// middleware/auth-cookie.js
//
// Slice 0 (auth hardening). Mounted in server.js immediately AFTER the minimal
// cookie parser and BEFORE everything that reads req.cookies.user_id
// (device-id, Capability Engine, every guard).
//
// It does two things, and deliberately nothing else:
//
//  1. INBOUND — verifies the signed `user_id` cookie and rewrites
//     req.cookies.user_id to the verified user id (a plain digit string, the
//     exact shape every existing reader already expects). A forged, unsigned
//     (legacy), tampered, or expired value is DELETED from req.cookies, so
//     every reader sees a visitor — the same outcome as "no cookie".
//     Because of this, none of the ~15 existing readers (including the
//     protected middleware/guards.js, lib/capability-engine.js and
//     routes/auth.js) needs to change.
//
//  2. OUTBOUND — wraps res.cookie so that any res.cookie('user_id', <id>, …)
//     is signed automatically and marked Secure when the request arrived over
//     HTTPS. routes/auth.js (protected) therefore issues signed cookies
//     without being edited. Clearing (res.clearCookie / empty value) and
//     every other cookie name pass through untouched.
//
// MODES (env AUTH_COOKIE_MODE):
//   enforce    (default) — only signed cookies are trusted.
//   transition — EMERGENCY ROLLBACK ONLY. Also trusts legacy bare-integer
//                cookies (the old insecure behaviour) while still signing
//                new ones. There is intentionally NO automatic upgrade of a
//                legacy cookie to a signed one: that would let a forged
//                cookie be converted into a permanent signed credential.
//
// BOOT SAFETY: fromEnv() throws if AUTH_COOKIE_SECRET is missing/too short or
// the mode is unrecognised, so a misconfigured deploy fails at startup (Render
// then keeps serving the previous deploy) instead of running unprotected.

const authCookie = require('../lib/auth-cookie');

const COOKIE_NAME = 'user_id';
const MODES = ['enforce', 'transition'];
const LOG_INTERVAL_MS = 60 * 1000;

// Rate-limited logger: at most one line per reason per minute, with a count of
// how many were suppressed. Never logs the cookie value or any user id.
function makeRateLimitedLogger(log, now) {
  const last = new Map();      // reason -> timestamp of last emitted line
  const suppressed = new Map(); // reason -> count since last emitted line
  return function emit(reason, message) {
    const t = now();
    const prev = last.get(reason);
    if (prev !== undefined && t - prev < LOG_INTERVAL_MS) {
      suppressed.set(reason, (suppressed.get(reason) || 0) + 1);
      return;
    }
    const extra = suppressed.get(reason) || 0;
    suppressed.set(reason, 0);
    last.set(reason, t);
    log(`[auth-cookie] ${message}${extra ? ` (+${extra} similar suppressed in the last minute)` : ''}`);
  };
}

function create({ secret, mode = 'enforce', warn = console.warn, now = Date.now } = {}) {
  if (!authCookie.isValidSecret(secret)) {
    throw new Error(`[auth-cookie] AUTH_COOKIE_SECRET must be set to a string of at least ${authCookie.MIN_SECRET_LENGTH} characters (generate with: openssl rand -hex 32)`);
  }
  if (!MODES.includes(mode)) {
    throw new Error(`[auth-cookie] AUTH_COOKIE_MODE must be one of: ${MODES.join(', ')} (got "${mode}")`);
  }
  const emit = makeRateLimitedLogger(warn, now);

  return function authCookieMiddleware(req, res, next) {
    // ── OUTBOUND: sign any user_id cookie the app issues ────────────────────
    const originalCookie = res.cookie;
    res.cookie = function wrappedCookie(name, value, options) {
      // Pass through: other cookie names, and clearing (Express's clearCookie
      // calls res.cookie(name, '', …)).
      if (name !== COOKIE_NAME || value === undefined || value === null || value === '') {
        return originalCookie.apply(this, arguments);
      }
      const opts = Object.assign({}, options);
      const maxAgeMs = (typeof opts.maxAge === 'number' && opts.maxAge > 0)
        ? opts.maxAge
        : authCookie.DEFAULT_MAX_AGE_MS;
      // sign() throws on an invalid id — surfaced loudly rather than issuing a
      // credential built from bad input.
      const signed = authCookie.sign(value, { secret, maxAgeMs, now: now() });
      if (opts.secure === undefined) opts.secure = !!req.secure;
      return originalCookie.call(this, name, signed, opts);
    };

    // ── INBOUND: verify and normalise ───────────────────────────────────────
    if (req.cookies && Object.prototype.hasOwnProperty.call(req.cookies, COOKIE_NAME)) {
      const raw = req.cookies[COOKIE_NAME];
      const result = authCookie.verify(raw, { secret, now: now() });

      if (result.ok) {
        req.cookies[COOKIE_NAME] = result.userId;
      } else if (result.reason === 'legacy' && mode === 'transition') {
        // Left as-is (bare integer). Loud on purpose: this is the insecure path.
        req.authCookieLegacy = true;
        emit('legacy-accepted', 'transition mode: accepted an UNSIGNED legacy user_id cookie (insecure; switch AUTH_COOKIE_MODE back to enforce)');
      } else {
        delete req.cookies[COOKIE_NAME];
        emit(`rejected-${result.reason}`, `rejected user_id cookie (${result.reason}); treated as signed-out`);
        // Tidy the browser so it stops sending a dead value. Ordering is safe
        // even on a login request: this Set-Cookie is queued first, the login
        // handler's fresh signed cookie is queued after it and wins.
        res.clearCookie(COOKIE_NAME);
      }
    }
    next();
  };
}

// Production entry point: reads configuration from the environment and FAILS
// FAST on any problem. Called from server.js at startup.
function fromEnv(env = process.env) {
  const mode = (env.AUTH_COOKIE_MODE || 'enforce').trim().toLowerCase();
  const middleware = create({ secret: env.AUTH_COOKIE_SECRET, mode });
  console.log(`[auth-cookie] signed user_id cookies active (mode=${mode})`);
  if (mode === 'transition') {
    console.warn('[auth-cookie] WARNING: mode=transition trusts unsigned legacy cookies. This is an emergency rollback mode, NOT secure.');
  }
  return middleware;
}

module.exports = { create, fromEnv, COOKIE_NAME, MODES };
