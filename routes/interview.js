// Interview API routes — full session lifecycle.
const express = require('express');
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
const { getUserById } = require('../db/auth');
const { sendInterviewReportEmail } = require('../services/email');
const {
  buildCompetencyMatrix,
  parseJdCompetencies,
  getRoleDefaults,
  getOrgTraits,
  MAX_JD_TEXT_CHARS,
} = require('../services/competency-matrix');

// ── Auth middleware ────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
}

// ── POST /api/interview/sessions — create session + generate opening question
router.post('/sessions', requireAuth, async (req, res) => {
  try {
    const { personaId, roleTitle, experienceLevel, orgPreset, jdText } = req.body;

    if (!personaId || !PERSONAS[personaId]) {
      return res.status(400).json({ error: 'Valid persona required' });
    }
    if (!roleTitle) {
      return res.status(400).json({ error: 'Role title required' });
    }

    // ── Competency pipeline ────────────────────────────────────────────────
    // Merge (role defaults → company traits → JD-parsed), case-insensitive
    // dedupe, exactly top 8. Deterministic, no AI call — safe on every start.
    const safeJdText      = (typeof jdText === 'string') ? jdText.slice(0, MAX_JD_TEXT_CHARS) : '';
    const roleDefaults    = getRoleDefaults(roleTitle);
    const companyTraits   = getOrgTraits(orgPreset);
    const jdCompetencies  = parseJdCompetencies(safeJdText);
    const competencyMatrix = buildCompetencyMatrix(roleDefaults, companyTraits, jdCompetencies, { limit: 8 });

    // 1. Create session record — matrix + raw JD live in session DB state
    const session = await createSession({
      userId: req.user.id,
      personaId,
      roleTitle,
      experienceLevel: experienceLevel || 'mid',
      orgPreset: orgPreset || null,
      jdText: safeJdText || null,
      competencyMatrix,
    });

    // 2. Generate opening question from AI — matrix mapped straight into the
    //    system prompt context variables
    const openingResult = await generateNextQuestion({
      sessionId: session.id,
      personaId,
      roleTitle,
      experienceLevel: experienceLevel || 'mid',
      orgPreset: orgPreset || null,
      competencyMatrix,
      jdText: safeJdText,
      qaPairs: [],
      questionCount: 0,
    });

    // 3. Save question to DB
    const question = await addQuestion({
      sessionId: session.id,
      questionText: openingResult.text,
      personaId,
      questionType: 'opening',
      questionOrder: 0,
      competency: openingResult.competency,
    });

    return res.json({
      success: true,
      sessionId: session.id,
      question: {
        id: question.id,
        text: question.question_text,
        type: question.question_type,
        order: question.question_order,
        competency: question.competency || openingResult.competency,
      },
      // Clean, flat fields the frontend can bind to directly — no digging
      // through nested question objects required.
      text: question.question_text,
      audio_url: openingResult.audio_url || null,
      competency_tag: question.competency || openingResult.competency || null,
    });
  } catch (err) {
    console.error('[interview/sessions POST]', err);
    return res.status(500).json({ error: 'Failed to start session. Please try again.' });
  }
});

// ── Shared: pick + persist the next question for a session ──────────────────
// Used by BOTH the REST /answer flow (text-only mode) and the Vapi tool-call
// webhook below (voice mode). Having exactly one function do this is what
// guarantees the engine only ever decides on ONE next question, no matter
// which channel triggered it — never two independently-generated questions
// racing each other.
async function pickAndPersistNextQuestion(session, MAX_QUESTIONS = 5) {
  const allQuestions = await getSessionQuestions(session.id);

  // Idempotency guard: if there's already an unanswered question sitting
  // there — the opening question created at session-start, or a repeat
  // webhook call for a turn we already handled — return THAT instead of
  // generating a second, different one. Without this, the very first
  // voice question would immediately diverge from the opening question
  // already shown on screen, since that one exists in the DB unanswered
  // before Vapi ever calls this endpoint.
  const pending = allQuestions.find(q => q.answer_text === null || q.answer_text === undefined);
  if (pending) {
    return {
      done: false,
      id: pending.id,
      text: pending.question_text,
      type: pending.question_type,
      order: pending.question_order,
      competency: pending.competency || null,
      audio_url: null,
    };
  }

  const answeredCount = allQuestions.filter(q => q.answer_text !== null && q.answer_text !== undefined).length;

  if (answeredCount >= MAX_QUESTIONS) {
    return { done: true, text: "That's all five questions — thank you. I'll put together your intelligence report now." };
  }

  const allScores = await getSessionScores(session.id);
  const qaPairs = allQuestions
    .filter(q => q.answer_text !== null && q.answer_text !== undefined)
    .map(q => ({ question: q.question_text, answer: q.answer_text || '' }));
  if (qaPairs.length && allScores.length) {
    const lastScoreRow = allScores[allScores.length - 1];
    if (lastScoreRow) qaPairs[qaPairs.length - 1].score = lastScoreRow.star_score;
  }

  const nextResult = await generateNextQuestion({
    sessionId: session.id,
    personaId: session.persona_id,
    roleTitle: session.role_title,
    experienceLevel: session.experience_level,
    orgPreset: session.org_preset,
    // Pulled from session DB state — set once at creation, reused every turn
    // by BOTH the text /answer flow and the Vapi voice webhook.
    competencyMatrix: session.competency_matrix || null,
    jdText: session.jd_text || '',
    currentAnswer: qaPairs.length ? (qaPairs[qaPairs.length - 1].answer || '') : '',
    qaPairs,
    questionCount: answeredCount,
  });

  const lastScore = qaPairs.length ? qaPairs[qaPairs.length - 1].score : undefined;
  const nextQuestion = await addQuestion({
    sessionId: session.id,
    questionText: nextResult.text,
    personaId: session.persona_id,
    questionType: (typeof lastScore === 'number' && lastScore < 60) ? 'drill_down' : 'behavioral',
    questionOrder: answeredCount,
    competency: nextResult.competency,
  });

  return {
    done: false,
    id: nextQuestion.id,
    text: nextQuestion.question_text,
    type: nextQuestion.question_type,
    order: nextQuestion.question_order,
    competency: nextQuestion.competency || nextResult.competency || null,
    audio_url: nextResult.audio_url || null,
  };
}

