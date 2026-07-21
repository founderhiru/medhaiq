// public/js/voice/player/browser-audio-player.js
//
// PR2A of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §5.4, §6.4.
//
// Real implementation. Still must NEVER know: interview, questions,
// versions, skip, queueing, Vapi, or ElevenLabs. It is a plain wrapper
// around `new Audio()` and nothing more.
//
// FROZEN CONTRACT (architecture doc §6, callout): stop() requests and
// guarantees that local playback ceases immediately, regardless of how
// the underlying provider implements synthesis. Implemented below via
// a real, synchronous HTMLMediaElement.pause() + currentTime reset --
// there is nothing remote to wait on, so the guarantee holds by
// construction.
//
// audioSource accepted shapes (kept deliberately minimal -- converting
// raw provider bytes into one of these is the TTSAdapter's job, not
// this player's):
//   - string   : a playable URL (including an existing blob: URL)
//   - Blob-like: any object with a string `.type` (duck-typed, not
//                `instanceof Blob`, so this works across realms/sandboxes)
//
// Testability: the audio element itself is created via an injectable
// factory (default: () => new Audio()), NOT hardcoded, so unit tests
// can inject a fake audio element without a real browser. This is an
// internal constructor detail, not part of the frozen public contract
// (play/stop/pause/resume/onEnded unchanged).
//
// Known open question (carried from PR1): no dispose()/teardown method
// exists in the frozen interface. stop() here also removes the
// 'ended' listener from the outgoing audio element and revokes any
// object URL it created, which covers the realistic leak surface for
// now -- revisit if a real dispose() is needed later.
//
// NOT YET WIRED into QuestionSpeechService or any view as of PR2A.

(function (global) {
  'use strict';

  function isBlobLike(value) {
    return !!value && typeof value === 'object' && typeof value.type === 'string';
  }

  function BrowserAudioPlayer(options) {
    options = options || {};
    this._createAudioElement = options.audioFactory || function () {
      return new global.Audio();
    };
    this._audio = null;
    this._objectUrl = null;
    this._endedHandler = null;
    this._endedCallbacks = [];
  }

  BrowserAudioPlayer.prototype._resolveSrc = function (audioSource) {
    if (typeof audioSource === 'string') {
      return { url: audioSource, objectUrl: null };
    }
    if (isBlobLike(audioSource)) {
      if (!global.URL || typeof global.URL.createObjectURL !== 'function') {
        throw new Error('BrowserAudioPlayer: no URL.createObjectURL available to play a Blob-like source.');
      }
      var url = global.URL.createObjectURL(audioSource);
      return { url: url, objectUrl: url };
    }
    throw new Error('BrowserAudioPlayer: unsupported audioSource -- expected a URL string or a Blob-like object with a .type.');
  };

  // Tears down the CURRENT audio element's listeners/object URL without
  // touching this._endedCallbacks (those are player-level subscriptions,
  // not tied to any one audio element).
  BrowserAudioPlayer.prototype._teardownCurrentAudio = function () {
    if (this._audio && this._endedHandler) {
      this._audio.removeEventListener('ended', this._endedHandler);
    }
    this._endedHandler = null;

    if (this._objectUrl && global.URL && typeof global.URL.revokeObjectURL === 'function') {
      global.URL.revokeObjectURL(this._objectUrl);
    }
    this._objectUrl = null;
  };

  BrowserAudioPlayer.prototype.play = function (audioSource) {
    // Defensive stop of whatever is currently playing before starting
    // the new source -- this is the exact overlap the Vapi-based
    // design could never guarantee against (see architecture doc §1).
    this.stop();

    var resolved = this._resolveSrc(audioSource);
    var audio = this._createAudioElement();
    audio.src = resolved.url;

    var self = this;
    var endedHandler = function () {
      self._endedCallbacks.forEach(function (cb) {
        try { cb(); } catch (e) { /* one listener's error must not break others */ }
      });
    };
    audio.addEventListener('ended', endedHandler);

    this._audio = audio;
    this._objectUrl = resolved.objectUrl;
    this._endedHandler = endedHandler;

    var playResult = audio.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(function (err) {
        // No onError hook exists in the frozen contract at this stage
        // (matches the same open question noted for STTAdapter/TTSAdapter
        // in PR1). Logged, not thrown -- a playback failure must never
        // corrupt interview state (Design Principle 8).
        if (global.console && global.console.warn) {
          global.console.warn('[BrowserAudioPlayer] play() rejected:', err && err.message);
        }
      });
    }
  };

  // FROZEN: guarantees local playback ceases immediately, regardless of
  // provider. Real, synchronous pause + position reset -- nothing remote
  // to wait on.
  BrowserAudioPlayer.prototype.stop = function () {
    if (this._audio) {
      try { this._audio.pause(); } catch (e) { /* already stopped/detached */ }
      try { this._audio.currentTime = 0; } catch (e) { /* not seekable/not loaded */ }
    }
    this._teardownCurrentAudio();
    this._audio = null;
  };

  BrowserAudioPlayer.prototype.pause = function () {
    if (this._audio) {
      this._audio.pause();
    }
  };

  BrowserAudioPlayer.prototype.resume = function () {
    if (!this._audio) return;
    var playResult = this._audio.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(function (err) {
        if (global.console && global.console.warn) {
          global.console.warn('[BrowserAudioPlayer] resume() rejected:', err && err.message);
        }
      });
    }
  };

  BrowserAudioPlayer.prototype.onEnded = function (callback) {
    if (typeof callback === 'function') {
      this._endedCallbacks.push(callback);
    }
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.BrowserAudioPlayer = BrowserAudioPlayer;
})(window);

