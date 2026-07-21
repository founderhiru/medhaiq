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
    ttsProvider: 'elevenlabseleven_multilingual_v2',
    defaultVoice: 'nPczCjzI2devNBz1zQrb', // TEMP TEST 2: "Brian" (premade) -- decisive test for whether this is plan-level API restriction vs voice-specific
    modelId: "eleven_v3",
    language: 'en-US',
    streaming: true,
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.VOICE_CLIENT_CONFIG = VOICE_CLIENT_CONFIG;
})(window);
