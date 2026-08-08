// public/js/voice/persona-voice-map.js
//
// Persona-Based Dynamic Voice Profiles — Step 1 of 3 (architecture only).
//
// Browser-safe ONLY. Maps a personaId (services/interview.js's PERSONAS
// keys) to a logical voiceProfile NAME — never a provider voice ID.
// Provider IDs live only in config/voice-profiles.js (server-side), read
// only by services/voice-tts-proxy.js. This split mirrors the existing
// voice-server-config.js / voice-client-config.js pattern: the browser
// structurally cannot learn a provider voice ID, even by accident,
// because no single object anywhere contains both a personaId and a
// provider ID.
//
// Resolved ONCE per question-page load (views/interview-session.ejs, at
// TTS adapter construction) — not re-resolved per synthesis call. The
// resolved voiceProfile name then rides in every synthesize()/prepare()
// request body in place of the old raw provider voice string.
//
// Load order: after tts-adapter.js's base classes, before
// elevenlabs-tts-adapter.js is *constructed* (not required to be loaded
// before elevenlabs-tts-adapter.js itself — only before the construction
// call site in interview-session.ejs runs).

(function (global) {
  'use strict';

  var PERSONA_VOICE_MAP = {
    alex_chen: 'alex',
    priya_ramesh: 'priya',
    marcus_webb: 'marcus',
    sanjeev_nair: 'sanjeev',
    sarah_kim: 'sarah',
    raj_mehta: 'raj',
  };

  // Must match config/voice-profiles.js's `defaultProfile` key exactly —
  // this is the one piece of shared vocabulary between the two files
  // (a name, never an ID), by design.
  var DEFAULT_VOICE_PROFILE = 'defaultProfile';

  /**
   * @param {string} [personaId] - e.g. 'alex_chen'.
   * @returns {string} a voiceProfile name — always returns something
   *   usable; unknown/missing personaId falls back to
   *   DEFAULT_VOICE_PROFILE, which config/voice-profiles.js also
   *   recognizes server-side.
   */
  function resolveVoiceProfile(personaId) {
    return PERSONA_VOICE_MAP[personaId] || DEFAULT_VOICE_PROFILE;
  }

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.PERSONA_VOICE_MAP = PERSONA_VOICE_MAP;
  global.MedhaIQVoice.resolveVoiceProfile = resolveVoiceProfile;
})(window);
