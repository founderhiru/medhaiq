// ═══════════════════════════════════════════════════════════════════════════
// routes/interview.js 
// Interview API routes — Full Session Lifecycle with Quality Guardrails
// ═══════════════════════════════════════════════════════════════════════════
const express = require('express');
const crypto = require('crypto'); // built-in Node module — used ONLY for the diagnostic hash trace below, no new dependency
// FEATURE FLAG — set DEBUG_HASH_TRACE=true in the environment to enable
// the diagnostic hash-trace logging below. Leave unset/false to disable
// cleanly after diagnosis — no code changes needed, just the env var.
const DEBUG_HASH_TRACE = process.env.DEBUG_HASH_TRACE === 'true';
const router = express.Router();
const {
  generateNextQuestion,
  scoreAnswer,
  generateReport,
  computeStarProgress,
  hasSufficientCoverage,
  PERSONAS,
} = require('../services/interview');
const { recordClaudeSessionCost } = require('../lib/cost-recorder');

const {
  createSession,
  getSession,
  getSessionQuestions,
  getSessionScores,
  addQuestion,
  addAnswer,
  addScore,
  saveReport,
  completeSession,
  abandonSession,
  touchSessionActivity,
  touchUserActivity,
  expireSessionForInactivity,
} = require('../db/interview');
const { sendInterviewReportEmail } = require('../services/email');
const {
  buildCompetencyMatrix,
  parseJdCompetencies,
  getRoleDefaults,
  getOrgTraits,
  MAX_JD_TEXT_CHARS,
} = require('../services/competency-matrix');
const sessionController = require('../controllers/sessionController');
// requireAuth + requireInterviewEntitlement now live in middleware/guards.js
// — single shared implementation built on the Capability Engine.
const { requireAuth, requireInterviewEntitlement } = require('../middleware/guards');
const { buildRadarPolygon } = require('../lib/radar-polygon');
// Anti-Abuse & Free-Offer Guardrail — burst protection on session START
// only (never on in-progress endpoints: answer/heartbeat/next-question).
const { interviewStartLimiter } = require('../middleware/rate-limit');
// Discovery Profile (Phase 2, additive) — decides ONLY whether Discovery or
// the existing generateNextQuestion() supplies the next question on turn
// 2+. Never modifies, wraps, or duplicates generateNextQuestion() itself.
const { selectDiscoveryProfile } = require('../services/discovery/discovery-router');
const { decideNextTurn } = require('../services/discovery/opening-strategy');
// question_type values authored by Discovery — deliberately NOT added to
// isPrimaryQuestionType() below, so discovery turns never count toward the
// 5-primary session budget and never interfere with follow-up eligibility.
function isDiscoveryQuestionType(questionType) {
  return questionType === 'discovery_opening' || questionType === 'discovery_followup';
}
// Per the config-driven-business-rules directive: this was previously its
// own local `const MAX_SESSION_MINUTES = 25`, defined independently of the
// identical value in config/plans.js. Sourcing it from there means there is
// now exactly one place this number can be changed.
const { INTERVIEW_MAX_SESSION_MINUTES } = require('../config/plans');

// Idle-timeout feature (minimal version, 2026-08-05) — see
// processInterviewAnswer below. Kept as a local constant rather than a
// config export: nothing else needs this number (no frontend warning
// timer to keep in sync with), so a shared export would be an extra
// moving part with no actual consumer.
const IDLE_TIMEOUT_MINUTES = 10;

// NOTE: harmonicAlignmentEngine (services/harmonicAlignmentEngine.js) only
// builds the JD/company/role competency matrix — it exports
// aiExtractJdCompetencies() and compileWeightedCompetencyMatrix(), and has
// never had a "next question" picker. generateNextQuestion() in
// services/interview.js is the single source of truth for question text —
// both the text-answer route and the Vapi webhook below call the same
// pickAndPersistNextQuestion(), which now calls generateNextQuestion().

// ── POST /api/interview/sessions — create session + generate opening question
// requireInterviewEntitlement runs AFTER requireAuth: blocks session
// creation if the user already has an active session (409) or has
// exhausted their plan's interview minutes (403) — the action-level gate
// per spec Section 5, not a page-level one.
router.post('/sessions', interviewStartLimiter, requireAuth, requireInterviewEntitlement, sessionController.initializeSession);
router.post('/session/initialize', interviewStartLimiter, requireAuth, requireInterviewEntitlement, sessionController.initializeSession);

// ── Primary vs follow-up question type helper ───────────────────────────────
// 'opening' and 'primary' are the current values; 'drill_down' is the legacy
// value used before this conversation-flow redesign — any session already
// in progress when this deploys still has 'drill_down' rows and must keep
// counting them as primary questions, or an in-flight interview's progress
// counter would silently jump or its session-end trigger would misfire.
function isPrimaryQuestionType(questionType) {
  return questionType === 'opening' || questionType === 'primary' || questionType === 'drill_down';
}

// ── Shared: pick + persist the next question for a session ──────────────────
// Hard session time cap — independent of the primary/follow-up structural
// bound. A candidate spending 8 minutes on one answer would otherwise be
// able to stretch a "N turns max" session indefinitely.
//
// Interview Policy (question budget + duration cap): read directly off
// `session.interview_policy` — the value frozen once, at creation, by
// controllers/sessionController.js — NEVER re-resolved from the
// candidate's current package. This also means MAX_QUESTIONS is no
// longer a caller-supplied parameter: it used to be, and one of this
// function's two call sites (the Vapi webhook, below) silently omitted
// it and fell back to a hardcoded default without anyone noticing —
// deriving it internally from the session itself removes that entire
// class of bug, since every caller now automatically gets the same
// answer with no argument to forget.
//
// LEGACY_QUESTION_BUDGET / a session with no interview_policy (created
// before this feature shipped) falls back to exactly the value every
// session used before packages had their own durations — a genuine
// no-op for anything already in progress when this ships.
const LEGACY_QUESTION_BUDGET = 5;

function getSessionQuestionBudget(session) {
  return session.question_budget || LEGACY_QUESTION_BUDGET;
}
// Executive Extension budget (Leadership only) — how many additional
// adaptive questions may be asked beyond the visible budget, IF coverage
// is insufficient at that point (see hasSufficientCoverage gate below).
// Defaults to 0 for any session without this column populated — a
// session created before this feature shipped, or any Explorer/Growth
// session, simply has no extension capacity, which is exactly today's
// existing behavior for those tiers.
function getSessionExtensionBudget(session) {
  return session.executive_extension_budget || 0;
}
function getSessionDurationMinutes(session) {
  return session.session_duration_minutes || INTERVIEW_MAX_SESSION_MINUTES;
}

