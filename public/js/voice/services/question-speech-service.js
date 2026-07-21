// public/js/voice/services/question-speech-service.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §5.2, §6.3.
//
// Folder renamed from speech/ to services/: this directory will hold
// more than question playback over time -- SpeechCache, VoicePersona,
// LatencyMonitor, Metrics, AudioPrefetch are all anticipated future
// siblings here (see architecture doc §14, Future Roadmap), and none
// of them are "speech" in the narrow sense either.
//
// QuestionSpeechService is the FROZEN, sole entry point
// InterviewVoiceController uses for speech (speak(question) / stop()).
//
// Dependency injection, not internal construction: this service does
// NOT build its own TTSAdapter. The caller (bootstrap wiring, added in
// PR3) reads voice-client-config.js, constructs the concrete adapter
// (e.g. new ElevenLabsTTSAdapter(...)), and passes it in. That means:
//   - unit tests inject a FakeAdapter, never a real ElevenLabsAdapter
//   - this service has zero knowledge of provider names or how to pick
//     one -- it only knows "a ttsAdapter satisfying the TTSAdapter
//     contract was handed to me"
//
// No synthesis, no playback, no speak()/stop() logic yet -- that lands
// in PR2/PR3 alongside BrowserAudioPlayer and the ElevenLabs integration.
//
// NOT YET WIRED into InterviewVoiceController or any view as of PR1.

(function (global) {
  'use strict';

  var TTSAdapter = global.MedhaIQVoice && global.MedhaIQVoice.TTSAdapter;
  if (!TTSAdapter) {
    throw new Error('QuestionSpeechService requires tts-adapter.js to be loaded first.');
  }

  /**
   * @param {Object} deps
   * @param {TTSAdapter} deps.ttsAdapter - already-constructed, injected by the caller
   * @param {BrowserAudioPlayer} deps.audioPlayer - already-constructed, injected by the caller
   * @param {Object} [deps.config] - playback preferences only (voice/language/streaming),
   *   never used here to select or construct an adapter
   */
  function QuestionSpeechService(deps) {
    deps = deps || {};

    if (!deps.ttsAdapter) {
      throw new Error('QuestionSpeechService requires an injected ttsAdapter (satisfying the TTSAdapter contract).');
    }
    if (!(deps.ttsAdapter instanceof TTSAdapter)) {
      throw new Error('QuestionSpeechService: injected ttsAdapter does not satisfy the TTSAdapter contract.');
    }

    this._ttsAdapter = deps.ttsAdapter;
    this._audioPlayer = deps.audioPlayer || null;
    this._config = deps.config || {};
  }

  QuestionSpeechService.prototype.speak = function (question) {
    throw new Error('QuestionSpeechService.speak() not implemented until PR3');
  };
  QuestionSpeechService.prototype.stop = function () {
    throw new Error('QuestionSpeechService.stop() not implemented until PR3');
  };
  QuestionSpeechService.prototype.onStarted = function (callback) {
    throw new Error('QuestionSpeechService.onStarted() not implemented until PR3');
  };
  QuestionSpeechService.prototype.onFinished = function (callback) {
    throw new Error('QuestionSpeechService.onFinished() not implemented until PR3');
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.QuestionSpeechService = QuestionSpeechService;
})(window);
