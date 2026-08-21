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
// Persona-Based Dynamic Voice Profiles, Step 1: this file is now the ONLY
// place a provider voice ID is ever resolved. Everything upstream of here
// (routes/voice-tts.js, and every browser file) only ever knows a
// voiceProfile NAME -- see config/voice-profiles.js's own header for the
// full rationale and the 3-step rollout.
const { resolveVoiceProfile } = require('../config/voice-profiles');
// Cost recording — the only cost_analytics touchpoint in this file goes
// through this decoupled service, never db/cost-analytics.js directly.
// Fire-and-forget: never awaited in a way that could delay the TTS
// response, and the function itself never throws (see lib/cost-recorder.js).
const { recordElevenLabsUsage } = require('../lib/cost-recorder');

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
 * @param {{ text: string, voiceProfile: string, language: string, streaming: boolean, userId: string|number }} params
 *   voiceProfile is a provider-agnostic NAME (e.g. 'alex'), never a raw
 *   provider voice ID -- resolved to one right here, via
 *   config/voice-profiles.js, the only place in the codebase that touches
 *   both a voiceProfile name and a real ElevenLabs ID. userId is optional
 *   and used ONLY for cost attribution (see recordElevenLabsUsage below) —
 *   never changes synthesis behavior.
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 * @throws {Error} with a `.code` of 'CONFIG_MISSING' | 'UPSTREAM_AUTH' | 'UPSTREAM_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR'
 */
async function synthesizeViaElevenLabs(params) {
  const startedAt = Date.now();
  const spokenText = normalizeSpokenCurrency(params.text);
  if (spokenText !== params.text) {
    logTTS('currency-normalized', { original: params.text, spoken: spokenText });
  }
  const resolvedVoice = resolveVoiceProfile(params.voiceProfile);
  logTTS('synthesize:start', { textLength: (params.text || '').length, voiceProfile: params.voiceProfile, language: params.language });

  if (!VOICE_SERVER_CONFIG.elevenLabsApiKey) {
    const err = new Error('VOICE_SERVER_CONFIG.elevenLabsApiKey is not set');
    err.code = 'CONFIG_MISSING';
    logTTS('synthesize:error', { code: err.code, message: err.message });
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOICE_SERVER_CONFIG.requestTimeoutMs);

  // Step 1 note: resolvedVoice.providerVoice is the SAME literal ID
  // ('Rachel'-equivalent default) every profile points at today -- the
  // fallback here only ever triggers if resolveVoiceProfile() itself
  // somehow returned an incomplete object, which it never does by
  // construction (see config/voice-profiles.js's defaultProfile entry).
  const voiceId = resolvedVoice.providerVoice || 'Rachel';
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
        // Phase 2B: model_id now explicit (VOICE_SERVER_CONFIG.ttsModelId,
        // default eleven_flash_v2_5) -- previously absent entirely, so
        // ElevenLabs silently applied its own account default. See the
        // ElevenLabs Model Usage Audit for the full finding.
        model_id: VOICE_SERVER_CONFIG.ttsModelId,
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

  // Cost capture — fire-and-forget, deliberately NOT awaited so it can
  // never delay returning audio to the caller, and wrapped so a recording
  // failure can never surface as a TTS failure. Reads the actual
  // character-cost ElevenLabs returns; never estimates from duration or
  // audio size. See lib/cost-recorder.js for the full non-fabrication
  // contract (missing header -> skipped, not zeroed).
  const characterCost = response.headers.get('character-cost');
  recordElevenLabsUsage({
    userId: params.userId,
    interviewId: null, // not available at this call site today — see header note in lib/cost-recorder.js
    characterCost: characterCost !== null ? Number(characterCost) : null,
    requestId: response.headers.get('request-id'),
    traceId: response.headers.get('elevenlabs-trace-id') || response.headers.get('x-request-id'),
    modelId: VOICE_SERVER_CONFIG.ttsModelId,
  }).catch((err) => console.error('[TTS][server] cost capture failed (non-fatal, audio already returned):', err.message));

  logTTS('synthesize:complete', { elapsedMs: Date.now() - startedAt, bytes: buffer.length, contentType });

  return { buffer, contentType };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2B -- True streaming via a POST-prepare / GET-stream token handoff
//
// The browser's native <audio> element can only issue GET requests, and
// progressively plays a URL's bytes as they arrive -- no MediaSource/
// SourceBuffer code needed (see the Phase 2B architecture note's Option A
// vs Option B comparison). But a GET request means whatever's in the URL
// is exposed in browser history, server access logs, and any intermediate
// proxy's logs -- and the founder explicitly did not want interview
// question text there.
//
// The fix: POST the real text here first (exactly like the existing
// synthesizeViaElevenLabs path -- same auth, same request shape). This
// function stores it server-side, keyed by a random opaque token, and
// hands back ONLY that token. The browser's subsequent GET carries the
// token, never the text. The token is single-use (deleted on first GET)
// and short-lived (PENDING_TOKEN_TTL_MS), since the GET happens
// essentially immediately after the POST resolves in the same
// synthesize() call -- there's no legitimate reason for one to survive
// more than a few seconds, so the window for a leaked/replayed token to
// matter at all is deliberately tiny.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const PENDING_TOKEN_TTL_MS = 30000; // generous vs. the realistic <1s gap between prepare() and the browser's GET, not a real usage window
const pendingSyntheses = new Map(); // token -> { text, voiceProfile, language, userId, expiresAt }

// Lazy sweep, not a hard requirement for correctness (expired tokens are
// also rejected on lookup below) -- this just bounds memory if a prepared
// token is ever abandoned (e.g. the client errored before its GET fired).
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of pendingSyntheses) {
    if (entry.expiresAt <= now) pendingSyntheses.delete(token);
  }
}, 60000).unref(); // unref: never keeps the process alive on its own

