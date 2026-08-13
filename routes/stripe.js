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
const { createPackageAcquisition, getActivePackageAcquisition } = require('../db/package-acquisitions');
const { PRODUCT_PACKAGES, PACKAGE_TIER_RANK } = require('../config/product-packages');
const { plans: PRICING_PLANS } = require('../config/pricing');

// Explicit whitelist — the ONLY package IDs Stripe checkout will ever
// create a session for or grant from. Adding a package to this list is
// a deliberate, reviewable one-line change, not something a client
// request can influence in any way.
const SUPPORTED_PACKAGE_IDS = ['growth', 'leadership'];

// Which env var holds each PRICE KIND's Sandbox/Test Price ID. Note this
// is keyed by price_kind, not package_id — 'leadership' and
// 'leadership_topup' both grant the SAME entitlement (packageId
// 'leadership', 300 minutes) but are two DIFFERENT purchasable prices:
// 'leadership' is the full package price (Explorer/Growth upgrading, or
// the standing Pricing page CTA), 'leadership_topup' is a cheaper price
// available ONLY to users who already have active Leadership (Buy More
// Minutes' +300 option) — see the server-side eligibility check on the
// /checkout/leadership-topup route below. Never read from anywhere else,
// never accepted from the client.
const PRICE_ENV_VAR_BY_KIND = {
  growth: 'STRIPE_GROWTH_PRICE_ID',
  leadership: 'STRIPE_LEADERSHIP_PRICE_ID',
  leadership_topup: 'STRIPE_LEADERSHIP_TOPUP_PRICE_ID',
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
//
// price_kind === packageId for both routes handled here — the ONE case
// where price_kind differs from packageId is the Leadership top-up route
// immediately below, which is registered BEFORE this param route so
// Express matches it first for that literal path.

router.post('/checkout/leadership-topup', requireAuth, async (req, res) => {
  if (!isStripeConfigured()) {
    console.error('[stripe] leadership-topup checkout requested but Stripe is not configured:', configError());
    return res.status(503).json({ error: 'Payments are temporarily unavailable' });
  }

  // Server-side eligibility gate — the discounted Leadership top-up
  // price is available ONLY to users who ALREADY have active Leadership
  // access. This is an entitlement rule, not a UI-only restriction: a
  // Growth (or Explorer) user calling this endpoint directly, bypassing
  // the UI entirely, is rejected here before any Stripe Checkout Session
  // is ever created — there is nothing for them to complete or replay.
  // Uses the exact same tier-aware resolution
  // (db/package-acquisitions.js's getActivePackageAcquisition) the rest
  // of the app already treats as canonical, so this can never drift from
  // what the Workspace itself shows as the user's current access level.
  const currentActive = await getActivePackageAcquisition(req.user.id);
  if (!currentActive || currentActive.package_id !== 'leadership') {
    return res.status(403).json({ error: 'The Leadership top-up price is only available to existing Leadership customers. Use the standard Leadership purchase instead.' });
  }

  const priceId = process.env[PRICE_ENV_VAR_BY_KIND.leadership_topup];
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`[stripe] ${PRICE_ENV_VAR_BY_KIND.leadership_topup} missing or malformed`);
    return res.status(503).json({ error: 'Payments are temporarily unavailable' });
  }

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        medhaiq_user_id: String(req.user.id),
        // package_id stays 'leadership' — this grants the exact same
        // entitlement as the full-price route (300 minutes, leadership
        // tier), merged into the user's existing pool. price_kind is
        // what tells the webhook which price to cross-check against —
        // see PRICE_ENV_VAR_BY_KIND above.
        package_id: 'leadership',
        price_kind: 'leadership_topup',
      },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?leadership_topup_purchase=cancelled#pricing`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] failed to create leadership-topup checkout session:', err && err.message);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
});

