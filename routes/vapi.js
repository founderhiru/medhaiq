// routes/vapi.js
const express = require('express');
const router = express.Router();

// ── Backend is the single source of truth ──────────────────────────────────
// This webhook now calls processInterviewAnswer — the EXACT SAME function
// the HTTP /api/interview/sessions/:id/answer route uses. Previously this
// file imported functions that didn't even exist on what routes/interview.js
// exports (getSessionQuestions/getSessionScores are not exported from
// there), and never used them anyway — the response Vapi received was a
// single hardcoded string, regardless of session state, candidate answer,
// competency, or story. That's the root cause of the reported desync: Vapi
// was never actually talking to the interview engine at all.
//
// Now: candidate speech -> processInterviewAnswer (same skip/pass
// detection, same scoring, same Question Blueprint / Executive Interview
// Strategy, same everything) -> Vapi speaks EXACTLY the text the backend
// decided. Vapi never invents its own follow-ups, reprompts, or
// transitions — it is a pure reader of the backend's decision.
const { getSession, getSessionQuestions } = require('../db/interview');
const { getUserById } = require('../db/auth');
const { processInterviewAnswer } = require('./interview');

/**
 * PATH: /api/vapi-webhook
 * This is the direct communication line Vapi hits every time a candidate
 * finishes speaking.
 */
router.post('/vapi-webhook', async (req, res) => {
  try {
    const payload = req.body;

    // 1. Check if Vapi is asking our engine what to say next
    if (payload.message && payload.message.type === 'assistant-request') {

      // Extract what the user said from Vapi's text stream
      const userTranscript = payload.message.transcript;

      // Grab our hidden database session tracking tag we set up in Phase 1
      const sessionId = payload.message.call && payload.message.call.metadata
        ? payload.message.call.metadata.sessionId
        : null;

      console.log(`[Vapi Webhook] Processing speech for Session: ${sessionId}`);

      if (!sessionId) {
        console.error('[Vapi Webhook] No sessionId in call metadata — cannot process.');
        return res.status(201).json({
          response: { output: [{ role: 'assistant', content: "Thank you for sharing that. Let's continue." }] },
        });
      }

      // 2. Find the session and its CURRENTLY PENDING question — the one
      // Vapi's last spoken question actually corresponds to. Same
      // idempotency pattern pickAndPersistNextQuestion already uses
      // elsewhere: the one question with no answer_text yet.
      const session = await getSession(sessionId);
      if (!session || session.status !== 'active') {
        console.error(`[Vapi Webhook] Session ${sessionId} not found or not active.`);
        return res.status(201).json({
          response: { output: [{ role: 'assistant', content: "Thank you for sharing that. Let's continue." }] },
        });
      }

      const allQuestions = await getSessionQuestions(sessionId);
      const pending = allQuestions.find(q => q.answer_text === null || q.answer_text === undefined);
      if (!pending) {
        console.error(`[Vapi Webhook] No pending question found for session ${sessionId} — nothing to answer.`);
        return res.status(201).json({
          response: { output: [{ role: 'assistant', content: "Thank you for sharing that. Let's continue." }] },
        });
      }

      // Look up the candidate's email/name for the report-delivery email,
      // in case this exact turn happens to be the one that completes the
      // session (sessionEnded:true) — mirrors what the HTTP route does via
      // req.user, just resolved from the DB instead of a browser session.
      let userEmail = null;
      let userName = '';
      try {
        const user = await getUserById(session.user_id);
        userEmail = user ? user.email : null;
        userName = user ? (user.name || '') : '';
      } catch (userErr) {
        console.error('[Vapi Webhook] Could not resolve user for report email (non-fatal):', userErr.message);
      }

      // 3. RUN THE REAL ENGINE — same skip/pass intent detection, same
      // sparse-answer guardrail, same scoring, same Question Blueprint /
      // Executive Interview Strategy, same follow-up logic. Not a
      // reimplementation — the identical function the HTTP route calls.
      const result = await processInterviewAnswer({
        sessionId,
        questionId: pending.id,
        answerText: userTranscript,
        skip: false,
        voiceMode: true,
        userId: session.user_id,
        userEmail,
        userName,
      });

      // 4. Decide what Vapi should actually say — always exactly what the
      // backend decided, never anything Vapi comes up with on its own.
      let spokenText;
      if (result.body.sessionEnded) {
        spokenText = "That completes our interview — thank you for your time today. Your report is being prepared now.";
      } else if (result.body.text) {
        // Covers all three real cases identically: a genuine next question,
        // a follow-up, or the sparse-answer reprompt — whichever the
        // backend decided, Vapi just reads it.
        spokenText = result.body.text;
      } else {
        // Defensive fallback — should not normally be reached now that
        // voiceMode always receives real question text, but kept as a safe
        // bridge in case of an unexpected empty response.
        spokenText = "Thank you for sharing that. Let's continue.";
      }

      return res.status(201).json({
        response: {
          output: [
            {
              role: 'assistant',
              content: spokenText,
            },
          ],
        },
      });
    }

    // Acknowledge standard baseline diagnostic pings from Vapi safely
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[Vapi Webhook Critical Error]:', error.message);
    // Secure fallback: if your system stumbles, pass a safe conversational bridge statement
    return res.status(201).json({
      response: {
        output: [{ role: 'assistant', content: "Thank you for sharing that. Let's move on to the next section." }]
      }
    });
  }
});

module.exports = router;
