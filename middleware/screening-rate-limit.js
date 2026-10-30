// Per-user limits for the Screening Copilot (guards run first, so req.user is set).
const rateLimit = require('express-rate-limit');
const cfg = require('../config/screening');

function make(max) {
  return rateLimit({
    windowMs: cfg.RATE.WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `scr:${req.user ? req.user.id : 'anon'}`,
    handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.', code: 'rate_limited' }),
  });
}

module.exports = {
  uploadLimiter: make(cfg.RATE.UPLOADS_PER_WINDOW),
  aiLimiter: make(cfg.RATE.AI_PER_WINDOW),
};
