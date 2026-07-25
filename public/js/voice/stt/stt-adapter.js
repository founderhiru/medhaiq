// public/js/voice/stt/stt-adapter.js
//
// PR1 of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §6.1.
//
// STTAdapter is a FROZEN interface. Any implementation (VapiSTTAdapter,
// and future DeepgramSTTAdapter / AssemblyAISTTAdapter / etc.) must
// satisfy this exact method contract. It owns microphone capture,
// streaming speech-to-text, and call lifecycle ONLY -- it must never
// know a "question" exists, never speak, never play audio, never queue,
// never interrupt (Design Principle 3: STT and TTS are independent
// systems).
//
// This file defines the contract only. It is not instantiated directly
// and is not yet referenced by any adapter, controller, or view --
// NOT YET WIRED into the live app as of PR1.

(function (global) {
  'use strict';

  /**
   * @interface STTAdapter
   *
   * startSession(sessionContext): Promise<void>
   *   Begin microphone capture + streaming STT for the given session.
   *
   * endSession(): void
   *   Tear down the session (mic, transport, listeners).
   *
   * onUserTranscript(callback): void
   *   Register a callback invoked with FINAL transcript text only.
   *   Interim/partial transcripts must never reach this callback.
   *
   * onCallEnded(callback): void
   *   Register a callback invoked when the underlying call/session ends
   *   for any reason (not just intentional stop).
   *
   * onError(callback): void
   *   Register a callback invoked on any provider-level error. Per
   *   Design Principle 8 (provider failures must not corrupt interview
   *   state), callers treat this as "release any gate held on this
   *   adapter's account" -- never as a reason to block interview text
   *   or scoring.
   */
  function STTAdapter() {
    if (this.constructor === STTAdapter) {
      throw new Error('STTAdapter is an interface and must not be instantiated directly.');
    }
  }

  STTAdapter.prototype.startSession = function (sessionContext) {
    throw new Error('STTAdapter.startSession() not implemented by ' + this.constructor.name);
  };
  STTAdapter.prototype.endSession = function () {
    throw new Error('STTAdapter.endSession() not implemented by ' + this.constructor.name);
  };
  STTAdapter.prototype.onUserTranscript = function (callback) {
    throw new Error('STTAdapter.onUserTranscript() not implemented by ' + this.constructor.name);
  };
  STTAdapter.prototype.onCallEnded = function (callback) {
    throw new Error('STTAdapter.onCallEnded() not implemented by ' + this.constructor.name);
  };
  STTAdapter.prototype.onError = function (callback) {
    throw new Error('STTAdapter.onError() not implemented by ' + this.constructor.name);
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.STTAdapter = STTAdapter;
})(window);
