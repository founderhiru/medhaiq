// tests/app-handoff.js — mobile app login handoff + script injection.
// Plain Node + assert, no DB/network. Run: node tests/app-handoff.js
const assert = require('assert');
const http = require('http');
const express = require('express');
const path = require('path');
const SECRET = 'c'.repeat(64);
process.env.AUTH_COOKIE_SECRET = SECRET;

const handoff = require('../routes/app-handoff');
const shell = require('../middleware/app-shell');
const authCookie = require('../lib/auth-cookie');
let n = 0; const ok = (name) => console.log('  ok  ' + (++n) + ' ' + name);

// A. code mint/consume
const t0 = 1_800_000_000_000;
let code = handoff.mintCode('42', SECRET, t0);
assert.strictEqual(handoff.consumeCode(code, SECRET, t0 + 1000), '42'); ok('valid code returns user id');
assert.strictEqual(handoff.consumeCode(code, SECRET, t0 + 1000), null); ok('code is single-use');
code = handoff.mintCode('42', SECRET, t0);
assert.strictEqual(handoff.consumeCode(code, SECRET, t0 + 121_000), null); ok('expired code refused');
code = handoff.mintCode('42', SECRET, t0);
assert.strictEqual(handoff.consumeCode(code.replace('h1.42.', 'h1.43.'), SECRET, t0), null); ok('tampered user id refused');
assert.strictEqual(handoff.consumeCode(code, 'd'.repeat(64), t0), null); ok('wrong secret refused');
assert.strictEqual(handoff.consumeCode(code.slice(0, -2), SECRET, t0), null); ok('truncated signature refused');
for (const bad of ['', 'x', 'h1.1.2.3', 'h1.0.9999999999.n.s', null, 'a'.repeat(500)]) assert.strictEqual(handoff.consumeCode(bad, SECRET, t0), null);
ok('malformed codes refused');
assert.throws(() => handoff.mintCode('0', SECRET)); assert.throws(() => handoff.mintCode('1', 'short')); ok('mint rejects bad id / weak secret');
const farFuture = handoff.mintCode('7', SECRET, t0 + 10_000_000);
assert.strictEqual(handoff.consumeCode(farFuture, SECRET, t0), null); ok('code with far-future expiry refused');
const sessionCookie = authCookie.sign(42, { secret: SECRET });
assert.strictEqual(handoff.consumeCode(sessionCookie, SECRET, t0), null); ok('a session cookie cannot be used as a handoff code');

// B. injection
const APP = 'Mozilla/5.0 (iPhone) MedhaIQApp/1.0';
assert.ok(shell.isAppRequest({ headers: { 'user-agent': APP } })); assert.ok(!shell.isAppRequest({ headers: { 'user-agent': 'Chrome' } })); ok('UA detection');
assert.ok(shell.injectTags('<body>x</body>').includes('app-shell.js')); assert.strictEqual(shell.injectTags(shell.injectTags('<body></body>')).split('app-shell.js').length, 2); ok('inject once, before </body>');

// C. real HTTP
const app = express();
app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'fixtures-views'));
app.use((req, _r, next) => { req.cookies = {}; (req.headers.cookie || '').split(';').forEach(p => { const [k, ...v] = p.trim().split('='); if (k) req.cookies[k] = v.join('='); }); next(); });
app.use(require('../middleware/auth-cookie').create({ secret: SECRET }));
app.use(shell.inject);
app.get('/page', (req, res) => res.type('html').send('plain'));
app.get('/render-cb', (req, res) => res.render('t', {}, (e, h) => res.send('CB:' + h)));
app.get('/render', (req, res) => res.render('t'));
app.get('/interview/session/1', (req, res) => res.render('t'));
app.use('/app', handoff);
const fs = require('fs'); fs.mkdirSync(path.join(__dirname, 'fixtures-views'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'fixtures-views', 't.ejs'), '<html><body>hello</body></html>');

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => http.get({ port, path: p, headers }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ s: r.statusCode, h: r.headers, b })); }).on('error', reject));
}
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  try {
    let r = await get(port, '/render', { 'user-agent': APP }); assert.ok(r.b.includes('/js/app-shell.js')); ok('app request gets script');
    r = await get(port, '/render', { 'user-agent': 'Safari' }); assert.ok(!r.b.includes('app-shell')); ok('browser request untouched');
    r = await get(port, '/render-cb', { 'user-agent': APP }); assert.strictEqual(r.b, 'CB:<html><body>hello</body></html>'); ok('render with callback untouched');
    r = await get(port, '/interview/session/1', { 'user-agent': APP }); assert.ok(!r.b.includes('app-shell')); ok('live interview page never touched');
    // handoff without login -> login redirect
    r = await get(port, '/app/handoff'); assert.strictEqual(r.s, 302); assert.ok(r.h.location.startsWith('/auth/login?next=')); ok('handoff without session redirects to login');
    // handoff with a validly signed cookie
    const cookie = 'user_id=' + authCookie.sign(42, { secret: SECRET });
    r = await get(port, '/app/handoff', { cookie }); assert.strictEqual(r.s, 200); assert.ok(r.h['cache-control'].includes('no-store'));
    const m = r.b.match(/medhaiq:\/\/auth\?code=([^"'&<\\]+)/); assert.ok(m, 'deep link present'); ok('handoff page issues medhaiq:// deep link');
    // forged cookie refused
    r = await get(port, '/app/handoff', { cookie: 'user_id=42' }); assert.strictEqual(r.s, 302); ok('forged bare cookie gets no code');
    const dl = decodeURIComponent(m[1]);
    r = await get(port, '/app/session?code=' + encodeURIComponent(dl), { 'user-agent': 'Safari' }); assert.strictEqual(r.s, 302); assert.ok(!r.h['set-cookie']); ok('session refuses non-app client');
    r = await get(port, '/app/session?code=' + encodeURIComponent(dl), { 'user-agent': APP });
    assert.strictEqual(r.s, 302); assert.strictEqual(r.h.location, '/dashboard/history');
    const sc = r.h['set-cookie'][0]; assert.ok(sc.startsWith('user_id=v1.42.') && /HttpOnly/i.test(sc)); ok('session issues signed HttpOnly user_id cookie');
    const val = sc.split(';')[0].split('=')[1]; const vr = authCookie.verify(val, { secret: SECRET }); assert.ok(vr.ok && String(vr.userId) === '42'); ok('issued cookie verifies');
    r = await get(port, '/app/session?code=' + encodeURIComponent(dl), { 'user-agent': APP }); assert.ok(r.h.location.startsWith('/auth/login')); assert.ok(!r.h['set-cookie']); ok('replayed code refused');
    console.log('\nAll ' + n + ' checks passed');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { srv.close(); fs.rmSync(path.join(__dirname, 'fixtures-views'), { recursive: true, force: true }); }
});
