// Interview API routes — full session lifecycle.
const express = require('express');
const router = express.Router();
const {
  generateNextQuestion,
  scoreAnswer,
  generateReport,
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
    const { personaId, roleTitle, experienceLevel, orgPreset } = req.body;

    if (!personaId || !PERSONAS[personaId]) {
      return res.status(400).json({ error: 'Valid persona required' });
    }
    if (!roleTitle) {
      return res.status(400).json({ error: 'Role title required' });
    }

    // 1. Create session record
    const session = await createSession({
      userId: req.user.id,
      personaId,
      roleTitle,
      experienceLevel: experienceLevel || 'mid',
      orgPreset: orgPreset || null,
    });

    // 2. Generate opening question from AI
    const questionText = await generateNextQuestion({
      sessionId: session.id,
      personaId,
      roleTitle,
      experienceLevel: experienceLevel || 'mid',
      orgPreset: orgPreset || null,
      qaPairs: [],
      questionCount: 0,
    });

    // 3. Save question to DB
    const question = await addQuestion({
      sessionId: session.id,
      questionText,
      personaId,
      questionType: 'opening',
      questionOrder: 0,
    });

    return res.json({
      success: true,
      sessionId: session.id,
      question: {
        id: question.id,
        text: question.question_text,
        type: question.question_type,
        order: question.question_order,
      },
    });
  } catch (err) {
    console.error('[interview/sessions POST]', err);
    return res.status(500).json({ error: 'Failed to start session. Please try again.' });
  }
});

// ── POST /api/interview/sessions/:id/answer — submit answer, score it, return next question or end
router.post('/sessions/:id/answer', requireAuth, async (req, res) => {
  const MAX_QUESTIONS = 5;
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { questionId, answerText, skip } = req.body;

    if (!questionId) return res.status(400).json({ error: 'questionId required' });

    // Verify session ownership
    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (String(session.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session is not active' });

    // 1. Save the answer
    await addAnswer({
      sessionId,
      questionId,
      answerText: answerText || '',
    });

    // 2. Score the answer (skip scores 0 across the board)
    let scores = null;
    if (!skip && answerText && answerText.trim()) {
      scores = await scoreAnswer(answerText, session.persona_id, {
        roleTitle: session.role_title,
        experienceLevel: session.experience_level,
        orgPreset: session.org_preset,
      });

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
    }

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

      return res.json({
        sessionEnded: true,
        reportId: sessionId,
        scores,
      });
    }

    // 5. Generate next question
    const qaPairs = allQuestions
      .filter(q => q.answer_text !== null && q.answer_text !== undefined)
      .map(q => ({ question: q.question_text, answer: q.answer_text || '' }));

    const nextQuestionText = await generateNextQuestion({
      sessionId,
      personaId: session.persona_id,
      roleTitle: session.role_title,
      experienceLevel: session.experience_level,
      orgPreset: session.org_preset,
      qaPairs,
      questionCount: answeredCount,
    });

    const nextQuestion = await addQuestion({
      sessionId,
      questionText: nextQuestionText,
      personaId: session.persona_id,
      questionType: scores && scores.star < 60 ? 'drill_down' : 'behavioral',
      questionOrder: answeredCount,
    });

    return res.json({
      sessionEnded: false,
      scores,
      question: {
        id: nextQuestion.id,
        text: nextQuestion.question_text,
        type: nextQuestion.question_type,
        order: nextQuestion.question_order,
      },
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

// Legacy route kept for compatibility
router.post('/start', async (req, res) => {
  res.status(410).json({ error: 'This endpoint is deprecated. Use POST /api/interview/sessions instead.' });
});

// Lightweight utility route to convert any standalone text to the soft female accent
router.post('/api/interview/tts', async (req, res) => {
  try {
    const { text } = req.body;
    const { OpenAI } = require('openai');
    const openai = new OpenAI();

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "shimmer", // Matches your soft female profile configuration
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
