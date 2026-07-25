// public/js/voice/stt/vapi-stt-adapter.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §5.5, §6.1.
//
// Empty scaffold for the PR2 implementation. VapiSTTAdapter will wrap
// Vapi's existing mic + streaming STT + call-lifecycle behavior --
// the SAME events already used in views/interview-session.ejs
// (call-start, call-end, error, and the message/transcript branch for
// message.role === 'user' && message.transcriptType === 'final') --
// re-homed behind the STTAdapter contract rather than reimplemented.
//
// It must NEVER gain responsibility for speech OUTPUT (no vapi.say(),
// no silenceCurrentSpeech()/resumeAudioSubscription() equivalents) --
// that responsibility belongs entirely to TTSAdapter/QuestionSpeechService.
//
// NOT YET WIRED: not instantiated or referenced anywhere in PR1. The
// existing Vapi mic/STT code in interview-session.ejs is untouched and
// remains the live path until PR3.

(function (global) {
  'use strict';

  var STTAdapter = global.MedhaIQVoice && global.MedhaIQVoice.STTAdapter;
  if (!STTAdapter) {
    throw new Error('VapiSTTAdapter requires stt-adapter.js to be loaded first.');
  }

  function VapiSTTAdapter() {
    STTAdapter.call(this);
    // PR2: internal Vapi instance, transcript callback registry, etc.
  }
  VapiSTTAdapter.prototype = Object.create(STTAdapter.prototype);
  VapiSTTAdapter.prototype.constructor = VapiSTTAdapter;

  VapiSTTAdapter.prototype.startSession = function (sessionContext) {
    // PR2: vapi.start(...), matching the existing call-start handshake.
    return Promise.reject(new Error('VapiSTTAdapter.startSession() not implemented until PR2'));
  };
  VapiSTTAdapter.prototype.endSession = function () {
    // PR2: vapi.stop(...)
  };
  VapiSTTAdapter.prototype.onUserTranscript = function (callback) {
    // PR2: forward message.role === 'user' && transcriptType === 'final'
  };
  VapiSTTAdapter.prototype.onCallEnded = function (callback) {
    // PR2: forward vapi.on('call-end', ...)
  };
  VapiSTTAdapter.prototype.onError = function (callback) {
    // PR2: forward vapi.on('error', ...)
  };

  global.MedhaIQVoice.VapiSTTAdapter = VapiSTTAdapter;
})(window);
