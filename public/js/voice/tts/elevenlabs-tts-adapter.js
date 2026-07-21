// public/js/voice/tts/elevenlabs-tts-adapter.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §5.3, §6.2.
//
// Empty scaffold for the PR2 implementation. ElevenLabsTTSAdapter will
// call ElevenLabs' TTS endpoint and resolve synthesize(text) to an
// AudioSource for BrowserAudioPlayer -- synthesis only, no playback
// control, no interview logic.
//
// NOT YET WIRED: not instantiated or referenced anywhere in PR1.

(function (global) {
  'use strict';

  var TTSAdapter = global.MedhaIQVoice && global.MedhaIQVoice.TTSAdapter;
  if (!TTSAdapter) {
    throw new Error('ElevenLabsTTSAdapter requires tts-adapter.js to be loaded first.');
  }

  /**
   * @param {{ voice: string, language: string, streaming: boolean }} options
   *   Sourced from VoiceConfig (defaultVoice, language, streaming) --
   *   passed in by QuestionSpeechService in PR2, not read directly from
   *   config here (keeps this adapter free of config-loading concerns).
   */
  function ElevenLabsTTSAdapter(options) {
    TTSAdapter.call(this);
    this._options = options || {};
    // PR2: API client setup, voice ID resolution, streaming vs. buffered mode.
  }
  ElevenLabsTTSAdapter.prototype = Object.create(TTSAdapter.prototype);
  ElevenLabsTTSAdapter.prototype.constructor = ElevenLabsTTSAdapter;

  ElevenLabsTTSAdapter.prototype.synthesize = function (text) {
    // PR2: call ElevenLabs TTS endpoint, return a Promise<AudioSource>.
    return Promise.reject(new Error('ElevenLabsTTSAdapter.synthesize() not implemented until PR2'));
  };

  global.MedhaIQVoice.ElevenLabsTTSAdapter = ElevenLabsTTSAdapter;
})(window);
