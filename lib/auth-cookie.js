// lib/auth-cookie.js
//
// Slice 0 (auth hardening) — signed `user_id` cookie primitives.
//
// WHY THIS EXISTS
// Before this file, the `user_id` cookie held a bare integer ("42") and every
// guard in the app trusted it. Anyone able to send `Cookie: user_id=N` was
// treated as user N. This module gives the cookie an HMAC signature and a
// server-enforced expiry so a client can no longer mint or alter one.
//
// This file is PURE: no Express, no database, no process.env reads, no logging.
// The secret is always passed in by the caller (middleware/auth-cookie.js), so
// every branch is unit-testable.
//
// COOKIE VALUE FORMAT (all characters are cookie-safe and URL-safe, so the
// app's minimal cookie parser — which does not URL-decode — reads it back
// byte-for-byte):
//
//     v1.<userId>.<issuedAtSec>.<expiresAtSec>.<signature>
//
//   signature = base64url( HMAC-SHA256( secret, "v1.<userId>.<iat>.<exp>" ) )
//
// Changing AUTH_COOKIE_SECRET invalidates every outstanding cookie (a global
// logout) — deliberate, documented in docs/SECURITY-AUTH-COOKIE.md.

const crypto = require('crypto');

const VERSION = 'v1';
const MIN_SECRET_LENGTH = 32;               // characters; `openssl rand -hex 32` gives 64
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // matches routes/auth.js today
const CLOCK_SKEW_SEC = 300;                 // tolerate 5 min of clock drift on iat
const MAX_USER_ID = 2147483647;             // Postgres INTEGER ceiling (users.id is SERIAL)
const USER_ID_RE = /^[1-9][0-9]{0,9}$/;     // positive integer, no leading zero, ≤ 10 digits

function isValidSecret(secret) {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

// A user id is acceptable only if it is a canonical positive integer within
// Postgres INTEGER range. Everything else (negative, "0", "007", "1e3",
// "42abc", 99999999999) is refused at both sign and verify time.
function isValidUserId(value) {
  const s = String(value);
  if (!USER_ID_RE.test(s)) return false;
  return Number(s) <= MAX_USER_ID;
}

function computeSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Build a signed cookie value.
 * Throws on an invalid secret or user id — callers must never silently mint a
 * credential from bad input.
 */
function sign(userId, { secret, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now() } = {}) {
  if (!isValidSecret(secret)) {
    throw new Error(`auth-cookie: secret must be a string of at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (!isValidUserId(userId)) {
    throw new Error('auth-cookie: refusing to sign an invalid user id');
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error('auth-cookie: maxAgeMs must be a positive number');
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + Math.floor(maxAgeMs / 1000);
  const payload = `${VERSION}.${String(userId)}.${iat}.${exp}`;
  return `${payload}.${computeSignature(payload, secret)}`;
}

/**
 * Verify a cookie value.
 * Returns { ok: true, userId: '42' } or { ok: false, reason }.
 * reason ∈ missing | legacy | malformed | bad_signature | expired | not_yet_valid
 *
 * `legacy` means "a bare integer — the pre-Slice-0 format". It is reported as
 * its own reason (rather than folded into malformed) so the middleware can
 * decide by mode whether to tolerate it. This function itself NEVER accepts it.
 */
function verify(raw, { secret, now = Date.now() } = {}) {
  if (!isValidSecret(secret)) {
    throw new Error(`auth-cookie: secret must be a string of at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'missing' };
  if (raw.length > 256) return { ok: false, reason: 'malformed' }; // no legitimate value is near this long

  if (/^[0-9]+$/.test(raw)) return { ok: false, reason: 'legacy' };

  const parts = raw.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };

  const [, userId, iatStr, expStr, providedSig] = parts;
  if (!isValidUserId(userId)) return { ok: false, reason: 'malformed' };
  if (!/^[0-9]{1,12}$/.test(iatStr) || !/^[0-9]{1,12}$/.test(expStr)) return { ok: false, reason: 'malformed' };
  if (!/^[A-Za-z0-9_-]{43}$/.test(providedSig)) return { ok: false, reason: 'malformed' }; // base64url of 32 bytes

  // Signature FIRST, before any time-based decision, so an attacker learns
  // nothing about validity windows from an unsigned probe.
  const payload = `${VERSION}.${userId}.${iatStr}.${expStr}`;
  const expected = Buffer.from(computeSignature(payload, secret));
  const provided = Buffer.from(providedSig);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const nowSec = Math.floor(now / 1000);
  const iat = Number(iatStr);
  const exp = Number(expStr);
  if (iat > nowSec + CLOCK_SKEW_SEC) return { ok: false, reason: 'not_yet_valid' };
  if (exp <= nowSec) return { ok: false, reason: 'expired' };

  return { ok: true, userId };
}

module.exports = {
  VERSION,
  MIN_SECRET_LENGTH,
  DEFAULT_MAX_AGE_MS,
  CLOCK_SKEW_SEC,
  MAX_USER_ID,
  isValidSecret,
  isValidUserId,
  sign,
  verify,
};
