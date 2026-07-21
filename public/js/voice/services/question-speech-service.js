// public/js/voice/services/question-speech-service.js
//
// PR3 amendment to the MedhaIQ Voice Platform Architecture v1.0 (frozen).
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
// PR3 CONTRACT CHANGE (approved amendment to the frozen interface,
// required before InterviewVoiceController wiring): a third callback,
// onPlaybackError(error), is added alongside onStarted/onFinished.
//   - onStarted()         : fires once playback has actually begun
//   - onFinished()        : fires ONLY on genuine natural completion
//   - onPlaybackError(err): fires on synthesis failure OR the speak()
//     timeout safety net below. onFinished no longer carries an
//     {error} payload -- errors have their own channel now, so a
//     caller checking "did it finish" never has to also check "did it
//     actually start" to know whether it's safe to move on.
//
// PR3 CONTRACT CHANGE 2: speak()-timeout safety net. If onStarted has
// not fired within speakTimeoutMs of a speak() call, this treats it as
// a playback error and releases the internal request token, even
// though the underlying TTSAdapter/proxy already has its own timeout
// (10s as of PR2B). This is deliberately redundant: it is the last
// line of defense against InterviewVoiceController's SPEAKING_PENDING
// state getting stuck if a provider hangs in some way its own timeout
// doesn't catch. In normal operation this should never fire -- it
// only matters when everything else already failed to.
//
// Dependency injection, not internal construction: this service does
// NOT build its own TTSAdapter. See PR1 notes (unchanged).
//
// PR2B internal-only race guard (unchanged, still load-bearing): speak()
// calls ttsAdapter.synthesize(), which is asynchronous (a real network
// round-trip once ElevenLabs is involved). If stop() -- or a newer
// speak() -- happens while a synthesize() call is still in flight, that
// in-flight result must never be played once it resolves; otherwise
// this reintroduces the exact class of bug the whole architecture
// redesign exists to eliminate (see architecture doc §1), just moved
// one layer up. A monotonic request token guards against this -- NOT
// the same thing as the controller's Question Version (that stays in
// InterviewVoiceController); this token is purely internal bookkeeping
// so QuestionSpeechService keeps its own promise honest. The PR3
// speak()-timeout reuses this exact same token mechanism.

