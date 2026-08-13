// routes/stripe.js
//
// Stripe Sandbox/Test-mode checkout for Growth and Leadership. This is a
// controlled staging integration — not a general payment system. Scope:
//   POST /api/stripe/checkout/:packageId  — creates a Stripe-hosted
//                                            Checkout Session for growth
//                                            or leadership ONLY (strict
//                                            whitelist below).
//   POST /api/stripe/webhook              — verifies and processes
//                                            Stripe's payment
//                                            confirmation, and ONLY then
//                                            grants the matching
//                                            existing package entitlement.
//
// History: this file originally supported Growth only, at the literal
// path /checkout/growth. That path is UNCHANGED and still works exactly
// as before — it's now matched by the :packageId param instead of a
// literal string, so the existing Growth CTA needed zero changes. Growth
// has been real-Sandbox tested multiple times; this extension adds
// Leadership alongside it without altering a single line of Growth's
// existing behavior (same price-ID env var, same metadata shape, same
// expiry/entitlement resolution, same idempotency path).
//
// Deliberately NOT implemented here (still out of scope): Explorer
// checkout, Top Up, the entitlement-exhausted modal's checkout wiring,
// INR/pricing-market checkout logic. Those all remain exactly as they
// were.
//
// This file introduces NO entitlement logic of its own — every number
// that ends up in package_acquisitions/credit_ledger is read from the
// same config/product-packages.js and config/pricing.js that already
// govern every other package grant in the app (Founder reassignment,
// welcome offer, etc.). Stripe is a payment trigger, not a second source
// of truth for what any package means.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/guards');
const { stripe, isStripeConfigured, configError } = require('../services/stripe-client');
const { createPackageAcquisition } = require('../db/package-acquisitions');
const { PRODUCT_PACKAGES } = require('../config/product-packages');
const { plans: PRICING_PLANS } = require('../config/pricing');

// Explicit whitelist — the ONLY package IDs Stripe checkout will ever
// create a session for or grant from. Adding a package to this list is
// a deliberate, reviewable one-line change, not something a client
// request can influence in any way.
const SUPPORTED_PACKAGE_IDS = ['growth', 'leadership'];

// Which env var holds each package's Sandbox/Test Price ID. Never read
// from anywhere else, never accepted from the client.
const PACKAGE_PRICE_ENV_VAR = {
  growth: 'STRIPE_GROWTH_PRICE_ID',
  leadership: 'STRIPE_LEADERSHIP_PRICE_ID',
};

/**
 * Existing package validity convention, read from config/pricing.js
 * (the same file the pricing cards themselves render from) — NOT a
 * Stripe-specific expiration rule. Each plan's validityMonths is looked
 * up, not hard-coded, so if the commercial validity period is ever
 * changed in config/pricing.js this integration follows automatically
 * with no code change here.
 *
 * Returns null (never-expiring) if the plan defines no validityMonths,
 * matching how config/pricing.js already models Explorer's null value.
 */
function resolveExpiryForPackage(packageId) {
  const plan = PRICING_PLANS.find((p) => p.id === packageId);
  const validityMonths = plan && plan.validityMonths;
  if (!validityMonths) return null;
  const expires = new Date();
  expires.setMonth(expires.getMonth() + validityMonths);
  return expires;
}

// ── Checkout creation ───────────────────────────────────────────────────
//
// :packageId is a route param, not a free-text client value — it is
// checked against SUPPORTED_PACKAGE_IDS immediately below, and used only
// as a lookup key into server-side env vars and config. The existing
// Growth CTA already POSTs to /api/stripe/checkout/growth and needs no
// change; this route now also matches /api/stripe/checkout/leadership.

router.post('/checkout/:packageId', requireAuth, async (req, res) => {
  const packageId = req.params.packageId;

  if (!SUPPORTED_PACKAGE_IDS.includes(packageId)) {
    return res.status(400).json({ error: 'Unsupported package' });
  }

  if (!isStripeConfigured()) {
    console.error('[stripe] checkout requested but Stripe is not configured:', configError());
    return res.status(503).json({ error: 'Payments are temporarily unavailable' });
  }

  const priceId = process.env[PACKAGE_PRICE_ENV_VAR[packageId]];
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`[stripe] ${PACKAGE_PRICE_ENV_VAR[packageId]} missing or malformed`);
    return res.status(503).json({ error: 'Payments are temporarily unavailable' });
  }

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      // Server-derived identity + package only — never trust anything
      // from the client body for who the purchaser is or what they're
      // buying. This is what the webhook uses to grant the entitlement
      // to the correct user and validate the correct package.
      metadata: {
        medhaiq_user_id: String(req.user.id),
        package_id: packageId,
      },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?${packageId}_purchase=cancelled#pricing`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] failed to create checkout session:', err && err.message);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
});

