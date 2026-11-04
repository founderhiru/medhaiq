// routes/pwa.js
//
// Installable web app (PWA) support. Everything here is inert unless env PWA_ENABLED=on.
//
//   GET  /sw.js                 service worker (ON) or a self-removing worker (OFF = kill switch)
//   GET  /install               "Use MedhaIQ on any device" page with QR code and steps
//   POST /pwa/pair/start        installed app asks for a sign-in pairing {id, secret, code}
//   GET  /pwa/pair/claim?id=    opened from the e-mail link / Google return, in the phone browser
//   POST /pwa/pair/approve      user types the 4-digit code shown in the app -> pair approved
//   POST /pwa/pair/poll         installed app collects the approval -> receives the signed cookie
//
// WHY PAIRING: on iPhone/iPad an installed web app keeps its login separate from Safari, so an
// e-mail sign-in link opened from Mail would sign in Safari, not the app. The app shows a short
// code, the link lands on /pwa/pair/claim where the user types that code, and the app signs
// itself in. The typed code stops a stranger from tricking a signed-in user into approving the
// stranger's device. Single use, 10 min TTL, 5 wrong tries burn the pairing. In-memory store
// (one Render instance, same assumption as middleware/rate-limit.js).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { pwaEnabled } = require('../middleware/app-shell');

const TTL_SEC = 600;
const MAX_TRIES = 5;
const MAX_PAIRS = 5000;
const pairs = new Map(); // id -> { hash, code, to, userId, tries, exp }

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const safePath = v => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && v.length < 300 && !/[\r\n]/.test(v)) ? v : null;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sweep(now = Date.now()) { for (const [k, p] of pairs) if (p.exp < now) pairs.delete(k); }

const SW_SOURCE = () => fs.readFileSync(path.join(__dirname, '..', 'lib', 'pwa-sw.js'), 'utf8');
const KILL_SW = "self.addEventListener('install',function(){self.skipWaiting()});" +
  "self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(k){return Promise.all(k.map(function(n){return caches.delete(n)}))}).then(function(){return self.registration.unregister()}).then(function(){return self.clients.matchAll()}).then(function(cs){cs.forEach(function(c){c.navigate(c.url)})}))});";

// Own limiters (NOT the shared login limiter): the installed app polls every ~2.5 s while waiting,
// which must never eat the sign-in budget of /auth/login.
const mk = (windowMs, max, keyGenerator) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, keyGenerator,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Please try again shortly.' }) });
const byIp = req => req.ip || 'unknown';
const startLimiter = mk(15 * 60 * 1000, 20, byIp);
const claimLimiter = mk(15 * 60 * 1000, 60, byIp);
const pollLimiter = mk(15 * 60 * 1000, 400, req => 'poll:' + String((req.body && req.body.id) || req.ip).slice(0, 64));

const router = express.Router();

router.get('/sw.js', (_req, res) => {
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.send(pwaEnabled() ? SW_SOURCE() : KILL_SW);
});

router.get('/install', (_req, res) => {
  if (!pwaEnabled()) return res.status(404).send('Not found');
  res.set({ 'Cache-Control': 'no-cache' }).type('html').send(installPage());
});

function guard(req, res, next) { return pwaEnabled() ? next() : res.status(404).json({ error: 'Not found' }); }
router.use('/pwa/pair', guard);

router.post('/pwa/pair/start', startLimiter, (req, res) => {
  sweep();
  if (pairs.size >= MAX_PAIRS) return res.status(503).json({ error: 'Busy. Try again shortly.' });
  const id = crypto.randomBytes(12).toString('base64url');
  const secret = crypto.randomBytes(24).toString('base64url');
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const to = safePath(req.body && req.body.to) || '/dashboard/history';
  pairs.set(id, { hash: sha(secret), code, to, userId: null, tries: 0, exp: Date.now() + TTL_SEC * 1000 });
  res.set('Cache-Control', 'no-store').json({ id, secret, code, expiresIn: TTL_SEC });
});

router.get('/pwa/pair/claim', claimLimiter, (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const id = String(req.query.id || '').slice(0, 64);
  const userId = req.cookies && req.cookies.user_id;
  if (!userId) return res.redirect('/auth/login?next=' + encodeURIComponent('/pwa/pair/claim?id=' + id));
  sweep();
  const ok = pairs.has(id);
  res.type('html').send(claimPage(id, ok));
});

router.post('/pwa/pair/approve', claimLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const userId = req.cookies && req.cookies.user_id;
  if (!userId) return res.status(401).json({ error: 'Sign in first' });
  sweep();
  const id = String((req.body && req.body.id) || '');
  const p = pairs.get(id);
  if (!p) return res.status(410).json({ error: 'This sign-in expired. Start again in the app.' });
  if (p.tries >= MAX_TRIES) { pairs.delete(id); return res.status(429).json({ error: 'Too many tries. Start again in the app.' }); }
  const code = String((req.body && req.body.code) || '').trim();
  if (!safeEq(code, p.code)) {
    p.tries += 1;
    if (p.tries >= MAX_TRIES) pairs.delete(id);
    return res.status(400).json({ error: 'That code does not match the one in your app.' });
  }
  p.userId = String(userId);
  res.json({ ok: true });
});