(function (global) {
  'use strict';

  var TTSAdapter = global.MedhaIQVoice && global.MedhaIQVoice.TTSAdapter;
  if (!TTSAdapter) {
    throw new Error('QuestionSpeechService requires tts-adapter.js to be loaded first.');
  }

  var DEFAULT_SPEAK_TIMEOUT_MS = 15000; // deliberately longer than the adapter's own ~10s timeout

  /**
   * @param {Object} deps
   * @param {TTSAdapter} deps.ttsAdapter - already-constructed, injected by the caller
   * @param {BrowserAudioPlayer} deps.audioPlayer - already-constructed, injected by the caller
   * @param {Object} [deps.config] - playback preferences only (voice/language/streaming),
   *   never used here to select or construct an adapter
   * @param {number} [deps.speakTimeoutMs] - safety-net timeout for onStarted; defaults to 15000
   */
  function QuestionSpeechService(deps) {
    deps = deps || {};

    if (!deps.ttsAdapter) {
      throw new Error('QuestionSpeechService requires an injected ttsAdapter (satisfying the TTSAdapter contract).');
    }
    if (!(deps.ttsAdapter instanceof TTSAdapter)) {
      throw new Error('QuestionSpeechService: injected ttsAdapter does not satisfy the TTSAdapter contract.');
    }
    if (!deps.audioPlayer) {
      throw new Error('QuestionSpeechService requires an injected audioPlayer.');
    }

    this._ttsAdapter = deps.ttsAdapter;
    this._audioPlayer = deps.audioPlayer;
    this._config = deps.config || {};
    this._speakTimeoutMs = deps.speakTimeoutMs || DEFAULT_SPEAK_TIMEOUT_MS;

    this._requestToken = 0;
    this._pendingTimeoutHandle = null;
    this._startedCallbacks = [];
    this._finishedCallbacks = [];
    this._playbackErrorCallbacks = [];

    var self = this;
    this._audioPlayer.onEnded(function () {
      self._handleNaturalEnd();
    });
  }

  QuestionSpeechService.prototype._clearPendingTimeout = function () {
    if (this._pendingTimeoutHandle) {
      clearTimeout(this._pendingTimeoutHandle);
      this._pendingTimeoutHandle = null;
    }
  };

  QuestionSpeechService.prototype._emitPlaybackError = function (err) {
    this._playbackErrorCallbacks.forEach(function (cb) {
      try { cb(err); } catch (e) { /* isolate listener errors */ }
    });
  };

  QuestionSpeechService.prototype.speak = function (question) {
    this._requestToken += 1;
    var token = this._requestToken;
    var self = this;
    var text = question && question.text;
    var questionId = question && question.questionId;

    // Requested diagnostic format: which question this request belongs to,
    // and which token, at every decision point -- not just "synthesize
    // started" in isolation. Logged here (not inside TTSAdapter/the proxy)
    // because this is the one layer allowed to know "question" and "token"
    // exist -- TTSAdapter must stay provider-agnostic (Design Principle 9).
    console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' start');

    this._clearPendingTimeout(); // any previous request's timer is no longer relevant

    // Safety net (PR3, required change 2): if onStarted hasn't happened
    // within speakTimeoutMs, stop waiting -- treat it as a playback
    // error and release this token so a late resolution is discarded,
    // exactly like an explicit stop() would.
    this._pendingTimeoutHandle = setTimeout(function () {
      if (token !== self._requestToken) return; // already superseded/handled
      self._requestToken += 1; // invalidate -- a late synthesize() resolution must not play
      self._pendingTimeoutHandle = null;
      console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' timeout (currentToken=' + self._requestToken + ')');
      var timeoutErr = new Error('QuestionSpeechService: onStarted was not received within ' + self._speakTimeoutMs + 'ms of speak()');
      timeoutErr.code = 'SPEAK_TIMEOUT';
      self._emitPlaybackError(timeoutErr);
    }, this._speakTimeoutMs);

    this._ttsAdapter.synthesize(text).then(function (audioSource) {
      if (token !== self._requestToken) {
        // A stop(), a newer speak(), or the timeout above already
        // superseded this request. Discard silently -- this is exactly
        // the race this service exists to guard against.
        console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' discarded (stale, currentToken=' + self._requestToken + ')');
        return;
      }
      console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' complete -- playing');
      self._clearPendingTimeout();
      self._audioPlayer.play(audioSource);
      self._startedCallbacks.forEach(function (cb) {
        try { cb(); } catch (e) { /* one listener's error must not break others */ }
      });
    }).catch(function (err) {
      if (token !== self._requestToken) {
        console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' error discarded (stale, currentToken=' + self._requestToken + '): ' + err.message);
        return; // superseded before the failure even arrived
      }
      console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' error: ' + err.message);
      self._clearPendingTimeout();
      // PR3 change 1: synthesis failure is a playback error, not a
      // "finished" -- onFinished now means ONLY genuine natural
      // completion. This is the callback InterviewVoiceController wires
      // to speechState = FREE + continue the interview (see PR3 plan).
      self._emitPlaybackError(err);
    });
  };

  QuestionSpeechService.prototype.stop = function () {
    console.log('[TTS] speechToken=' + this._requestToken + ' stop() -- invalidating (new currentToken=' + (this._requestToken + 1) + ')');
    this._requestToken += 1; // invalidate any in-flight synthesize() for the previous token
    this._clearPendingTimeout();
    this._audioPlayer.stop();
  };

  QuestionSpeechService.prototype._handleNaturalEnd = function () {
    this._finishedCallbacks.forEach(function (cb) {
      try { cb(); } catch (e) { /* isolate listener errors */ }
    });
  };

  QuestionSpeechService.prototype.onStarted = function (callback) {
    if (typeof callback === 'function') this._startedCallbacks.push(callback);
  };
  QuestionSpeechService.prototype.onFinished = function (callback) {
    if (typeof callback === 'function') this._finishedCallbacks.push(callback);
  };
  QuestionSpeechService.prototype.onPlaybackError = function (callback) {
    if (typeof callback === 'function') this._playbackErrorCallbacks.push(callback);
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.QuestionSpeechService = QuestionSpeechService;
})(window);


