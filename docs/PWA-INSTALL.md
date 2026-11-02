# MedhaIQ installable web app (PWA)

Users open medhaiq.ai on any device and install it: iPhone/iPad (Safari: Share > Add to Home Screen),
Android (Chrome: Install), laptop (Chrome/Edge install icon). No app store. Same site everywhere.
Share `https://www.medhaiq.ai/install` (QR code + steps).

## Switch
- ON:  set env `PWA_ENABLED=on` in the Render dashboard (staging first, then production), then restart.
- OFF: remove it (or set anything else). Pages stop carrying the tags, `/install` and sign-in pairing return 404,
  and `/sw.js` serves a self-removing worker, so installed devices clean themselves up on their next visit.

## server.js wiring
1. (already added for the mobile app) `app.use(require('./middleware/app-shell').inject);` - now also handles the PWA tags
2. (already added) `app.use('/app', require('./routes/app-handoff'));`
3. NEW, right after line 2: `app.use(require('./routes/pwa'));`

## Safety
- The service worker never touches pages, APIs, sign-in, the live interview, payments or pairing; it only shows an offline screen.
- Not injected on the live interview page, APIs, admin, founder or debug pages.
- iPhone/iPad e-mail-link sign-in: the installed app shows a 4-digit code; the link opens /pwa/pair/claim where the user types it.

Tests: node tests/pwa.js (32 checks), node tests/app-handoff.js (23), node tests/auth-cookie-security.js (59).
