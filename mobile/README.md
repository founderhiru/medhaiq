# MedhaIQ Mobile (iPhone, iPad, Android)

A native app shell that opens the live MedhaIQ platform (https://www.medhaiq.ai) full-screen.
Because it loads the real site, every page, the live voice interview, reports, Stripe
checkout and account screens are identical to the website and update the moment the site
updates. No page or feature is re-implemented, so nothing can drift or break.

What is native: app icon, splash screen (brand navy + logo), status bar, offline screen,
microphone/camera permission prompts, iPad support, external links open in the system browser.

## Folder
- `capacitor.config.json` - app id `ai.medhaiq.app`, live URL, allowed domains, colours
- `www/` - launch + offline screen (only shown while connecting / if offline)
- `resources/` - icon and splash source images (from the MedhaIQ brand mark)
- `scripts/native-setup.mjs` - adds mic/camera/iPad settings to the generated projects
- `../.github/workflows/mobile-android.yml` - builds the Android APK in the cloud

## Android (no computer setup)
1. GitHub -> Actions -> "MedhaIQ Mobile - Android build" -> Run workflow.
2. When green, open the run -> Artifacts -> download `MedhaIQ-android-debug-apk`.
3. Send the APK to an Android phone/tablet and install it.
For Play Store you need a signed release build (Play Console account, USD 25 one-time).

## iPhone / iPad
Needs a Mac with Xcode and an Apple Developer account (USD 99/year) for TestFlight/App Store:
`cd mobile && npm ci && npm run add:ios && npm run assets -- --ios && npx cap open ios`
Quickest option with no Apple account: open medhaiq.ai in Safari -> Share -> Add to Home Screen.

## Sign-in (same Google + e-mail flows as the website)
Google refuses sign-in inside embedded app browsers, and e-mail links open the phone browser. So in the app
both flows run in the phone's real browser and return to the app through a one-time code:
`/app/handoff` (phone browser) -> `medhaiq://auth?code=...` -> `/app/session` (inside the app, issues the
normal signed cookie). Server files: `routes/app-handoff.js`, `middleware/app-shell.js`.
App-only helpers (bottom navigation, edge-swipe back) load from `public/js/app-shell.js` and
`public/css/app-shell.css`; they are injected ONLY when the user-agent contains `MedhaIQApp/`, so the website
for normal visitors is unchanged, and never on the live interview page.

## Server wiring (2 lines in server.js)
1. After `app.use(require('./middleware/capabilities'));` add:
   `app.use(require('./middleware/app-shell').inject);`
2. After the `app.use('/api/feedback', ...)` line add:
   `app.use('/app', require('./routes/app-handoff'));`
Test: `node tests/app-handoff.js` (23 checks).

## Open items
1. Apple App Store rule 3.1.1 may require in-app purchase for interview credit packs.
2. The custom link `medhaiq://` can in theory be claimed by another app; codes are single-use and expire in 2 minutes.
   Universal Links / App Links are the stronger follow-up once the store accounts exist.
3. Report PDF download inside the app needs a check on a real phone.
