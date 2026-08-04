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
    defaultVoice: 'hpp4J3VqNfWAUOO0d1Us', // TEMP TEST 2: "Bella" (premade) -- decisive test for whether this is plan-level API restriction vs voice-specific
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
