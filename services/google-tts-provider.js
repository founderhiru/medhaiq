// services/google-tts-provider.js
//
// Google Cloud Text-to-Speech provider (staging migration, 2026-11-27).
//
// ONLY used when TTS_PROVIDER=google (see services/voice-tts-proxy.js, the
// single dispatch point). With the flag unset or set to anything else, this
// file is never reached and the ElevenLabs code path is byte-for-byte what
// it was before.
//
// AUTHENTICATION (verified against Google's published API definition and
// auth guide, 2026-11-27): Cloud TTS' REST method text:synthesize accepts the
// single OAuth scope https://www.googleapis.com/auth/cloud-platform, and
// Google's own guidance is service-account credentials (ADC), not a bare API
// key. This file implements the standard OAuth 2.0 service-account flow
// directly with Node's built-in `crypto` (RS256-signed JWT exchanged at
// Google's token endpoint for a ~1h bearer token) -- deliberately NO new npm
// dependency, because package.json/package-lock.json changes cannot be made
// safely through the GitHub web UI and would risk breaking `npm ci` on Render.
//
// SECRETS: the service-account JSON lives ONLY in the server env var
// GOOGLE_TTS_SERVICE_ACCOUNT_JSON (raw JSON or base64 of it). It is never
// logged, never placed in a response, never sent to the browser. Only the
// client_email's presence/shape is ever logged.
//
// CONTRACT with the proxy: returns { buffer, contentType:'audio/mpeg',
// characters } and throws Errors with the SAME `.code` vocabulary the
// ElevenLabs path uses ('CONFIG_MISSING' | 'UPSTREAM_AUTH' | 'UPSTREAM_ERROR'
// | 'TIMEOUT' | 'NETWORK_ERROR') so routes/voice-tts.js and the browser
// adapter's existing error handling work unchanged.

const crypto = require('crypto');
const { VOICE_SERVER_CONFIG } = require('../config/voice-server-config');

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry
// Google's documented hard limit is 5,000 BYTES of input per request
// (content limit, not raisable). Stay well under it and split on sentence
// boundaries so a long question can never fail where ElevenLabs succeeded.
const MAX_REQUEST_BYTES = 4500;

function logG(event, detail) {
  // eslint-disable-next-line no-console
  console.log('[TTS][google] ' + event + (detail ? ' ' + JSON.stringify(detail) : ''));
}

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ── Credentials ────────────────────────────────────────────────────────────
let cachedCreds = null;
let cachedCredsSource = null;

function loadCredentials() {
  const raw = VOICE_SERVER_CONFIG.googleTtsServiceAccountJson;
  if (!raw) throw makeErr('CONFIG_MISSING', 'GOOGLE_TTS_SERVICE_ACCOUNT_JSON is not set');
  if (cachedCreds && cachedCredsSource === raw) return cachedCreds;

  let text = String(raw).trim();
  if (!text.startsWith('{')) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch (_) { /* handled below */ }
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) {
    throw makeErr('CONFIG_MISSING', 'GOOGLE_TTS_SERVICE_ACCOUNT_JSON is not valid JSON (or base64 of JSON)');
  }
  if (!parsed || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw makeErr('CONFIG_MISSING', 'GOOGLE_TTS_SERVICE_ACCOUNT_JSON must contain client_email and private_key');
  }
  // Render/env UIs sometimes store the key with literal "\n" sequences.
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  cachedCreds = parsed;
  cachedCredsSource = raw;
  return parsed;
}

// ── OAuth2 service-account access token (cached, single-flight) ────────────
let cachedToken = null; // { value, expiresAt }
let tokenInFlight = null;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function buildSignedJwt(creds, tokenUrl) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: creds.client_email,
    scope: GOOGLE_SCOPE,
    aud: tokenUrl,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  let signature;
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    signature = signer.sign(creds.private_key);
  } catch (_) {
    // Never include the key or the underlying message (may echo key material).
    throw makeErr('CONFIG_MISSING', 'GOOGLE_TTS_SERVICE_ACCOUNT_JSON private_key could not be used to sign');
  }
  return signingInput + '.' + b64url(signature);
}

async function fetchAccessToken(signal) {
  const creds = loadCredentials();
  const tokenUrl = VOICE_SERVER_CONFIG.googleOauthTokenUrl;
  const assertion = buildSignedJwt(creds, tokenUrl);

  let res;
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw makeErr('TIMEOUT', 'Google token request timed out');
    throw makeErr('NETWORK_ERROR', 'Network error reaching Google OAuth: ' + err.message);
  }

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    logG('token:rejected', { status: res.status });
    throw makeErr('UPSTREAM_AUTH', 'Google rejected the service-account credentials (status ' + res.status + ')');
  }
  if (!res.ok) {
    logG('token:error', { status: res.status });
    throw makeErr('UPSTREAM_ERROR', 'Google OAuth returned status ' + res.status);
  }
  let body;
  try { body = await res.json(); } catch (_) {
    throw makeErr('UPSTREAM_ERROR', 'Google OAuth returned a non-JSON response');
  }
  if (!body || typeof body.access_token !== 'string') {
    throw makeErr('UPSTREAM_ERROR', 'Google OAuth response had no access_token');
  }
  const ttlMs = (Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600) * 1000;
  cachedToken = { value: body.access_token, expiresAt: Date.now() + ttlMs };
  logG('token:refreshed', { ttlSeconds: Math.round(ttlMs / 1000) });
  return cachedToken.value;
}

