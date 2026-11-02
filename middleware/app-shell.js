// middleware/app-shell.js
//
// MedhaIQ mobile app support (additive; see mobile/README.md).
// The native app identifies itself with a "MedhaIQApp/<version>" user-agent
// suffix (capacitor.config.json -> appendUserAgent). For those requests ONLY,
// this middleware adds one stylesheet + one script tag to server-rendered
// HTML pages: the in-app navigation bar and the app login handoff helper.
// Normal browser visitors are never affected, and no view file is edited.
//
// Deliberately skipped: the live interview page (frozen, fragile), APIs,
// admin and founder screens. Calls to res.render() that pass a callback
// (e.g. PDF/e-mail rendering) are left untouched.

const APP_UA = /MedhaIQApp\//;
const SKIP = [/^\/interview\/session\//, /^\/api\//, /^\/admin\b/, /^\/founder\b/, /^\/debug\b/];
const TAGS = '<link rel="stylesheet" href="/css/app-shell.css"><script src="/js/app-shell.js" defer></script>';

function isAppRequest(req) {
  return APP_UA.test(String((req.headers && req.headers['user-agent']) || ''));
}

function injectTags(html) {
  if (typeof html !== 'string' || html.includes('/js/app-shell.js')) return html;
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + TAGS : html.slice(0, i) + TAGS + html.slice(i);
}

function inject(req, res, next) {
  if (!isAppRequest(req) || SKIP.some(re => re.test(req.path))) return next();
  const original = res.render;
  res.render = function appShellRender(view, options, cb) {
    if (typeof options === 'function') { cb = options; options = undefined; }
    if (typeof cb === 'function') return original.call(this, view, options, cb);
    return original.call(this, view, options, (err, html) => {
      if (err) return next(err);
      this.send(injectTags(html));
    });
  };
  next();
}

module.exports = { inject, isAppRequest, injectTags, APP_UA, TAGS };