/**
 * @param {{ text: string, voiceProfile: string, language: string, userId: string|number }} params
 *   voiceProfile is a provider-agnostic NAME, stored as-is here -- the
 *   provider ID resolution happens later, in streamViaElevenLabsToken,
 *   at the point the actual ElevenLabs call is made.
 * @returns {string} an opaque, single-use, short-lived token -- never the text itself
 */
function prepareStream(params) {
  const token = crypto.randomBytes(24).toString('base64url');
  pendingSyntheses.set(token, {
    text: params.text,
    voiceProfile: params.voiceProfile,
    language: params.language,
    userId: params.userId,
    expiresAt: Date.now() + PENDING_TOKEN_TTL_MS,
  });
  logTTS('stream:prepared', { token, textLength: (params.text || '').length, voiceProfile: params.voiceProfile });
  return token;
}

/**
 * @param {{ token: string, userId: string|number }} params
 * @returns {Promise<{ upstreamResponse: Response, contentType: string }>}
 *   upstreamResponse.body is a WHATWG ReadableStream -- the route pipes it
 *   straight to the browser (Readable.fromWeb(...).pipe(res)), never
 *   buffered here, which is the actual "true streaming" fix.
 * @throws {Error} with `.code` of 'TOKEN_NOT_FOUND' | 'TOKEN_EXPIRED' |
 *   'TOKEN_FORBIDDEN' | the same upstream codes synthesizeViaElevenLabs can throw
 */