router.post('/checkout/:packageId', requireAuth, async (req, res) => {
  const packageId = req.params.packageId;

  if (!SUPPORTED_PACKAGE_IDS.includes(packageId)) {
    return res.status(400).json({ error: 'Unsupported package' });
  }

  if (!isStripeConfigured()) {
    console.error('[stripe] checkout requested but Stripe is not configured:', configError());
    return res.status(503).json({ error: 'Payments are temporarily unavailable' });
  }

  const priceId = process.env[PRICE_ENV_VAR_BY_KIND[packageId]];
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`[stripe] ${PRICE_ENV_VAR_BY_KIND[packageId]} missing or malformed`);
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
        price_kind: packageId,
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
  // session matches the env-configured price for the price_kind claimed
  // in metadata. Metadata is server-set at session creation and never
  // client-writable, so this can't be forged by a browser — but this
  // check still guards against the metadata and the price ever silently
  // drifting apart (e.g. a future bug in checkout creation), which
  // would otherwise grant the wrong package for what was actually paid.
  //
  // price_kind (not package_id) is what determines the EXPECTED price
  // here, because 'leadership' and 'leadership_topup' are two different
  // prices that both grant the same package_id='leadership' entitlement
  // — see PRICE_ENV_VAR_BY_KIND above. Falls back to packageId itself
  // when price_kind is absent, which preserves the exact old behavior
  // for any session created by code prior to this price_kind field
  // existing (packageId was already the correct lookup key for every
  // price kind that existed before the Leadership top-up was added).
  const priceKind = (session.metadata && session.metadata.price_kind) || packageId;
  const priceEnvVar = PRICE_ENV_VAR_BY_KIND[priceKind];
  if (!priceEnvVar) {
    console.error(`[stripe] session ${session.id} has unrecognized price_kind=${priceKind} — not granting entitlement`);
    return;
  }
  let lineItems;
  try {
    lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  } catch (err) {
    console.error(`[stripe] could not verify line items for session ${session.id}:`, err && err.message);
    return;
  }
  const chargedPriceId = lineItems && lineItems.data && lineItems.data[0] && lineItems.data[0].price && lineItems.data[0].price.id;
  const expectedPriceId = process.env[priceEnvVar];
  if (!chargedPriceId || chargedPriceId !== expectedPriceId) {
    console.error(`[stripe] session ${session.id} price mismatch — metadata claims price_kind=${priceKind} (expected price ${expectedPriceId}) but charged price was ${chargedPriceId} — not granting entitlement`);
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

  // Buy More Minutes: this purchase's own package (packageId above) is
  // NOT necessarily the user's resulting access level — a Leadership
  // user buying a Growth top-up stays Leadership. Read the user's
  // CURRENT resolved package (same tier-first resolution
  // lib/capability-engine.js uses) to word the success message
  // correctly: "is now active" when this purchase matches or exceeds
  // their current access level, "remains active" when they already sit
  // at a higher tier than what was just purchased. Note: if the webhook
  // for THIS purchase hasn't landed yet (rare, sub-second race — same
  // caveat as the rest of this function), this reads the state from
  // just before it, which in the worst case shows slightly stale wording
  // for one page load; the minutes-added number below is always correct
  // regardless, since it comes from static config, not this DB read.
  let accessLevelName = pkgPricingEntry.title;
  let accessLevelIsNewlyEstablished = true;
  try {
    const currentActive = await getActivePackageAcquisition(requestingUserId);
    if (currentActive) {
      const currentPricingEntry = PRICING_PLANS.find((p) => p.id === currentActive.package_id);
      const currentRank = PACKAGE_TIER_RANK[currentActive.package_id] ?? -1;
      const purchasedRank = PACKAGE_TIER_RANK[packageId] ?? -1;
      if (currentPricingEntry) {
        accessLevelName = currentPricingEntry.title;
        accessLevelIsNewlyEstablished = currentRank <= purchasedRank;
      }
    }
  } catch (err) {
    // Falls back to the purchased package's own name/"is now active"
    // wording above — never lets a lookup failure break the success
    // page itself.
    console.error('[stripe] could not resolve current access level for success page:', err && err.message);
  }

  return {
    status: 'paid',
    packageId,
    packageName: pkgPricingEntry.title,
    minutes: pkgDefinition.entitlements.includedMinutes,
    accessLevelName,
    accessLevelIsNewlyEstablished,
  };
}

