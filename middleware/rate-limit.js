// middleware/rate-limit.js
//
// Anti-Abuse & Free-Offer Guardrail — server-side rate limiting.
// Deliberately conservative: these limits exist to stop scripted account
// creation / session-start bursts, not to interrupt a real person having
// a real interview. If a limit is ever hit by a legitimate user, that's
// a bug to loosen, not a feature.
//
// New dependency: express-rate-limit (small, no external service, in-
// memory store — fine for a single Render instance; if MedhaIQ ever runs
// multiple instances, swap the store for a shared one, e.g. Redis).

const rateLimit = require('express-rate-limit');

// Keyed by IP (post trust-proxy, so this is the real client IP, not
// Render's load balancer) — deliberately NOT "1 IP = 1 account" logic,
// just a burst brake. Shared IPs (offices, campuses) get a shared, still-
// generous budget, not a shared account limit.
function ipKey(req) {
  return req.ip || 'unknown';
}

const standardHandler = (req, res) => {
  res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
};

// POST /auth/login, /auth/password-login, /auth/signup — covers signup,
// login, and the magic-link "forgot password" equivalent (this app has
// no separate forgot-password route; the magic link IS that flow).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  handler: standardHandler,
});

// POST /api/interview/sessions, /api/interview/session/initialize —
// interview START only. Deliberately NOT applied to in-progress-interview
// endpoints (answer, heartbeat, next-question) — those must never be
// throttled mid-conversation.
const interviewStartLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  handler: standardHandler,
});

// POST /api/voice/synthesize, /synthesize/prepare — session/voice
// initialization only, not the audio stream itself.
const voiceInitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  handler: standardHandler,
});

module.exports = { authLimiter, interviewStartLimiter, voiceInitLimiter };
