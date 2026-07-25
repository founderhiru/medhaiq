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

// ═══════════════════════════════════════════════════════════════════════════
// Spoken currency/number normalization (bug fix, 2026-07-23)
//
// ElevenLabs was reading "$25M" literally as "twenty-five em" instead of
// "twenty-five million dollars". Deliberately applied ONLY here, at the
// TTS synthesis seam — this is the one place in the codebase that holds
// the actual spoken text right before it goes to ElevenLabs, so the
// written form ("$25M") shown in the UI / stored in the DB is completely
// untouched; only what gets spoken changes. Deterministic, no LLM call.
// ═══════════════════════════════════════════════════════════════════════════

const CURRENCY_WORDS = { '$': 'dollars', '₹': 'rupees', '€': 'euros', '£': 'pounds' };
const MAGNITUDE_WORDS = { K: 'thousand', L: 'lakh', CR: 'crore', M: 'million', B: 'billion', T: 'trillion' };
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// Supports 0-999 — sufficient here since the magnitude word (thousand /
// lakh / crore / million / etc.) carries the scale; the number in front of
// an abbreviation is essentially always a small integer or one-decimal value.
function integerToWords(n) {
  if (n === 0) return 'zero';
  let str = '';
  if (n >= 100) {
    str += ONES[Math.floor(n / 100)] + ' hundred';
    n %= 100;
    if (n) str += ' ';
  }
  if (n >= 20) {
    str += TENS[Math.floor(n / 10)];
    if (n % 10) str += '-' + ONES[n % 10];
  } else if (n > 0) {
    str += ONES[n];
  }
  return str;
}

function numberToWords(numStr) {
  const [intPart, decPart] = String(numStr).split('.');
  let spoken = integerToWords(parseInt(intPart, 10) || 0);
  if (decPart) {
    spoken += ' point ' + decPart.split('').map((d) => ONES[parseInt(d, 10)]).join(' ');
  }
  return spoken;
}

/**
 * Expands abbreviated monetary values into natural spoken English.
 * "$25M" -> "twenty-five million dollars", "₹5Cr" -> "five crore rupees".
 * Leaves everything else (already-natural text, unknown symbols) untouched.
 */
function normalizeSpokenCurrency(text) {
  if (!text || typeof text !== 'string') return text;
  const pattern = /([$₹€£])\s?(\d+(?:\.\d+)?)\s?(Cr|CR|cr|K|k|M|m|B|b|T|t|L|l)?(?![a-zA-Z])/g;
  return text.replace(pattern, (match, symbol, numStr, suffix) => {
    const currencyWord = CURRENCY_WORDS[symbol];
    if (!currencyWord) return match; // unknown symbol — leave untouched
    let spoken = numberToWords(numStr);
    if (suffix) {
      const key = suffix.toLowerCase() === 'cr' ? 'CR' : suffix.toUpperCase();
      if (MAGNITUDE_WORDS[key]) spoken += ' ' + MAGNITUDE_WORDS[key];
    }
    return `${spoken} ${currencyWord}`;
  });
}

/**
 * @param {{ text: string, voice: string, language: string, streaming: boolean }} params
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 * @throws {Error} with a `.code` of 'CONFIG_MISSING' | 'UPSTREAM_AUTH' | 'UPSTREAM_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR'
 */
async function synthesizeViaElevenLabs(params) {
  const startedAt = Date.now();
  const spokenText = normalizeSpokenCurrency(params.text);
  if (spokenText !== params.text) {
    logTTS('currency-normalized', { original: params.text, spoken: spokenText });
  }
  logTTS('synthesize:start', { textLength: (params.text || '').length, voice: params.voice, language: params.language });

  if (!VOICE_SERVER_CONFIG.elevenLabsApiKey) {
    const err = new Error('VOICE_SERVER_CONFIG.elevenLabsApiKey is not set');
    err.code = 'CONFIG_MISSING';
    logTTS('synthesize:error', { code: err.code, message: err.message });
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOICE_SERVER_CONFIG.requestTimeoutMs);

  const voiceId = params.voice || 'Rachel';
  const url = VOICE_SERVER_CONFIG.elevenLabsApiBaseUrl.replace(/\/$/, '') + '/v1/text-to-speech/' + encodeURIComponent(voiceId);

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
        text: spokenText,
        // language/streaming forwarded as-is; ElevenLabs-specific request
        // shape lives ENTIRELY inside this function -- nothing above this
        // line (routes/voice-tts.js, and everything client-side) knows
        // ElevenLabs' request/response format.
        language: params.language,
        streaming: !!params.streaming,
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
    const authErr = new Error('ElevenLabs rejected the API key (status ' + response.status + ')');
    authErr.code = 'UPSTREAM_AUTH';
    logTTS('synthesize:error', { code: authErr.code, status: response.status });
    throw authErr;
  }

  if (!response.ok) {
    const upstreamErr = new Error('ElevenLabs returned status ' + response.status);
    upstreamErr.code = 'UPSTREAM_ERROR';
    logTTS('synthesize:error', { code: upstreamErr.code, status: response.status });
    throw upstreamErr;
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || 'audio/mpeg';

  logTTS('synthesize:complete', { elapsedMs: Date.now() - startedAt, bytes: buffer.length, contentType });

  return { buffer, contentType };
}

module.exports = { synthesizeViaElevenLabs };
