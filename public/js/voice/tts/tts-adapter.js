// public/js/voice/tts/tts-adapter.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §6.2.
//
// TTSAdapter is a FROZEN interface: one method, pure text-to-audio
// synthesis. No playback control, no interview logic, no knowledge of
// questions, versions, skip, or queueing (Design Principle 9: voice is
// an infrastructure layer, not business logic). Implementations
// (ElevenLabsTTSAdapter, and future CartesiaTTSAdapter /
// DeepgramAuraTTSAdapter / OpenAITTSAdapter / etc.) must satisfy this
// exact contract so QuestionSpeechService never needs to change when a
// provider is swapped.
//
// NOT YET WIRED into the live app as of PR1.

(function (global) {
  'use strict';

  /**
   * @interface TTSAdapter
   *
   * synthesize(text): Promise<AudioSource>
   *   Given plain text, resolve to an AudioSource that BrowserAudioPlayer
   *   can play (e.g. a URL, Blob, or ArrayBuffer -- finalized in PR2).
   *   Must not play, queue, or cache audio itself.
   */
  function TTSAdapter() {
    if (this.constructor === TTSAdapter) {
      throw new Error('TTSAdapter is an interface and must not be instantiated directly.');
    }
  }

  TTSAdapter.prototype.synthesize = function (text) {
    throw new Error('TTSAdapter.synthesize() not implemented by ' + this.constructor.name);
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.TTSAdapter = TTSAdapter;
})(window);
