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

  ElevenLabsTTSAdapter.prototype.synthesize = function (text) {
    var self = this;
    var startedAt = Date.now();
    log('synthesize:start', { textLength: (text || '').length, voice: this._options.voice, language: this._options.language });

    if (!text || typeof text !== 'string') {
      var validationErr = new Error('ElevenLabsTTSAdapter.synthesize(): text is required');
      log('synthesize:error', { reason: 'invalid input' });
      return Promise.reject(validationErr);
    }

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

