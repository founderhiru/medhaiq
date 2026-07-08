// routes/vapi.js
const express = require('express');
const router = express.Router();

// Import your existing interview scoring and generation logic
// (This pulls from the same code running your current endpoints)
const { getSessionQuestions, getSessionScores } = require('./interview'); 

/**
 * PATH: /api/vapi-webhook
 * This is the direct communication line Vapi hits every time a candidate finishes speaking.
 */
router.post('/vapi-webhook', async (req, res) => {
  try {
    const payload = req.body;

    // 1. Check if Vapi is asking our engine what to say next
    if (payload.message && payload.message.type === 'assistant-request') {
      
      // Extract what the user said from Vapi's text stream
      const userTranscript = payload.message.transcript; 
      
      // Grab our hidden database session tracking tag we set up in Phase 1
      const sessionId = payload.message.call.metadata.sessionId; 

      console.log(`[Vapi Webhook] Processing speech for Session: ${sessionId}`);

      // 2. RUN YOUR HARMONICALIGNMENTENGINE HERE
      // We look up the session data and fetch the next pre-arranged matching question text string.
      // NOTE: Replace 'YourEngineFunction' with whatever function your app uses to get the text string.
      const nextQuestionText = "Walk me through a specific moment when you had to tell a senior leader their pet feature wasn't going to ship...";

      // 3. Send the exact script text back to Vapi's voice boxes.
      // This forces Vapi to act as a silent reader—skipping its own LLM entirely!
      return res.status(201).json({
        response: {
          output: [
            {
              role: 'assistant',
              content: nextQuestionText 
            }
          ]
        }
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