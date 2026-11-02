// routes/app-handoff.js
//
// Lets the MedhaIQ mobile app reuse the website's EXISTING sign-in flows
// (Google OAuth and e-mail magic link) without editing routes/auth.js.
//
// Why: Google refuses sign-in inside embedded app browsers, and a magic link
// opened from the mail app lands in Safari/Chrome, not the app. So the app
// runs those flows in the phone's real browser with next=/app/handoff, and:
//
//   1. GET /app/handoff  (phone browser, already signed in by the normal
//      flow) mints a short-lived single-use code and bounces to
//      medhaiq://auth?code=...  which opens the app.
//   2. GET /app/session?code=...  (inside the app) verifies the code, marks
//      it used, and issues the normal signed user_id cookie in the app.
//
// Code = h1.<userId>.<expiresAtSec>.<nonce>.<HMAC-SHA256 signature>, keyed by
// AUTH_COOKIE_SECRET with a distinct prefix so it can never double as a
// session cookie. TTL 120 s, single use (in-memory; fine for one Render
// instance, same assumption as middleware/rate-limit.js).

const crypto = require('crypto');
const express = require('express');
const { authLimiter } = require('../middleware/rate-limit');
const { isAppRequest } = require('../middleware/app-shell');

const TTL_SEC = 120;
const PREFIX = 'app-handoff.h1';
const used = new Map(); // nonce -> expiresAtSec

function sig(payload, secret) {
  return crypto.createHmac('sha256', secret).update(`${PREFIX}|${payload}`).digest('base64url');
}

function mintCode(userId, secret, nowMs = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('app-handoff: bad secret');
  if (!/^[1-9][0-9]{0,9}$/.test(String(userId))) throw new Error('app-handoff: bad user id');
  const exp = Math.floor(nowMs / 1000) + TTL_SEC;
  const payload = `h1.${userId}.${exp}.${crypto.randomBytes(16).toString('base64url')}`;
  return `${payload}.${sig(payload, secret)}`;
}

// Returns the user id (string) or null. Consumes the code on success.
function consumeCode(code, secret, nowMs = Date.now()) {
  if (typeof code !== 'string' || code.length > 200 || typeof secret !== 'string') return null;
  const parts = code.split('.');
  if (parts.length !== 5 || parts[0] !== 'h1') return null;
  const [, userId, expStr, nonce, given] = parts;
  const payload = `h1.${userId}.${expStr}.${nonce}`;
  const want = sig(payload, secret);
  const a = Buffer.from(given), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!/^[1-9][0-9]{0,9}$/.test(userId)) return null;
  const nowSec = Math.floor(nowMs / 1000);
  const exp = Number(expStr);
  for (const [n, e] of used) if (e < nowSec) used.delete(n);
  if (!Number.isFinite(exp) || exp < nowSec || exp > nowSec + TTL_SEC + 5) return null;
  if (used.has(nonce)) return null;
  used.set(nonce, exp);
  return userId;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function handoffPage(code) {
  const url = `medhaiq://auth?code=${encodeURIComponent(code)}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Opening MedhaIQ</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0E1A;color:#fff;font-family:'Plus Jakarta Sans',Inter,system-ui,sans-serif;text-align:center;padding:24px}a{display:inline-block;margin-top:20px;padding:14px 28px;border-radius:12px;color:#fff;text-decoration:none;font-weight:600;background:linear-gradient(135deg,#3D8BFF,#8B5CF6)}p{color:#9DA8BA}</style></head>
<body><div><h1>You're signed in</h1><p>Returning you to the MedhaIQ app…</p><a href="${esc(url)}">Open MedhaIQ</a></div>
<script>setTimeout(function(){location.href=${JSON.stringify(url)}},150)</script></body></html>`;
}

const router = express.Router();

router.get('/handoff', authLimiter, (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const secret = process.env.AUTH_COOKIE_SECRET;
  const userId = req.cookies && req.cookies.user_id; // already verified by middleware/auth-cookie
  if (!userId) return res.redirect('/auth/login?next=' + encodeURIComponent('/app/handoff'));
  try {
    return res.type('html').send(handoffPage(mintCode(userId, secret)));
  } catch (err) {
    console.error('[app-handoff] mint failed:', err.message);
    return res.redirect('/auth/login?error=google-auth-failed');
  }
});

router.get('/session', authLimiter, (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (!isAppRequest(req)) return res.redirect('/auth/login');
  const userId = consumeCode(String(req.query.code || ''), process.env.AUTH_COOKIE_SECRET);
  if (!userId) return res.redirect('/auth/login?error=google-auth-failed');
  res.cookie('user_id', userId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' }); // signed by middleware/auth-cookie
  return res.redirect('/dashboard/history');
});

module.exports = router;
module.exports.mintCode = mintCode;
module.exports.consumeCode = consumeCode;
module.exports._used = used;
