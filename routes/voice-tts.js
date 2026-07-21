// routes/voice-tts.js
//
// PR3 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
//
// Thin route: request validation + status-code mapping only. All actual
// synthesis logic lives in services/voice-tts-proxy.js.
//
// No express.json() here -- server.js already applies it globally
// (app.use(express.json())). Adding it again at the route level would
// try to re-read an already-consumed request stream and silently wipe
// req.body.
//
// PR3: now mounted in server.js (see PR3 Integration Plan §4) and
// gated behind requireAuth -- an authenticated session is required,
// matching every other interview-adjacent route. Without this, the
// endpoint would be an open, unauthenticated way to burn ElevenLabs
// API credits at MedhaIQ's expense from outside the app entirely.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/guards');
const { synthesizeViaElevenLabs } = require('../services/voice-tts-proxy');

const ERROR_STATUS_BY_CODE = {
  CONFIG_MISSING: 500,
  UPSTREAM_AUTH: 502,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  NETWORK_ERROR: 502,
};

router.post('/synthesize', requireAuth, async (req, res) => {
  const { text, voice, language, streaming } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const { buffer, contentType } = await synthesizeViaElevenLabs({ text, voice, language, streaming });
    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    const status = ERROR_STATUS_BY_CODE[err.code] || 502;
    res.status(status).json({ error: err.message, code: err.code || 'UNKNOWN' });
  }
});

module.exports = router;
