// routes/debug-elevenlabs-voices.js
//
// TEMPORARY DIAGNOSTIC ENDPOINT -- created to resolve the "402
// paid_plan_required" ElevenLabs error during PR3 voice integration.
// DELETE THIS FILE (and its mount in server.js) once a working,
// API-accessible voice has been identified and voice-client-config.js
// is updated to use it. Not part of the permanent architecture.
//
// GET /api/debug/elevenlabs/voices
//
// Calls ElevenLabs' GET /v1/voices using the SAME server-side API key
// MedhaIQ already uses (VOICE_SERVER_CONFIG.elevenLabsApiKey) -- never
// a different/new key, so this tells us exactly what our own
// production key can and can't do.
//
// Returns ONLY: name, voice_id, category, labels, preview_url per voice.
// Never returns the API key or any other secret. On any upstream error,
// returns ElevenLabs' complete response body so nothing is guessed at.
//
// Gated behind the same requireFounder pattern as routes/debug-voice.js
// -- internal diagnostic tooling, not for general access.

const express = require('express');
const router = express.Router();
const { getUserById } = require('../db/auth');
const { isFounder } = require('../db/founder-access');
const { VOICE_SERVER_CONFIG } = require('../config/voice-server-config');

async function requireFounder(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).send('Authentication required');
  const user = await getUserById(userId);
  if (!user) return res.status(401).send('Session expired');
  const founder = await isFounder(user.id);
  if (!founder) return res.status(403).send('Forbidden');
  req.user = user;
  next();
}

router.get('/', requireFounder, async (req, res) => {
  if (!VOICE_SERVER_CONFIG.elevenLabsApiKey) {
    return res.status(500).json({ error: 'ELEVENLABS_API_KEY is not set on this environment' });
  }

  const url = VOICE_SERVER_CONFIG.elevenLabsApiBaseUrl.replace(/\/$/, '') + '/v1/voices';

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': VOICE_SERVER_CONFIG.elevenLabsApiKey },
    });

    if (!response.ok) {
      // Return the COMPLETE upstream body, exactly as requested --
      // no summarizing, no guessing at what the error means.
      const bodyText = await response.text().catch(() => '(could not read response body)');
      return res.status(502).json({
        error: 'ElevenLabs GET /v1/voices failed',
        upstreamStatus: response.status,
        upstreamBody: bodyText,
      });
    }

    const data = await response.json();
    const voices = (data.voices || []).map(v => ({
      name: v.name,
      voice_id: v.voice_id,
      category: v.category,
      labels: v.labels || undefined,
      preview_url: v.preview_url || undefined,
    }));

    res.json({ count: voices.length, voices });
  } catch (err) {
    res.status(502).json({ error: 'Network error reaching ElevenLabs', message: err.message });
  }
});

module.exports = router;
