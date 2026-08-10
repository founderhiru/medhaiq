// public/js/voice/voice-client-config.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// Browser-safe ONLY. Must never contain API keys, tokens, or any
// server secret -- see config/voice-server-config.js for the
// server-side counterpart. This split exists specifically so that
// browser code cannot read server configuration directly.
//
// Provider NAME (sttProvider/ttsProvider) is not secret and lives here
// so bootstrap wiring code (added in PR3) can decide which concrete
// adapter to construct. The adapter is then injected into
// QuestionSpeechService (see services/question-speech-service.js) --
// this file does not construct anything itself.
//
// NOT YET WIRED: nothing reads this in PR1.

(function (global) {
  'use strict';

  var VOICE_CLIENT_CONFIG = {
    sttProvider: 'vapi',
    ttsProvider: 'elevenlabseleven_flash_v2.5', // NOT fixed here on purpose -- unused (see grep: nothing reads ttsProvider), and out of this phase's approved scope. Flagging separately rather than bundling an unrequested change.
    // Persona-Based Dynamic Voice Profiles, Step 1: defaultVoice (a raw
    // ElevenLabs voice ID) removed from here entirely -- it was travelling
    // client -> server on the wire in every synthesize()/prepare() call,
    // which is exactly the provider leak the Speech Layer redesign closes.
    // defaultProfile is a NAME only (must match a key in the server-side
    // config/voice-profiles.js), used solely as the fallback when a
    // question-page load has no resolvable personaId (e.g. debug-voice.ejs).
    // The normal path never touches this -- see
    // public/js/voice/persona-voice-map.js, resolved once per question
    // page from the real personaId.
    defaultProfile: 'defaultProfile',
    // Phase 2B: modelId removed. It was dead configuration -- never read by
    // anything (see the ElevenLabs Model Usage Audit) -- and model selection
    // is now server-side only (VOICE_SERVER_CONFIG.ttsModelId), the single
    // authoritative source, so there's no reason for the client to know or
    // guess it. Also fixed the pre-existing 'elevenlabseleven_flash_v2.5'
    // string here, which was never a valid provider name.
    language: 'en-US',
    streaming: true,
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.VOICE_CLIENT_CONFIG = VOICE_CLIENT_CONFIG;
})(window);