async function pickAndPersistNextQuestion(session) {
  const visibleQuestionBudget = getSessionQuestionBudget(session);
  const executiveExtensionBudget = getSessionExtensionBudget(session);
  const totalQuestionCeiling = visibleQuestionBudget + executiveExtensionBudget;
  const sessionDurationMinutes = getSessionDurationMinutes(session);
  const allQuestions = await getSessionQuestions(session.id);

  // Moved earlier (was previously built just before the generateNextQuestion
  // call further down) so the Executive Extension coverage gate below can
  // reuse this exact same qaPairs construction — one computation, two
  // consumers, never duplicated logic that could quietly drift apart.
  const allScores = await getSessionScores(session.id);
  const scoreByQuestionId = new Map(allScores.map(s => [s.question_id, Number(s.weighted_overall)]));
  const answeredQuestions = allQuestions.filter(q => q.answer_text !== null && q.answer_text !== undefined);
  const engineAnsweredQuestions = answeredQuestions.filter(q => !isDiscoveryQuestionType(q.question_type));
  const qaPairs = engineAnsweredQuestions.map(q => ({
    question: q.question_text,
    answer: q.answer_text,
    // NOTE: score is a real Number here, not the raw Postgres NUMERIC
    // string — "0.00" is truthy in JS, which previously made a skipped
    // (0-score) answer look like a valid low score and incorrectly
    // triggered a drill-down question with no real answer to drill into.
    score: Number.isFinite(scoreByQuestionId.get(q.id)) ? scoreByQuestionId.get(q.id) : null,
    wasSkipped: q.answer_text === '',
    storyKey: q.story_key || null,
    competency: q.competency || null,
  }));

  const countAnsweredPrimaries = (qs) => qs.filter(q =>
    isPrimaryQuestionType(q.question_type) && q.answer_text !== null && q.answer_text !== undefined
  ).length;

  // Time cap check — first, before any other guard, so a session that has
  // simply run too long ends immediately regardless of question counts.
  if (session.started_at) {
    const elapsedMinutes = (Date.now() - new Date(session.started_at).getTime()) / 60000;
    if (elapsedMinutes >= sessionDurationMinutes) {
      return {
        done: true,
        text: "We're at the time limit for this session — thank you. I'll put together your intelligence report now.",
        question: {
          id: 'session_done',
          text: "We're at the time limit for this session — thank you. I'll put together your intelligence report now.",
          type: 'done',
          order: totalQuestionCeiling
        }
      };
    }
  }

  // 1. Idempotency guard: returns current pending question if it exists
  const pending = allQuestions.find(q => q.answer_text === null || q.answer_text === undefined);
  if (pending) {

    // 🚨 GUARD 1: FINAL QUESTION RACE CONDITION — counts PRIMARY answers only,
    // so a follow-up mixed into the sequence can never mis-trigger this.
    // Uses the TOTAL ceiling (visible budget + any Executive Extension
    // allowance), not just the visible budget — a pending extension
    // question (Leadership, coverage was insufficient at question 5)
    // must still be answerable, not blocked here.
    const _guard1AnsweredPrimaries = countAnsweredPrimaries(allQuestions);
    if (_guard1AnsweredPrimaries >= totalQuestionCeiling) {
      return {
        done: true,
        text: "That's all the questions for this interview — thank you. I'll put together your intelligence report now.",
        question: {
          id: pending.id || 'session_done',
          text: "That's all the questions for this interview — thank you. I'll put together your intelligence report now.",
          type: 'done',
          order: totalQuestionCeiling
        }
      };
    }

    return {
      done: false,
      id: pending.id,
      text: pending.question_text,
      type: pending.question_type,
      isFollowup: pending.question_type === 'follow_up',
      order: pending.question_order,
      isFinalQuestion: isPrimaryQuestionType(pending.question_type) &&
  (_guard1AnsweredPrimaries + 1) >= totalQuestionCeiling,
      // Authoritative Adaptive Follow-up signal — reuses the same
      // primary-only count already computed above for isFinalQuestion.
      // Phase-based, not per-question: true once primary-only progress
      // has reached the visible budget, regardless of whether THIS turn
      // happens to be a follow-up (a follow-up occurring during a
      // genuine extension should still read as Adaptive Follow-up) or a
      // primary. Never derived from raw question_order, which also
      // counts ordinary follow-ups and would overcount.
      isExecutiveExtension: _guard1AnsweredPrimaries >= visibleQuestionBudget,
      extensionQuestionNumber: _guard1AnsweredPrimaries - visibleQuestionBudget + 1,
      competency: pending.competency || null,
      audio_url: null,
      question: {
        id: pending.id,
        text: pending.question_text,
        type: pending.question_type,
        isFollowup: pending.question_type === 'follow_up',
        order: pending.question_order,
        isFinalQuestion: isPrimaryQuestionType(pending.question_type) &&
  (_guard1AnsweredPrimaries + 1) >= totalQuestionCeiling,
        isExecutiveExtension: _guard1AnsweredPrimaries >= visibleQuestionBudget,
        extensionQuestionNumber: _guard1AnsweredPrimaries - visibleQuestionBudget + 1,
        competency: pending.competency || null
      }
    };
  }

  // 2. Check if the maximum PRIMARY questions limit has already been met
  const answeredPrimaryCount = countAnsweredPrimaries(allQuestions);

  // 🚨 GUARD 2: session completion decision.
  // Three cases, in order:
  //   a) Total ceiling reached (visible budget + extension budget, if any)
  //      -> hard stop, no exceptions, regardless of coverage.
  //   b) Visible budget reached but ceiling not yet reached (only
  //      possible for Leadership, where executiveExtensionBudget > 0) ->
  //      check coverage via the EXISTING Coverage/Hypothesis Engine
  //      (hasSufficientCoverage — see services/interview.js; not a new
  //      algorithm, a read of the same snapshot generateNextQuestion
  //      already computes every turn). Sufficient -> stop here, exactly
  //      like Growth/Explorer would. Insufficient -> fall through and
  //      let the existing question-selection logic decide the next
  //      question normally (competency gap, follow-up, or scenario —
  //      whatever it would already decide) for one more turn.
  //   c) Visible budget not yet reached -> unchanged, fall through.
  if (answeredPrimaryCount >= totalQuestionCeiling) {
    return {
      done: true,
      text: "That's all the questions for this interview — thank you. I'll put together your intelligence report now.",
      question: {
        id: 'session_done',
        text: "That's all the questions for this interview — thank you. I'll put together your intelligence report now.",
        type: 'done',
        order: totalQuestionCeiling
      }
    };
  }

  if (answeredPrimaryCount >= visibleQuestionBudget) {
    const coverageIsSufficient = hasSufficientCoverage({
      roleTitle: session.role_title,
      qaPairs,
      questionCount: answeredPrimaryCount,
    });
    if (coverageIsSufficient) {
      return {
        done: true,
        text: "That's all the questions for this interview — thank you. I'll put together your intelligence report now.",
        question: {
          id: 'session_done',
          text: "That's all the questions for this interview — thank you. I'll put together your intelligence report now.",
          type: 'done',
          order: visibleQuestionBudget
        }
      };
    }
    // Coverage insufficient and extension budget remains — fall through
    // to the exact same question-selection logic every other turn uses.
  }

  // 2b. Decide: is this turn the (at most one) adaptive follow-up to the
  // primary that was just answered, or a new primary? Fully deterministic —
  // the model has no say in whether a follow-up happens, only in writing
  // it once orchestration decides one should. Eligibility is based on the
  // candidate's actual answer substance (word count + real STAR-component
  // detection via the existing computeStarProgress()), not just "was it
  // skipped" — a technically-answered-but-thin response shouldn't earn a
  // follow-up any more than a skipped one does.
  const primaries = allQuestions.filter(q => isPrimaryQuestionType(q.question_type));
  const lastPrimary = primaries[primaries.length - 1] || null;
  const lastPrimaryWasSkipped = !!lastPrimary && lastPrimary.answer_text === '';
  const followupAlreadyUsedForLastPrimary = !!lastPrimary && allQuestions.some(q =>
    q.question_type === 'follow_up' && String(q.parent_question_id) === String(lastPrimary.id)
  );
  const lastPrimaryHasSubstance = (() => {
    if (!lastPrimary || lastPrimaryWasSkipped || !lastPrimary.answer_text) return false;
    const clean = lastPrimary.answer_text.trim().replace(/\s+/g, ' ');
    const wordCount = clean.split(' ').filter(Boolean).length;
    if (wordCount < 20) return false; // too thin to have anything worth deepening
    const star = computeStarProgress(lastPrimary.answer_text);
    const starComponentCount = ['situation', 'task', 'action', 'result'].filter(k => star[k]).length;
    return starComponentCount >= 2 || wordCount >= 40;
  })();
  const isFollowupTurn = !!(
    lastPrimary &&
    lastPrimaryHasSubstance &&
    !followupAlreadyUsedForLastPrimary &&
    answeredPrimaryCount < totalQuestionCeiling // never offer a follow-up after the final question (visible or extension) — go straight to the report
  );

  // 3. Generate the next question — single source of truth.
  // This is the exact same function that generates the opening question in
  // controllers/sessionController.js, using the exact same session-stored
  // jdText / competencyMatrix / roleTitle. Whatever this returns is what BOTH
  // the frontend text UI (via /sessions/:id/answer) and Vapi (via
  // /vapi/next-question below) will see, because both call this one
  // function and both read/write the same interview_questions row.
  // (allScores/qaPairs etc. were already built earlier in this function —
  // reused here, not rebuilt, so the coverage gate above and question
  // generation below can never see two different snapshots of the same data.)

  let competencyMatrix = session.competency_matrix;
  if (typeof competencyMatrix === 'string') {
    try { competencyMatrix = JSON.parse(competencyMatrix); } catch (e) { competencyMatrix = []; }
  }

  // Resume Intelligence: read the immutable per-session snapshot (set once
  // at initializeSession, see controllers/sessionController.js) — never
  // re-read from career_profiles here, so a mid-session resume replace can
  // never change an interview already in progress.
  let resumeContext = session.resume_context;
  if (typeof resumeContext === 'string') {
    try { resumeContext = JSON.parse(resumeContext); } catch (e) { resumeContext = null; }
  }
  let storyLibrary = session.story_library;
  if (typeof storyLibrary === 'string') {
    try { storyLibrary = JSON.parse(storyLibrary); } catch (e) { storyLibrary = []; }
  }

  // ── Discovery Router / Opening Strategy (additive, stateless gate) ──────
  // Recomputed fresh on every turn from data already loaded above — the
  // session's frozen experience_level/resume_context/story_library plus a
  // count of already-persisted discovery rows. No runtime object survives
  // between requests, no new session/DB field, nothing to reset. For any
  // profile with usesDiscoveryOpening=false (Professional/Leadership/
  // Executive in v1), decideNextTurn() always returns useDiscovery:false —
  // a hard no-op — and generateNextQuestion() below is reached exactly as
  // it was before this feature existed.
  const { profile: discoveryProfile } = selectDiscoveryProfile({
    experienceLevel: session.experience_level,
    resumeContext,
    storyLibrary,
  });
  const discoveryAnsweredCount = allQuestions.filter(q =>
    isDiscoveryQuestionType(q.question_type) && q.answer_text !== null && q.answer_text !== undefined
  ).length;
  const discoveryTurn = decideNextTurn({ profile: discoveryProfile, discoveryAnsweredCount });

  if (discoveryTurn.useDiscovery) {
    // Discovery still owns this turn. generateNextQuestion() is NOT called
    // — persisted via the same addQuestion() path everything else uses, so
    // history/reports/analytics read this row exactly like any other.
    const questionOrder = answeredQuestions.length; // same convention as below: keeps DB ordering monotonic across the whole session, discovery rows included
    const savedDiscoveryQuestion = await addQuestion({
      sessionId: session.id,
      questionText: discoveryTurn.questionText,
      personaId: session.persona_id,
      questionType: discoveryTurn.discoveryQuestionType,
      questionOrder,
      competency: null,
      storyKey: null,
      parentQuestionId: null,
      questionBlueprint: null,
      questionPosition: null,
    });
    return {
      done: false,
      id: savedDiscoveryQuestion.id,
      text: savedDiscoveryQuestion.question_text,
      type: savedDiscoveryQuestion.question_type,
      isFollowup: false,
      order: savedDiscoveryQuestion.question_order,
      competency: null,
      audio_url: null,
      question: {
        id: savedDiscoveryQuestion.id,
        text: savedDiscoveryQuestion.question_text,
        type: savedDiscoveryQuestion.question_type,
        isFollowup: false,
        order: savedDiscoveryQuestion.question_order,
        competency: null,
      },
    };
  }
  // ── Explicit one-way handoff ─────────────────────────────────────────────
  // discoveryTurn.useDiscovery is false from here on for this session,
  // forever: discoveryAnsweredCount only grows (a count of already-answered
  // rows) and discoveryProfile is a fixed function of immutable session
  // fields, so this branch can never be re-entered. Nothing below this line
  // is new — this is the pre-existing code path, completely unmodified.

  // Executive Interview Strategy — additive only. Simply "which primary
  // number is this" (1-5); undefined for follow-ups, since the strategy
  // layer is explicitly scoped to primaries only and follow-up logic
  // itself is completely untouched. Does not affect answeredPrimaryCount,
  // isFollowupTurn, or any existing eligibility check above.
  const questionPosition = isFollowupTurn ? undefined : (answeredPrimaryCount + 1);

  const generated = await generateNextQuestion({
    sessionId: session.id,
    personaId: session.persona_id,
    roleTitle: session.role_title,
    experienceLevel: session.experience_level,
    orgPreset: session.org_preset,
    competencyMatrix: competencyMatrix || [],
    jdText: session.jd_text || '',
    qaPairs,
    questionCount: engineAnsweredQuestions.length,
    resumeContext,
    storyLibrary: storyLibrary || [],
    isFollowup: isFollowupTurn,
    questionPosition,
    forcedCompetency: isFollowupTurn ? lastPrimary.competency : undefined,
    forcedStoryKey: isFollowupTurn ? lastPrimary.story_key : undefined,
  });

  const questionOrder = answeredQuestions.length; // 0-indexed, matches opening question's order:0
  const savedQuestion = await addQuestion({
    sessionId: session.id,
    questionText: generated.text,
    personaId: session.persona_id,
    questionType: isFollowupTurn ? 'follow_up' : 'primary',
    questionOrder,
    competency: generated.competency,
    storyKey: generated.storyKey,
    parentQuestionId: isFollowupTurn ? lastPrimary.id : null,
    questionBlueprint: generated.questionBlueprint,
    questionPosition,
    strategySource: generated.questionBlueprint ? generated.questionBlueprint.strategy_source : null,
    strategyPurpose: generated.questionBlueprint ? generated.questionBlueprint.strategy_purpose : null,
  });

  // Authoritative "is this the final question" — deterministic, not a
  // guess: true only when answering this question will bring the primary
  // count to the hard ceiling (GUARD 2a above), which always stops
  // unconditionally regardless of coverage. Deliberately does NOT try to
  // predict a coverage-based early stop (e.g. Q5/Q6 ending early because
  // evidence was sufficient) — that genuinely isn't knowable until the
  // answer is scored, and is correctly communicated via sessionEnded on
  // the NEXT response instead. Replaces the client's own QN>=MAXQ guess
  // (views/interview-session.ejs), which used the visible budget instead
  // of the real ceiling and could be wrong during a Leadership extension.
  const isFinalQuestion = !isFollowupTurn && (answeredPrimaryCount + 1) >= totalQuestionCeiling;
  // Authoritative Adaptive Follow-up signal — same reasoning and same
  // primary-only source (answeredPrimaryCount) as isFinalQuestion just
  // above. Phase-based: true once primary-only progress has reached the
  // visible budget, independent of whether THIS specific turn is a
  // follow-up or a primary — a follow-up occurring during a genuine
  // extension should still read as Adaptive Follow-up (existing header
  // behavior, unchanged), while an ordinary follow-up occurring BEFORE
  // the visible budget is reached must not inflate this. Never derived
  // from question_order, which also counts ordinary follow-ups.
  const isExecutiveExtension = answeredPrimaryCount >= visibleQuestionBudget;
  const extensionQuestionNumber = answeredPrimaryCount - visibleQuestionBudget + 1;

  return {
    done: false,
    id: savedQuestion.id,
    text: savedQuestion.question_text,
    type: savedQuestion.question_type,
    isFollowup: isFollowupTurn,
    order: savedQuestion.question_order,
    isFinalQuestion,
    isExecutiveExtension,
    extensionQuestionNumber,
    competency: generated.competency || null,
    audio_url: null,
    question: {
      id: savedQuestion.id,
      text: savedQuestion.question_text,
      type: savedQuestion.question_type,
      isFollowup: isFollowupTurn,
      order: savedQuestion.question_order,
      isFinalQuestion,
      isExecutiveExtension,
      extensionQuestionNumber,
      competency: generated.competency || null,
    },
  };
}