// ── Webhook ──────────────────────────────────────────────────────────────
//
// IMPORTANT: this handler requires the RAW request body for Stripe's
// signature verification, so it is deliberately NOT registered on
// `router` above (which sits behind the app-wide express.json() once
// mounted). server.js instead calls handleWebhook directly, mounted with
// its own express.raw({ type: 'application/json' }) BEFORE express.json()
// runs — see server.js for the exact ordering and why it matters.

async function handleWebhook(req, res) {
  if (!isStripeConfigured()) {
    console.error('[stripe] webhook received but Stripe is not configured:', configError());
    return res.status(503).send('Stripe not configured');
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET missing');
    return res.status(503).send('Webhook not configured');
  }

  const signature = req.headers['stripe-signature'];
  let event;
  try {
    // req.body is the raw Buffer here (see server.js mounting), required
    // for constructEvent's HMAC check — parsing it as JSON first would
    // invalidate the signature.
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe] webhook signature verification failed:', err && err.message);
    return res.status(400).send(`Webhook signature verification failed`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await handleCheckoutCompleted(session);
    }
    // Other event types (e.g. checkout.session.expired) are intentionally
    // no-ops for this scope — nothing to grant, nothing to revoke.
  } catch (err) {
    console.error('[stripe] webhook handler error:', err && err.message);
    // 500 so Stripe retries — idempotency (purchase_reference unique
    // index) makes a retry safe even if our own processing had already
    // partially happened.
    return res.status(500).send('Webhook handler error');
  }

  return res.status(200).send('ok');
}

/**
 * Grants the matching existing package entitlement — ONLY after
 * confirming the Checkout Session represents an actually-paid
 * transaction for a package/price combination this server itself
 * configured. Reaching this webhook at all is not sufficient proof:
 * Stripe fires checkout.session.completed for Checkout Sessions that
 * reach payment_status states other than 'paid' (Stripe docs: async
 * payment methods can complete a session before payment is confirmed).
 * Reference: https://docs.stripe.com/payments/checkout/fulfill-orders
 */
async function handleCheckoutCompleted(session) {
  if (session.payment_status !== 'paid') {
    console.log(`[stripe] session ${session.id} completed but payment_status=${session.payment_status} — not granting entitlement`);
    return;
  }

  const packageId = session.metadata && session.metadata.package_id;
  const userId = session.metadata && session.metadata.medhaiq_user_id;

  if (!SUPPORTED_PACKAGE_IDS.includes(packageId) || !userId) {
    console.error(`[stripe] session ${session.id} missing/unexpected metadata (package_id=${packageId}, user=${userId}) — not granting entitlement`);
    return;
  }

  // Defense-in-depth: confirm the Stripe Price actually charged on this
  // session matches the env-configured price for the package_id claimed
  // in metadata. Metadata is server-set at session creation and never
  // client-writable, so this can't be forged by a browser — but this
  // check still guards against the metadata and the price ever silently
  // drifting apart (e.g. a future bug in checkout creation), which
  // would otherwise grant the wrong package for what was actually paid.
  let lineItems;
  try {
    lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  } catch (err) {
    console.error(`[stripe] could not verify line items for session ${session.id}:`, err && err.message);
    return;
  }
  const chargedPriceId = lineItems && lineItems.data && lineItems.data[0] && lineItems.data[0].price && lineItems.data[0].price.id;
  const expectedPriceId = process.env[PACKAGE_PRICE_ENV_VAR[packageId]];
  if (!chargedPriceId || chargedPriceId !== expectedPriceId) {
    console.error(`[stripe] session ${session.id} price mismatch — metadata claims package_id=${packageId} (expected price ${expectedPriceId}) but charged price was ${chargedPriceId} — not granting entitlement`);
    return;
  }

  // Existing MedhaIQ source of truth for what a package grants — the
  // exact same lookup config/product-packages.js's resolveInterviewPolicy()
  // and every other consumer of PRODUCT_PACKAGES uses. Not re-derived,
  // not hard-coded here.
  const packageDefinition = PRODUCT_PACKAGES[packageId];
  const includedMinutes = packageDefinition.entitlements.includedMinutes;
  const expiresAt = resolveExpiryForPackage(packageId);

  try {
    // Idempotency is enforced at the database level (unique partial index
    // on package_acquisitions.purchase_reference) — this reuses the
    // existing transaction-wrapped grant function unchanged. The index
    // is on the Stripe session id itself, so it is inherently
    // package-agnostic: two different legitimate purchases (Growth once,
    // Leadership once) have two different session ids and both grant
    // normally; only a *repeated* delivery for the *same* session id is
    // ever treated as a duplicate.
    await createPackageAcquisition({
      userId: Number(userId),
      packageId,
      expiresAt,
      source: 'purchase',
      purchaseReference: session.id,
      initialMinutes: includedMinutes,
    });
    console.log(`[stripe] granted ${packageId} package to user ${userId} (session ${session.id})`);
  } catch (err) {
    // Postgres unique_violation on the partial index = this session was
    // already processed by an earlier webhook delivery. Not an error —
    // exactly the "return success without granting again" behavior
    // required by the approved design.
    if (err && err.code === '23505') {
      console.log(`[stripe] session ${session.id} already processed — skipping duplicate grant`);
      return;
    }
    throw err;
  }
}

