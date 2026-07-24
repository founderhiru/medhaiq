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
    this._activeAbortController = null;
    this._startedCallbacks = [];
    this._finishedCallbacks = [];
    this._playbackErrorCallbacks = [];

    // ── Speech queue (Phase A, 2026-07-24) ──────────────────────────────
    // Root cause of overlapping ack/question audio: speak() previously
    // only aborted the PREVIOUS in-flight synthesize() network call — it
    // never waited for, or stopped, audio that was already PLAYING. If
    // the backend responded unusually fast (confirmed in a real staging
    // log: a ~1.8s backend round-trip against a ~2-2.5s acknowledgement
    // synthesis+playback), the next question's speak() call would fire
    // while the acknowledgement was still audibly playing, and both
    // ended up playing back-to-back-but-overlapping on the same
    // BrowserAudioPlayer. This queue guarantees exactly one ACTIVE
    // (synthesizing-or-playing) request at a time; every other speak()
    // call waits until the active one reaches a terminal state.
    //
    // _queue: pending {question, token} items not yet started.
    // _activeItem: the currently synthesizing-or-playing item, or null
    // if nothing is active (queue is empty and idle).
    this._queue = [];
    this._activeItem = null;

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

  // TEMPORARY DEBUG LOGGING (Phase A speech-queue instrumentation,
  // 2026-07-24) -- mirrors the existing [DEBUG-SPEAK-ENTRY] convention
  // in this file. Remove once overlapping-playback is confirmed fixed
  // via a live regression pass.
  QuestionSpeechService.prototype._logQueue = function (event, item, extra) {
    console.log('[SPEECH-QUEUE] ' + event, {
      questionId: item && item.question && item.question.questionId,
      token: item && item.token,
      queueDepth: this._queue.length,
      hasActive: !!this._activeItem,
      timestamp: Date.now(),
      extra: extra
    });
    if (global.timelineLog) {
      global.timelineLog('speech_queue_' + event, item && item.question && item.question.questionId, true, 'queueDepth=' + this._queue.length + (extra ? ' ' + extra : ''));
    }
  };

  /**
   * Public entry point — unchanged signature/behavior from the caller's
   * point of view (InterviewVoiceController still just calls speak()),
   * but internally this now enqueues rather than firing immediately.
   */
  QuestionSpeechService.prototype.speak = function (question) {
    this._requestToken += 1;
    var item = { question: question, token: this._requestToken };
    this._queue.push(item);
    this._logQueue('enqueue', item);

    if (!this._activeItem) {
      this._advanceQueue();
    }
    return item.token;
  };

  /**
   * If nothing is currently active and the queue has work, starts the
   * next item. This is the ONLY place _activeItem gets set to a new
   * value from null -- the single serialization point that guarantees
   * at most one active synthesize-or-playback at a time.
   */
  QuestionSpeechService.prototype._advanceQueue = function () {
    if (this._activeItem) return; // something is already active -- do nothing, it'll call this again on its own terminal state
    var next = this._queue.shift();
    if (!next) return; // queue empty, stay idle
    this._activeItem = next;
    this._logQueue('start', next);
    this._runActive(next);
  };

  /**
   * The actual synthesize-then-play logic, run for exactly the current
   * _activeItem. Every exit path (natural completion, cancel, interrupt,
   * error) must end by clearing _activeItem and calling _advanceQueue()
   * so the next queued request (if any) gets its turn.
   */
  QuestionSpeechService.prototype._runActive = function (item) {
    var question = item.question;
    var token = item.token;
    var self = this;
    var text = question && question.text;
    var questionId = question && question.questionId;

    if (this._activeAbortController) {
      try { this._activeAbortController.abort(); } catch (e) { /* already aborted/settled */ }
    }
    var abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    this._activeAbortController = abortController;

    // TEMPORARY DEBUG LOGGING (ElevenLabs usage investigation) -- entry
    // point of speak(), logged before any other work. Remove once the
    // duplicate-synthesis question is resolved.
    console.log('[DEBUG-SPEAK-ENTRY]', {
      questionId: questionId,
      questionVersion: question && question.version, // now populated for real questions (see interview-session.ejs _speak() call site); still undefined for the skip-ack call site, which has no Question Version concept
      requestToken: token,
      textLength: (text || '').length,
      textPreview: (text || '').substring(0, 50),
      reason: question && question.reason, // pure diagnostic metadata -- e.g. initial-question / skip / closing / post-skip-question / question
      timestamp: Date.now()
    });

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
      if (!self._activeItem || token !== self._activeItem.token) return; // already superseded/handled
      self._pendingTimeoutHandle = null;
      console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' timeout');
      var timeoutErr = new Error('QuestionSpeechService: onStarted was not received within ' + self._speakTimeoutMs + 'ms of speak()');
      timeoutErr.code = 'SPEAK_TIMEOUT';
      self._logQueue('cancel', self._activeItem, 'reason=speak_timeout');
      self._activeItem = null;
      self._emitPlaybackError(timeoutErr);
      self._advanceQueue();
    }, this._speakTimeoutMs);

    console.log(
      "[TTS] synthesize",
      {
        questionId: questionId,
        token: token,
        textLength: text.length,
        preview: text.substring(0, 50),
        reason: question && question.reason
      }
    );

    this._ttsAdapter.synthesize(text, abortController ? { signal: abortController.signal } : undefined).then(function (audioSource) {
      if (!self._activeItem || token !== self._activeItem.token) {
        // A stop(), a newer speak(), or the timeout above already
        // superseded this request. Discard silently -- this is exactly
        // the race this service exists to guard against. Never started
        // playing, so this is a 'cancel', not an 'interrupt'.
        console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' discarded (stale)');
        return;
      }
      console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' complete -- playing');
      if (global.timelineLog) global.timelineLog('elevenlabs_synthesized', questionId, true, 'bytes=' + (audioSource && audioSource.size));
      self._clearPendingTimeout();
      var _playSeq = self._audioPlayer.play(audioSource);
      console.log('[TIMELINE-CORRELATION] questionId=' + questionId + ' speechToken=' + token + ' <-> BrowserAudioPlayer playSeq=' + _playSeq);
      if (global.timelineLog) global.timelineLog('browser_started_playback', questionId, true, '(play() invoked -- BrowserAudioPlayer stays provider/interview-agnostic by design, so this confirms play() was called, not independently that audio is audibly playing)');
      self._startedCallbacks.forEach(function (cb) {
        try { cb(); } catch (e) { /* one listener's error must not break others */ }
      });
    }).catch(function (err) {
      if (!self._activeItem || token !== self._activeItem.token) {
        console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' error discarded (stale): ' + err.message);
        return; // superseded before the failure even arrived
      }
      console.log('[TTS] questionId=' + questionId + ' speechToken=' + token + ' error: ' + err.message);
      self._clearPendingTimeout();
      self._logQueue('cancel', self._activeItem, 'reason=synthesis_error');
      self._activeItem = null;
      // PR3 change 1: synthesis failure is a playback error, not a
      // "finished" -- onFinished now means ONLY genuine natural
      // completion. This is the callback InterviewVoiceController wires
      // to speechState = FREE + continue the interview (see PR3 plan).
      self._emitPlaybackError(err);
      self._advanceQueue();
    });
  };

  /**
   * Explicit external stop (barge-in, or "moving to a new turn, cut off
   * whatever's still playing"). Interrupts the current active item (if
   * any) AND clears the pending queue -- a stop() means "silence
   * everything now", not "silence this one, then play whatever was
   * queued next", since queued items belong to the turn being cut off.
   */
  QuestionSpeechService.prototype.stop = function () {
    var hadActive = !!this._activeItem;
    var wasPlaying = hadActive; // if it reached _runActive's synthesize().then(), audio may already be playing; we don't currently track a finer-grained "started" flag here, so treat any active item as a potential interrupt -- see note below
    console.log('[TTS] speechToken=' + (this._activeItem ? this._activeItem.token : '(none)') + ' stop()');

    if (this._activeAbortController) {
      try { this._activeAbortController.abort(); } catch (e) { /* already aborted/settled */ }
      this._activeAbortController = null;
    }
    this._clearPendingTimeout();

    if (hadActive) {
      this._logQueue(wasPlaying ? 'interrupt' : 'cancel', this._activeItem, 'reason=explicit_stop');
      this._activeItem = null;
    }
    // A stop() means "cut everything for this turn" -- any items still
    // waiting in the queue belong to the turn being interrupted and must
    // not play later. Each gets logged as its own clean 'cancel'.
    if (this._queue.length) {
      var self = this;
      this._queue.forEach(function (queuedItem) {
        self._logQueue('cancel', queuedItem, 'reason=queue_cleared_by_stop');
      });
      this._queue = [];
    }

    this._audioPlayer.stop();
  };

  QuestionSpeechService.prototype._handleNaturalEnd = function () {
    if (global.timelineLog) global.timelineLog('playback_finished', null, true, '(natural completion via BrowserAudioPlayer onEnded)');
    if (this._activeItem) {
      this._logQueue('complete', this._activeItem);
      this._activeItem = null;
    }
    this._finishedCallbacks.forEach(function (cb) {
      try { cb(); } catch (e) { /* isolate listener errors */ }
    });
    this._advanceQueue();
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


