// ═══════════════════════════════════════════════════════════════════════════
// routes/interview.js (or interview (2).js)
// Interview API routes — Full Session Lifecycle with Quality Guardrails
// ═══════════════════════════════════════════════════════════════════════════
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
const sessionController = require('../controllers/sessionController');

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
router.post('/sessions', requireAuth, sessionController.initializeSession);
router.post('/session/initialize', requireAuth, sessionController.initializeSession);

// ── Shared: pick + persist the next question for a session ──────────────────
async function pickAndPersistNextQuestion(session, MAX_QUESTIONS = 5) {
  const allQuestions = await getSessionQuestions(session.id);

  // 1. Idempotency guard: returns current pending question if it exists
  const pending = allQuestions.find(q => q.answer_text === null || q.answer_text === undefined);
  if (pending) {
    
    // 🚨 GUARD 1: FINAL QUESTION RACE CONDITION
    if (allQuestions.length >= MAX_QUESTIONS && pending.question_order === MAX_QUESTIONS - 1) {
      return { 
        done: true, 
        text: "That's all five questions — thank you. I'll put together your intelligence report now.",
        // 🌟 Nesting polyfill prevents routes/vapi.js from throwing a TypeError
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
      order: pending.question_order,
      competency: pending.competency || null,
      audio_url: null,
      question: {
        id: pending.id,
        text: pending.question_text,
        type: pending.question_type,
        order: pending.question_order,
        competency: pending.competency || null
      }
    };
  }

  // 2. Check if the maximum questions limit has already been met
  const answeredCount = allQuestions.filter(q => q.answer_text !== null && q.answer_text !== undefined).length;
  
  // 🚨 GUARD 2: MAX QUESTION LIMIT REACHED
  if (answeredCount >= MAX_QUESTIONS) {
    return { 
      done: true, 
      text: "That's all five questions — thank you. I'll put together your intelligence report now.",
      // 🌟 Nesting polyfill prevents routes/vapi.js from throwing a TypeError
      question: {
        id: 'session_done',
        text: "That's all five questions — thank you. I'll put together your intelligence report now.",
        type: 'done',
        order: MAX_QUESTIONS
      }
    };
  }

  // 3. STRICT HARMONIC ALIGNMENT ENGINE FLOW
  const allScores = await getSessionScores(session.id);
  const nextQuestion = await harmonicAlignmentEngine.getNextAlignedQuestion(session, allQuestions, allScores);
  
  return {
    done: false,
    ...nextQuestion,
    question: nextQuestion
  };
}

  // 3. Proceed to fetch scores and evaluate next steps normally...

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
    questionId: 'Q' + nextQuestion.question_order,
    uiText: nextQuestion.question_text,
    audioPrompt: nextQuestion.question_text,
  };
}

// ── POST /api/interview/sessions/:id/answer ────────────────────────────────
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

    const allQuestions = await getSessionQuestions(sessionId);

    // ── LINE-BY-LINE FIX FOR BUG 2: RESPONSE QUALITY GATEWAY INTERCEPTOR ──
    const cleanInput = (answerText || '').trim().replace(/\s+/g, ' ');
    const wordCount = cleanInput.split(' ').filter(Boolean).length;
    const sparsePhrases = new Set(["yes", "no", "ok", "sure", "yep", "nope", "yeah", "yes.", "no."]);
    
    // Intercept if the candidate types/says a simple, non-contextual phrase
    if (!skip && (wordCount < 5 || sparsePhrases.has(cleanInput.toLowerCase()))) {
      console.log(`[guardrail] Intercepted sparse answer: "${cleanInput}". Blocking database commit.`);
      
      const repromptText = "I see. Could you please expand on that answer with a bit more detail or a specific example from your professional experience?";
      
      // Return early: database state is preserved, stopping the progress bar from incrementing
      return res.json({
        sessionEnded: false,
        validationFailed: true, 
        scores: { star: 0, technical: 0, executive: 0, gcc: 0, friction: 0, weighted: 0 },
        star_progress: { situation: false, task: false, action: false, result: false, stepsComplete: 0, totalSteps: 4 },
        intelligence_scores: { overallScore: 0, vectors: { structure: 0, technicalDepth: 0, executivePresence: 0, gccReadiness: 0, communicationClarity: 0 } },
        text: repromptText,
        question: {
          id: questionId, // Keep original question ID active for the retry attempt
          text: repromptText,
          type: 'reprompt',
          order: allQuestions.filter(q => q.answer_text !== null).length
        },
        uiText: repromptText,
        audioPrompt: repromptText,
        competency_tag: null
      });
    }

    // 1. Save valid answer to database
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

    // 2. Score the validated answer
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

    const starProgress = skip
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

    // 3. Recalculate answered counts safely
    const updatedQuestions = await getSessionQuestions(sessionId);
    const answeredCount = updatedQuestions.filter(q => q.answer_text !== null && q.answer_text !== undefined).length;

    // 4. Check if session should end
    if (answeredCount >= MAX_QUESTIONS) {
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

    // 5. Handle standard voiceMode response paths
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