// ── Shared answer-processing core — used by BOTH the HTTP route below AND
// routes/vapi.js. This is the single source of truth the whole "Backend
// must be the single source of truth" requirement depends on: there is
// exactly one implementation of "process this answer and decide what
// happens next," not two independently-maintained copies that can drift
// apart. Returns a plain { httpStatus, body } object rather than calling
// res.json directly, so callers without a real Express req/res (like the
// Vapi webhook) can use it identically to the HTTP route.
// Idle-timeout feature (2026-08-05, extended). Shared by every protected
// endpoint that advances interview state (currently: processInterviewAnswer
// and /vapi/next-question below) — one implementation, not a copy per
// route. last_user_activity_at only advances on genuine candidate
// actions (touchUserActivity — see its call sites) — never on the
// heartbeat's unconditional 60s auto-ping, AI speech, TTS, score
// updates, or polling. expireSessionForInactivity anchors ended_at to
// that same timestamp (not NOW()), so no idle time is ever billed.
// Returns null if the session is fine to proceed; the exact 410 shape
// (or the pre-existing 400 for an already-inactive session) otherwise.
async function checkSessionActiveAndNotIdle(session, sessionId, opts) {
  if (session.status !== 'active') return { httpStatus: 400, body: { error: 'Session is not active' } };

  // "Actively recording" bypass (2026-08-05 follow-up): while the
  // candidate is genuinely mid-speech, the idle-minutes evaluation is
  // skipped entirely — not just deferred by touching the timestamp, but
  // not evaluated at all — so a long spoken answer can never trigger a
  // false expiry no matter how long it runs. The active-session check
  // above still applies regardless, so an already-ended session is never
  // let through just because this flag was set.
  if (opts && opts.skipIdleCheck) return null;

  const lastUserActivityAt = session.last_user_activity_at || session.started_at;
  const idleMinutes = (Date.now() - new Date(lastUserActivityAt).getTime()) / 60000;
  if (idleMinutes > IDLE_TIMEOUT_MINUTES) {
    await expireSessionForInactivity(sessionId);
    return {
      httpStatus: 410,
      body: {
        code: 'SESSION_EXPIRED',
        message: 'Your interview session expired due to 10 minutes of inactivity.',
      },
    };
  }
  return null;
}

