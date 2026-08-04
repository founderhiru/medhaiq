// public/js/voice/tts/elevenlabs-tts-adapter.js
//
// PR2B of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
// See MedhaIQ_Voice_Platform_Architecture_v1.0.docx §5.3, §6.2.
//
// Real implementation. Calls the server-side proxy
// (routes/voice-tts.js -> services/voice-tts-proxy.js) -- NEVER
// ElevenLabs directly and NEVER holds an API key. The proxy is not
// mounted in server.js yet (see routes/voice-tts.js), so this adapter
// is not reachable from the live app either; it is only exercised by
// PR2B's own test harness pointing at a standalone test server.
//
// Deliberately provider-neutral naming, per architecture doc §5.3 and
// explicit instruction: the public method is synthesize(text), not
// e.g. generateElevenLabsAudio(). Nothing ElevenLabs-specific leaks
// into the TTSAdapter contract -- only this file's internals know a
// provider named "ElevenLabs" exists.
//
// Temporary structured logging (PR2B scope, remove in PR5):
//   [TTS] synthesize:start / synthesize:complete / synthesize:error

(function (global) {
  'use strict';

  var TTSAdapter = global.MedhaIQVoice && global.MedhaIQVoice.TTSAdapter;
  if (!TTSAdapter) {
    throw new Error('ElevenLabsTTSAdapter requires tts-adapter.js to be loaded first.');
  }

  function log(event, detail) {
    var line = '[TTS] ' + event + (detail ? ' ' + JSON.stringify(detail) : '');
    if (global.console && global.console.log) global.console.log(line);
  }

  /**
   * @param {{ voice: string, language: string, streaming: boolean }} options
   *   Sourced from VoiceConfig (defaultVoice, language, streaming).
   * @param {{ proxyUrl: string, timeoutMs: number }} [httpOptions]
   *   Not part of VoiceConfig -- these are adapter-internal wiring details
   *   (which local/staging/prod path to call, how long to wait), injected
   *   separately so tests can point this at a mock server without needing
   *   a VoiceConfig field for it.
   */
  function ElevenLabsTTSAdapter(options, httpOptions) {
    TTSAdapter.call(this);
    this._options = options || {};
    this._proxyUrl = (httpOptions && httpOptions.proxyUrl) || '/api/voice/synthesize';
    this._timeoutMs = (httpOptions && httpOptions.timeoutMs) || 10000;
  }
  ElevenLabsTTSAdapter.prototype = Object.create(TTSAdapter.prototype);
  ElevenLabsTTSAdapter.prototype.constructor = ElevenLabsTTSAdapter;

  /**
   * Phase 2B (Voice Layer Optimization): public entry point unchanged in
   * signature/behavior from the caller's point of view (still
   * synthesize(text) -> Promise<Blob-like-or-URL-string>, still consumed
   * identically by QuestionSpeechService and BrowserAudioPlayer -- see
   * BrowserAudioPlayer's own header comment confirming it already accepts
   * either shape). Internally, when streaming is configured, this now
   * tries the true-streaming path first (POST-prepare / GET-stream token
   * handoff -- see routes/voice-tts.js and services/voice-tts-proxy.js)
   * and falls back to the original POST+blob path on ANY failure, exactly
   * per the "no regression acceptable" requirement. The fallback is not a
   * degraded mode the caller has to know about -- one synthesize() promise
   * either way.
   */
  ElevenLabsTTSAdapter.prototype.synthesize = function (text) {
    var self = this;
    var startedAt = Date.now();
    log('synthesize:start', { textLength: (text || '').length, voice: this._options.voice, language: this._options.language });
    log('request:start', { elapsedMs: 0 }); // Phase 2B latency instrumentation -- "TTS Request Start"

    if (!text || typeof text !== 'string') {
      var validationErr = new Error('ElevenLabsTTSAdapter.synthesize(): text is required');
      log('synthesize:error', { reason: 'invalid input' });
      return Promise.reject(validationErr);
    }

    if (this._options.streaming) {
      return this._synthesizeViaStream(text, startedAt).catch(function (streamErr) {
        log('stream:fallback_to_blob', { reason: streamErr && streamErr.message, elapsedMs: Date.now() - startedAt });
        return self._synthesizeViaBlob(text, startedAt);
      });
    }
    return this._synthesizeViaBlob(text, startedAt);
  };

  /**
   * True-streaming attempt. Resolves with a plain URL STRING (not a Blob)
   * -- BrowserAudioPlayer already accepts this shape unchanged (see its
   * _resolveSrc: a string is treated as a playable URL directly). The
   * browser's native <audio> element progressively downloads and plays
   * that URL's bytes as they arrive; no MediaSource/SourceBuffer code
   * needed here or in the player.
   *
   * Two network round-trips, both fast and both POST (the founder's
   * approved refinement -- question text never appears in a URL):
   *   1. POST /synthesize/prepare {text, voice, language} -> {streamUrl}
   *      (streamUrl contains only an opaque token, never the text)
   *   2. (not fetched here at all -- step 2 is BrowserAudioPlayer.play()
   *      setting audio.src = streamUrl, a GET the browser issues itself)
   */
  ElevenLabsTTSAdapter.prototype._synthesizeViaStream = function (text, startedAt) {
    var self = this;
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(function () { controller.abort(); }, this._timeoutMs);
    }

    var fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        voice: this._options.voice,
        language: this._options.language,
      }),
    };
    if (controller) fetchOptions.signal = controller.signal;

    return global.fetch(this._proxyUrl + '/prepare', fetchOptions)
      .then(function (response) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            var err = new Error('Stream prepare failed: ' + (body.error || response.status));
            err.status = response.status;
            err.code = body.code || 'UNKNOWN';
            throw err;
          });
        }
        return response.json();
      })
      .then(function (body) {
        if (!body || typeof body.streamUrl !== 'string') {
          throw new Error('Stream prepare response missing streamUrl');
        }
        log('stream:prepared', { elapsedMs: Date.now() - startedAt });
        return body.streamUrl; // resolves synthesize()'s promise -- a URL string, handed straight to BrowserAudioPlayer.play()
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (controller && controller.signal.aborted) {
          throw new Error('Stream prepare timed out after ' + self._timeoutMs + 'ms');
        }
        throw err;
      });
  };

  /**
   * Original PR2B implementation, unchanged internally -- renamed only.
   * This is now both (a) the path used when streaming is off, and (b) the
   * fallback path when streaming is on but _synthesizeViaStream rejected
   * for any reason.
   */
  ElevenLabsTTSAdapter.prototype._synthesizeViaBlob = function (text, startedAt) {
    var self = this;
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(function () { controller.abort(); }, this._timeoutMs);
    }

    var fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        voice: this._options.voice,
        language: this._options.language,
        streaming: this._options.streaming,
      }),
    };
    if (controller) fetchOptions.signal = controller.signal;

    return global.fetch(this._proxyUrl, fetchOptions)
      .then(function (response) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            var err = new Error('TTS synthesis failed: ' + (body.error || response.status));
            err.status = response.status;
            err.code = body.code || 'UNKNOWN';
            throw err;
          });
        }
        return response.blob();
      })
      .then(function (blob) {
        log('synthesize:complete', { elapsedMs: Date.now() - startedAt, bytes: blob.size, type: blob.type });
        return blob; // Blob satisfies BrowserAudioPlayer's Blob-like contract (has .type)
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        var reason = (controller && controller.signal.aborted) ? 'timeout' : (err.code || err.message);
        log('synthesize:error', { reason: reason, elapsedMs: Date.now() - startedAt });
        // Re-throw a clean, consistent Error regardless of failure mode
        // (network failure, invalid key surfaced as UPSTREAM_AUTH by the
        // proxy, timeout) -- callers only ever see "synthesize failed",
        // never a raw fetch/network exception shape.
        if (controller && controller.signal.aborted) {
          throw new Error('TTS synthesis timed out after ' + self._timeoutMs + 'ms');
        }
        throw err;
      });
  };

  global.MedhaIQVoice.ElevenLabsTTSAdapter = ElevenLabsTTSAdapter;
})(window);

