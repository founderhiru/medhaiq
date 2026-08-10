// middleware/device-id.js
//
// Anti-Abuse & Free-Offer Guardrail — lightweight, privacy-conscious
// device signal. This deliberately does NOT do browser fingerprinting
// (canvas/WebGL/font enumeration, etc). It reuses the exact same
// mechanism the app already uses for user_id: a first-party, httpOnly,
// long-lived cookie holding a random identifier.
//
// Nothing here is used as identity. It is a SECONDARY risk signal only,
// consumed by services/free-offer-guardrail.js — never by auth or by
// the Capability Engine.
//
// Raw identifiers (cookie value, IP) are never persisted. Only a salted
// SHA-256 hash is ever written to the database (db/free-offer-claims.js),
// so a leaked DB row can't be reversed into the original device/IP.

const crypto = require('crypto');

const DEVICE_COOKIE_NAME = 'mdq_device';
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // ~400 days (browser cap)

// Falls back to a fixed dev secret so local/staging never hard-crashes,
// but warns loudly so it doesn't silently ship that way to production.
// This secret only salts an abuse-signal hash, not an auth/session
// secret — the blast radius of a weak fallback here is "abuse detection
// slightly weaker," never an account-takeover vector.
const HASH_SECRET = process.env.DEVICE_HASH_SECRET || 'medhaiq-dev-fallback-secret-change-in-prod';
if (!process.env.DEVICE_HASH_SECRET) {
  console.warn('[device-id] DEVICE_HASH_SECRET is not set — using an insecure fallback. Set it in Render env vars before public launch.');
}

function hashValue(value) {
  return crypto.createHmac('sha256', HASH_SECRET).update(String(value)).digest('hex');
}

/**
 * Ensures every request carries a first-party device cookie (creating one
 * on first visit), and attaches req.deviceHash / req.ipHash — salted
 * hashes only, never the raw cookie value or raw IP.
 *
 * Mounted early in server.js, after the cookie parser and after
 * `app.set('trust proxy', ...)` so req.ip reflects the real client IP
 * rather than Render's load balancer.
 */
function attachDeviceSignal(req, res, next) {
  let deviceId = req.cookies && req.cookies[DEVICE_COOKIE_NAME];
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    res.cookie(DEVICE_COOKIE_NAME, deviceId, {
      httpOnly: true,
      maxAge: DEVICE_COOKIE_MAX_AGE_MS,
      sameSite: 'lax',
    });
  }
  req.deviceHash = hashValue(deviceId);
  req.ipHash = hashValue(req.ip || 'unknown');
  next();
}

module.exports = { attachDeviceSignal, hashValue, DEVICE_COOKIE_NAME };