async function processInterviewAnswer({ sessionId, questionId, answerText, skip, voiceMode, micLive, userId, userEmail, userName, app }) {
  // One turnId per invocation — the single correlating value threaded
  // through every log line for this request/response round-trip, so
  // backend generation, frontend receipt, UI render, and vapi.say() can
  // all be matched up by grepping for the same TURN_ID.
  const turnId = Math.random().toString(16).slice(2, 8);
  console.log(`[turn-trace] TURN_ID=${turnId} processInterviewAnswer start: sessionId=${sessionId} questionId=${questionId} skip=${!!skip} voiceMode=${!!voiceMode}`);

  // ── Per-stage timing instrumentation (diagnostics only, 2026-07-24) ──
  // Purely additive: measures the existing call sequence, changes nothing
  // about it. Correlates with turnId, same value already threaded through
  // every other log line here, so a full turn's timing (this server-side
  // breakdown plus the client's own STT/TTS/playback timing, already
  // logged separately) can be reconstructed by grepping one turnId across
  // both server and browser console logs.
  const _timing = { turnStart: process.hrtime.bigint() };
  function _msSince(mark) { return Number(process.hrtime.bigint() - mark) / 1e6; }
  function _msBetween(a, b) { return Number(b - a) / 1e6; }

  if (!questionId) return { httpStatus: 400, body: { error: 'questionId required' } };

  // Verify session ownership
  const session = await getSession(sessionId);
  if (!session) return { httpStatus: 404, body: { error: 'Session not found' } };
  if (String(session.user_id) !== String(userId)) return { httpStatus: 403, body: { error: 'Forbidden' } };
  // "Actively recording" bypass (2026-08-05 follow-up): voiceMode is
  // only ever true from the Vapi webhook (routes/vapi.js), which by
  // construction only fires during a live call — recording is
  // definitionally active there. micLive is the HTTP path's own signal,
  // reported by the frontend's actual mic state at submission time.
  const idleCheck = await checkSessionActiveAndNotIdle(session, sessionId, { skipIdleCheck: !!voiceMode || !!micLive });
  if (idleCheck) return idleCheck;
  // Genuine activity, regardless of channel — shared here (not just the
  // HTTP route) so the Vapi voice-answer path also resets the idle
  // clock, not just typed/HTTP submissions.
  touchUserActivity(sessionId).catch((e) => console.warn('[interview] touchUserActivity failed (non-fatal):', e.message));

  // Interview Policy — read from THIS session's frozen columns (see
  // pickAndPersistNextQuestion's header comment above), not re-resolved
  // from the candidate's current package. Must be declared after session
  // load. totalQuestionCeiling (visible budget + any Executive Extension
  // allowance) is what this function's own early-exit check below must
  // use — NOT the visible budget alone, or a Leadership session would be
  // finalized here, before ever reaching pickAndPersistNextQuestion's own
  // coverage-gate logic, silently skipping the extension entirely.
  const visibleQuestionBudget = getSessionQuestionBudget(session);
  const executiveExtensionBudget = getSessionExtensionBudget(session);
  const totalQuestionCeiling = visibleQuestionBudget + executiveExtensionBudget;

  const allQuestions = await getSessionQuestions(sessionId);

  // ── RESPONSE INTENT CLASSIFICATION (no LLM) — formalized 2026-08-13 ────
  // Four states: ANSWER, SKIP, DONT_KNOW, SPARSE. Replaces the previous
  // two-separate-checks approach (a boolean skip detector, then a
  // separate inline sparse-phrase check) with one classifier evaluated
  // once, in priority order SKIP → DONT_KNOW → SPARSE → ANSWER. This is
  // the SAME shared function both typed answers and Vapi voice answers
  // go through — there has only ever been one call path
  // (processInterviewAnswer), so no separate classification system for
  // voice was introduced.
  //
  // SKIP and DONT_KNOW phrase lists and word-count gates are the exact
  // same ones already proven in production (including the 2026-07-29
  // SKIP_DESIRE_REGEX fix for "I'd like to skip"-style phrasing) — DONT_KNOW
  // is newly split OUT of what used to be lumped into SKIP
  // ("i don't know", "no idea", etc. used to set effectiveSkip=true with
  // no way to tell it apart from a real "skip"/"pass"). The false-positive
  // guard for DONT_KNOW mirrors the existing pattern already used for
  // SKIP's ambiguous phrases (AMBIGUOUS_SKIP_PHRASES's <=6-word gate): an
  // 8-word ceiling comfortably covers every genuine DONT_KNOW example
  // ("I'm not familiar with that" = 5 words) while excluding the two
  // documented false-positive cases ("I don't know the exact number, but
  // I believe the project saved 20%" = 13 words; "I don't know whether
  // that was the right decision, but here is what I did..." = 15 words) —
  // both correctly fall through to ANSWER.
  const STRONG_SKIP_PHRASES = [
    'skip this', 'pass this', 'just skip', 'just pass', 'skip it', 'pass it',
    "let's skip", "lets skip", 'skip question', 'pass question', 'next question',
    'go next', 'go to next',
  ];
  // These are genuinely ambiguous — "I decided to move on from the vendor
  // after repeated delivery failures" is a legitimate story that happens
  // to contain "move on". They only count as skip-intent when they make
  // up almost the entire short message (<=6 words), not when embedded in
  // a longer, real answer.
  const AMBIGUOUS_SKIP_PHRASES = ['move on', "let's move on", "lets move on", 'move forward', 'continue'];
  const SKIP_DESIRE_REGEX = /\b(?:want|like)\s+to\s+(?:skip|pass)\b/;
  const DONT_KNOW_PHRASES = [
    "i don't know", "i dont know", "don't know", "dont know", 'no idea',
    "i have no idea", 'not sure', "i'm not sure", 'im not sure',
    'not familiar with that', "i'm not familiar with that", 'im not familiar with that',
  ];
  const DONT_KNOW_MAX_WORDS = 8;
  const SPARSE_PHRASES = new Set(['yes', 'no', 'ok', 'sure', 'yep', 'nope', 'yeah', 'maybe', 'not really', 'yes.', 'no.']);
  const SPARSE_MIN_WORDS = 5;

  const cleanInputForIntent = (answerText || '').trim();
  const intentWordCount = cleanInputForIntent.split(/\s+/).filter(Boolean).length;
  const normalizedIntentInput = cleanInputForIntent.toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();

  function classifyResponseIntent() {
    if (skip) return 'SKIP'; // explicit Skip button — never reclassified
    // SKIP — same 15-word ceiling already proven in production. An empty
    // cleanInputForIntent falls through untouched to the SPARSE check
    // below (word count 0 < 5), matching the exact pre-existing behavior
    // for a blank submission with the Skip button NOT clicked — not
    // reclassified as SKIP here.
    if (cleanInputForIntent && intentWordCount <= 15) {
      if (/^(skip|pass|next)$/.test(normalizedIntentInput)) return 'SKIP';
      if (SKIP_DESIRE_REGEX.test(normalizedIntentInput)) return 'SKIP';
      if (STRONG_SKIP_PHRASES.some((phrase) => normalizedIntentInput.includes(phrase))) return 'SKIP';
      if (intentWordCount <= 6 && AMBIGUOUS_SKIP_PHRASES.some((phrase) => normalizedIntentInput.includes(phrase))) return 'SKIP';
    }
    // DONT_KNOW — 8-word ceiling (see comment above for why).
    if (intentWordCount <= DONT_KNOW_MAX_WORDS && DONT_KNOW_PHRASES.some((phrase) => normalizedIntentInput.includes(phrase))) {
      return 'DONT_KNOW';
    }
    // SPARSE — same guardrail thresholds already in production.
    if (intentWordCount < SPARSE_MIN_WORDS || SPARSE_PHRASES.has(normalizedIntentInput)) {
      return 'SPARSE';
    }
    return 'ANSWER';
  }

  const responseIntent = classifyResponseIntent();
  if (responseIntent !== 'ANSWER') {
    console.log(`[intent-router] Classified as ${responseIntent}: "${cleanInputForIntent}"`);
  }
  // effectiveSkip = "advance without scoring, don't reprompt" — true for
  // BOTH SKIP and DONT_KNOW. Kept as one boolean (rather than touching
  // every downstream site individually) because every existing consumer
  // of effectiveSkip below (starProgress's zero object, the wasSkipped
  // API field, the voice closing-line phrasing) treats "explicit skip"
  // and "don't know" identically from a session-flow point of view — the
  // only place SKIP and DONT_KNOW actually need to be told apart is (a)
  // what gets persisted (responseIntent, new) and (b) the scoring gate
  // just below (also new). This keeps the diff to exactly those two
  // places instead of touching voice/UI-facing code paths that were
  // explicitly flagged as protected.
  const effectiveSkip = responseIntent === 'SKIP' || responseIntent === 'DONT_KNOW';

  if (responseIntent === 'SPARSE') {
    const cleanInput = cleanInputForIntent.replace(/\s+/g, ' ');
    console.log(`[guardrail] Intercepted sparse answer: "${cleanInput}". Blocking database commit.`);

    const repromptText = "I see. Could you please expand on that answer with a bit more detail or a specific example from your professional experience?";
    console.log(`[turn-trace] TURN_ID=${turnId} Backend generated (REPROMPT, same question — must NOT advance): QuestionId=${questionId}`);
    if (DEBUG_HASH_TRACE) {
      console.log(`[HASH-TRACE] stage=1_backend_answer_response turnId=${turnId} questionId=${questionId} type=reprompt validationFailed=true len=${repromptText.length} first80=${JSON.stringify(repromptText.slice(0, 80))} sha256=${crypto.createHash('sha256').update(repromptText).digest('hex')}`);
    }

    return {
      httpStatus: 200,
      body: {
        sessionEnded: false,
        validationFailed: true,
        turnId,
        wasSkipped: false,
        scores: { star: 0, technical: 0, executive: 0, gcc: 0, friction: 0, weighted: 0 },
        star_progress: { situation: false, task: false, action: false, result: false, stepsComplete: 0, totalSteps: 4 },
        intelligence_scores: { overallScore: 0, vectors: { structure: 0, technicalDepth: 0, executivePresence: 0, gccReadiness: 0, communicationClarity: 0 } },
        text: repromptText,
        question: {
          id: questionId,
          text: repromptText,
          type: 'reprompt',
          order: allQuestions.filter(q => q.answer_text !== null).length
        },
        uiText: repromptText,
        audioPrompt: repromptText,
        competency_tag: null
      },
    };
  }

  // 1. Save valid answer to database — response_intent persisted
  // explicitly for every new row (migration 025). SKIP/DONT_KNOW save
  // empty answer_text, same as before; ANSWER saves the real text.
  _timing.beforeAnswerSave = process.hrtime.bigint();
  const savedAnswer = await addAnswer({
    sessionId,
    questionId,
    answerText: effectiveSkip ? '' : (answerText || ''),
    responseIntent,
  });
  _timing.afterAnswerSave = process.hrtime.bigint();
  if (!savedAnswer) {
    return {
      httpStatus: 409,
      body: { error: 'This question was already answered — ignoring duplicate submission.', duplicate: true },
    };
  }

  // ── Discovery Scoring Gate (additive, orchestration-level only) ─────────
  // Discovery-authored questions (services/discovery/*) are contextual
  // onboarding, not an evaluated interview turn. This decides ONLY whether
  // scoreAnswer()/addScore() are invoked for THIS answer — it does not
  // modify either function, and every non-Discovery question type below
  // reaches them exactly as before this gate existed.
  const answeredQuestionRow = allQuestions.find(q => String(q.id) === String(questionId));
  const isDiscoveryQuestion = isDiscoveryQuestionType(answeredQuestionRow && answeredQuestionRow.question_type);

  // 2. Score the validated answer — skipped entirely for Discovery turns
  // AND now (2026-08-13) for SKIP/DONT_KNOW turns too. Previously this
  // gate only checked isDiscoveryQuestion; a SKIP/DONT_KNOW turn still
  // got scored with a hardcoded {star:0,...} object and a real
  // interview_scores row written for it — exactly the "0/100 as
  // demonstrated incapability" problem the approved plan set out to fix.
  // No new averaging logic is introduced anywhere: lib/career-intelligence-
  // report.js's avgOf() already naturally excludes a question from the
  // average when there is simply no interview_scores row for it, which is
  // now the case for every SKIP/DONT_KNOW turn — same as it already was
  // for Discovery turns. `scores`/`starProgress`/`intelligenceScores` stay
  // null (not a fabricated zero object) for both cases; the frontend
  // already treats all three as optional, so this degrades exactly the
  // same way a Discovery turn already does.
  let scores = null;
  let starProgress = null;
  let intelligenceScores = null;
  _timing.beforeScoring = process.hrtime.bigint();
  const shouldScoreThisTurn = !isDiscoveryQuestion && !effectiveSkip;
  if (shouldScoreThisTurn) {
    if (answerText && answerText.trim()) {
     scores = await scoreAnswer(answerText, session.persona_id, {
        sessionId,
        roleTitle: session.role_title,
        experienceLevel: session.experience_level,
        orgPreset: session.org_preset,
      });
    } else {
      // Defensive fallback only — responseIntent 'ANSWER' should never
      // reach here with empty text (SPARSE/SKIP/DONT_KNOW would have
      // classified it first), kept so an unexpected empty-but-ANSWER case
      // still degrades to a real zero score row rather than a null-object
      // crash a few lines below.
      scores = { star: 0, technical: 0, executive: 0, gcc: 0, friction: 0, weighted: 0 };
    }
  }
  _timing.afterScoring = process.hrtime.bigint();
  _timing.scoringWasSkipped = !shouldScoreThisTurn; // for the diagnostic log below — a skip/dont-know/Discovery turn legitimately has ~0ms here, not a fast scoreAnswer() call

  _timing.beforeDbScore = process.hrtime.bigint();
  if (shouldScoreThisTurn) {
    await addScore({
      sessionId,
      questionId,
      star: scores.star,
      technical: scores.technical,
      executive: scores.executive,
      gcc: scores.gcc,
      friction: scores.friction,
      weighted: scores.weighted,
    });

    starProgress = computeStarProgress(answerText);

    intelligenceScores = {
      overallScore: scores.weighted,
      vectors: {
        structure: scores.star,
        technicalDepth: scores.technical,
        executivePresence: scores.executive,
        gccReadiness: scores.gcc,
        communicationClarity: scores.friction,
      },
    };
  }
  _timing.afterDbScore = process.hrtime.bigint();

  // 3. Recalculate answered counts safely — PRIMARY questions only.
  // Follow-ups are real Q&A exchanges (still scored, still in the report
  // below) but must never affect whether the session is considered
  // "done" — only the 5 primary questions count toward that.
  const updatedQuestions = await getSessionQuestions(sessionId);
  const answeredCount = updatedQuestions.filter(q =>
    isPrimaryQuestionType(q.question_type) && q.answer_text !== null && q.answer_text !== undefined
  ).length;

  // Shared finalize-and-report helper — used both when the 5th primary
  // has just been answered directly, AND when pickAndPersistNextQuestion
  // returns done:true for any other reason (time cap, or the GUARD1/
  // GUARD2 safety nets). Without this shared path, a done:true result
  // from the second case was previously returned to the candidate as if
  // it were a real next question, and the report/session-complete state
  // never actually got written.
  async function finalizeSessionAndRespond() {
    // ── Idempotency guard (report guardrail) ─────────────────────────────
    // A fresh re-fetch (NOT the outer `session` var, which was read at the
    // start of this request and is stale by the time we reach here) — if
    // another request already completed this session first (retry,
    // double-submit, or a race), skip straight to a normal-looking
    // response instead of re-running generateReport()/saveReport()/
    // completeSession()/email/PDF a second time. This closes the realistic
    // case (retry after the response already returned, double-click) —
    // it is not a database-level lock, so a true sub-millisecond
    // simultaneous race is not fully closed by this alone; a stronger
    // guarantee would need a DB transaction/constraint, which is out of
    // scope for "smallest possible guard."
    const freshSession = await getSession(sessionId);
    if (freshSession && freshSession.status === 'completed') {
      console.warn(`[finalize] session ${sessionId} already completed — skipping duplicate finalize (idempotency guard)`);
      return {
        httpStatus: 200,
        body: {
          sessionEnded: true,
          reportId: sessionId,
          turnId,
          wasSkipped: effectiveSkip,
          scores,
          star_progress: starProgress,
          intelligence_scores: intelligenceScores,
          text: "That completes your interview. Your report is ready.",
          audio_url: null,
          competency_tag: null,
        },
      };
    }

    const allScores = await getSessionScores(sessionId);
    const qaPairs = updatedQuestions
      .filter(q => q.answer_text !== null && q.answer_text !== undefined)
      .map(q => ({ question: q.question_text, answer: q.answer_text }));

    const reportData = await generateReport({
      sessionId,
      personaId: session.persona_id,
      roleTitle: session.role_title,
      experienceLevel: session.experience_level,
      orgPreset: session.org_preset,
      qaPairs,
      scores: allScores,
    });

    await saveReport({
      sessionId,
      overallScore: reportData.overall_score,
      strengthsJson: reportData.strengths_json,
      improvementsJson: reportData.improvements_json,
      personaVerdict: reportData.persona_verdict,
      nextStepsJson: reportData.next_steps_json,
      reportMarkdown: reportData.report_markdown,
      executiveSummary: reportData.executive_summary,
      recommendation: reportData.recommendation,
      strongestResponse: reportData.strongest_response,
      weakestResponse: reportData.weakest_response,
      structuralFlow: reportData.structural_flow,
      linguisticNuances: reportData.linguistic_nuances,
      scoreboard: reportData.scoreboard,
      executiveInterpretation: reportData.executive_interpretation,
      roleReadiness: reportData.role_readiness,
      nextLevelDirection: reportData.next_level_direction,
    });

    await completeSession(sessionId, reportData.overall_score);

    await recordClaudeSessionCost({ interviewId: sessionId, userId: session.user_id });

    try {
      const persona = PERSONAS[session.persona_id];
      if (userEmail) {
        // ── Canonical Career Intelligence Report (Step 4, see
        // docs/MEDHAIQ_REPORTING_DESIGN_V1.md) — the SAME builder already
        // used by the Web Report and PDF routes. allScores and
        // updatedQuestions are already fetched above (lines ~740/759) for
        // generateReport() and saveReport() — no new DB query is added
        // here, this just reuses them a second time. `session` +
        // `reportData` together provide everything buildCareerIntelligenceReport()
        // needs for sessionContext; ended_at is intentionally omitted (the
        // session is completing in this same request, so there is no
        // reliable "session end" timestamp yet) — the builder handles a
        // missing ended_at gracefully (durationMinutes becomes null,
        // unused by the email template).
        const { buildCareerIntelligenceReport } = require('../lib/career-intelligence-report');
        const cirReport = {
          session_id: sessionId,
          overall_score: reportData.overall_score,
          recommendation: reportData.recommendation,
          executive_summary: reportData.executive_summary,
          role_title: session.role_title,
          experience_level: session.experience_level,
          org_preset: session.org_preset,
          started_at: session.started_at || null,
          ended_at: null,
          created_at: new Date().toISOString(),
          structural_flow: reportData.structural_flow,
          linguistic_nuances: reportData.linguistic_nuances,
          persona_verdict: reportData.persona_verdict,
          strongest_response: reportData.strongest_response,
          weakest_response: reportData.weakest_response,
          next_steps_json: reportData.next_steps_json,
          // Leadership-only narrative layer — from this same in-memory
          // generateReport() result, not a DB re-read. See
          // lib/career-intelligence-report.js's leadershipInsights field.
          executive_interpretation: reportData.executive_interpretation,
          role_readiness: reportData.role_readiness,
          next_level_direction: reportData.next_level_direction,
          // Approved narrow correction (post-Step-4): passed through so the
          // canonical builder can carry the existing coaching sentence into
          // developmentPriorities[0].narrative for the email's Priority
          // section. Not a new data source — reportData.improvements_json
          // was already produced by the generateReport() call above.
          improvements_json: reportData.improvements_json,
        };
        const cir = buildCareerIntelligenceReport({
          report: cirReport, scoresData: allScores, questions: updatedQuestions, persona,
        });

        // ── Package resolution (report guardrail) ──────────────────────
        // The lightweight lookup capability-engine.js itself uses
        // internally — NOT the full resolveCapabilities(req), which this
        // function has no req to call anyway (it's shared with the Vapi
        // path) and which does several extra DB lookups (careerProfile,
        // up to 1000 sessions) irrelevant to just resolving a package_id.
        const { getActivePackageAcquisition } = require('../db/package-acquisitions');
        const { PRODUCT_PACKAGES, DEFAULT_PACKAGE_ID } = require('../config/product-packages');
        const activeAcquisition = await getActivePackageAcquisition(userId);
        const packageId = (activeAcquisition && PRODUCT_PACKAGES[activeAcquisition.package_id])
          ? activeAcquisition.package_id
          : DEFAULT_PACKAGE_ID;
        const permissions = PRODUCT_PACKAGES[packageId].permissions;
        const hasFullReport = permissions.includes('reports.full');
        const hasPdfAccess = permissions.includes('reports.executive');

        // ── Leadership PDF — generated ONLY if entitled, checked before
        // any rendering/Puppeteer work (same cost-guard principle as the
        // PDF route in server.js). A PDF failure must never break the
        // report or the email — caught locally, logged, and the email
        // still sends without the attachment.
        let pdfBuffer = null;
        let pdfFilename = null;
        if (hasPdfAccess) {
          try {
            const { renderReportPdf } = require('../services/pdf-report');
            const starAvg = cir.fiveVectors.structure;
            const technicalAvg = cir.fiveVectors.domainExpertise;
            const executiveAvg = cir.fiveVectors.strategicThinking;
            const gccAvg = cir.fiveVectors.leadershipExecution;
            const frictionAvg = cir.fiveVectors.communication;
            const radar = buildRadarPolygon([starAvg, technicalAvg, executiveAvg, gccAvg, frictionAvg]);
            const promotionReadiness  = reportData.overall_score >= 80 ? 'High' : reportData.overall_score >= 60 ? 'Medium' : 'Low';
            const leadershipPotential = executiveAvg >= 80 ? 'Strong' : executiveAvg >= 60 ? 'Developing' : 'Emerging';
            const confidenceLevel     = frictionAvg >= 80 ? 'High' : frictionAvg >= 55 ? 'Medium' : 'Low';
            let scoreboard = reportData.scoreboard || {};
            if (typeof scoreboard === 'string') { try { scoreboard = JSON.parse(scoreboard); } catch (e) { scoreboard = {}; } }
            const vectorBreakdown = Array.isArray(scoreboard.vector_breakdown) ? scoreboard.vector_breakdown : [];
            const vectorScoreMap = { structure: starAvg, technical: technicalAvg, executive: executiveAvg, gcc: gccAvg, communication: frictionAvg };
            const rankedVectors = vectorBreakdown.map(vb => ({ ...vb, score: vectorScoreMap[vb.vector] || 0 })).sort((a, b) => b.score - a.score);
            const topStrengths = rankedVectors.slice(0, 3);
            const strengthKeys = topStrengths.map(s => s.vector);
            const topDevelopmentAreas = rankedVectors.filter(v => strengthKeys.indexOf(v.vector) === -1).slice().reverse();
            const practiceFocus = topDevelopmentAreas[0] || null;

            const pdfHtml = await new Promise((resolve, reject) => {
              app.render('interview-report-pdf', {
                candidateName: userName || 'Candidate',
                report: cirReport,
                personaName: persona.name,
                roleTitle: session.role_title || 'General Professional',
                experienceLevel: session.experience_level || 'Mid-Career',
                formattedDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
                starAvg, technicalAvg, executiveAvg, gccAvg, frictionAvg,
                radarPolygonPoints: radar.polygonPoints,
                radarPoints: radar.points,
                qaCards: cir.questionEvidence,
                promotionReadiness, leadershipPotential, confidenceLevel,
                nextSteps: cir.careerRoadmap,
                vectorBreakdown, candidateModel: scoreboard.candidate_model || null,
                evidenceMaturity: scoreboard.evidence_maturity || null,
                leadershipReadiness: scoreboard.leadership_readiness,
                starCounts: {
                  situation: cir.starIntelligence.situation.detected,
                  task: cir.starIntelligence.task.detected,
                  action: cir.starIntelligence.action.detected,
                  result: cir.starIntelligence.result.detected,
                },
                starTotal: cir.starIntelligence.totalAnswered,
                topStrengths, topDevelopmentAreas, practiceFocus,
                // Same empty-state fix as the PDF route in server.js — see
                // that route's comment for the full explanation. cir is
                // already computed above for this same PDF.
                hasReliableSignal: cir.strengths[0] && cir.strengths[0].score >= 25,
                canonicalDevelopmentAreas: cir.developmentPriorities,
              }, (err, html) => (err ? reject(err) : resolve(html)));
            });
            pdfBuffer = await renderReportPdf(pdfHtml);
            pdfFilename = `MedhaIQ-Report-${sessionId}.pdf`;
          } catch (pdfErr) {
            console.error('[email] Leadership PDF generation failed (non-fatal — email sends without attachment):', pdfErr.message);
            pdfBuffer = null;
            pdfFilename = null;
          }
        }

        sendInterviewReportEmail({
          toEmail:     userEmail,
          userName:    userName || '',
          reportId:    sessionId,
          personaName: persona ? persona.name : 'Expert Interviewer',
          roleTitle:   session.role_title || 'Professional',
          cir,
          depth:       hasFullReport ? 'full' : 'snapshot',
          pdfBuffer,
          pdfFilename,
        }).catch(e => console.error('[email] report delivery failed (non-fatal):', e.message));
      }
    } catch (emailErr) {
      console.error('[email] report setup failed (non-fatal):', emailErr.message);
    }

    // Conversational closing (UX fix, 2026-08-10): previously always
    // null here -- the interview ended with no spoken/displayed closing
    // at all, for every plan. effectiveSkip is the SAME signal already
    // computed above (deterministic skip/pass intent detector +
    // explicit Skip button) -- not a new detector, just read here too.
    // Two canonical strings, shared by Explorer/Growth/Leadership alike
    // since finalizeSessionAndRespond() is already their one shared
    // completion path.
    const closingText = effectiveSkip
      ? "No problem. That completes the interview. I'll now prepare your report."
      : "Thank you. That completes your interview. I'll now prepare your report.";

    console.log(`[turn-trace] TURN_ID=${turnId} Backend generated (SESSION ENDED): reportId=${sessionId}`);
    return {
      httpStatus: 200,
      body: {
        sessionEnded: true,
        reportId: sessionId,
        turnId,
        wasSkipped: effectiveSkip,
        scores,
        star_progress: starProgress,
        intelligence_scores: intelligenceScores,
        text: closingText,
        audio_url: null,
        competency_tag: null,
      },
    };
  }

  // 4. Check if session should end. Uses the TOTAL ceiling, not the
  // visible budget — the actual "is coverage sufficient at the visible
  // budget" decision lives inside pickAndPersistNextQuestion (called
  // just below), never here. This is only a hard stop for when even the
  // extension allowance is exhausted.
  if (answeredCount >= totalQuestionCeiling) {
    return await finalizeSessionAndRespond();
  }

  // 5. Generate the next question — this now ALWAYS happens, voiceMode or
  // not. Previously voiceMode short-circuited here and returned
  // text:null/question:null, meaning even a correctly-wired Vapi
  // integration would never actually receive a real next question. There
  // is no longer any behavioral reason for voice and text to diverge here
  // — both need the real next question text to speak/display.
  const picked = await (async () => {
    _timing.beforeQuestionGen = process.hrtime.bigint();
    const result = await pickAndPersistNextQuestion(session);
    _timing.afterQuestionGen = process.hrtime.bigint();
    return result;
  })();
  if (picked.done) {
    return await finalizeSessionAndRespond();
  }
  console.log(`[turn-trace] TURN_ID=${turnId} Backend generated (${picked.type === 'follow_up' ? 'FOLLOW_UP — must NOT advance progress' : 'PRIMARY — advances progress'}): QuestionId=${picked.id}`);

  // ── [TURN-TIMING] final breakdown (diagnostics only, 2026-07-24) ──────
  // Matches the requested format exactly. "Answered Count" doubles as a
  // human-readable turn number (Interview Turn N) without needing a
  // separate counter — this IS the count after this exact answer was
  // saved. Total is measured end-to-end across this function, not summed
  // from the stages, so it also reflects anything NOT individually
  // instrumented (getSessionQuestions re-fetch, star progress compute,
  // etc.) rather than silently under-reporting.
  {
    const scoringMs = _timing.scoringWasSkipped ? 0 : _msBetween(_timing.beforeScoring, _timing.afterScoring);
    const dbSaveMs = _msBetween(_timing.beforeAnswerSave, _timing.afterAnswerSave) + _msBetween(_timing.beforeDbScore, _timing.afterDbScore);
    const questionGenMs = _msBetween(_timing.beforeQuestionGen, _timing.afterQuestionGen);
    const totalMs = _msSince(_timing.turnStart);
    console.log(
      `[TURN-TIMING] Interview Turn ${answeredCount} (turnId=${turnId})\n` +
      `  Answer Save (DB):     ${_msBetween(_timing.beforeAnswerSave, _timing.afterAnswerSave).toFixed(0)} ms\n` +
      `  Scoring (scoreAnswer): ${scoringMs.toFixed(0)} ms${_timing.scoringWasSkipped ? ' (skipped — skip/empty answer, no AI call made)' : ''}\n` +
      `  Score Save (DB):      ${_msBetween(_timing.beforeDbScore, _timing.afterDbScore).toFixed(0)} ms\n` +
      `  Database (total):     ${dbSaveMs.toFixed(0)} ms\n` +
      `  Question Generation:  ${questionGenMs.toFixed(0)} ms\n` +
      `  Total (backend):      ${totalMs.toFixed(0)} ms\n` +
      `  (STT finalization, TTS synthesis, and browser playback start are logged client-side — see [TIMELINE] step=final_transcript_received, [TTS] synthesize:start/complete, and step=browser_started_playback for the same turnId/questionId, to complete the full picture.)`
    );
  }

  // ── HASH-TRACE STAGE 1 — backend, immediately before returning /answer.
  // Diagnostic only: does not alter picked.text, the response body, or any
  // control flow. Logs the exact question text's SHA-256 so it can be
  // compared byte-for-byte against every later stage (frontend receipt,
  // showQuestion(), instructNext(), the literal Vapi payload, and the
  // first assistant transcript back). Whichever stage's hash first
  // differs from this one is where the divergence begins.
  if (DEBUG_HASH_TRACE) {
    const _t1 = String(picked.text || '');
    console.log(`[HASH-TRACE] stage=1_backend_answer_response turnId=${turnId} questionId=${picked.id} type=${picked.type} len=${_t1.length} first80=${JSON.stringify(_t1.slice(0, 80))} sha256=${crypto.createHash('sha256').update(_t1).digest('hex')}`);
  }

  return {
    httpStatus: 200,
    body: {
      sessionEnded: false,
      turnId,
      wasSkipped: effectiveSkip,
      scores,
      star_progress: starProgress,
      intelligence_scores: intelligenceScores,
      voiceMode: !!voiceMode,
      question: {
        id: picked.id,
        text: picked.text,
        type: picked.type,
        order: picked.order,
        isFinalQuestion: picked.isFinalQuestion,
        isExecutiveExtension: picked.isExecutiveExtension,
        extensionQuestionNumber: picked.extensionQuestionNumber,
      },
      text: picked.text,
      audio_url: picked.audio_url,
      competency_tag: picked.competency,
    },
  };
}

