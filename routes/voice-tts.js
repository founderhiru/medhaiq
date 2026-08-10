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
const { Readable } = require('stream');
const { requireAuth } = require('../middleware/guards');
// Anti-Abuse & Free-Offer Guardrail — applied to the two initialization
// endpoints only, never to /stream/:token (the actual audio GET, which
// fires continuously during playback and must never be throttled).
const { voiceInitLimiter } = require('../middleware/rate-limit');
const { synthesizeViaElevenLabs, prepareStream, streamViaElevenLabsToken } = require('../services/voice-tts-proxy');

const ERROR_STATUS_BY_CODE = {
  CONFIG_MISSING: 500,
  UPSTREAM_AUTH: 502,
  UPSTREAM_ERROR: 502,
  TIMEOUT: 504,
  NETWORK_ERROR: 502,
  // Phase 2B streaming-token errors -- all map to a 4xx the client-side
  // adapter's fallback logic already treats as "!response.ok", so no new
  // client-side error-handling branch is needed for these specifically.
  TOKEN_NOT_FOUND: 404,
  TOKEN_EXPIRED: 410,
  TOKEN_FORBIDDEN: 403,
};

router.post('/synthesize', voiceInitLimiter, requireAuth, async (req, res) => {
  // Persona-Based Dynamic Voice Profiles, Step 1: the request now carries
  // voiceProfile (a provider-agnostic name, e.g. 'alex') instead of a raw
  // provider voice ID. Resolution to an actual ElevenLabs ID happens
  // entirely inside services/voice-tts-proxy.js via config/voice-profiles.js
  // -- this route stays a thin passthrough, unchanged in shape.
  const { text, voiceProfile, language, streaming } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const { buffer, contentType } = await synthesizeViaElevenLabs({ text, voiceProfile, language, streaming });
    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    const status = ERROR_STATUS_BY_CODE[err.code] || 502;
    res.status(status).json({ error: err.message, code: err.code || 'UNKNOWN' });
  }
});

// ── Phase 2B: true streaming, POST-prepare / GET-stream token handoff ──────
// See services/voice-tts-proxy.js's header comment on this section for the
// full rationale. In short: the question TEXT travels here, in a POST body,
// exactly like the existing /synthesize route above -- never in a URL.
// Only an opaque, single-use, short-lived token is ever exposed via GET.
router.post('/synthesize/prepare', voiceInitLimiter, requireAuth, async (req, res) => {
  const { text, voiceProfile, language } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  const token = prepareStream({ text, voiceProfile, language, userId: req.user.id });
  res.json({ streamUrl: '/api/voice/stream/' + encodeURIComponent(token) });
});

router.get('/stream/:token', requireAuth, async (req, res) => {
  try {
    const { upstreamResponse, contentType } = await streamViaElevenLabsToken({
      token: req.params.token,
      userId: req.user.id,
    });

    res.status(200);
    res.set('Content-Type', contentType);

    // True pass-through streaming: Readable.fromWeb wraps the upstream
    // fetch's WHATWG ReadableStream body as a Node stream, piped straight
    // to the Express response as chunks arrive -- nothing buffered here,
    // which is the actual fix for the audit's streaming finding. The
    // browser's <audio> element (fed this route's URL by
    // BrowserAudioPlayer, completely unchanged) plays progressively as
    // these bytes arrive, same as any other progressively-downloaded
    // audio URL.
    const nodeStream = Readable.fromWeb(upstreamResponse.body);
    let firstChunkLogged = false;
    nodeStream.once('data', () => {
      firstChunkLogged = true;
      console.log('[TTS][server] stream:first_audio_byte ' + JSON.stringify({ token: req.params.token }));
    });
    nodeStream.on('error', (err) => {
      console.error('[TTS][server] stream:pipe_error', err && err.message);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    nodeStream.pipe(res);
  } catch (err) {
    const status = ERROR_STATUS_BY_CODE[err.code] || 502;
    res.status(status).json({ error: err.message, code: err.code || 'UNKNOWN' });
  }
});

module.exports = router;