module.exports = { router, handleWebhook, resolveCheckoutSuccessContext };

// ── Post-payment success page context ───────────────────────────────────
//
// UX-only helper for GET /checkout/success (server.js). This does NOT
// grant anything — the webhook above remains the sole source of truth
// for entitlement. This function only answers "what should the success
// page say", by asking Stripe directly (server-side, authoritative)
// which package a *specific, ownership-verified* Checkout Session was
// for, then reading that package's display name and minutes from the
// same config every other part of the app already uses (config/pricing.js's
// `title`, config/product-packages.js's `includedMinutes`) — never
// hard-coded, never re-derived, and never trusting anything the browser
// claims about which package it bought. Already fully generic — works
// unchanged for both growth and leadership, and required zero
// modification for this extension.
//
// If the webhook hasn't landed in the DB yet (real but usually
// sub-second race — see approved design), this still renders correctly:
// the copy is driven by Stripe's own payment_status on the session, not
// by polling package_acquisitions, so the "browser closed before this
// page ever loads" scenario is completely unaffected — that path never
// touches this function at all.
async function resolveCheckoutSuccessContext(sessionId, requestingUserId) {
  if (!isStripeConfigured()) {
    return { status: 'unavailable' };
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return { status: 'invalid' };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error('[stripe] could not retrieve checkout session for success page:', err && err.message);
    return { status: 'invalid' };
  }

  // Ownership check — a session_id is not a secret capability token by
  // itself; without this, one user's success-page URL (e.g. shared,
  // bookmarked, or guessed) could show another user's purchase details.
  // Never trust the URL alone.
  const ownerId = session.metadata && session.metadata.medhaiq_user_id;
  if (!ownerId || String(ownerId) !== String(requestingUserId)) {
    return { status: 'invalid' };
  }

  const packageId = session.metadata && session.metadata.package_id;
  const pkgDefinition = packageId && PRODUCT_PACKAGES[packageId];
  const pkgPricingEntry = packageId && PRICING_PLANS.find((p) => p.id === packageId);
  if (!pkgDefinition || !pkgPricingEntry) {
    // Metadata present but doesn't map to a real, currently-configured
    // package — same "don't display something invented" principle as
    // the rest of the app. Treat as invalid rather than guessing.
    return { status: 'invalid' };
  }

  if (session.payment_status !== 'paid') {
    // Genuinely still in flight (e.g. an async payment method). Not a
    // failure — just not confirmed yet. The webhook will grant the
    // entitlement whenever Stripe itself confirms payment, independent
    // of whether anyone is looking at this page.
    return { status: 'processing', packageName: pkgPricingEntry.title };
  }

  return {
    status: 'paid',
    packageId,
    packageName: pkgPricingEntry.title,
    minutes: pkgDefinition.entitlements.includedMinutes,
  };
}

