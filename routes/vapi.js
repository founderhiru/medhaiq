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
// Cost recording — the only cost_analytics touchpoint in this file goes
// through this decoupled service, never db/cost-analytics.js directly. See
// lib/cost-recorder.js header for the full non-blocking/idempotency contract.
const { recordVapiCallCost } = require('../lib/cost-recorder');

/**
 * PATH: /api/vapi-webhook
 * This is the direct communication line Vapi hits every time a candidate
 * finishes speaking.
 */
router.post('/vapi-webhook', async (req, res) => {
  // TEMPORARY diagnostic logging -- added to prove/disprove whether this
  // webhook is actually being invoked during a live interview, before any
  // gating decision is made. Remove once confirmed either way.
  console.log('[WEBHOOK] request received at ' + Date.now()
    + ' messageType=' + (req.body && req.body.message && req.body.message.type)
    + ' sessionId=' + (req.body && req.body.message && req.body.message.call && req.body.message.call.metadata
        ? req.body.message.call.metadata.sessionId : '(none)'));

  try {
    const payload = req.body;

    // 1. Check if Vapi is asking our engine what to say next
    if (payload.message && payload.message.type === 'assistant-request') {
      console.log('[WEBHOOK] assistant-request confirmed -- this call WILL invoke processInterviewAnswer and return spoken text to Vapi');

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
      console.log('[WEBHOOK] calling processInterviewAnswer sessionId=' + sessionId + ' questionId=' + pending.id + ' answerText="' + String(userTranscript).slice(0, 80) + '"');
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
        // 2026-08-10: now reads the backend's own closing text (see
        // routes/interview.js's finalizeSessionAndRespond) instead of a
        // second, separately-hardcoded string here -- that text is
        // already skip-aware (Explorer/Growth/Leadership share the same
        // canonical completion path). The literal string below only
        // fires in the genuinely-unexpected case that text is missing.
        spokenText = result.body.text || "That completes our interview — thank you for your time today. Your report is being prepared now.";
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

      console.log('[WEBHOOK] responding to Vapi -- it WILL speak this text via its own voice: "' + spokenText.slice(0, 100) + '"');
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

    // ── 2. Authoritative call cost — Vapi's end-of-call-report event ───────
    // This is the ONLY place Vapi cost is written. Separate branch from
    // assistant-request above — does not touch or depend on any of that
    // logic. Cost recording is fire-and-forget (see lib/cost-recorder.js);
    // a failure here can never affect the webhook's response to Vapi.
    //
    // FIELD PATH — CONFIRMED (2026-08-21 diagnostic pass) against Vapi's own
    // current docs (docs.vapi.ai/server-url/events: the end-of-call-report
    // payload is { message: { type, endedReason, call, artifact } } — there
    // is NO top-level message.cost) and third-party debugging references
    // ("the cost and costBreakdown fields" are documented as part of the
    // Call object, delivered in this webhook's `call` field). So the
    // authoritative path is message.call.cost / message.call.costBreakdown.
    // The previous version tried message.cost FIRST — a field that does not
    // exist per Vapi's documented schema — falling back to message.call.cost
    // only if that lookup came back undefined. Functionally the fallback
    // should already have reached the right value, but the priority was
    // backwards versus the confirmed schema; swapped below so the primary
    // path matches what Vapi actually sends, with the old message.cost
    // check kept only as a legacy fallback in case some account/report
    // version does place it there.
    if (payload.message && payload.message.type === 'end-of-call-report') {
      const call = payload.message.call || null;
      const sessionId = call && call.metadata ? call.metadata.sessionId : null;

      const rawCost = (call && call.cost !== undefined && call.cost !== null)
        ? call.cost
        : (payload.message.cost !== undefined ? payload.message.cost : undefined);
      const rawDurationSeconds = (call && call.durationSeconds !== undefined && call.durationSeconds !== null)
        ? call.durationSeconds
        : payload.message.durationSeconds;
      const costBreakdown = (call && call.costBreakdown) || payload.message.costBreakdown || null;

      // ── Diagnostic logging (temporary, per this investigation) ──────────
      // Deliberately excludes: API keys/tokens, transcript/recording
      // content, and any user PII beyond the internal sessionId already
      // used for attribution elsewhere in this file. Safe to leave in
      // place short-term; remove once a real staging call confirms the
      // path end-to-end, per the same pattern the assistant-request branch
      // above already used for its own temporary diagnostic logging.
      console.log('[WEBHOOK][vapi-cost-diagnostic] end-of-call-report', JSON.stringify({
        messageType: payload.message.type,
        vapiCallId: call ? call.id : null,
        endedReason: payload.message.endedReason || null,
        sessionId,
        rawCost,
        rawCostType: typeof rawCost,
        rawDurationSeconds,
        costBreakdown,
        willCallRecordVapiCallCost: !!sessionId,
      }));

      if (!sessionId) {
        console.error('[Vapi Webhook][vapi-cost-diagnostic] no sessionId in call.metadata — recordVapiCallCost will NOT be called, cost cannot be attributed.');
        return res.status(200).json({ received: true });
      }

      const durationMinutes = (rawDurationSeconds !== undefined && rawDurationSeconds !== null)
        ? rawDurationSeconds / 60
        : null;

      // Resolve current plan for attribution — same lookup pattern as the
      // assistant-request branch above, kept local to this branch since it
      // needs the session's user_id, not anything assistant-request loaded.
      let userPlan = null;
      let userIdForCost = null;
      try {
        const session = await getSession(sessionId);
        userIdForCost = session ? session.user_id : null;
        if (userIdForCost) {
          const user = await getUserById(userIdForCost);
          userPlan = user ? user.subscription_plan : null;
        }
      } catch (lookupErr) {
        console.error('[Vapi Webhook] Could not resolve user/plan for cost attribution (non-fatal, cost still recorded without it):', lookupErr.message);
      }

      console.log(`[WEBHOOK][vapi-cost-diagnostic] calling recordVapiCallCost interviewId=${sessionId} vapiCost=${rawCost} durationMinutes=${durationMinutes}`);
      await recordVapiCallCost({
        interviewId: sessionId,
        userId: userIdForCost,
        userPlan,
        vapiCost: rawCost,
        durationMinutes,
      });

      return res.status(200).json({ received: true });
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
