// tests/auth-cookie-security.js
//
// Slice 0 (auth hardening) regression + security suite.
// Plain Node + assert (no test framework, no new dependencies) — same style as
// the rest of tests/. Run:  node tests/auth-cookie-security.js
//
// Sections:
//   A. lib/auth-cookie.js          — pure sign/verify
//   B. middleware/auth-cookie.js   — inbound normalisation + outbound signing (fake req/res)
//   C. Real HTTP through Express   — actual Set-Cookie headers, actual round trips
//   D. Real guards, forged cookies — middleware/guards.js + campus-guards.js (DB calls stubbed)
//   E. Static guarantees           — nothing else sets/parses the cookie; mount order in server.js
//
// No database or network access is required. DB modules are replaced with
// in-memory stubs via require.cache BEFORE the guards are loaded.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);
const NOW = 1_800_000_000_000; // fixed clock, ms

const authCookie = require('../lib/auth-cookie');
const mw = require('../middleware/auth-cookie');

// ── tiny harness ──────────────────────────────────────────────────────────
const tests = [];
let currentSection = '';
function section(name) { tests.push({ section: name }); }
function test(name, fn) { tests.push({ name, fn }); }

// ── DB stubs (must be installed before guards / capability-engine load) ───
function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(path.join(ROOT, relPath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
const USERS = {
  '1':  { id: 1,  email: 'founder@test.local', name: 'Founder', market: null },
  '42': { id: 42, email: 'user42@test.local',  name: 'User 42', market: null },
  '43': { id: 43, email: 'user43@test.local',  name: 'User 43', market: null },
};
stubModule('db/auth.js', { getUserById: async (id) => USERS[String(id)] || null });
stubModule('db/career-profile.js', { getCareerProfile: async () => null });
stubModule('db/interview.js', {
  getUserSessions: async () => [],
  abandonStaleActiveSession: async () => [],
  findRecoverableSession: async () => null,
});
stubModule('db/package-acquisitions.js', {
  getActivePackageAcquisition: async () => null,
  getMergedCreditPool: async () => ({ totalMinutes: 0, earliestAcquiredAt: null }),
});
stubModule('db/founder-access.js', { isFounder: async (id) => String(id) === '1' });
stubModule('db/campus.js', { getLearnerForUser: async (id) => (String(id) === '42' ? { id: 7, cohort_id: 1 } : null) });

const { requireAuth, requireAuthPage, requireFounderPage } = require('../middleware/guards');
const { requireCampusLearner } = require('../middleware/campus-guards');

// ══════════════════════════════════════════════════════════════════════════
section('A. lib/auth-cookie.js — sign / verify');

test('sign() → verify() round trip returns the same user id', () => {
  const v = authCookie.sign(42, { secret: SECRET, now: NOW });
  assert.deepStrictEqual(authCookie.verify(v, { secret: SECRET, now: NOW + 1000 }), { ok: true, userId: '42' });
});
test('signed value has the documented v1.<id>.<iat>.<exp>.<sig> shape and is cookie/URL safe', () => {
  const v = authCookie.sign(42, { secret: SECRET, now: NOW, maxAgeMs: 3600_000 });
  const p = v.split('.');
  assert.strictEqual(p.length, 5);
  assert.strictEqual(p[0], 'v1'); assert.strictEqual(p[1], '42');
  assert.strictEqual(Number(p[3]) - Number(p[2]), 3600);
  assert.strictEqual(encodeURIComponent(v), v, 'must survive Express encodeURIComponent unchanged');
});
test('tampered user id (42 → 43) is rejected as bad_signature', () => {
  const p = authCookie.sign(42, { secret: SECRET, now: NOW }).split('.'); p[1] = '43';
  assert.deepStrictEqual(authCookie.verify(p.join('.'), { secret: SECRET, now: NOW }), { ok: false, reason: 'bad_signature' });
});
test('privilege escalation to user 1 by editing the id is rejected', () => {
  const p = authCookie.sign(42, { secret: SECRET, now: NOW }).split('.'); p[1] = '1';
  assert.strictEqual(authCookie.verify(p.join('.'), { secret: SECRET, now: NOW }).ok, false);
});
test('extending expiry by editing exp is rejected', () => {
  const p = authCookie.sign(42, { secret: SECRET, now: NOW, maxAgeMs: 60_000 }).split('.'); p[3] = String(Number(p[3]) + 10_000_000);
  assert.strictEqual(authCookie.verify(p.join('.'), { secret: SECRET, now: NOW }).reason, 'bad_signature');
});
test('tampered signature is rejected', () => {
  const v = authCookie.sign(42, { secret: SECRET, now: NOW });
  const flipped = v.slice(0, -1) + (v.slice(-1) === 'A' ? 'B' : 'A');
  assert.strictEqual(authCookie.verify(flipped, { secret: SECRET, now: NOW }).reason, 'bad_signature');
});
test('cookie signed with a different secret is rejected (secret rotation = global logout)', () => {
  const v = authCookie.sign(42, { secret: OTHER_SECRET, now: NOW });
  assert.strictEqual(authCookie.verify(v, { secret: SECRET, now: NOW }).reason, 'bad_signature');
});
test('expired cookie is rejected', () => {
  const v = authCookie.sign(42, { secret: SECRET, now: NOW, maxAgeMs: 60_000 });
  assert.strictEqual(authCookie.verify(v, { secret: SECRET, now: NOW + 61_000 }).reason, 'expired');
});
test('cookie is valid right up to (not including) expiry', () => {
  const v = authCookie.sign(42, { secret: SECRET, now: NOW, maxAgeMs: 60_000 });
  assert.strictEqual(authCookie.verify(v, { secret: SECRET, now: NOW + 59_000 }).ok, true);
});
test('cookie issued far in the future is rejected (not_yet_valid), small clock skew tolerated', () => {
  const future = authCookie.sign(42, { secret: SECRET, now: NOW + 3600_000 });
  assert.strictEqual(authCookie.verify(future, { secret: SECRET, now: NOW }).reason, 'not_yet_valid');
  const slight = authCookie.sign(42, { secret: SECRET, now: NOW + 60_000 });
  assert.strictEqual(authCookie.verify(slight, { secret: SECRET, now: NOW }).ok, true);
});
test('legacy bare-integer cookie is reported as "legacy" and NEVER accepted by verify()', () => {
  for (const v of ['1', '42', '999999']) {
    assert.deepStrictEqual(authCookie.verify(v, { secret: SECRET, now: NOW }), { ok: false, reason: 'legacy' });
  }
});
test('malformed inputs are rejected without throwing', () => {
  const bad = ['', undefined, null, 42, {}, [], 'v1', 'v1.42', 'v1.42.1.2', 'v2.42.1.2.x', 'v1.42.1.2.short', 'v1.a.1.2.' + 'A'.repeat(43),
    'v1.42.x.2.' + 'A'.repeat(43), 'v1..1.2.' + 'A'.repeat(43), 'v1.42.1.2.' + 'A'.repeat(43) + '.extra', 'x'.repeat(300), '42abc', '4 2', '-1', '1.5'];
  for (const v of bad) {
    const r = authCookie.verify(v, { secret: SECRET, now: NOW });
    assert.strictEqual(r.ok, false, `should reject ${JSON.stringify(v)}`);
  }
});
test('sign() refuses invalid user ids (negative, zero, leading zero, float, exponent, overflow, text, empty)', () => {
  for (const bad of [-1, 0, '0', '007', 1.5, '1e3', 2147483648, 99999999999, 'abc', '', null, undefined, '42; admin=1']) {
    assert.throws(() => authCookie.sign(bad, { secret: SECRET, now: NOW }), /invalid user id/, `should refuse ${String(bad)}`);
  }
});
test('sign() accepts the largest Postgres INTEGER id', () => {
  assert.strictEqual(authCookie.verify(authCookie.sign(2147483647, { secret: SECRET, now: NOW }), { secret: SECRET, now: NOW }).userId, '2147483647');
});
test('sign()/verify() refuse a missing or short secret', () => {
  for (const s of [undefined, null, '', 'short', 'x'.repeat(31)]) {
    assert.throws(() => authCookie.sign(42, { secret: s }), /secret must be/);
    assert.throws(() => authCookie.verify('x', { secret: s }), /secret must be/);
  }
});
test('sign() refuses non-positive maxAge', () => {
  for (const m of [0, -5, NaN, Infinity]) assert.throws(() => authCookie.sign(42, { secret: SECRET, maxAgeMs: m }), /maxAgeMs/);
});
test('a forged signature cannot be found by simple guessing (independent secrets give independent signatures)', () => {
  const a = authCookie.sign(42, { secret: SECRET, now: NOW }); const b = authCookie.sign(42, { secret: OTHER_SECRET, now: NOW });
  assert.notStrictEqual(a.split('.')[4], b.split('.')[4]);
});

// ══════════════════════════════════════════════════════════════════════════
section('B. middleware/auth-cookie.js — unit (fake req/res)');

function fakeRes() {
  const res = { _cookies: [] };
  res.cookie = function (name, value, opts) { this._cookies.push({ name, value, opts }); return this; };
  // Mirrors Express 4: clearCookie delegates to res.cookie with an empty value.
  res.clearCookie = function (name, opts) { return this.cookie(name, '', Object.assign({ path: '/', expires: new Date(1) }, opts)); };
  return res;
}
function run(middleware, req, res = fakeRes()) {
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}
const silent = () => {};
const enforce = () => mw.create({ secret: SECRET, mode: 'enforce', warn: silent, now: () => NOW });
const transition = (warn = silent) => mw.create({ secret: SECRET, mode: 'transition', warn, now: () => NOW });
const good = (id = 42) => authCookie.sign(id, { secret: SECRET, now: NOW });

test('valid signed cookie → req.cookies.user_id becomes the plain verified id (shape existing readers expect)', () => {
  const req = { cookies: { user_id: good(42) }, secure: false };
  const { nextCalled } = run(enforce(), req);
  assert.strictEqual(req.cookies.user_id, '42'); assert.strictEqual(typeof req.cookies.user_id, 'string'); assert.ok(nextCalled);
});
test('forged bare-integer cookie (the original vulnerability) is removed in enforce mode', () => {
  const req = { cookies: { user_id: '1' } };
  const { res, nextCalled } = run(enforce(), req);
  assert.strictEqual(req.cookies.user_id, undefined); assert.ok(nextCalled);
  assert.ok(res._cookies.some(c => c.name === 'user_id' && c.value === ''), 'browser is told to drop the dead cookie');
});
test('tampered / expired / malformed cookies are removed in enforce mode', () => {
  const p = good(42).split('.'); p[1] = '1';
  for (const v of [p.join('.'), authCookie.sign(42, { secret: SECRET, now: NOW - 40 * 86400_000 }), 'garbage', 'v1.1.1.1.x']) {
    const req = { cookies: { user_id: v } }; run(enforce(), req);
    assert.strictEqual(req.cookies.user_id, undefined, `should drop ${v}`);
  }
});
test('no user_id cookie → request passes through untouched', () => {
  const req = { cookies: { other: 'x' } }; const { res, nextCalled } = run(enforce(), req);
  assert.deepStrictEqual(req.cookies, { other: 'x' }); assert.ok(nextCalled); assert.strictEqual(res._cookies.length, 0);
});
test('other cookies (device id, greeting index, founder market override) are never touched', () => {
  const req = { cookies: { user_id: '1', mh_last_greeting_idx: '3', founder_market_override: 'INDIA', mh_device: 'abc' } };
  run(enforce(), req);
  assert.strictEqual(req.cookies.mh_last_greeting_idx, '3'); assert.strictEqual(req.cookies.founder_market_override, 'INDIA'); assert.strictEqual(req.cookies.mh_device, 'abc');
});
test('missing req.cookies object does not crash the middleware', () => {
  const { nextCalled } = run(enforce(), {}); assert.ok(nextCalled);
});
test('transition mode: legacy cookie IS still trusted (documented emergency behaviour) and flagged, but NEVER auto-upgraded to a signed cookie', () => {
  const req = { cookies: { user_id: '42' } };
  const { res } = run(transition(), req);
  assert.strictEqual(req.cookies.user_id, '42'); assert.strictEqual(req.authCookieLegacy, true);
  assert.strictEqual(res._cookies.length, 0, 'no Set-Cookie may be minted from a legacy cookie');
});
test('transition mode still rejects tampered signed cookies and garbage', () => {
  const p = good(42).split('.'); p[1] = '1';
  for (const v of [p.join('.'), 'garbage']) { const req = { cookies: { user_id: v } }; run(transition(), req); assert.strictEqual(req.cookies.user_id, undefined); }
});
test('transition mode still verifies and normalises signed cookies', () => {
  const req = { cookies: { user_id: good(42) } }; run(transition(), req); assert.strictEqual(req.cookies.user_id, '42');
});
test('outbound: res.cookie("user_id", 42, opts) is signed, keeps httpOnly/sameSite/maxAge, and verifies', () => {
  const res = fakeRes(); const m = enforce(); const req = { cookies: {}, secure: false }; m(req, res, () => {});
  res.cookie('user_id', 42, { httpOnly: true, maxAge: 30 * 86400_000, sameSite: 'lax' });
  const c = res._cookies[0];
  assert.strictEqual(c.name, 'user_id'); assert.notStrictEqual(c.value, 42); assert.strictEqual(c.opts.httpOnly, true);
  assert.strictEqual(c.opts.sameSite, 'lax'); assert.strictEqual(c.opts.maxAge, 30 * 86400_000);
  assert.deepStrictEqual(authCookie.verify(c.value, { secret: SECRET, now: NOW + 1000 }), { ok: true, userId: '42' });
});
test('outbound: signed expiry equals the cookie maxAge (short-lived cookies are server-enforced too)', () => {
  const res = fakeRes(); const req = { cookies: {} }; enforce()(req, res, () => {});
  res.cookie('user_id', 42, { httpOnly: true, maxAge: 4 * 3600_000 });
  const v = res._cookies[0].value;
  assert.strictEqual(authCookie.verify(v, { secret: SECRET, now: NOW + 3 * 3600_000 }).ok, true);
  assert.strictEqual(authCookie.verify(v, { secret: SECRET, now: NOW + 5 * 3600_000 }).reason, 'expired');
});
test('outbound: no maxAge given → defaults to 30 days', () => {
  const res = fakeRes(); const req = { cookies: {} }; enforce()(req, res, () => {});
  res.cookie('user_id', 42, { httpOnly: true });
  assert.strictEqual(authCookie.verify(res._cookies[0].value, { secret: SECRET, now: NOW + 29 * 86400_000 }).ok, true);
  assert.strictEqual(authCookie.verify(res._cookies[0].value, { secret: SECRET, now: NOW + 31 * 86400_000 }).reason, 'expired');
});
test('outbound: Secure flag follows req.secure (HTTPS behind the Render proxy), and an explicit setting is respected', () => {
  const mk = (secure, opts) => { const res = fakeRes(); const req = { cookies: {}, secure }; enforce()(req, res, () => {}); res.cookie('user_id', 42, opts); return res._cookies[0].opts.secure; };
  assert.strictEqual(mk(true, {}), true); assert.strictEqual(mk(false, {}), false); assert.strictEqual(mk(true, { secure: false }), false);
});
test('outbound: original options object is not mutated', () => {
  const res = fakeRes(); const req = { cookies: {}, secure: true }; enforce()(req, res, () => {});
  const opts = Object.freeze({ httpOnly: true, maxAge: 1000 }); res.cookie('user_id', 42, opts); // would throw on mutation (frozen)
});
test('outbound: clearing (res.clearCookie and empty value) passes through UNSIGNED', () => {
  const res = fakeRes(); const req = { cookies: {} }; enforce()(req, res, () => {});
  res.clearCookie('user_id'); res.cookie('user_id', ''); res.cookie('user_id', null); res.cookie('user_id', undefined);
  assert.deepStrictEqual(res._cookies.map(c => c.value), ['', '', null, undefined]);
});
test('outbound: other cookie names pass through with identical arguments', () => {
  const res = fakeRes(); const req = { cookies: {} }; enforce()(req, res, () => {});
  res.cookie('mh_last_greeting_idx', '2', { httpOnly: true }); res.cookie('founder_market_override', 'INDIA', { sameSite: 'lax' });
  assert.deepStrictEqual(res._cookies.map(c => [c.name, c.value]), [['mh_last_greeting_idx', '2'], ['founder_market_override', 'INDIA']]);
  assert.strictEqual(res._cookies[0].opts.secure, undefined, 'must not add Secure to unrelated cookies');
});
test('outbound: signing an invalid id THROWS (no credential is minted from bad input)', () => {
  const res = fakeRes(); const req = { cookies: {} }; enforce()(req, res, () => {});
  assert.throws(() => res.cookie('user_id', 'abc', {}), /invalid user id/); assert.throws(() => res.cookie('user_id', -5, {}), /invalid user id/);
  assert.strictEqual(res._cookies.length, 0);
});
test('logging is rate-limited and never contains the cookie value or any user id', () => {
  const lines = []; let t = NOW; const m = mw.create({ secret: SECRET, mode: 'enforce', warn: (l) => lines.push(l), now: () => t });
  for (let i = 0; i < 5; i++) run(m, { cookies: { user_id: '424242' } });
  assert.strictEqual(lines.length, 1, 'only the first line within a minute is emitted');
  t += 61_000; run(m, { cookies: { user_id: '424242' } });
  assert.strictEqual(lines.length, 2); assert.match(lines[1], /\+4 similar suppressed/);
  for (const l of lines) { assert.ok(!l.includes('424242')); assert.match(l, /^\[auth-cookie\]/); }
});
test('create()/fromEnv() FAIL FAST on a missing/short secret or unknown mode', () => {
  assert.throws(() => mw.create({ mode: 'enforce' }), /AUTH_COOKIE_SECRET/);
  assert.throws(() => mw.create({ secret: 'short' }), /AUTH_COOKIE_SECRET/);
  assert.throws(() => mw.create({ secret: SECRET, mode: 'off' }), /AUTH_COOKIE_MODE/);
  const quiet = { log: console.log, warn: console.warn }; console.log = silent; console.warn = silent;
  try {
    assert.throws(() => mw.fromEnv({}), /AUTH_COOKIE_SECRET/);
    assert.throws(() => mw.fromEnv({ AUTH_COOKIE_SECRET: 'x'.repeat(10) }), /AUTH_COOKIE_SECRET/);
    assert.throws(() => mw.fromEnv({ AUTH_COOKIE_SECRET: SECRET, AUTH_COOKIE_MODE: 'disabled' }), /AUTH_COOKIE_MODE/);
    assert.strictEqual(typeof mw.fromEnv({ AUTH_COOKIE_SECRET: SECRET }), 'function', 'default mode is enforce');
    assert.strictEqual(typeof mw.fromEnv({ AUTH_COOKIE_SECRET: SECRET, AUTH_COOKIE_MODE: ' Transition ' }), 'function', 'mode is trimmed / case-insensitive');
  } finally { console.log = quiet.log; console.warn = quiet.warn; }
});

// ══════════════════════════════════════════════════════════════════════════
section('C. Real HTTP through Express — actual Set-Cookie headers and round trips');

// Exact copy of the minimal cookie parser in server.js (asserted identical in section E).
function serverCookieParser(req, _res, next) {
  const cookieHeader = req.headers.cookie || '';
  req.cookies = {};
  cookieHeader.split(';').forEach(part => {
    const [key, ...valParts] = part.trim().split('=');
    if (key) req.cookies[key.trim()] = valParts.join('=');
  });
  next();
}

function buildApp({ withMiddleware = true, mode = 'enforce' } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(serverCookieParser);
  if (withMiddleware) app.use(mw.create({ secret: SECRET, mode, warn: silent }));
  // Mirrors what routes/auth.js does at its four call sites:
  app.post('/issue', (req, res) => { res.cookie('user_id', Number(req.query.id || 42), { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' }); res.json({ ok: true }); });
  app.get('/logout', (req, res) => { res.clearCookie('user_id'); res.redirect('/'); });
  app.get('/echo', (req, res) => res.json({ userId: req.cookies.user_id === undefined ? null : req.cookies.user_id }));
  app.get('/login-with-dead-cookie', (req, res) => { res.cookie('user_id', 43, { httpOnly: true, maxAge: 1000 * 60 }); res.json({ ok: true }); });
  // Real guards from the repo (DB stubbed above):
  app.get('/g/auth', requireAuth, (req, res) => res.json({ id: req.user.id }));
  app.get('/g/page', requireAuthPage, (req, res) => res.json({ id: req.user.id }));
  app.get('/g/founder', requireFounderPage, (req, res) => res.json({ id: req.user.id }));
  app.get('/g/campus', requireCampusLearner, (req, res) => res.json({ id: req.user.id, learner: req.campusLearner.id }));
  return app;
}
function withServer(app, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', async () => {
      try { await fn(`http://127.0.0.1:${server.address().port}`); resolve(); } catch (e) { reject(e); } finally { server.close(); }
    });
  });
}
const get = (base, p, headers = {}, method = 'GET') => fetch(base + p, { method, headers, redirect: 'manual' });
const setCookies = (r) => r.headers.getSetCookie();
const cookieValueFrom = (setCookie) => setCookie.split(';')[0].split('=').slice(1).join('=');

test('issue → Set-Cookie carries a SIGNED value (not a bare integer) with HttpOnly, SameSite=Lax, Max-Age=2592000', () => withServer(buildApp(), async (base) => {
  const r = await get(base, '/issue', {}, 'POST'); const sc = setCookies(r).find(c => c.startsWith('user_id='));
  assert.ok(sc, 'user_id cookie issued'); const value = cookieValueFrom(sc);
  assert.match(value, /^v1\.42\.\d+\.\d+\.[A-Za-z0-9_-]{43}$/); assert.doesNotMatch(value, /%/);
  assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Lax/i); assert.match(sc, /Max-Age=2592000/);
  assert.doesNotMatch(sc, /;\s*Secure/i, 'plain-HTTP request → no Secure flag (same as today)');
}));
test('issue over HTTPS (X-Forwarded-Proto: https, as behind Render) → Secure flag is set', () => withServer(buildApp(), async (base) => {
  const r = await get(base, '/issue', { 'X-Forwarded-Proto': 'https' }, 'POST'); const sc = setCookies(r).find(c => c.startsWith('user_id='));
  assert.match(sc, /;\s*Secure/i);
}));
test('full round trip: issued cookie is accepted and resolves to the right user', () => withServer(buildApp(), async (base) => {
  const sc = setCookies(await get(base, '/issue?id=42', {}, 'POST')).find(c => c.startsWith('user_id='));
  const r = await get(base, '/echo', { Cookie: `user_id=${cookieValueFrom(sc)}` });
  assert.deepStrictEqual(await r.json(), { userId: '42' });
}));
test('ORIGINAL VULNERABILITY: forged "user_id=1" is now signed-out, and the browser is told to delete it', () => withServer(buildApp(), async (base) => {
  const r = await get(base, '/echo', { Cookie: 'user_id=1' });
  assert.deepStrictEqual(await r.json(), { userId: null });
  const clear = setCookies(r).find(c => c.startsWith('user_id='));
  assert.ok(clear && /Expires=Thu, 01 Jan 1970/i.test(clear), 'clearing Set-Cookie sent');
}));
test('every forged/legacy/garbage/expired shape resolves to signed-out over real HTTP', () => withServer(buildApp(), async (base) => {
  const expired = authCookie.sign(42, { secret: SECRET, now: Date.now() - 40 * 86400_000 });
  const p = authCookie.sign(42, { secret: SECRET }).split('.'); p[1] = '1';
  for (const v of ['1', '42', '999', 'v1.1.1.1.abc', 'abc', p.join('.'), expired, authCookie.sign(42, { secret: OTHER_SECRET })]) {
    const j = await (await get(base, '/echo', { Cookie: `user_id=${v}` })).json();
    assert.strictEqual(j.userId, null, `should be signed-out for ${v}`);
  }
}));
test('duplicate user_id cookies: the app parser keeps the LAST one, and a forged last value cannot ride on an earlier valid one', () => withServer(buildApp(), async (base) => {
  const valid = authCookie.sign(42, { secret: SECRET });
  assert.strictEqual((await (await get(base, '/echo', { Cookie: `user_id=${valid}; user_id=1` })).json()).userId, null);
  assert.strictEqual((await (await get(base, '/echo', { Cookie: `user_id=1; user_id=${valid}` })).json()).userId, '42');
}));
test('logout: res.clearCookie("user_id") still emits an expiring cookie (not signed)', () => withServer(buildApp(), async (base) => {
  const r = await get(base, '/logout'); const sc = setCookies(r).find(c => c.startsWith('user_id='));
  assert.strictEqual(r.status, 302); assert.match(sc, /^user_id=;/); assert.match(sc, /Expires=Thu, 01 Jan 1970/i);
}));
test('login on a request that ALSO carried a dead cookie: the fresh signed cookie is the LAST Set-Cookie (wins in the browser)', () => withServer(buildApp(), async (base) => {
  const r = await get(base, '/login-with-dead-cookie', { Cookie: 'user_id=1' });
  const all = setCookies(r).filter(c => c.startsWith('user_id='));
  assert.strictEqual(all.length, 2, 'clear + fresh');
  assert.match(all[0], /^user_id=;/); assert.match(all[1], /^user_id=v1\.43\./);
}));
test('transition mode over HTTP: legacy trusted (insecure, emergency only) and no cookie is minted', () => withServer(buildApp({ mode: 'transition' }), async (base) => {
  const r = await get(base, '/echo', { Cookie: 'user_id=42' });
  assert.deepStrictEqual(await r.json(), { userId: '42' }); assert.strictEqual(setCookies(r).filter(c => c.startsWith('user_id=')).length, 0);
}));

// ══════════════════════════════════════════════════════════════════════════
section('D. Real guards (middleware/guards.js, campus-guards.js) — forged cookies, DB stubbed');

const signed = (id) => `user_id=${authCookie.sign(id, { secret: SECRET })}`;

test('CONTROL (proves this suite can detect the bug): WITHOUT the middleware, forged "user_id=1" passes the real founder guard', () => withServer(buildApp({ withMiddleware: false }), async (base) => {
  const r = await get(base, '/g/founder', { Cookie: 'user_id=1' });
  assert.strictEqual(r.status, 200, 'this is the pre-fix vulnerability');
}));
test('requireAuth (API): signed cookie → 200 with the right user', () => withServer(buildApp(), async (base) => {
  const r = await get(base, '/g/auth', { Cookie: signed(42) }); assert.strictEqual(r.status, 200); assert.strictEqual((await r.json()).id, 42);
}));
test('requireAuth (API): forged cookie → 401', () => withServer(buildApp(), async (base) => {
  for (const v of ['user_id=42', 'user_id=1']) assert.strictEqual((await get(base, '/g/auth', { Cookie: v })).status, 401);
}));
test('requireAuth (API): no cookie → 401 (unchanged)', () => withServer(buildApp(), async (base) => {
  assert.strictEqual((await get(base, '/g/auth')).status, 401);
}));
test('requireAuthPage: signed → 200; forged → 302 to /auth/login?next=… (intent-return preserved)', () => withServer(buildApp(), async (base) => {
  assert.strictEqual((await get(base, '/g/page', { Cookie: signed(42) })).status, 200);
  const r = await get(base, '/g/page', { Cookie: 'user_id=42' });
  assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), '/auth/login?next=' + encodeURIComponent('/g/page'));
}));
test('requireFounderPage: signed founder → 200; signed non-founder → redirected to /dashboard/history; FORGED founder id → login redirect', () => withServer(buildApp(), async (base) => {
  assert.strictEqual((await get(base, '/g/founder', { Cookie: signed(1) })).status, 200);
  const nonFounder = await get(base, '/g/founder', { Cookie: signed(42) });
  assert.strictEqual(nonFounder.status, 302); assert.strictEqual(nonFounder.headers.get('location'), '/dashboard/history');
  const forged = await get(base, '/g/founder', { Cookie: 'user_id=1' });
  assert.strictEqual(forged.status, 302); assert.match(forged.headers.get('location'), /^\/auth\/login\?next=/);
}));
test('requireCampusLearner: signed enrolled learner → 200; forged → 401; signed but not enrolled → 403 (unchanged behaviour)', () => withServer(buildApp(), async (base) => {
  const ok = await get(base, '/g/campus', { Cookie: signed(42) }); assert.strictEqual(ok.status, 200); assert.strictEqual((await ok.json()).learner, 7);
  assert.strictEqual((await get(base, '/g/campus', { Cookie: 'user_id=42' })).status, 401);
  assert.strictEqual((await get(base, '/g/campus', { Cookie: signed(43) })).status, 403);
}));
test('a signed cookie for one user cannot be replayed as another (id swap → 401)', () => withServer(buildApp(), async (base) => {
  const p = authCookie.sign(42, { secret: SECRET }).split('.'); p[1] = '1';
  assert.strictEqual((await get(base, '/g/auth', { Cookie: `user_id=${p.join('.')}` })).status, 401);
}));

