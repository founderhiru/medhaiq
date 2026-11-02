// middleware/app-shell.js
//
// Adds small helper tags to server-rendered HTML pages. Two independent, additive features:
//
//  1. Native mobile app (user-agent contains "MedhaIQApp/"): in-app navigation bar and login
//     handoff helper (public/js/app-shell.js). See mobile/README.md.
//  2. Installable web app / PWA (only when env PWA_ENABLED=on, default OFF): manifest + home-screen
//     meta tags, service-worker registration, install prompt and installed-app navigation
//     (public/js/pwa.js). Same site for every device; nothing here changes page content.
//
// Never injected on: the live interview page, APIs, admin/founder/debug screens, /pwa/*.
// res.render() calls that pass a callback (PDF/e-mail rendering) are left untouched.
// No view file is edited. Turn the PWA off instantly by removing PWA_ENABLED (or setting it to
// anything but "on"): pages stop carrying the tags and /sw.js serves a self-removing worker.

const APP_UA = /MedhaIQApp\//;
const SKIP = [/^\/interview\/session\//, /^\/api\//, /^\/admin\b/, /^\/founder\b/, /^\/debug\b/, /^\/pwa\//];
const TAGS = '<link rel="stylesheet" href="/css/app-shell.css"><script src="/js/app-shell.js" defer></script>';
const PWA_HEAD = [
  ['rel="manifest"', '<link rel="manifest" href="/manifest.json">'],
  ['name="theme-color"', '<meta name="theme-color" content="#0A0F1E">'],
  ['name="mobile-web-app-capable"', '<meta name="mobile-web-app-capable" content="yes">'],
  ['name="apple-mobile-web-app-capable"', '<meta name="apple-mobile-web-app-capable" content="yes">'],
  ['name="apple-mobile-web-app-title"', '<meta name="apple-mobile-web-app-title" content="MedhaIQ">'],
  ['name="apple-mobile-web-app-status-bar-style"', '<meta name="apple-mobile-web-app-status-bar-style" content="black">'],
  ['sizes="180x180"', '<link rel="apple-touch-icon" sizes="180x180" href="/assets/pwa/apple-touch-icon-180.png">'],
  ['/css/pwa.css', '<link rel="stylesheet" href="/css/pwa.css">'],
];
const PWA_BODY = '<script src="/js/pwa.js" defer></script>';

function pwaEnabled() { return String(process.env.PWA_ENABLED || '').toLowerCase() === 'on'; }
function isAppRequest(req) { return APP_UA.test(String((req.headers && req.headers['user-agent']) || '')); }

// Original API, unchanged: native-app tags before the last </body>.
function injectTags(html) {
  if (typeof html !== 'string' || html.includes('/js/app-shell.js')) return html;
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + TAGS : html.slice(0, i) + TAGS + html.slice(i);
}

function injectPwa(html) {
  if (typeof html !== 'string' || html.includes('/js/pwa.js')) return html;
  const head = PWA_HEAD.filter(([needle]) => !html.includes(needle)).map(([, tag]) => tag).join('');
  const h = html.indexOf('</head>');
  if (h !== -1) html = html.slice(0, h) + head + html.slice(h);
  const b = html.lastIndexOf('</body>');
  return b === -1 ? html + PWA_BODY : html.slice(0, b) + PWA_BODY + html.slice(b);
}

function pick(req) {
  if (isAppRequest(req)) return injectTags;
  if (pwaEnabled()) return injectPwa;
  return null;
}

function inject(req, res, next) {
  const fn = pick(req);
  if (!fn || SKIP.some(re => re.test(req.path))) return next();
  const original = res.render;
  res.render = function appShellRender(view, options, cb) {
    if (typeof options === 'function') { cb = options; options = undefined; }
    if (typeof cb === 'function') return original.call(this, view, options, cb);
    return original.call(this, view, options, (err, html) => {
      if (err) return next(err);
      this.send(fn(html));
    });
  };
  next();
}

module.exports = { inject, isAppRequest, injectTags, injectPwa, pwaEnabled, APP_UA, TAGS, PWA_BODY };