async function getAccessToken(signal) {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cachedToken.value;
  }
  // Single-flight: concurrent synths share one token refresh.
  if (!tokenInFlight) {
    tokenInFlight = fetchAccessToken(signal).finally(() => { tokenInFlight = null; });
  }
  return tokenInFlight;
}

// ── Input splitting (5,000-byte hard limit) ────────────────────────────────
function splitForGoogle(text) {
  if (Buffer.byteLength(text, 'utf8') <= MAX_REQUEST_BYTES) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if (Buffer.byteLength(current + s, 'utf8') > MAX_REQUEST_BYTES && current) {
      chunks.push(current.trim());
      current = '';
    }
    // A single sentence longer than the limit: hard-split on characters.
    if (Buffer.byteLength(s, 'utf8') > MAX_REQUEST_BYTES) {
      let piece = '';
      for (const ch of s) {
        if (Buffer.byteLength(piece + ch, 'utf8') > MAX_REQUEST_BYTES) { chunks.push(piece); piece = ''; }
        piece += ch;
      }
      current += piece;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Request body ───────────────────────────────────────────────────────────
// Chirp 3 HD / WaveNet (the live path): plain text + voice name + MP3 +
// speakingRate. Unchanged behaviour.
//
// Gemini TTS (AUDITION ONLY, founder compare page): when p.modelName is set,
// Google's Gemini-TTS fields are used instead -- input.prompt carries styling
// / accent instructions and voice.modelName selects the model. speakingRate is
// deliberately NOT sent for Gemini: its support there is not documented, and an
// unsupported field could turn into a 400. Pace is steered inside the prompt.
function buildRequestBody(p, chunk) {
  const input = { text: chunk };
  const voice = { languageCode: p.languageCode, name: p.voiceName };
  // MP3 keeps the existing audio/mpeg contract the browser's <audio> element
  // and BrowserAudioPlayer already rely on.
  const audioConfig = { audioEncoding: 'MP3' };
  if (p.modelName) {
    voice.modelName = p.modelName;
    if (p.prompt) input.prompt = p.prompt;
  } else {
    audioConfig.speakingRate = p.speakingRate;
  }
  return { input, voice, audioConfig };
}

// ── Synthesis ──────────────────────────────────────────────────────────────
/**
 * @param {{ text: string, languageCode: string, voiceName: string, speakingRate: number,
 *           modelName?: string, prompt?: string }} p   (modelName/prompt: Gemini audition only)
 *   text is the ALREADY currency-normalized spoken text (the proxy does that
 *   before calling here -- one shared normalization for every provider).
 * @returns {Promise<{ buffer: Buffer, contentType: string, characters: number, chunks: number }>}
 */
async function synthesize(p) {
  const startedAt = Date.now();
  if (!p || typeof p.text !== 'string' || !p.text.trim()) {
    throw makeErr('UPSTREAM_ERROR', 'Google TTS: empty text');
  }
  loadCredentials(); // throws CONFIG_MISSING before any network call

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOICE_SERVER_CONFIG.requestTimeoutMs);
  const baseUrl = VOICE_SERVER_CONFIG.googleTtsApiBaseUrl.replace(/\/$/, '');
  const url = baseUrl + '/v1/text:synthesize';

  try {
    const chunks = splitForGoogle(p.text);
    const buffers = [];
    for (const chunk of chunks) {
      const token = await getAccessToken(controller.signal);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify(buildRequestBody(p, chunk)),
        });
      } catch (err) {
        if (err.name === 'AbortError') throw makeErr('TIMEOUT', 'Google TTS request timed out after ' + VOICE_SERVER_CONFIG.requestTimeoutMs + 'ms');
        throw makeErr('NETWORK_ERROR', 'Network error reaching Google TTS: ' + err.message);
      }

      if (res.status === 401) cachedToken = null; // force a fresh token next call
      if (res.status === 401 || res.status === 403) {
        logG('synthesize:error', { code: 'UPSTREAM_AUTH', status: res.status });
        throw makeErr('UPSTREAM_AUTH', 'Google TTS rejected the credentials (status ' + res.status + ')');
      }
      if (!res.ok) {
        logG('synthesize:error', { code: 'UPSTREAM_ERROR', status: res.status });
        throw makeErr('UPSTREAM_ERROR', 'Google TTS returned status ' + res.status);
      }

      let body;
      try { body = await res.json(); } catch (_) {
        throw makeErr('UPSTREAM_ERROR', 'Google TTS returned a non-JSON response');
      }
      if (!body || typeof body.audioContent !== 'string' || !body.audioContent) {
        throw makeErr('UPSTREAM_ERROR', 'Google TTS response had no audioContent');
      }
      buffers.push(Buffer.from(body.audioContent, 'base64'));
    }

    const buffer = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
    // Google bills by characters of the input string (spaces/newlines included).
    const characters = Array.from(p.text).length;
    logG('synthesize:complete', { elapsedMs: Date.now() - startedAt, bytes: buffer.length, characters, chunks: chunks.length, voice: p.voiceName });
    return { buffer, contentType: 'audio/mpeg', characters, chunks: chunks.length };
  } finally {
    clearTimeout(timeout);
  }
}

function _resetForTests() {
  cachedCreds = null; cachedCredsSource = null; cachedToken = null; tokenInFlight = null;
}

module.exports = { synthesize, splitForGoogle, buildRequestBody, _resetForTests, GOOGLE_SCOPE, MAX_REQUEST_BYTES };