// ══════════════════════════════════════════════════════════════════════════
section('E. Static guarantees about the codebase');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'back up'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const allFiles = walk(ROOT);
const jsFiles = allFiles.filter(f => f.endsWith('.js') && !f.includes(`${path.sep}tests${path.sep}`));
const rel = (f) => path.relative(ROOT, f);

test("only routes/auth.js issues the user_id cookie (exactly 4 call sites) — so the outbound wrapper covers every issuer", () => {
  const hits = [];
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const m = src.match(/res\.cookie\(\s*['"]user_id['"]/g);
    if (m) hits.push([rel(f), m.length]);
  }
  // Allowed: routes/auth.js (the real issuer), middleware/auth-cookie.js (its header comment
  // documents the call it wraps), views/server.js (known orphan copy, never loaded).
  const outside = hits.filter(([f]) => !['routes/auth.js', 'middleware/auth-cookie.js', 'views/server.js'].includes(f));
  assert.deepStrictEqual(outside, [], 'no other file may set user_id');
  assert.deepStrictEqual(hits.find(([f]) => f === 'routes/auth.js'), ['routes/auth.js', 4]);
});
test('nothing except the server.js cookie parser and this middleware reads the raw Cookie header', () => {
  const offenders = [];
  for (const f of jsFiles) {
    const r = rel(f);
    if (['server.js', 'views/server.js'].includes(r)) continue;
    if (/headers\.cookie|headers\['cookie'\]|getHeader\(['"]cookie['"]\)/i.test(fs.readFileSync(f, 'utf8'))) offenders.push(r);
  }
  assert.deepStrictEqual(offenders, []);
});
test('no client-side code touches document.cookie (cookie is httpOnly and stays that way)', () => {
  const offenders = allFiles.filter(f => /\.(js|ejs|html)$/.test(f) && !f.includes(`${path.sep}tests${path.sep}`)).filter(f => /document\.cookie/.test(fs.readFileSync(f, 'utf8'))).map(rel);
  assert.deepStrictEqual(offenders, []);
});
test('no second auth mechanism exists (no signed-cookie/JWT/session lib added or already present) that this fix could be bypassed through', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies));
  for (const d of ['cookie-parser', 'express-session', 'jsonwebtoken', 'cookie-session']) assert.ok(!deps.includes(d), `unexpected auth dependency: ${d}`);
});
test('server.js mounts the auth-cookie middleware exactly once, AFTER the cookie parser and BEFORE device-id and the Capability Engine', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const mounts = src.match(/require\('\.\/middleware\/auth-cookie'\)\.fromEnv\(\)/g) || [];
  assert.strictEqual(mounts.length, 1);
  const iParser = src.indexOf('// Minimal cookie parser');
  const iAuth = src.indexOf("require('./middleware/auth-cookie').fromEnv()");
  const iDevice = src.indexOf("require('./middleware/device-id').attachDeviceSignal");
  const iCaps = src.indexOf("require('./middleware/capabilities')");
  assert.ok(iParser > -1 && iAuth > iParser && iDevice > iAuth && iCaps > iAuth, `order parser(${iParser}) < auth(${iAuth}) < device(${iDevice}), caps(${iCaps})`);
});
test('the cookie parser used in section C is byte-identical to the one in server.js (so section C tests the real parsing behaviour)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const body = ["  const cookieHeader = req.headers.cookie || '';", '  req.cookies = {};', '  cookieHeader.split(\';\').forEach(part => {', '    const [key, ...valParts] = part.trim().split(\'=\');', '    if (key) req.cookies[key.trim()] = valParts.join(\'=\');', '  });'];
  for (const line of body) assert.ok(src.includes(line), `server.js parser line missing/changed: ${line}`);
  const mine = serverCookieParser.toString();
  for (const line of body) assert.ok(mine.includes(line.trim()), `test parser drifted from: ${line}`);
});
test('every existing reader of req.cookies.user_id is downstream of the middleware (none run before it in server.js)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const iAuth = src.indexOf("require('./middleware/auth-cookie').fromEnv()");
  const firstReader = src.search(/req\.cookies\.user_id/);
  const codeBeforeAuthReads = src.slice(0, iAuth).split('\n').filter(l => !l.trim().startsWith('//') && /req\.cookies\.user_id/.test(l));
  assert.deepStrictEqual(codeBeforeAuthReads, [], 'no executable code before the middleware reads the cookie');
  assert.ok(firstReader > -1);
});

// ── runner ────────────────────────────────────────────────────────────────
(async () => {
  let passed = 0; let failed = 0; const failures = [];
  for (const t of tests) {
    if (t.section) { console.log(`\n${t.section}`); currentSection = t.section; continue; }
    try { await t.fn(); passed++; console.log(`  ✓ ${t.name}`); }
    catch (e) { failed++; failures.push({ section: currentSection, name: t.name, e }); console.log(`  ✗ ${t.name}\n      ${String(e && e.message).split('\n')[0]}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed) { for (const f of failures) console.error(`\nFAIL [${f.section}] ${f.name}\n${f.e && f.e.stack}`); }
  process.exit(failed ? 1 : 0);
})();
