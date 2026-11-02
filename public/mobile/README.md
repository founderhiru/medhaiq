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

## Known items needing a decision (see delivery notes)
1. Google sign-in is blocked by Google inside any embedded app browser. Email login works.
2. Apple App Store rule 3.1.1 may require in-app purchase for interview credit packs.
