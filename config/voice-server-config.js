// config/voice-server-config.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// Server-side ONLY. Never require() this from anything that bridges
// values into a view/response body wholesale (e.g. never
// `res.render(..., { voiceConfig: VOICE_SERVER_CONFIG })`).
//
// Holds provider secrets. Splitting this from the browser-facing
// public/js/voice/voice-client-config.js means browser code
// structurally cannot read API keys, even by accident -- there is no
// single VoiceConfig object that both sides share.
//
// NOT YET WIRED: no route or service requires this in PR1. The actual
// ElevenLabs network call (which needs this key) is a server-side
// proxy route added in a later PR -- the browser's ElevenLabsTTSAdapter
// will call that proxy, never ElevenLabs directly with this key.

const VOICE_SERVER_CONFIG = {
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || null,
};

module.exports = { VOICE_SERVER_CONFIG };