// ── POST /api/interview/sessions/:id/answer ────────────────────────────────
router.post('/sessions/:id/answer', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { questionId, answerText, skip, voiceMode, micLive } = req.body;

    // Server-owned session lifecycle management (bug fix, 2026-07-24):
    // any real answer submission IS activity, independent of the
    // dedicated heartbeat ping — refreshes last_activity_at so this
    // session is never mistaken for stale mid-interview. Non-blocking and
    // non-fatal: a failure here must never break real answer processing.
    touchSessionActivity(sessionId).catch((e) => console.warn('[interview] touchSessionActivity failed (non-fatal):', e.message));

    const result = await processInterviewAnswer({
      sessionId, questionId, answerText, skip, voiceMode, micLive,
      userId: req.user.id,
      userEmail: req.user.email || null,
      userName: req.user.name || '',
      app: req.app,
    });
    return res.status(result.httpStatus).json(result.body);
  } catch (err) {
    console.error('[interview/sessions/:id/answer]', err);
    return res.status(500).json({ error: 'Failed to process answer. Please try again.' });
  }
});

// ── DELETE /api/interview/sessions/:id — abandon session
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (String(session.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });

    // Feature, 2026-07-24 follow-up: an optional client-supplied reason —
    // currently only used by the Resume/Start New recovery modal, which
    // passes 'superseded_by_new_session' so the Founder Dashboard can
    // distinguish "candidate deliberately restarted after a recoverable
    // interruption" from a normal voluntary End Session click (which
    // sends no reason at all, and must keep reading as NULL). Anything
    // not on abandonSession's own allowlist is silently treated as NULL
    // there — this route trusts that function as the real boundary
    // rather than re-validating here.
    const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason : undefined;
    await abandonSession(sessionId, reason);
    return res.json({ success: true });
  } catch (err) {
    console.error('[interview/sessions DELETE]', err);
    return res.status(500).json({ error: 'Failed to end session' });
  }
});

