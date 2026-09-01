// config/voice-profiles.js
//
// Persona-Based Dynamic Voice Profiles — Step 1 of 3 (architecture only).
//
// Speech Layer ONLY. Server-side. The ONLY file in the codebase where a
// persona's *voice* touches a real provider voice ID. Nothing above
// services/voice-tts-proxy.js (its sole reader) ever sees a provider ID —
// not routes/voice-tts.js, not any browser code, not the Interview Engine.
// Mirrors the existing split in config/voice-server-config.js (server
// secrets, never bridged into a view/response body wholesale) — same
// discipline applied here to provider voice IDs.
//
// personaId (services/interview.js's PERSONAS keys) never appears in this
// file. The Interview Engine knows personaId; the browser resolves
// personaId -> voiceProfile NAME via public/js/voice/persona-voice-map.js
// (name only, no provider data); this file resolves that NAME ->
// providerVoice. Two separate, one-directional hops — neither side needs
// to know the other's shape.
//
// Rollout (explicit, staged, per founder direction):
//   Step 1 (done): architecture correct, all six profiles pointed at the
//     SAME existing ElevenLabs voice (CURRENT_DEFAULT_VOICE_ID) — zero
//     behavior change to what candidates hear.
//   Step 2 (done): regression pass confirmed interview behavior was
//     100% unchanged with this layer in place.
//   Step 3 (this change): each profile's providerVoice swapped for a
//     distinct real ElevenLabs ID. Configuration-only — no other file in
//     the codebase changed for Step 3. CURRENT_DEFAULT_VOICE_ID is kept
//     below only as the fallback (defaultProfile) voice.
//
// Extensible on purpose: fields beyond providerVoice are forward-looking
// and safe to add to without touching any call site. Only .providerVoice
// is read today (see services/voice-tts-proxy.js) — model/pace/style/
// stability/similarityBoost are accepted now so Step 3 (and beyond) is
// purely additive to this object, never a code change.

// Carried over unchanged from the prior single-voice config (was
// public/js/voice/voice-client-config.js's defaultVoice, browser-side —
// now removed from there and living here instead, server-side only).
const CURRENT_DEFAULT_VOICE_ID = 'hpp4J3VqNfWAUOO0d1Us'; // "Bella" (premade)

// Shape of a single voice profile:
// {
//   provider: 'elevenlabs',       // which TTS provider this profile targets
//   providerVoice: '<voice id>',  // REQUIRED — the only field read today
//   model: undefined,             // optional per-voice model override (falls back to VOICE_SERVER_CONFIG.ttsModelId)
//   pace: 1.0,                    // speaking rate — provider-mapped in a future step
//   style: undefined,             // free-text descriptor (e.g. 'analytical', 'energetic founder')
//   stability: undefined,         // provider-specific delivery tuning (e.g. ElevenLabs voice_settings.stability)
//   similarityBoost: undefined,   // ditto (ElevenLabs voice_settings.similarity_boost)
// }

const VOICE_PROFILES = {
  // Step 3: each persona now resolves to its own distinct ElevenLabs
  // voice ID (below). defaultProfile, at the bottom of this object,
  // intentionally still falls back to CURRENT_DEFAULT_VOICE_ID.
  alex: {
    provider: 'elevenlabs',
    providerVoice:'aKUMgdkpitgitOAQ9gZN',
    pace: 0.95,
    style: 'analytical',
  },
  priya: {
    provider: 'elevenlabs',
    providerVoice: 'D7UvEAZ6mWnzSoRPS3jV', 
    pace: 1.05,
    style: 'structured executive',
  },
  marcus: {
    provider: 'elevenlabs',
    providerVoice: 'ZoiZ8fuDWInAcwPXaVeq',
    pace: 1.0,
    style: 'conversational product leadership',
  },
  sanjeev: {
    provider: 'elevenlabs',
    providerVoice: 'YlKsPt31o1mfk5M6i78o',
    pace: 0.95,
    style: 'engineering leadership',
  },
  sarah: {
    provider: 'elevenlabs',
    providerVoice: '299hhEjoz44O862N5H4G', 
    pace: 1.1,
    style: 'energetic founder',
  },
  raj: {
    provider: 'elevenlabs',
    providerVoice: 'M50bdzdVCqNbr6HtbFB5',
    pace: 1.0,
    style: 'polished executive',
  },

  // Fallback for a missing/unknown voiceProfile (e.g. debug-voice.ejs,
  // any flow that reaches the TTS proxy without a resolved persona).
  // resolveVoiceProfile() below always returns a usable profile — never
  // throws — same "fail open" principle already used by the client
  // adapter's streaming->blob fallback.
  defaultProfile: {
    provider: 'elevenlabs',
    providerVoice: CURRENT_DEFAULT_VOICE_ID,
    pace: 1.0,
    style: 'neutral',
  },
};

/**
 * @param {string} [voiceProfileName] - e.g. 'alex'. Sourced from the
 *   browser's voiceProfile request field (never a provider ID — see
 *   routes/voice-tts.js).
 * @returns {{provider:string, providerVoice:string, model?:string, pace?:number, style?:string, stability?:number, similarityBoost?:number}}
 *   Always a usable profile. Unknown or missing names fall back to
 *   defaultProfile rather than throwing.
 */
function resolveVoiceProfile(voiceProfileName) {
  return VOICE_PROFILES[voiceProfileName] || VOICE_PROFILES.defaultProfile;
}

module.exports = { VOICE_PROFILES, resolveVoiceProfile, CURRENT_DEFAULT_VOICE_ID };