async function streamViaElevenLabsToken(params) {
  const entry = pendingSyntheses.get(params.token);

  // Single-use: delete on first lookup regardless of what happens next --
  // a token that fails validation must not be retryable either.
  if (entry) pendingSyntheses.delete(params.token);

  if (!entry) {
    const err = new Error('Stream token not found or already used');
    err.code = 'TOKEN_NOT_FOUND';
    throw err;
  }
  if (entry.expiresAt <= Date.now()) {
    const err = new Error('Stream token expired');
    err.code = 'TOKEN_EXPIRED';
    throw err;
  }
  // Defense in depth: even though the token itself is unguessable (192
  // bits of randomness), also confirm it belongs to the requesting user --
  // the GET route is still requireAuth-gated, so this just makes sure one
  // authenticated user's token can't be used by another authenticated user.
  if (String(entry.userId) !== String(params.userId)) {
    const err = new Error('Stream token does not belong to this user');
    err.code = 'TOKEN_FORBIDDEN';
    throw err;
  }

  const startedAt = Date.now();
  const spokenText = normalizeSpokenCurrency(entry.text); // same currency-normalization fix as the non-streaming path
  const resolvedVoice = resolveVoiceProfile(entry.voiceProfile);
  logTTS('stream:start', { textLength: (entry.text || '').length, voiceProfile: entry.voiceProfile, language: entry.language });

  if (!VOICE_SERVER_CONFIG.elevenLabsApiKey) {
    const err = new Error('VOICE_SERVER_CONFIG.elevenLabsApiKey is not set');
    err.code = 'CONFIG_MISSING';
    logTTS('stream:error', { code: err.code, message: err.message });
    throw err;
  }

  const voiceId = resolvedVoice.providerVoice || 'Rachel';
  const url = VOICE_SERVER_CONFIG.elevenLabsApiBaseUrl.replace(/\/$/, '')
    + '/v1/text-to-speech/' + encodeURIComponent(voiceId) + '/stream';

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': VOICE_SERVER_CONFIG.elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: spokenText,
        model_id: VOICE_SERVER_CONFIG.ttsModelId,
        language: entry.language,
      }),
    });
  } catch (err) {
    const networkErr = new Error('Network error reaching ElevenLabs (stream): ' + err.message);
    networkErr.code = 'NETWORK_ERROR';
    logTTS('stream:error', { code: networkErr.code, message: err.message });
    throw networkErr;
  }

  if (response.status === 401 || response.status === 403) {
    const authErr = new Error('ElevenLabs rejected the API key (status ' + response.status + ')');
    authErr.code = 'UPSTREAM_AUTH';
    logTTS('stream:error', { code: authErr.code, status: response.status });
    throw authErr;
  }
  if (!response.ok) {
    const upstreamErr = new Error('ElevenLabs returned status ' + response.status + ' (stream)');
    upstreamErr.code = 'UPSTREAM_ERROR';
    logTTS('stream:error', { code: upstreamErr.code, status: response.status });
    throw upstreamErr;
  }

  logTTS('stream:first_response_headers', { elapsedMs: Date.now() - startedAt }); // headers back != first audio byte -- that's logged by the route once actual body bytes start flowing

  // Cost capture — same fire-and-forget contract as the non-streaming path
  // above. Headers arrive with the initial HTTP response, before the body
  // stream is consumed, so this never touches or delays the actual
  // streaming pipe (routes/voice-tts.js pipes upstreamResponse.body
  // straight through, completely unchanged by this addition).
  const characterCost = response.headers.get('character-cost');
  recordElevenLabsUsage({
    userId: params.userId,
    interviewId: null, // not available at this call site today — see header note in lib/cost-recorder.js
    characterCost: characterCost !== null ? Number(characterCost) : null,
    requestId: response.headers.get('request-id'),
    traceId: response.headers.get('elevenlabs-trace-id') || response.headers.get('x-request-id'),
    modelId: VOICE_SERVER_CONFIG.ttsModelId,
  }).catch((err) => console.error('[TTS][server] cost capture failed (non-fatal, stream unaffected):', err.message));

  return {
    upstreamResponse: response,
    contentType: response.headers.get('content-type') || 'audio/mpeg',
  };
}

module.exports = { synthesizeViaElevenLabs, prepareStream, streamViaElevenLabsToken };