// ── POST /api/interview/sessions/:id/heartbeat — server-owned session
// lifecycle management (bug fix, 2026-07-24). Called periodically by the
// client (interview-session.ejs) while a session is genuinely in
// progress, so last_activity_at stays fresh and this session is never
// mistaken for stale by requireInterviewEntitlement's auto-recovery
// check (middleware/guards.js) if the candidate opens a second tab or
// their previous attempt tries to start a new one.
router.post('/sessions/:id/heartbeat', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (String(session.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  if (session.status !== 'active') return res.json({ success: true, ignored: true }); // already ended — nothing to refresh

    await touchSessionActivity(sessionId);
    // Idle-timeout feature (2026-08-05 follow-up): the regular 60s
    // auto-ping never sends this flag — only an explicit caller (the
    // Continue Interview gate, views/interview-session.ejs) can assert
    // "this heartbeat represents a genuine action," so the unconditional
    // background ping still can't contaminate the idle-timeout signal.
    if (req.body && req.body.genuine === true) {
      await touchUserActivity(sessionId);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[interview/sessions heartbeat]', err);
    return res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// ── POST /api/interview/sessions/:id/browser-closing — server-owned
// session lifecycle management (bug fix, 2026-07-24). Sent via
// navigator.sendBeacon on beforeunload/pagehide, so a candidate closing
// the tab mid-interview is recorded with a real, specific reason
// (abandoned_reason='browser_closed') rather than only being caught later
// by the generic heartbeat-timeout path once the inactivity window
// elapses. sendBeacon requests can't carry auth headers reliably across
// browsers, so this reads sessionId from the body and re-validates
// ownership via the session's own user_id — same trust boundary as every
// other session mutation here, just via a different auth signal
// (cookie, which sendBeacon does send) than the Bearer-style check some
// other routes use. Best-effort by nature (the tab is closing) — never
// throws in a way that would matter to a client that's already gone.
router.post('/sessions/:id/browser-closing', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const session = await getSession(sessionId);
    if (!session || String(session.user_id) !== String(req.user.id) || session.status !== 'active') {
      return res.json({ success: true }); // nothing to do — respond 200 regardless, the tab is closing either way
    }
    await abandonSession(sessionId, 'browser_closed');
    return res.json({ success: true });
  } catch (err) {
    console.error('[interview/sessions browser-closing]', err);
    return res.status(500).json({ error: 'Failed to record browser-closing signal' });
  }
});

// ── GET /api/interview/sessions/:id — get session status
router.get('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (String(session.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });

    const questions = await getSessionQuestions(sessionId);
    const currentQ = questions.find(q => !q.answer_text) || null;

    return res.json({
      session,
      currentQuestion: currentQ ? {
        id: currentQ.id,
        text: currentQ.question_text,
        type: currentQ.question_type,
        order: currentQ.question_order,
      } : null,
      answeredCount: questions.filter(q => q.answer_text !== null).length,
    });
  } catch (err) {
    console.error('[interview/sessions GET]', err);
    return res.status(500).json({ error: 'Failed to get session' });
  }
});

