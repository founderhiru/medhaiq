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
  PERSONAS,
} = require('../services/interview');
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
// Per the config-driven-business-rules directive: this was previously its
// own local `const MAX_SESSION_MINUTES = 25`, defined independently of the
// identical value in config/plans.js. Sourcing it from there means there is
// now exactly one place this number can be changed.
const { INTERVIEW_MAX_SESSION_MINUTES } = require('../config/plans');

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
router.post('/sessions', requireAuth, requireInterviewEntitlement, sessionController.initializeSession);
router.post('/session/initialize', requireAuth, requireInterviewEntitlement, sessionController.initializeSession);

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
// Hard session time cap — independent of the 5-primary / 5-follow-up
// structural bound. A candidate spending 8 minutes on one answer would
// otherwise be able to stretch a "10 turns max" session indefinitely.

async function pickAndPersistNextQuestion(session, MAX_QUESTIONS = 5) {
  const allQuestions = await getSessionQuestions(session.id);

  const countAnsweredPrimaries = (qs) => qs.filter(q =>
    isPrimaryQuestionType(q.question_type) && q.answer_text !== null && q.answer_text !== undefined
  ).length;

  // Time cap check — first, before any other guard, so a session that has
  // simply run too long ends immediately regardless of question counts.
  if (session.started_at) {
    const elapsedMinutes = (Date.now() - new Date(session.started_at).getTime()) / 60000;
    if (elapsedMinutes >= INTERVIEW_MAX_SESSION_MINUTES) {
      return {
        done: true,
        text: "We're at the time limit for this session — thank you. I'll put together your intelligence report now.",
        question: {
          id: 'session_done',
          text: "We're at the time limit for this session — thank you. I'll put together your intelligence report now.",
          type: 'done',
          order: MAX_QUESTIONS
        }
      };
    }
  }

  // 1. Idempotency guard: returns current pending question if it exists
  const pending = allQuestions.find(q => q.answer_text === null || q.answer_text === undefined);
  if (pending) {

    // 🚨 GUARD 1: FINAL QUESTION RACE CONDITION — counts PRIMARY answers only,
    // so a follow-up mixed into the sequence can never mis-trigger this.
    if (countAnsweredPrimaries(allQuestions) >= MAX_QUESTIONS) {
      return {
        done: true,
        text: "That's all five questions — thank you. I'll put together your intelligence report now.",
        question: {
          id: pending.id || 'session_done',
          text: "That's all five questions — thank you. I'll put together your intelligence report now.",
          type: 'done',
          order: MAX_QUESTIONS
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
      competency: pending.competency || null,
      audio_url: null,
      question: {
        id: pending.id,
        text: pending.question_text,
        type: pending.question_type,
        isFollowup: pending.question_type === 'follow_up',
        order: pending.question_order,
        competency: pending.competency || null
      }
    };
  }

  // 2. Check if the maximum PRIMARY questions limit has already been met
  const answeredPrimaryCount = countAnsweredPrimaries(allQuestions);

  // 🚨 GUARD 2: MAX PRIMARY QUESTION LIMIT REACHED
  if (answeredPrimaryCount >= MAX_QUESTIONS) {
    return {
      done: true,
      text: "That's all five questions — thank you. I'll put together your intelligence report now.",
      question: {
        id: 'session_done',
        text: "That's all five questions — thank you. I'll put together your intelligence report now.",
        type: 'done',
        order: MAX_QUESTIONS
      }
    };
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
    answeredPrimaryCount < MAX_QUESTIONS // never offer a follow-up after the final primary — go straight to the report
  );

  // 3. Generate the next question — single source of truth.
  // This is the exact same function that generates the opening question in
  // controllers/sessionController.js, using the exact same session-stored
  // jdText / competencyMatrix / roleTitle. Whatever this returns is what BOTH
  // the frontend text UI (via /sessions/:id/answer) and Vapi (via
  // /vapi/next-question below) will see, because both call this one
  // function and both read/write the same interview_questions row.
  const allScores = await getSessionScores(session.id);
  const scoreByQuestionId = new Map(allScores.map(s => [s.question_id, Number(s.weighted_overall)]));
  const answeredQuestions = allQuestions.filter(q => q.answer_text !== null && q.answer_text !== undefined);
  const qaPairs = answeredQuestions.map(q => ({
    question: q.question_text,
    answer: q.answer_text,
    // NOTE: score is a real Number here, not the raw Postgres NUMERIC
    // string — "0.00" is truthy in JS, which previously made a skipped
    // (0-score) answer look like a valid low score and incorrectly
    // triggered a drill-down question with no real answer to drill into.
    score: Number.isFinite(scoreByQuestionId.get(q.id)) ? scoreByQuestionId.get(q.id) : null,
    wasSkipped: q.answer_text === '',
    storyKey: q.story_key || null,
    // ROOT CAUSE FIX (P0 "skip generates paraphrase of same competency"):
    // `competency` was never included here even though it's already
    // present on every `q` row (getSessionQuestions selects q.*, and
    // addQuestion() already persists it correctly on write). Without
    // it, qaBelongsToCompetency() in the Coverage/Memory Engine could
    // never attribute any past question to its actual competency, so
    // lastAskedTurn stayed -1 forever for every competency and the
    // recency penalty in selectNextCompetency() never engaged --
    // leaving the array's first-priority competency (e.g. 'technical'
    // for Data Engineer/AI Engineer roles) selected on every turn,
    // regardless of questionCount. This one field is the fix; no
    // change to the Coverage Engine's scoring logic itself.
    competency: q.competency || null,
  }));

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
    questionCount: answeredQuestions.length,
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

  return {
    done: false,
    id: savedQuestion.id,
    text: savedQuestion.question_text,
    type: savedQuestion.question_type,
    isFollowup: isFollowupTurn,
    order: savedQuestion.question_order,
    competency: generated.competency || null,
    audio_url: null,
    question: {
      id: savedQuestion.id,
      text: savedQuestion.question_text,
      type: savedQuestion.question_type,
      isFollowup: isFollowupTurn,
      order: savedQuestion.question_order,
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
async function processInterviewAnswer({ sessionId, questionId, answerText, skip, voiceMode, userId, userEmail, userName }) {
  const MAX_QUESTIONS = 5;
  // One turnId per invocation — the single correlating value threaded
  // through every log line for this request/response round-trip, so
  // backend generation, frontend receipt, UI render, and vapi.say() can
  // all be matched up by grepping for the same TURN_ID.
  const turnId = Math.random().toString(16).slice(2, 8);
  console.log(`[turn-trace] TURN_ID=${turnId} processInterviewAnswer start: sessionId=${sessionId} questionId=${questionId} skip=${!!skip} voiceMode=${!!voiceMode}`);

  if (!questionId) return { httpStatus: 400, body: { error: 'questionId required' } };

  // Verify session ownership
  const session = await getSession(sessionId);
  if (!session) return { httpStatus: 404, body: { error: 'Session not found' } };
  if (String(session.user_id) !== String(userId)) return { httpStatus: 403, body: { error: 'Forbidden' } };
  if (session.status !== 'active') return { httpStatus: 400, body: { error: 'Session is not active' } };

  const allQuestions = await getSessionQuestions(sessionId);

  // ── DETERMINISTIC SKIP/PASS INTENT DETECTION (no LLM) ──────────────────
  // Fixes the real bug: a candidate typing "pass", "skip this", "I don't
  // know, just move on", etc. was previously either reprompted with a
  // generic "please expand" message or scored as a real (near-zero)
  // answer — neither of which is what the candidate meant. This runs
  // BEFORE the sparse-answer guardrail below, and produces the exact
  // same effect as clicking the existing Skip button — same downstream
  // code path, not a new one. Deliberately conservative: only considers
  // SHORT inputs (<=15 words) — a genuine, substantive answer describing
  // real experience is essentially never this short, even if it happens
  // to mention "next" or "move on" in passing. This ALSO now applies
  // identically to spoken answers via the Vapi webhook, since both paths
  // call this exact same function.
  const STRONG_SKIP_PHRASES = [
    'skip this', 'pass this', 'just skip', 'just pass', 'skip it', 'pass it',
    "let's skip", "lets skip", 'skip question', 'pass question', 'next question',
    "i don't know", "i dont know", 'no idea', "don't know it", "dont know it",
    'go next', 'go to next',
  ];
  // These are genuinely ambiguous — "I decided to move on from the vendor
  // after repeated delivery failures" is a legitimate story that happens
  // to contain "move on". They only count as skip-intent when they make
  // up almost the entire short message (<=6 words), not when embedded in
  // a longer, real answer.
  const AMBIGUOUS_SKIP_PHRASES = ['move on', "let's move on", "lets move on", 'move forward', 'continue'];
  const cleanInputForIntent = (answerText || '').trim();
  const intentWordCount = cleanInputForIntent.split(/\s+/).filter(Boolean).length;
  const detectedSkipIntent = (() => {
    if (!cleanInputForIntent || intentWordCount > 15) return false;
    const lower = cleanInputForIntent.toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
    // Also catch the single bare word "skip" or "pass" (not just phrases)
    if (/^(skip|pass|next)$/.test(lower)) return true;
    if (STRONG_SKIP_PHRASES.some((phrase) => lower.includes(phrase))) return true;
    if (intentWordCount <= 6 && AMBIGUOUS_SKIP_PHRASES.some((phrase) => lower.includes(phrase))) return true;
    return false;
  })();
  if (detectedSkipIntent) {
    console.log(`[intent-router] Detected skip/pass intent in answer: "${cleanInputForIntent}" — routing as an explicit skip.`);
  }
  const effectiveSkip = !!skip || detectedSkipIntent;

  // ── RESPONSE QUALITY GATEWAY INTERCEPTOR ──
  const cleanInput = (answerText || '').trim().replace(/\s+/g, ' ');
  const wordCount = cleanInput.split(' ').filter(Boolean).length;
  const sparsePhrases = new Set(["yes", "no", "ok", "sure", "yep", "nope", "yeah", "yes.", "no."]);

  if (!effectiveSkip && (wordCount < 5 || sparsePhrases.has(cleanInput.toLowerCase()))) {
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

  // 1. Save valid answer to database
  const savedAnswer = await addAnswer({
    sessionId,
    questionId,
    answerText: effectiveSkip ? '' : (answerText || ''),
  });
  if (!savedAnswer) {
    return {
      httpStatus: 409,
      body: { error: 'This question was already answered — ignoring duplicate submission.', duplicate: true },
    };
  }

  // 2. Score the validated answer
  let scores;
  if (!effectiveSkip && answerText && answerText.trim()) {
    scores = await scoreAnswer(answerText, session.persona_id, {
      roleTitle: session.role_title,
      experienceLevel: session.experience_level,
      orgPreset: session.org_preset,
    });
  } else {
    scores = { star: 0, technical: 0, executive: 0, gcc: 0, friction: 0, weighted: 0 };
  }

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

  const starProgress = effectiveSkip
    ? { situation: false, task: false, action: false, result: false, stepsComplete: 0, totalSteps: 4 }
    : computeStarProgress(answerText);

  const intelligenceScores = {
    overallScore: scores.weighted,
    vectors: {
      structure: scores.star,
      technicalDepth: scores.technical,
      executivePresence: scores.executive,
      gccReadiness: scores.gcc,
      communicationClarity: scores.friction,
    },
  };

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
    });

    await completeSession(sessionId, reportData.overall_score);

    try {
      const persona = PERSONAS[session.persona_id];
      if (userEmail) {
        sendInterviewReportEmail({
          toEmail:          userEmail,
          userName:         userName || '',
          reportId:         sessionId,
          personaName:      persona ? persona.name : 'Expert Interviewer',
          roleTitle:        session.role_title || 'Professional',
          overallScore:     reportData.overall_score,
          recommendation:   reportData.recommendation,
          executiveSummary: reportData.executive_summary,
          scoreboard:       reportData.scoreboard,
          topPriorities:    reportData.improvements_json || [],
        }).catch(e => console.error('[email] report delivery failed (non-fatal):', e.message));
      }
    } catch (emailErr) {
      console.error('[email] report setup failed (non-fatal):', emailErr.message);
    }

    console.log(`[turn-trace] TURN_ID=${turnId} Backend generated (SESSION ENDED): reportId=${sessionId}`);
    return {
      httpStatus: 200,
      body: {
        sessionEnded: true,
        reportId: sessionId,
        turnId,
        scores,
        star_progress: starProgress,
        intelligence_scores: intelligenceScores,
        text: null,
        audio_url: null,
        competency_tag: null,
      },
    };
  }

  // 4. Check if session should end
  if (answeredCount >= MAX_QUESTIONS) {
    return await finalizeSessionAndRespond();
  }

  // 5. Generate the next question — this now ALWAYS happens, voiceMode or
  // not. Previously voiceMode short-circuited here and returned
  // text:null/question:null, meaning even a correctly-wired Vapi
  // integration would never actually receive a real next question. There
  // is no longer any behavioral reason for voice and text to diverge here
  // — both need the real next question text to speak/display.
  const picked = await pickAndPersistNextQuestion(session, MAX_QUESTIONS);
  if (picked.done) {
    return await finalizeSessionAndRespond();
  }
  console.log(`[turn-trace] TURN_ID=${turnId} Backend generated (${picked.type === 'follow_up' ? 'FOLLOW_UP — must NOT advance progress' : 'PRIMARY — advances progress'}): QuestionId=${picked.id}`);

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
      scores,
      star_progress: starProgress,
      intelligence_scores: intelligenceScores,
      voiceMode: !!voiceMode,
      question: {
        id: picked.id,
        text: picked.text,
        type: picked.type,
        order: picked.order,
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
    const { questionId, answerText, skip, voiceMode } = req.body;

    const result = await processInterviewAnswer({
      sessionId, questionId, answerText, skip, voiceMode,
      userId: req.user.id,
      userEmail: req.user.email || null,
      userName: req.user.name || '',
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

    await abandonSession(sessionId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[interview/sessions DELETE]', err);
    return res.status(500).json({ error: 'Failed to end session' });
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