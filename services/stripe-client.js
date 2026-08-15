// services/stripe-client.js
//
// Single configured Stripe SDK client (see routes/stripe.js for the
// checkout + webhook routes that consume this). This file owns nothing
// about MedhaIQ packages, entitlements, or minutes — it is purely the
// Stripe transport. Package resolution stays in
// config/product-packages.js and config/pricing.js, exactly as before
// this integration existed.
//
// Environment-aware: staging accepts ONLY Sandbox (sk_test_) keys and
// refuses live keys; the real production service accepts ONLY LIVE
// (sk_live_) keys and refuses test keys. Which behavior applies is
// decided by IS_LIVE_PRODUCTION — the same canonical flag
// routes/founder.js and lib/pricing-market.js already use to distinguish
// "the real customer-facing deployment" from every other environment
// (staging included, even though staging's NODE_ENV is also
// 'production' — see the comment below for why that matters).
//
// Fails safe, not fail loud — same convention as server.js's DATABASE_URL
// check and middleware/capabilities.js's fails-open handling: a missing
// or wrong-environment key logs clearly and disables the Stripe routes
// rather than crashing the whole app or (worse) silently accepting a
// key that doesn't belong in the environment it was found in.

const Stripe = require('stripe');

const secretKey = process.env.STRIPE_SECRET_KEY || '';

// The ONE canonical production-environment flag already used identically
// by routes/founder.js's blockInProduction and lib/pricing-market.js's
// resolveMarket — deliberately NOT process.env.NODE_ENV, since staging
// also runs with NODE_ENV=production (render.yaml sets it there, and
// IS_LIVE_PRODUCTION is deliberately absent from render.yaml so it can
// never accidentally propagate to staging — it must be set directly on
// the real production Render service's own env vars). No new
// environment-detection mechanism introduced here; this reuses the
// existing one.
const isLiveProduction = process.env.IS_LIVE_PRODUCTION === 'true';

let stripe = null;
let configError = null;

if (!secretKey) {
  configError = 'STRIPE_SECRET_KEY is not set';
} else if (isLiveProduction) {
  // PRODUCTION: require a LIVE key, refuse a Sandbox/test key outright —
  // a test key silently "working" on production would mean real
  // customers completing Checkout against a Sandbox Price/webhook that
  // grants nothing real and charges nothing real. Fail safe instead.
  if (!secretKey.startsWith('sk_live_')) {
    configError = 'STRIPE_SECRET_KEY does not look like a LIVE key (must start with sk_live_) — refusing to initialize on the production service';
  } else {
    stripe = new Stripe(secretKey);
  }
} else {
  // STAGING / any non-production service: require a Sandbox/test key,
  // refuse a LIVE key outright — this is the original safety boundary,
  // preserved exactly as it was. Even if IS_LIVE_PRODUCTION were ever
  // accidentally left unset/false on the real production service, this
  // branch would then require sk_test_ there too, which is still a fail-
  // safe outcome (payments disabled) rather than a live key silently
  // running through Sandbox-only assumptions elsewhere in the code.
  if (!secretKey.startsWith('sk_test_')) {
    configError = 'STRIPE_SECRET_KEY does not look like a Sandbox/test key (must start with sk_test_) — refusing to initialize on a non-production service';
  } else {
    stripe = new Stripe(secretKey);
  }
}

if (configError) {
  // Never logs the actual key value — only the descriptive reason above,
  // which contains no part of the secret itself.
  console.error(`[stripe-client] DISABLED — ${configError}`);
} else {
  console.log(`[stripe-client] ${isLiveProduction ? 'LIVE' : 'Sandbox/test-mode'} Stripe client initialized`);
}

/**
 * True only when a Stripe key matching the CURRENT environment is
 * configured — a Sandbox key on staging, a LIVE key on the real
 * production service (IS_LIVE_PRODUCTION=true). Routes/stripe.js checks
 * this before doing anything and returns a clean error rather than
 * throwing if false.
 */
function isStripeConfigured() {
  return stripe !== null;
}

module.exports = { stripe, isStripeConfigured, configError: () => configError };
