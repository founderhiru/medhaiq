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
    providerVoice:'SQ8WYwlpzxrTbbuJgi38',
    pace: 0.95,
    style: 'analytical',
  },
  priya: {
    provider: 'elevenlabs',
    providerVoice: 'C3aqZfd4M0h7Ys5tWGIS', 
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

// ═══════════════════════════════════════════════════════════════════════════
// Google Cloud TTS voices (staging migration, 2026-11-27)
//
// A PARALLEL map, deliberately NOT merged into VOICE_PROFILES above, so the
// ElevenLabs entries stay byte-identical (instant, lossless rollback) and
// only services/voice-tts-proxy.js's Google branch ever reads this.
//
// Every voice name below was checked against Google's published en-IN /
// en-US voice list (2026-11-27). Genders are Google's own SSML genders.
// Persona gender is inferred from the persona's first name -- the Interview
// Engine defines no gender field. Locale follows the persona's identity:
// Indian-named personas (priya, sanjeev, raj) -> en-IN; the others -> en-US.
// The specific Chirp 3 HD voice picked within each gender is a FIRST GUESS,
// to be confirmed by ear on the founder-only compare page
// (/debug/voice/compare) -- changing any of them is a one-line edit here.
//
//   chirp3hd -> $30 / 1M chars, first 1M chars/month free   (premium)
//   wavenet  -> $4  / 1M chars, first 4M chars/month free   (cheaper)
// ═══════════════════════════════════════════════════════════════════════════
const GOOGLE_VOICES = {
  alex: {      // analytical, male, US
    chirp3hd: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Puck', gender: 'MALE' },
    wavenet:  { languageCode: 'en-US', name: 'en-US-Wavenet-D', gender: 'MALE' },
  },
  priya: {     // structured executive, female, India
    chirp3hd: { languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Erinome', gender: 'FEMALE' },
    wavenet:  { languageCode: 'en-IN', name: 'en-IN-Wavenet-D', gender: 'FEMALE' },
  },
  marcus: {    // conversational product leader, male, US
    chirp3hd: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Achird', gender: 'MALE' },
    wavenet:  { languageCode: 'en-US', name: 'en-US-Wavenet-I', gender: 'MALE' },
  },
  sanjeev: {   // engineering leadership, male, India
    chirp3hd: { languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Iapetus', gender: 'MALE' },
    wavenet:  { languageCode: 'en-IN', name: 'en-IN-Wavenet-C', gender: 'MALE' },
  },
  sarah: {     // energetic founder, female, US
    chirp3hd: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Zephyr', gender: 'FEMALE' },
    wavenet:  { languageCode: 'en-US', name: 'en-US-Wavenet-F', gender: 'FEMALE' },
  },
  raj: {       // polished executive, male, India
    chirp3hd: { languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Schedar', gender: 'MALE' },
    wavenet:  { languageCode: 'en-IN', name: 'en-IN-Wavenet-B', gender: 'MALE' },
  },
  // Same fail-open principle as defaultProfile above.
  defaultProfile: {
    chirp3hd: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Kore', gender: 'FEMALE' },
    wavenet:  { languageCode: 'en-US', name: 'en-US-Wavenet-H', gender: 'FEMALE' },
  },
};

// Extra candidates offered ONLY on the founder compare page, so voices can be
// auditioned across personas before one is locked in. Never used in a live
// interview unless copied into GOOGLE_VOICES above.
const GOOGLE_COMPARE_EXTRAS = [
  { tier: 'chirp3hd', languageCode: 'en-US', name: 'en-US-Chirp3-HD-Puck', gender: 'MALE' },
  { tier: 'chirp3hd', languageCode: 'en-US', name: 'en-US-Chirp3-HD-Orus', gender: 'MALE' },
  { tier: 'chirp3hd', languageCode: 'en-US', name: 'en-US-Chirp3-HD-Aoede', gender: 'FEMALE' },
  { tier: 'chirp3hd', languageCode: 'en-US', name: 'en-US-Chirp3-HD-Leda', gender: 'FEMALE' },
  { tier: 'chirp3hd', languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Charon', gender: 'MALE' },
  { tier: 'chirp3hd', languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Orus', gender: 'MALE' },
  { tier: 'chirp3hd', languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Kore', gender: 'FEMALE' },
  { tier: 'chirp3hd', languageCode: 'en-IN', name: 'en-IN-Chirp3-HD-Sulafat', gender: 'FEMALE' },
  { tier: 'wavenet', languageCode: 'en-US', name: 'en-US-Wavenet-A', gender: 'MALE' },
  { tier: 'wavenet', languageCode: 'en-US', name: 'en-US-Wavenet-J', gender: 'MALE' },
  { tier: 'wavenet', languageCode: 'en-US', name: 'en-US-Wavenet-C', gender: 'FEMALE' },
  { tier: 'wavenet', languageCode: 'en-IN', name: 'en-IN-Wavenet-A', gender: 'FEMALE' },
  { tier: 'wavenet', languageCode: 'en-IN', name: 'en-IN-Wavenet-F', gender: 'MALE' },
];

const GOOGLE_VOICE_TIERS = ['chirp3hd', 'wavenet'];

/**
 * @param {string} [voiceProfileName] - same persona NAME resolveVoiceProfile takes.
 * @param {string} [tier] - 'chirp3hd' | 'wavenet'; anything else -> 'chirp3hd'.
 * @returns {{languageCode:string, name:string, gender:string}} always usable, never throws.
 */
function resolveGoogleVoice(voiceProfileName, tier) {
  const entry = GOOGLE_VOICES[voiceProfileName] || GOOGLE_VOICES.defaultProfile;
  const t = GOOGLE_VOICE_TIERS.includes(tier) ? tier : 'chirp3hd';
  return entry[t];
}

module.exports = {
  VOICE_PROFILES, resolveVoiceProfile, CURRENT_DEFAULT_VOICE_ID,
  GOOGLE_VOICES, GOOGLE_COMPARE_EXTRAS, GOOGLE_VOICE_TIERS, resolveGoogleVoice,
};
