// services/voice-tts-proxy.js
//
// PR2B of the MedhaIQ Voice Platform Architecture v1.0 (frozen).
//
// Thin-routes/service-orchestrators convention (matches
// services/resume-preview.js etc.): routes/voice-tts.js stays a thin
// HTTP wrapper; this file holds the actual ElevenLabs call, timeout,
// and error normalization.
//
// This is the ONLY place in the entire codebase that holds
// VOICE_SERVER_CONFIG.elevenLabsApiKey in memory during a request.
// It is never logged, never included in any response body, and never
// forwarded to the browser in any form.
//
// NOT YET WIRED: routes/voice-tts.js (which calls this) is not
// mounted in server.js as of PR2B. Nothing in the live app can reach
// this code yet.
//
// Temporary structured logging (per architecture doc PR2B scope):
// [TTS] tags mirror the client-side adapter's own logging so a single
// grep across server + browser logs tells the whole synthesis story.
// Remove in PR5 along with the client-side equivalents.

const { VOICE_SERVER_CONFIG } = require('../config/voice-server-config');

function logTTS(event, detail) {
  // eslint-disable-next-line no-console
  console.log('[TTS][server] ' + event + (detail ? ' ' + JSON.stringify(detail) : ''));
}

/**
 * @param {{ text: string, voice: string, language: string, streaming: boolean }} params
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 * @throws {Error} with a `.code` of 'CONFIG_MISSING' | 'UPSTREAM_AUTH' | 'PAYMENT_REQUIRED' | 'UPSTREAM_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR'
 */
async function synthesizeViaElevenLabs(params) {
  const startedAt = Date.now();
  const voiceId = params.voice || 'Rachel';
  const resolvedUrl = VOICE_SERVER_CONFIG.elevenLabsApiBaseUrl.replace(/\/$/, '') + '/v1/text-to-speech/' + encodeURIComponent(voiceId);

  // Existence/length only -- NEVER the key value itself, in logs or anywhere else.
  logTTS('synthesize:start', {
    textLength: (params.text || '').length,
    voice: params.voice,
    language: params.language,
    endpoint: resolvedUrl,
    apiKeyPresent: !!VOICE_SERVER_CONFIG.elevenLabsApiKey,
    apiKeyLength: VOICE_SERVER_CONFIG.elevenLabsApiKey ? VOICE_SERVER_CONFIG.elevenLabsApiKey.length : 0,
  });

  if (!VOICE_SERVER_CONFIG.elevenLabsApiKey) {
    const err = new Error('VOICE_SERVER_CONFIG.elevenLabsApiKey is not set');
    err.code = 'CONFIG_MISSING';
    logTTS('synthesize:error', { code: err.code, message: err.message });
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOICE_SERVER_CONFIG.requestTimeoutMs);

  const url = resolvedUrl;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': VOICE_SERVER_CONFIG.elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: params.text,
        // model_id is REQUIRED by ElevenLabs' real API -- every documented
        // example includes it. Previously omitted entirely, which may have
        // been defaulting to a model this account/plan doesn't have access
        // to (a plausible explanation for a 402 despite full credits).
        // eleven_multilingual_v2 is ElevenLabs' broadly-available default
        // across plans; language/streaming were never real accepted fields
        // (language_code is, and must be a 2-letter ISO 639-1 code, not a
        // locale string like "en-US"; streaming is a different endpoint
        // path, not a body flag -- not implemented here yet).
        model_id: 'eleven_multilingual_v2',
        language_code: (params.language || 'en-US').split('-')[0],
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('ElevenLabs request timed out after ' + VOICE_SERVER_CONFIG.requestTimeoutMs + 'ms');
      timeoutErr.code = 'TIMEOUT';
      logTTS('synthesize:error', { code: timeoutErr.code, elapsedMs: Date.now() - startedAt });
      throw timeoutErr;
    }
    const networkErr = new Error('Network error reaching ElevenLabs: ' + err.message);
    networkErr.code = 'NETWORK_ERROR';
    logTTS('synthesize:error', { code: networkErr.code, message: err.message });
    throw networkErr;
  }
  clearTimeout(timeout);

  if (response.status === 401 || response.status === 403) {
    const bodyText = await response.text().catch(() => '(could not read response body)');
    const authErr = new Error('ElevenLabs rejected the API key (status ' + response.status + '): ' + bodyText);
    authErr.code = 'UPSTREAM_AUTH';
    authErr.upstreamBody = bodyText;
    logTTS('synthesize:error', { code: authErr.code, status: response.status, upstreamBody: bodyText });
    throw authErr;
  }

  if (response.status === 402) {
    // 402 Payment Required -- this is ElevenLabs telling us something about
    // the ACCOUNT (quota/credits/billing), not our request shape or auth.
    // Distinct code from UPSTREAM_AUTH/UPSTREAM_ERROR specifically so this
    // is never mistaken for a code bug when it shows up in logs.
    const bodyText = await response.text().catch(() => '(could not read response body)');
    const paymentErr = new Error('ElevenLabs returned 402 Payment Required: ' + bodyText);
    paymentErr.code = 'PAYMENT_REQUIRED';
    paymentErr.upstreamBody = bodyText;
    logTTS('synthesize:error', { code: paymentErr.code, status: response.status, upstreamBody: bodyText });
    throw paymentErr;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '(could not read response body)');
    const upstreamErr = new Error('ElevenLabs returned status ' + response.status + ': ' + bodyText);
    upstreamErr.code = 'UPSTREAM_ERROR';
    upstreamErr.upstreamBody = bodyText;
    logTTS('synthesize:error', { code: upstreamErr.code, status: response.status, upstreamBody: bodyText });
    throw upstreamErr;
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || 'audio/mpeg';

  logTTS('synthesize:complete', { elapsedMs: Date.now() - startedAt, bytes: buffer.length, contentType });

  return { buffer, contentType };
}

module.exports = { synthesizeViaElevenLabs };
