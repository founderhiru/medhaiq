// services/stripe-client.js
//
// Single configured Stripe SDK client — Sandbox/Test-mode ONLY, staging
// integration (see routes/stripe.js for the checkout + webhook routes
// that consume this). This file owns nothing about MedhaIQ packages,
// entitlements, or minutes — it is purely the Stripe transport. Package
// resolution stays in config/product-packages.js and config/pricing.js,
// exactly as before this integration existed.
//
// Fails safe, not fail loud — same convention as server.js's DATABASE_URL
// check and middleware/capabilities.js's fails-open handling: a missing
// or misconfigured key logs clearly and disables the Stripe routes
// rather than crashing the whole app or (worse) silently accepting a
// live key on a staging service.

const Stripe = require('stripe');

const secretKey = process.env.STRIPE_SECRET_KEY || '';

// Deliberately NOT process.env.NODE_ENV — this codebase's established
// reason (see routes/founder.js's blockInProduction, lib/pricing-market.js)
// is that staging also runs with NODE_ENV=production (render.yaml), so
// NODE_ENV can't distinguish "real production" from "staging." This is a
// second, independent guard on top of requiring an `sk_test_` key: even
// if IS_LIVE_PRODUCTION were ever accidentally set to 'true' on this
// staging service, a live key would still be refused below.
const isLiveProductionFlag = process.env.IS_LIVE_PRODUCTION === 'true';

let stripe = null;
let configError = null;

if (!secretKey) {
  configError = 'STRIPE_SECRET_KEY is not set';
} else if (!secretKey.startsWith('sk_test_')) {
  // Refuses ANY non-test key outright, on any environment, regardless of
  // IS_LIVE_PRODUCTION — this integration is Sandbox-only by design, not
  // just "Sandbox on staging."
  configError = 'STRIPE_SECRET_KEY does not look like a Sandbox/test key (must start with sk_test_) — refusing to initialize';
} else if (isLiveProductionFlag) {
  configError = 'IS_LIVE_PRODUCTION=true — refusing to initialize the Stripe Sandbox integration on a live production service';
} else {
  stripe = new Stripe(secretKey);
}

if (configError) {
  console.error(`[stripe-client] DISABLED — ${configError}`);
} else {
  console.log('[stripe-client] Sandbox/test-mode Stripe client initialized');
}

/**
 * True only when a valid Sandbox key is configured and this is not the
 * live production service. Routes/stripe.js checks this before doing
 * anything and returns a clean error rather than throwing if false.
 */
function isStripeConfigured() {
  return stripe !== null;
}

module.exports = { stripe, isStripeConfigured, configError: () => configError };
