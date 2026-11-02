// tests/pwa.js — installable web app (PWA): injection, kill switch, service worker, sign-in pairing.
// Plain Node + assert. Run: node tests/pwa.js
const assert = require('assert'); const http = require('http'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const express = require('express');
const SECRET = 'e'.repeat(64); process.env.AUTH_COOKIE_SECRET = SECRET;
const authCookie = require('../lib/auth-cookie'); const shell = require('../middleware/app-shell'); const pwa = require('../routes/pwa');
let n = 0; const ok = (m) => console.log('  ok  ' + (++n) + ' ' + m);
const ROOT = path.join(__dirname, '..');

// A. static assets
const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf8'));
assert.strictEqual(mf.display, 'standalone'); assert.strictEqual(mf.scope, '/'); assert.ok(mf.name && mf.short_name && mf.start_url);
for (const i of mf.icons) assert.ok(fs.existsSync(path.join(ROOT, 'public', i.src)), i.src);
assert.ok(mf.icons.some(i => i.sizes === '192x192') && mf.icons.some(i => i.sizes === '512x512') && mf.icons.some(i => i.purpose === 'maskable')); ok('manifest valid, icons exist (192, 512, maskable)');
for (const f of ['public/js/pwa.js', 'public/css/pwa.css', 'public/pwa/offline.html', 'public/pwa/qrcode.js', 'lib/pwa-sw.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
assert.ok(!/document\.cookie/.test(fs.readFileSync(path.join(ROOT, 'public/js/pwa.js'), 'utf8'))); ok('client script never touches document.cookie');
const pj = fs.readFileSync(path.join(ROOT, 'public/js/pwa.js'), 'utf8');
assert.ok(pj.includes("'Get the MedhaIQ App'") && pj.includes("Take your career intelligence with you.") && (pj.match(/href = '\/install'/g) || []).length === 2); ok('footer + hero entry points both link to /install with the approved wording');
assert.ok(!/App Store|Google Play/.test(pj)); ok('wording never claims an App Store or Google Play app');

// B. injection
const HTML = '<html><head><title>x</title></head><body>hi</body></html>';
process.env.PWA_ENABLED = 'on'; let o = shell.injectPwa(HTML);
assert.ok(o.includes('rel="manifest"') && o.includes('/js/pwa.js') && o.includes('apple-touch-icon') && o.includes('/css/pwa.css')); ok('pwa tags injected into head and body');
const withManifest = shell.injectPwa('<html><head><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#0A0F1E"></head><body></body></html>');
assert.strictEqual(withManifest.split('rel="manifest"').length, 2); assert.strictEqual(withManifest.split('name="theme-color"').length, 2); ok('no duplicate manifest/theme-color');
assert.strictEqual(shell.injectPwa(o), o); ok('injection is idempotent');

// C. real HTTP
const tmp = path.join(__dirname, 'fixtures-views-pwa'); fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(path.join(tmp, 't.ejs'), HTML);
const app = express(); app.set('view engine', 'ejs'); app.set('views', tmp); app.use(express.json());
app.use((req, _r, next) => { req.cookies = {}; (req.headers.cookie || '').split(';').forEach(p => { const [k, ...v] = p.trim().split('='); if (k) req.cookies[k] = v.join('='); }); next(); });
app.use(require('../middleware/auth-cookie').create({ secret: SECRET })); app.use(shell.inject);
app.get('/explore', (q, r) => r.render('t')); app.get('/interview/session/1', (q, r) => r.render('t')); app.get('/cb', (q, r) => r.render('t', {}, (e, h) => r.send('CB' + h)));
app.use(pwa);
function req(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ port, method, path: p, headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers) }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ s: res.statusCode, h: res.headers, b, j }); });
    }); r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari'; const APPUA = 'Mozilla/5.0 MedhaIQApp/1.0';
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  try {
    process.env.PWA_ENABLED = 'on';
    let r = await req(port, 'GET', '/explore', { headers: { 'user-agent': IOS } }); assert.ok(r.b.includes('/js/pwa.js')); ok('ON: web visitors get pwa tags (all devices)');
    r = await req(port, 'GET', '/explore', { headers: { 'user-agent': APPUA } }); assert.ok(r.b.includes('/js/app-shell.js') && !r.b.includes('/js/pwa.js')); ok('ON: native app gets app tags, not pwa tags');
    r = await req(port, 'GET', '/interview/session/1', { headers: { 'user-agent': IOS } }); assert.ok(!r.b.includes('pwa.js')); ok('live interview page untouched');
    r = await req(port, 'GET', '/cb', { headers: { 'user-agent': IOS } }); assert.strictEqual(r.b, 'CB' + HTML); ok('render with callback untouched');
    r = await req(port, 'GET', '/sw.js'); assert.ok(r.b.includes("const VERSION") && r.h['service-worker-allowed'] === '/' && /no-cache/.test(r.h['cache-control'])); ok('ON: /sw.js serves the real worker');
    r = await req(port, 'GET', '/install'); assert.strictEqual(r.s, 200); assert.ok(r.b.includes('Add to Home Screen') && r.b.includes('qrcode')); ok('ON: /install page served');

    // pairing flow
    const cookie = 'user_id=' + authCookie.sign(42, { secret: SECRET });
    r = await req(port, 'POST', '/pwa/pair/start', { body: { to: '/interview' } }); assert.strictEqual(r.s, 200); const P = r.j; assert.ok(P.id && P.secret && /^\d{4}$/.test(P.code)); ok('pair/start returns id, secret, 4-digit code');
    r = await req(port, 'POST', '/pwa/pair/poll', { body: { id: P.id, secret: P.secret } }); assert.deepStrictEqual(r.j, { pending: true }); ok('poll is pending before approval');
    r = await req(port, 'POST', '/pwa/pair/poll', { body: { id: P.id, secret: 'wrong' } }); assert.strictEqual(r.s, 410); ok('poll with wrong secret refused (id alone is not enough)');
    r = await req(port, 'GET', '/pwa/pair/claim?id=' + P.id); assert.strictEqual(r.s, 302); assert.ok(r.h.location.startsWith('/auth/login?next=')); ok('claim without sign-in goes to login');
    r = await req(port, 'GET', '/pwa/pair/claim?id=' + P.id, { headers: { cookie } }); assert.strictEqual(r.s, 200); assert.ok(r.b.includes('4-digit code') && /no-store/.test(r.h['cache-control'])); ok('claim page asks for the code');
    r = await req(port, 'POST', '/pwa/pair/approve', { body: { id: P.id, code: P.code } }); assert.strictEqual(r.s, 401); ok('approve without sign-in refused');
    const wrong = P.code === '0000' ? '1111' : '0000';
    r = await req(port, 'POST', '/pwa/pair/approve', { headers: { cookie }, body: { id: P.id, code: wrong } }); assert.strictEqual(r.s, 400); ok('wrong code refused');
    r = await req(port, 'POST', '/pwa/pair/poll', { body: { id: P.id, secret: P.secret } }); assert.deepStrictEqual(r.j, { pending: true }); ok('still pending after a wrong code');
    r = await req(port, 'POST', '/pwa/pair/approve', { headers: { cookie }, body: { id: P.id, code: P.code } }); assert.deepStrictEqual(r.j, { ok: true }); ok('correct code approves');
    r = await req(port, 'POST', '/pwa/pair/poll', { body: { id: P.id, secret: P.secret } });
    assert.strictEqual(r.j.ok, true); assert.strictEqual(r.j.redirect, '/interview'); const sc = r.h['set-cookie'][0]; assert.ok(sc.startsWith('user_id=v1.42.') && /HttpOnly/i.test(sc));
    const vr = authCookie.verify(sc.split(';')[0].split('=')[1], { secret: SECRET }); assert.ok(vr.ok && String(vr.userId) === '42'); ok('poll issues signed HttpOnly cookie for the approving user + saved redirect');
    r = await req(port, 'POST', '/pwa/pair/poll', { body: { id: P.id, secret: P.secret } }); assert.strictEqual(r.s, 410); assert.ok(!r.h['set-cookie']); ok('pairing is single use');
    // burn after 5 wrong tries
    const Q = (await req(port, 'POST', '/pwa/pair/start', { body: {} })).j; const bad = Q.code === '9999' ? '8888' : '9999';
    for (let i = 0; i < 5; i++) await req(port, 'POST', '/pwa/pair/approve', { headers: { cookie }, body: { id: Q.id, code: bad } });
    r = await req(port, 'POST', '/pwa/pair/approve', { headers: { cookie }, body: { id: Q.id, code: Q.code } }); assert.ok(r.s === 410 || r.s === 429); ok('5 wrong codes burn the pairing (even the right code then fails)');
    r = await req(port, 'POST', '/pwa/pair/start', { body: { to: 'https://evil.example' } }); const E = r.j;
    await req(port, 'POST', '/pwa/pair/approve', { headers: { cookie }, body: { id: E.id, code: E.code } });
    r = await req(port, 'POST', '/pwa/pair/poll', { body: { id: E.id, secret: E.secret } }); assert.strictEqual(r.j.redirect, '/dashboard/history'); ok('external redirect target is ignored');
    r = await req(port, 'POST', '/pwa/pair/start', { body: { to: '//evil.example' } });
    await req(port, 'POST', '/pwa/pair/approve', { headers: { cookie }, body: { id: r.j.id, code: r.j.code } });
    r = await req(port, 'POST', '/pwa/pair/poll', { body: { id: r.j.id, secret: r.j.secret } }); assert.strictEqual(r.j.redirect, '/dashboard/history'); ok('protocol-relative redirect target ignored');

    // kill switch
    delete process.env.PWA_ENABLED;
    r = await req(port, 'GET', '/explore', { headers: { 'user-agent': IOS } }); assert.ok(!r.b.includes('pwa.js')); ok('OFF: pages carry no pwa tags');
    r = await req(port, 'GET', '/sw.js'); assert.ok(r.b.includes('unregister') && !r.b.includes('VERSION')); ok('OFF: /sw.js is a self-removing worker (clears installed workers)');
    for (const [m, p2] of [['GET', '/install'], ['POST', '/pwa/pair/start'], ['GET', '/pwa/pair/claim?id=x']]) { r = await req(port, m, p2, { body: m === 'POST' ? {} : undefined }); assert.strictEqual(r.s, 404, p2); } ok('OFF: install page and pairing endpoints return 404');
    r = await req(port, 'GET', '/explore', { headers: { 'user-agent': APPUA } }); assert.ok(r.b.includes('/js/app-shell.js')); ok('OFF: native app tags still work');

    // D. service worker behaviour
    const listeners = {}; const cached = new Map([['/pwa/offline.html', 'OFFLINE']]);
    const ctx = { self: { location: { origin: 'https://www.medhaiq.ai' }, addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim() {} } },
      caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => true, match: async (u) => cached.get(u) },
      URL, fetch: async () => { throw new Error('offline'); }, Promise };
    vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/pwa-sw.js'), 'utf8'), ctx);
    const handle = async (url, extra = {}) => { let resp; const e = Object.assign({ request: Object.assign({ method: 'GET', mode: 'navigate', url }, extra), respondWith: (p) => { resp = p; } }); listeners.fetch(e); return resp ? await resp : undefined; };
    assert.strictEqual(await handle('https://www.medhaiq.ai/explore'), 'OFFLINE'); ok('SW: offline navigation shows branded offline page');
    for (const u of ['/api/interview/x', '/auth/login', '/interview/session/9', '/checkout/success', '/pwa/pair/poll', '/app/session']) assert.strictEqual(await handle('https://www.medhaiq.ai' + u), undefined, u); ok('SW: never intercepts api, auth, live interview, payments, pairing');
    assert.strictEqual(await handle('https://www.medhaiq.ai/explore', { method: 'POST' }), undefined); assert.strictEqual(await handle('https://www.medhaiq.ai/css/a.css', { mode: 'no-cors' }), undefined); assert.strictEqual(await handle('https://other.com/x'), undefined); ok('SW: ignores non-GET, assets and other origins');
    console.log('\nAll ' + n + ' checks passed');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
