/* MedhaIQ mobile app helper. Loaded ONLY inside the native app (see
   middleware/app-shell.js). Provides: bottom navigation, edge-swipe back,
   sign-in via the phone's real browser (Google/e-mail), external links. */
(function () {
  'use strict';
  var Cap = window.Capacitor || {};
  var P = (Cap.Plugins) || {};
  var path = location.pathname;
  var HANDOFF = '/app/handoff';

  function openExternal(url) {
    if (P.Browser && P.Browser.open) { P.Browser.open({ url: url }); } else { window.open(url, '_blank'); }
  }

  /* ---- sign-in handoff ---- */
  if (path === '/auth/login') {
    var q = new URLSearchParams(location.search);
    if (!q.get('next')) { q.set('next', HANDOFF); location.replace('/auth/login?' + q.toString()); return; }
  }
  function handleDeepLink(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== 'medhaiq:' || u.hostname !== 'auth') return;
      var code = u.searchParams.get('code');
      if (!code) return;
      if (P.Browser && P.Browser.close) { try { P.Browser.close(); } catch (e) {} }
      location.replace('/app/session?code=' + encodeURIComponent(code));
    } catch (e) {}
  }
  if (P.App) {
    if (P.App.addListener) P.App.addListener('appUrlOpen', function (e) { handleDeepLink(e && e.url); });
    if (P.App.getLaunchUrl) P.App.getLaunchUrl().then(function (r) { if (r && r.url) handleDeepLink(r.url); }).catch(function () {});
  }

  /* ---- links: Google sign-in and other sites open in the real browser ---- */
  var STAY = /(^|\.)(medhaiq\.ai|stripe\.com|stripe\.network)$/;
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || ev.defaultPrevented) return;
    var u; try { u = new URL(a.href, location.href); } catch (e) { return; }
    if (u.protocol === 'mailto:' || u.protocol === 'tel:') return;
    if (u.hostname === location.hostname && u.pathname.indexOf('/auth/google') === 0) {
      ev.preventDefault();
      if (!u.searchParams.get('next')) u.searchParams.set('next', HANDOFF);
      openExternal(u.href);
      return;
    }
    if (/^https?:$/.test(u.protocol) && !STAY.test(u.hostname)) { ev.preventDefault(); openExternal(u.href); }
  }, true);

  /* ---- bottom navigation (not on sign-in or the live interview) ---- */
  var HIDE = [/^\/auth\//, /^\/interview\/session\//, /^\/login/];
  var show = !HIDE.some(function (re) { return re.test(path); });
  var TABS = [
    { href: '/', label: 'Home', match: /^\/$/, d: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
    { href: '/explore', label: 'Explore', match: /^\/(explore|professional-horizons)/, d: 'M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5z' },
    { href: '/interview', label: 'Practice', match: /^\/interview(?!\/report)/, d: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4' },
    { href: '/dashboard/reports', label: 'Reports', match: /^\/(dashboard|interview\/report)/, d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
    { href: '/settings', label: 'Profile', match: /^\/(settings|resume)/, d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' }
  ];
  function buildNav() {
    if (!show || document.getElementById('mh-app-nav')) return;
    var nav = document.createElement('nav');
    nav.id = 'mh-app-nav'; nav.setAttribute('aria-label', 'App navigation');
    nav.innerHTML = TABS.map(function (t) {
      var on = t.match.test(path) ? ' aria-current="page" class="on"' : '';
      return '<a href="' + t.href + '"' + on + '><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + t.d + '"/></svg><span>' + t.label + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
    document.documentElement.classList.add('mh-has-app-nav');
    document.addEventListener('focusin', function (e) { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) nav.classList.add('hid'); });
    document.addEventListener('focusout', function () { nav.classList.remove('hid'); });
  }
  if (document.body) buildNav(); else document.addEventListener('DOMContentLoaded', buildNav);

  /* ---- swipe from the left edge = back (iOS has no back button) ---- */
  var sx = null, sy = 0;
  document.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX < 24 ? t.clientX : null; sy = t.clientY; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (sx === null) return; var t = e.changedTouches[0];
    if (t.clientX - sx > 90 && Math.abs(t.clientY - sy) < 60 && history.length > 1 && !/^\/interview\/session\//.test(path)) history.back();
    sx = null;
  }, { passive: true });
})();
