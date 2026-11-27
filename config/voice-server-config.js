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
  // Phase 2B (Voice Layer Optimization): the single authoritative source for
  // which ElevenLabs model is used -- previously the request never sent
  // model_id at all, so ElevenLabs silently applied its own account default
  // (eleven_multilingual_v2, per their May 2025 changelog), while an unused
  // client-side config field separately claimed "eleven_v3" (never read by
  // anything -- see the ElevenLabs Model Usage Audit). eleven_flash_v2_5 is
  // ElevenLabs' own recommended model for real-time/conversational use.
  ttsModelId: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5',
  // Global interviewer speaking pace (2026-09-01) -- applies identically
  // to every persona/voice ID, by design (no per-persona override at this
  // stage). ElevenLabs' documented valid range is 0.7-1.2; 1.0 is their
  // own default, which is what this integration silently used before
  // this change (voice_settings was never sent at all). 0.90 slows
  // delivery slightly for a calmer, more measured pace without
  // approaching the quality degradation ElevenLabs' own docs warn about
  // near the extremes of the range.
  ttsSpeed: process.env.ELEVENLABS_TTS_SPEED ? parseFloat(process.env.ELEVENLABS_TTS_SPEED) : 0.90,

  // ── Google Cloud TTS (staging migration, 2026-11-27) -- ALL additive ──────
  // TTS_PROVIDER is the reversible feature flag. Anything other than the
  // exact value 'google' (unset, typo, 'elevenlabs') keeps ElevenLabs, so a
  // misconfiguration can never silently switch providers. Read at call time
  // by services/voice-tts-proxy.js.
  ttsProvider: (process.env.TTS_PROVIDER || 'elevenlabs').trim().toLowerCase(),
  // Service-account JSON (raw JSON or base64 of it). Server-side ONLY, same
  // discipline as elevenLabsApiKey: never bridged into a view/response.
  googleTtsServiceAccountJson: process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON || null,
  // Overridable only so tests can point at a local mock server.
  googleTtsApiBaseUrl: process.env.GOOGLE_TTS_API_BASE_URL || 'https://texttospeech.googleapis.com',
  googleOauthTokenUrl: process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  // 'chirp3hd' (default, premium) or 'wavenet' (cheaper). Per-persona voice
  // names for each tier live in config/voice-profiles.js. Pacing is NOT
  // duplicated here: Google's speakingRate is fed from ttsSpeed above, so
  // the single 0.90 pacing setting governs both providers.
  googleTtsVoiceTier: (process.env.GOOGLE_TTS_VOICE_TIER || 'chirp3hd').trim().toLowerCase(),
};

module.exports = { VOICE_SERVER_CONFIG };