// ── POST /api/interview/vapi/next-question — Vapi tool-call webhook
router.post('/vapi/next-question', async (req, res) => {
  try {
    if (process.env.VAPI_WEBHOOK_SECRET) {
      const provided = req.headers['x-vapi-secret'] || req.headers['x-webhook-secret'];
      if (provided !== process.env.VAPI_WEBHOOK_SECRET) {
        console.warn('[vapi webhook] rejected — missing/incorrect secret header');
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }
    }

    const body = req.body || {};
    const message = body.message || body;
    const call = message.call || body.call || {};
    const toolCalls = message.toolCalls || message.tool_calls
      || (message.functionCall ? [{ id: 'legacy', function: message.functionCall }] : []);
    const toolCallId = (toolCalls[0] && toolCalls[0].id) || 'unknown';

    const sessionId = parseInt(
      (call.metadata && call.metadata.sessionId) ||
      (message.metadata && message.metadata.sessionId) ||
      body.sessionId,
      10
    );
    if (!sessionId) {
      return res.status(400).json({ error: 'No sessionId in call metadata' });
    }

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const idleCheck = await checkSessionActiveAndNotIdle(session, sessionId, { skipIdleCheck: true });
    if (idleCheck) {
      // This route's contract is Vapi's tool-call response shape, not
      // processInterviewAnswer's {httpStatus, body} — translate rather
      // than return idleCheck directly, so Vapi still gets a spoken
      // result instead of a raw error the assistant can't say anything
      // sensible about.
      return res.json({ results: [{ toolCallId, result: "This interview session has ended." }] });
    }

    const picked = await pickAndPersistNextQuestion(session);
    const spokenText = picked.text;

    return res.json({ results: [{ toolCallId, result: spokenText }] });
  } catch (err) {
    console.error('[vapi webhook]', err);
    return res.status(500).json({ error: 'Failed to generate next question' });
  }
});

// Deprecated endpoint
router.post('/start', async (req, res) => {
  res.status(410).json({ error: 'This endpoint is deprecated. Use POST /api/interview/sessions instead.' });
});

// Text-to-speech utility route
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;
    const { OpenAI } = require('openai');
    const openai = new OpenAI();

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "shimmer",
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    return res.status(200).json({
      success: true,
      aiVoice: `data:audio/mp3;base64,${buffer.toString('base64')}`
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.isPrimaryQuestionType = isPrimaryQuestionType;
module.exports.processInterviewAnswer = processInterviewAnswer;
// Test-only export (Discovery Profile Phase 2 characterization suite,
// tests/discovery-professional-regression.js) — same pattern as the two
// exports above, no behavior change.
module.exports.pickAndPersistNextQuestion = pickAndPersistNextQuestion;