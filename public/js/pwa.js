/* MedhaIQ installable web app helper. Injected by middleware/app-shell.js only when PWA_ENABLED=on.
   Registers the service worker, offers install (Android/desktop prompt, iPhone/iPad steps),
   shows the bottom navigation when running as an installed app on a touch device, and signs the
   installed app in after an e-mail / Google sign-in (pairing, see routes/pwa.js). */
(function () {
  'use strict';
  var path = location.pathname;
  var ua = navigator.userAgent;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var touch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1;
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  var deferred = null;
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }

  /* ---- service worker ---- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {}); });
  }

  /* ---- install API (used by the /install page and the banner) ---- */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('mh-installable')); maybeBanner(); });
  window.addEventListener('appinstalled', function () { deferred = null; removeBanner(); });
  window.MedhaIQPWA = {
    canInstall: function () { return !!deferred; },
    install: function () { if (!deferred) return Promise.resolve(false); var d = deferred; deferred = null; d.prompt(); return d.userChoice.then(function () { removeBanner(); return true; }); }
  };

  /* ---- install banner (touch devices only, never when already installed) ---- */
  var QUIET = [/^\/auth\//, /^\/interview\/session\//, /^\/install/, /^\/pwa\//];
  var banner = null;
  function removeBanner() { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; }
  function maybeBanner() {
    if (standalone || !touch || banner || QUIET.some(function (re) { return re.test(path); })) return;
    var until = Number(store('mh_install_dismissed') || 0);
    if (until && Date.now() < until) return;
    var iosHint = ios && safari && !deferred;
    if (!deferred && !iosHint) return;
    banner = document.createElement('div');
    banner.id = 'mh-install'; banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', 'Install MedhaIQ');
    banner.innerHTML = '<img src="/assets/pwa/icon-192.png" alt="" width="40" height="40"><div class="t"><b>Install MedhaIQ</b><span>' +
      (iosHint ? 'Tap Share, then Add to Home Screen' : 'Open it like an app, full screen') + '</span></div>' +
      (iosHint ? '' : '<button type="button" class="go">Install</button>') + '<button type="button" class="x" aria-label="Dismiss">&times;</button>';
    document.body.appendChild(banner);
    var go = banner.querySelector('.go'); if (go) go.addEventListener('click', function () { window.MedhaIQPWA.install(); });
    banner.querySelector('.x').addEventListener('click', function () { store('mh_install_dismissed', String(Date.now() + 14 * 864e5)); removeBanner(); });
  }
  function ready(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () { setTimeout(maybeBanner, 4000); });

  /* ---- bottom navigation: installed app on a touch device ---- */
  var HIDE = [/^\/auth\//, /^\/interview\/session\//, /^\/login/, /^\/pwa\//, /^\/install/];
  var TABS = [
    { href: '/', label: 'Home', match: /^\/$/, d: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
    { href: '/explore', label: 'Explore', match: /^\/(explore|professional-horizons)/, d: 'M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5z' },
    { href: '/interview', label: 'Practice', match: /^\/interview(?!\/report)/, d: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4' },
    { href: '/dashboard/reports', label: 'Reports', match: /^\/(dashboard|interview\/report)/, d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
    { href: '/settings', label: 'Profile', match: /^\/(settings|resume)/, d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' }
  ];
  if (standalone && touch && !HIDE.some(function (re) { return re.test(path); })) {
    ready(function () {
      if (document.getElementById('mh-pwa-nav')) return;
      var nav = document.createElement('nav'); nav.id = 'mh-pwa-nav'; nav.setAttribute('aria-label', 'App navigation');
      nav.innerHTML = TABS.map(function (t) {
        var on = t.match.test(path) ? ' aria-current="page" class="on"' : '';
        return '<a href="' + t.href + '"' + on + '><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + t.d + '"/></svg><span>' + t.label + '</span></a>';
      }).join('');
      document.body.appendChild(nav); document.documentElement.classList.add('mh-has-pwa-nav');
      document.addEventListener('focusin', function (e) { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) nav.classList.add('hid'); });
      document.addEventListener('focusout', function () { nav.classList.remove('hid'); });
    });
  }

  /* ---- edge swipe = back, in the installed app (iOS has no back button) ---- */
  if (standalone && touch) {
    var sx = null, sy = 0;
    document.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX < 24 ? t.clientX : null; sy = t.clientY; }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (sx === null) return; var t = e.changedTouches[0];
      if (t.clientX - sx > 90 && Math.abs(t.clientY - sy) < 60 && history.length > 1 && !/^\/interview\/session\//.test(path)) history.back();
      sx = null;
    }, { passive: true });
  }

  /* ---- "Get the MedhaIQ App" entry points: site footer + home hero (hidden once installed) ---- */
  function addEntryPoints() {
    if (standalone) return;
    var faq = document.querySelector('.mh-footer-link[href="/faq"]');
    if (faq && !document.getElementById('mh-app-link-footer')) {
      var f = document.createElement('a');
      f.id = 'mh-app-link-footer'; f.href = '/install'; f.className = 'mh-footer-link'; f.textContent = 'Get the MedhaIQ App';
      faq.parentNode.insertBefore(f, faq.nextSibling);
    }
    var act = document.querySelector('.mh-hero-actions');
    if (act && !document.getElementById('mh-app-link-hero')) {
      var h = document.createElement('a');
      h.id = 'mh-app-link-hero'; h.href = '/install'; h.className = 'mh-app-cta';
      h.innerHTML = '<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg></span>' +
        '<span class="tx"><b>Get the MedhaIQ App</b><span>Take your career intelligence with you.</span></span><span class="ar" aria-hidden="true">&rarr;</span>';
      act.parentNode.insertBefore(h, act.nextSibling);
    }
  }
  ready(addEntryPoints);

  /* ---- sign-in pairing: installed app only, on the sign-in page ---- */
  if (standalone && path === '/auth/login') pairing();
  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}), credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  function pairing() {
    var q = new URLSearchParams(location.search), next = q.get('next') || '';
    var mine = null; try { mine = JSON.parse(store('mh_pair') || 'null'); } catch (e) {}
    if (next.indexOf('/pwa/pair/claim') !== 0) {
      post('/pwa/pair/start', { to: next || undefined }).then(function (p) {
        if (!p || !p.id) return;
        store('mh_pair', JSON.stringify({ id: p.id, secret: p.secret, code: p.code, exp: Date.now() + p.expiresIn * 1000 }));
        q.set('next', '/pwa/pair/claim?id=' + p.id); location.replace('/auth/login?' + q.toString());
      }).catch(function () {});
      return;
    }
    var id = next.split('id=')[1] || '';
    if (!mine || mine.id !== id || mine.exp < Date.now()) return;
    ready(function () {
      var box = document.createElement('div'); box.id = 'mh-pair';
      box.innerHTML = '<b>Signing in to the app</b><span>After you tap the link in your email (or finish Google sign-in), enter this code when asked:</span><code>' + mine.code + '</code>';
      document.body.appendChild(box);
    });
    var timer = setInterval(function () {
      if (Date.now() > mine.exp) { clearInterval(timer); return; }
      post('/pwa/pair/poll', { id: mine.id, secret: mine.secret }).then(function (j) {
        if (j && j.ok) { clearInterval(timer); store('mh_pair', null); location.replace(j.redirect || '/dashboard/history'); }
        else if (j && j.expired) { clearInterval(timer); store('mh_pair', null); }
      }).catch(function () {});
    }, 2500);
  }
})();