// ── POST /api/interview/sessions/:id/answer — submit answer, score it, return next question or end
router.post('/sessions/:id/answer', requireAuth, async (req, res) => {
  const MAX_QUESTIONS = 5;
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { questionId, answerText, skip, voiceMode } = req.body;

    if (!questionId) return res.status(400).json({ error: 'questionId required' });

    // Verify session ownership
    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (String(session.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session is not active' });

    // 1. Save the answer — addAnswer returns null if this question was
    // already answered by a request that won a race against this one
    // (see migration 002_answer_uniqueness). Never treat that as a new
    // answer: it's the same reason the session could previously overshoot
    // past 5 questions when Skip got double-clicked during a slow AI call.
    const savedAnswer = await addAnswer({
      sessionId,
      questionId,
      answerText: answerText || '',
    });
    if (!savedAnswer) {
      return res.status(409).json({
        error: 'This question was already answered — ignoring duplicate submission.',
        duplicate: true,
      });
    }

    // 2. Score the answer. IMPORTANT: this always runs now, even on skip —
    // previously skip left `scores` as null and never wrote a row to
    // interview_scores at all. That meant: (a) the dashboard had no data
    // to paint for that question, contradicting the comment that used to
    // sit here ("skip scores 0 across the board" — it didn't, in code),
    // and (b) qaPairs for THIS question had no .score downstream, so a
    // skip/non-answer could never correctly trigger a drill-down. Skip is
    // now just a fast path to an explicit, real, persisted 0 — same
    // treatment as an "I don't know" that reaches scoreAnswer's own
    // trivial-answer floor.
    let scores;
    if (!skip && answerText && answerText.trim()) {
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

    // Tactical: instant, deterministic S/T/A/R detection — no AI round
    // trip needed, so the Live Terminal can light up immediately. Skip
    // obviously detected none of the four.
    const starProgress = skip
      ? { situation: false, task: false, action: false, result: false, stepsComplete: 0, totalSteps: 4 }
      : computeStarProgress(answerText);

    // Strategic: standardized IntelligenceMetrics shape the frontend
    // binds to directly (overall gauge + 5-vector bars), decoupled from
    // whatever shape scoreAnswer() happens to return internally.
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

    // 3. Get all answered Q&As so far
    const allQuestions = await getSessionQuestions(sessionId);
    const answeredCount = allQuestions.filter(q => q.answer_text !== null && q.answer_text !== undefined).length;

    // 4. Check if session should end
    if (answeredCount >= MAX_QUESTIONS) {
      // Generate report
      const allScores = await getSessionScores(sessionId);
      const qaPairs = allQuestions
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

      const report = await saveReport({
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

      // ── Send report email (non-blocking — never fails the response) ──────────
      try {
        const persona   = PERSONAS[session.persona_id];
        const userEmail = req.user.email || null;
        if (userEmail) {
          sendInterviewReportEmail({
            toEmail:          userEmail,
            userName:         req.user.name || '',
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

      return res.json({
        sessionEnded: true,
        reportId: sessionId,
        scores,
        star_progress: starProgress,
        intelligence_scores: intelligenceScores,
        text: null,
        audio_url: null,
        competency_tag: null,
      });
    }
 // 5. Generate next question — UNLESS voice is driving this session, in
    // which case the Vapi tool-call webhook (below) is the only place the
    // next question gets picked. Doing it here too would create two
    // independently-generated "next questions" racing each other, which is
    // exactly the kind of drift this whole redesign is trying to remove.
    if (voiceMode) {
      return res.json({
        sessionEnded: false,
        scores,
        star_progress: starProgress,
        intelligence_scores: intelligenceScores,
        voiceMode: true,
        text: null,
        question: null,
        competency_tag: null,
      });
    }

    const picked = await pickAndPersistNextQuestion(session, MAX_QUESTIONS);
    if (picked.done) {
      // Shouldn't normally happen here (answeredCount was already checked
      // above), but handle it defensively rather than send a broken response.
      return res.json({ sessionEnded: false, scores, star_progress: starProgress, intelligence_scores: intelligenceScores, text: null, question: null });
    }

    return res.json({
      sessionEnded: false,
      scores,
      star_progress: starProgress,
      intelligence_scores: intelligenceScores,
      question: {
        id: picked.id,
        text: picked.text,
        type: picked.type,
        order: picked.order,
      },
      // Flat mirror of `question` above so the client never has to guess
      // which shape came back — fixes the UI/audio desync where the DOM
      // waited on one shape while Vapi's audio events assumed another.
      text: picked.text,
      audio_url: picked.audio_url,
      competency_tag: picked.competency,
    });
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

// ── POST /api/interview/vapi/next-question — Vapi tool-call webhook ────────
// THIS is what actually closes the sync bug, as opposed to the earlier
// fire-and-forget system-message approach: Vapi's own function/tool-calling
// mechanism BLOCKS the assistant from speaking until this endpoint responds.
// It can no longer "beat us to it" by asking its own question, because it
// is, by design, not allowed to say anything next until it has this result.
//
// REQUIRES DASHBOARD SETUP on vapi.ai — this code alone does nothing until
// you configure it there. See the chat response for exact steps:
//   1. Create a Function/Tool on your Assistant named e.g. "get_next_question"
//      with no required parameters, Server URL = this endpoint's full URL.
//   2. Update the Assistant's system prompt to require calling that
//      function before every question, and to say ONLY what it returns.
//   3. Pass metadata:{ sessionId } when starting the call client-side
//      (already done in interview-session.ejs) so this endpoint knows
//      which interview session the call belongs to.
//
// This is a server-to-server webhook — Vapi calls it directly, not through
// the candidate's browser, so it can't carry our normal cookie-based auth.
// It's protected instead by a shared secret you set as VAPI_WEBHOOK_SECRET
// and configure as a custom header on the Vapi tool (commonly "x-vapi-secret").
router.post('/vapi/next-question', async (req, res) => {
  try {
    if (process.env.VAPI_WEBHOOK_SECRET) {
      const provided = req.headers['x-vapi-secret'] || req.headers['x-webhook-secret'];
      if (provided !== process.env.VAPI_WEBHOOK_SECRET) {
        console.warn('[vapi webhook] rejected — missing/incorrect secret header');
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }
    } else {
      console.warn('[vapi webhook] VAPI_WEBHOOK_SECRET is not set — this endpoint is currently unauthenticated. Set it in Render env vars before going live.');
    }

    // Vapi's exact payload shape has changed across SDK versions, so this
    // reads defensively from every location metadata/tool-call info has
    // been seen in their docs, rather than assuming one exact shape.
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
      console.error('[vapi webhook] no sessionId found in call metadata — was metadata:{sessionId} passed to vapi.start()?');
      return res.status(400).json({ error: 'No sessionId in call metadata' });
    }

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const picked = await pickAndPersistNextQuestion(session);
    const spokenText = picked.done ? picked.text : picked.text;

    // Vapi's documented tool-result response shape. If your Vapi SDK
    // version expects a different envelope, check their current docs —
    // this is the part most likely to need a small tweak after a live test.
    return res.json({ results: [{ toolCallId, result: spokenText }] });
  } catch (err) {
    console.error('[vapi webhook]', err);
    return res.status(500).json({ error: 'Failed to generate next question' });
  }
});

// Legacy route kept for compatibility
router.post('/start', async (req, res) => {
  res.status(410).json({ error: 'This endpoint is deprecated. Use POST /api/interview/sessions instead.' });
});

// Text-to-speech utility route, used to generate the audio_url returned
// alongside a question so the frontend can play/sync it against the
// on-screen text (see speech-start handling in interview-session.ejs).
router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;
    const { OpenAI } = require('openai');
    const openai = new OpenAI();

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "shimmer", // Configured TTS voice for the AI interviewer
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
