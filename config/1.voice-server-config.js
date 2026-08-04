// config/voice-server-config.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// Extended in PR2B (additive only -- elevenLabsApiKey unchanged from PR1).
//
// Server-side ONLY. Never require() this from anything that bridges
// values into a view/response body wholesale (e.g. never
// `res.render(..., { voiceConfig: VOICE_SERVER_CONFIG })`).
//
// Holds provider secrets. Splitting this from the browser-facing
// public/js/voice/voice-client-config.js means browser code
// structurally cannot read API keys, even by accident -- there is no
// single VoiceConfig object that both sides share.
//
// elevenLabsApiBaseUrl is overridable via env var specifically so the
// PR2B proxy (services/voice-tts-proxy.js) can be pointed at a local
// mock server in tests, without touching this file per environment.

const VOICE_SERVER_CONFIG = {
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || null,
  elevenLabsApiBaseUrl: process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io',
  requestTimeoutMs: parseInt(process.env.VOICE_TTS_TIMEOUT_MS, 10) || 10000,
};

module.exports = { VOICE_SERVER_CONFIG };