router.post('/pwa/pair/poll', pollLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  sweep();
  const id = String((req.body && req.body.id) || '');
  const p = pairs.get(id);
  if (!p || !safeEq(sha((req.body && req.body.secret) || ''), p.hash)) return res.status(410).json({ expired: true });
  if (!p.userId) return res.json({ pending: true });
  pairs.delete(id); // single use
  res.cookie('user_id', p.userId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' }); // signed by middleware/auth-cookie
  res.json({ ok: true, redirect: p.to });
});

const BASE_CSS = "@font-face{font-family:'Plus Jakarta Sans';font-weight:700;src:url(/assets/pwa/pjs-700.woff2) format('woff2')}" +
  "*{box-sizing:border-box;margin:0;padding:0}html{background:#0A0E1A}body{min-height:100vh;background:radial-gradient(60% 40% at 50% 0%,rgba(59,130,246,.16),#0A0E1A 70%);color:#fff;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}" +
  ".logo{display:inline-flex;align-items:center;gap:10px;line-height:1;text-decoration:none}.logo img{height:26px;width:auto}.w{font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:700;font-size:20px;letter-spacing:-.04em;color:#fff}.w span{background:linear-gradient(135deg,#3D8BFF 0%,#4F74FF 38%,#6D5CF5 72%,#8B5CF6 100%);-webkit-background-clip:text;background-clip:text;color:transparent}" +
  ".btn{display:inline-block;border:0;cursor:pointer;color:#fff;text-decoration:none;font:600 16px 'Plus Jakarta Sans',system-ui,sans-serif;padding:13px 26px;border-radius:12px;background:linear-gradient(135deg,#3D8BFF,#8B5CF6);box-shadow:0 8px 28px rgba(79,116,255,.3)}" +
  ".btn+.btn{margin-left:12px}.card{background:#111827;border:1px solid #1E293B;border-radius:20px;padding:24px}.mu{color:#9DA8BA;line-height:1.6}";
const LOGO = '<a class="logo" href="/"><img src="/assets/branding/medhaiq-icon.png" alt=""><span class="w">Medha<span>IQ</span></span></a>';

function claimPage(id, ok) {
  const body = ok
    ? `<h1>Finish signing in to the app</h1><p class="mu" style="margin:10px 0 18px">Enter the 4-digit code shown in your MedhaIQ app. Only continue if you started this sign-in yourself, on your own device.</p>
<form id="f"><input id="c" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" placeholder="0000" autofocus style="width:100%;font:700 34px 'Plus Jakarta Sans',system-ui;letter-spacing:.4em;text-align:center;padding:14px;border-radius:12px;border:1px solid #1E293B;background:#0D1220;color:#fff;margin-bottom:14px">
<button class="btn" style="width:100%" type="submit">Sign in the app</button></form><p id="m" class="mu" style="margin-top:14px;min-height:22px"></p>
<p style="margin-top:8px"><a class="mu" href="/dashboard/history">Not using the app? Continue in the browser</a></p>`
    : `<h1>This sign-in expired</h1><p class="mu" style="margin:10px 0 18px">Go back to the MedhaIQ app and start sign-in again, or continue in the browser.</p><a class="btn" href="/dashboard/history">Continue in the browser</a>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>MedhaIQ | Finish sign-in</title><style>${BASE_CSS}main{max-width:420px;margin:0 auto;padding:28px 20px}h1{font:700 24px 'Plus Jakarta Sans',system-ui;letter-spacing:-.02em}</style></head><body><main><div style="margin-bottom:24px">${LOGO}</div><div class="card">${body}</div></main>
<script>(function(){var id=${JSON.stringify(id)},f=document.getElementById('f');if(!f)return;var m=document.getElementById('m'),c=document.getElementById('c');
function done(r){location.replace(r||'/dashboard/history')}
function approve(code){return fetch('/pwa/pair/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,code:code})}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})}
function selfPoll(p){return fetch('/pwa/pair/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id,secret:p.secret})}).then(function(r){return r.json()}).then(function(j){if(j.ok){try{localStorage.removeItem('mh_pair')}catch(e){}done(j.redirect)}})}
var mine=null;try{mine=JSON.parse(localStorage.getItem('mh_pair')||'null')}catch(e){}
if(mine&&mine.id===id){approve(mine.code).then(function(x){if(x.j.ok)selfPoll(mine)})}
f.addEventListener('submit',function(e){e.preventDefault();m.textContent='';approve(c.value).then(function(x){if(x.j.ok){m.textContent='Done. Return to the MedhaIQ app, it will sign in automatically.'}else{m.textContent=x.j.error||'Something went wrong.'}}).catch(function(){m.textContent='Network error. Try again.'})});})();</script></body></html>`;
}

function installPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0A0F1E"><title>MedhaIQ | Access MedhaIQ on Any Device</title>
<link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" sizes="180x180" href="/assets/pwa/apple-touch-icon-180.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="MedhaIQ">
<style>${BASE_CSS}main{max-width:980px;margin:0 auto;padding:28px 22px 60px}h1{font:800 clamp(30px,5vw,46px)/1.1 'Plus Jakarta Sans',system-ui;letter-spacing:-.03em;margin:30px 0 12px}h1 span{background:linear-gradient(135deg,#3D8BFF,#8B5CF6);-webkit-background-clip:text;background-clip:text;color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:30px}h2{font:700 19px 'Plus Jakarta Sans',system-ui;margin-bottom:10px}h3{font:600 14px Inter,system-ui;color:#fff;margin:12px 0 2px}ol{padding-left:20px;color:#cbd5e1;line-height:1.8}.tag{display:inline-block;font-size:12px;letter-spacing:.1em;color:#7aa2ff;margin-bottom:8px}
.me,.card:target{outline:1px solid #4F74FF}.card{scroll-margin-top:24px}.qr{background:#fff;border-radius:14px;padding:12px;width:176px;height:176px}.qr svg{width:100%;height:100%;display:block}.row{display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-top:28px}</style></head>
<body><main>${LOGO}<div class="tag" style="display:block;margin-top:34px">MEDHAIQ &middot; ACCESS ANYWHERE</div><h1>Your career intelligence. <span>Wherever you go.</span></h1>
<p class="mu" style="font-size:18px;max-width:640px">Experience MedhaIQ across desktop, mobile and tablet, with one account and the same reports on every device.</p>
<div class="row"><div class="qr" id="qr" aria-label="QR code for this page"></div><div><p class="mu" style="margin-bottom:14px">Scan with your phone or tablet camera to open this page there.</p><button class="btn" id="inst" type="button" style="display:none">Install MedhaIQ</button><a class="btn" id="open" href="/">Open MedhaIQ</a></div></div>
<div class="grid">
<section class="card" id="desktop" data-p="desktop"><div class="tag">DESKTOP</div><h2>Use it in your browser</h2><p class="mu">Open medhaiq.ai in any modern browser and sign in.</p><h3>Want its own window?</h3><ol><li>In <b>Chrome or Edge</b>, click the install icon in the address bar</li></ol></section>
<section class="card" id="mobile" data-p="mobile"><div class="tag">MOBILE</div><h2>Add it to your phone</h2><h3>iPhone</h3><ol><li>Open this page in <b>Safari</b></li><li>Tap Share, then <b>Add to Home Screen</b></li></ol><h3>Android</h3><ol><li>Open this page in <b>Chrome</b></li><li>Tap <b>Install MedhaIQ</b> above, or menu &rarr; <b>Install app</b></li></ol></section>
<section class="card" id="tablet" data-p="tablet"><div class="tag">IPAD &amp; TABLETS</div><h2>Add it to your tablet</h2><h3>iPad</h3><ol><li>Open this page in <b>Safari</b></li><li>Tap Share, then <b>Add to Home Screen</b></li></ol><h3>Android tablet</h3><ol><li>Open this page in <b>Chrome</b></li><li>Menu &rarr; <b>Install app</b></li></ol></section></div>
<p style="margin-top:30px;font:600 17px 'Plus Jakarta Sans',system-ui">One platform. Every device.</p>
<p class="mu" style="margin-top:6px;font-size:14px">MedhaIQ installs straight from your browser as a web app. There is no App Store or Google Play download.</p></main>
<script src="/pwa/qrcode.js"></script><script src="/js/pwa.js" defer></script>
<script>(function(){try{var q=qrcode(0,'M');q.addData(location.origin+'/install');q.make();document.getElementById('qr').innerHTML=q.createSvgTag({cellSize:4,margin:0,scalable:true})}catch(e){document.getElementById('qr').style.display='none'}
var ua=navigator.userAgent,ipad=/iPad/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1),iph=/iPhone|iPod/.test(ua),and=/Android/.test(ua),p=ipad?'tablet':iph?'mobile':and?(/Mobile/.test(ua)?'mobile':'tablet'):'desktop';
if(!location.hash)document.querySelectorAll('[data-p]').forEach(function(e){if(e.dataset.p===p)e.classList.add('me')});
var b=document.getElementById('inst');function sync(){if(window.MedhaIQPWA&&window.MedhaIQPWA.canInstall())b.style.display='inline-block'}
b.addEventListener('click',function(){window.MedhaIQPWA.install()});addEventListener('mh-installable',sync);setTimeout(sync,1200)})();</script></body></html>`;
}

module.exports = router;
module.exports._pairs = pairs;
