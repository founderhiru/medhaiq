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
// checkout, the entitlement-exhausted modal's checkout wiring.
//
// ALL FOUR purchase types below (growth, leadership, growth_topup,
// leadership_topup) are market-aware, via lib/pricing-market.js's
// existing resolveMarket() — see resolvePriceEnvVar() below. This used
// to be two different systems (a single-price lookup for the two full
// packages, a market-aware lookup for the two top-ups); they are now
// ONE unified lookup, keyed by price_kind + market, covering all four —
// the "old: package → one Price ID, new: package + market → correct
// Price ID" generalization applied uniformly rather than leaving an
// inconsistency between package and top-up checkout.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/guards');
const { stripe, isStripeConfigured, configError } = require('../services/stripe-client');
const { createPackageAcquisition, getActivePackageAcquisition } = require('../db/package-acquisitions');
const { PRODUCT_PACKAGES, PACKAGE_TIER_RANK } = require('../config/product-packages');
const { plans: PRICING_PLANS } = require('../config/pricing');
const { resolveMarket } = require('../lib/pricing-market');
const { getUserById } = require('../db/auth');
const { sendFounderPurchaseNotification } = require('../services/email');

// Explicit whitelist — the ONLY package IDs Stripe checkout will ever
// create a session for or grant from. Adding a package to this list is
// a deliberate, reviewable one-line change, not something a client
// request can influence in any way.
const SUPPORTED_PACKAGE_IDS = ['growth', 'leadership'];

// Which env var holds the Sandbox/Test Price ID for a given price_kind +
// market combination. Four price_kinds × two markets = the 8 Stripe
// Prices this app now uses (4 Products — Growth, Leadership, +120,
// +300 — × 2 currencies each). Never read from anywhere else, never
// accepted from the client. The two full-package kinds ('growth',
// 'leadership') and the two top-up kinds ('growth_topup',
// 'leadership_topup') are commercially distinct products (confirmed:
// ₹699/$12 top-up vs ₹999/$19 full Growth; ₹1,999/$29 top-up vs
// ₹2,999/$49 full Leadership) — never allowed to fall back to or be
// confused with each other.
const MARKET_PRICE_ENV_VAR = {
  growth: { india: 'STRIPE_GROWTH_PRICE_ID_INR', international: 'STRIPE_GROWTH_PRICE_ID_USD' },
  leadership: { india: 'STRIPE_LEADERSHIP_PRICE_ID_INR', international: 'STRIPE_LEADERSHIP_PRICE_ID_USD' },
  growth_topup: { india: 'STRIPE_GROWTH_TOPUP_PRICE_ID_INR', international: 'STRIPE_GROWTH_TOPUP_PRICE_ID_USD' },
  leadership_topup: { india: 'STRIPE_LEADERSHIP_TOPUP_PRICE_ID_INR', international: 'STRIPE_LEADERSHIP_TOPUP_PRICE_ID_USD' },
};

/**
 * Resolves which env var holds the correct Price ID for this price_kind
 * + market. Market is resolved ONCE, at checkout-creation time, from the
 * real inbound request (lib/pricing-market.js's resolveMarket — logged-
 * in user's stable market, then geo header, then safe default) and
 * stored in the Checkout Session's metadata; the webhook (which has no
 * HTTP request of its own — it's a server-to-server call from Stripe,
 * with no geo header to read) reads that stored market back rather than
 * re-resolving it, so the price the webhook validates against is always
 * the exact same one actually shown/charged at checkout time, never a
 * value that could have drifted between request and webhook delivery.
 */
function resolvePriceEnvVar(priceKind, market) {
  const byMarket = MARKET_PRICE_ENV_VAR[priceKind];
  return byMarket && byMarket[market];
}

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

router.post('/checkout/growth-topup', requireAuth, async (req, res) => {
  if (!isStripeConfigured()) {
    console.error('[stripe] growth-topup checkout requested but Stripe is not configured:', configError());
    return res.status(503).json({ error: 'Payments are temporarily unavailable' });
  }

  // Server-side eligibility gate — the +120 top-up is available to
  // anyone at Growth tier or above (Growth or Leadership); Explorer must
  // purchase a real package first, per the approved eligibility rule.
  // Same tier-aware resolution as the Leadership top-up gate below.
  const currentActive = await getActivePackageAcquisition(req.user.id);
  const currentRank = PACKAGE_TIER_RANK[currentActive && currentActive.package_id] ?? -1;
  if (currentRank < PACKAGE_TIER_RANK.growth) {
    return res.status(403).json({ error: 'AI Minute top-ups are only available to Growth or Leadership customers. Purchase a package first.' });
  }

  // Currency/market resolved ONCE here, from the real request
  // (lib/pricing-market.js's existing resolveMarket — logged-in user's
  // stable market, then geo header, then safe default), and stored in
  // the session metadata so the webhook validates against the exact
  // same price actually shown/charged, never re-resolving it later.
  const market = resolveMarket(req, req.user);
  const priceEnvVarName = resolvePriceEnvVar('growth_topup', market);
  const priceId = priceEnvVarName && process.env[priceEnvVarName];
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`[stripe] ${priceEnvVarName || 'growth top-up price env var'} missing or malformed (market=${market})`);
    return res.status(503).json({ error: 'Payments are temporarily unavailable' });
  }

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        medhaiq_user_id: String(req.user.id),
        // package_id is the ENTITLEMENT this grants (growth, 120
        // minutes, merged into the user's existing pool) — separate
        // from price_kind (which price funnel) and market (which
        // currency was actually charged), both needed by the webhook's
        // price cross-check.
        package_id: 'growth',
        price_kind: 'growth_topup',
        market,
      },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?growth_topup_purchase=cancelled#pricing`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] failed to create growth-topup checkout session:', err && err.message);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
});

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

  const market = resolveMarket(req, req.user);
  const priceEnvVarName = resolvePriceEnvVar('leadership_topup', market);
  const priceId = priceEnvVarName && process.env[priceEnvVarName];
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`[stripe] ${priceEnvVarName || 'leadership top-up price env var'} missing or malformed (market=${market})`);
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
        // tier), merged into the user's existing pool. price_kind +
        // market together are what tell the webhook which exact price
        // to cross-check against — see MARKET_PRICE_ENV_VAR above.
        package_id: 'leadership',
        price_kind: 'leadership_topup',
        market,
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

  // Market-aware as of this change (previously single-price, see file
  // header) — resolved the same way as the two top-up routes, so a
  // visitor sees and is charged the exact currency the Pricing page
  // itself already showed them (both now read from the same
  // resolveMarket() call shape).
  const market = resolveMarket(req, req.user);
  const priceEnvVarName = resolvePriceEnvVar(packageId, market);
  const priceId = priceEnvVarName && process.env[priceEnvVarName];
  if (!priceId || !priceId.startsWith('price_')) {
    console.error(`[stripe] ${priceEnvVarName || 'price env var'} missing or malformed (packageId=${packageId}, market=${market})`);
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
        market,
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
  // session matches the env-configured price for the price_kind + market
  // claimed in metadata. Metadata is server-set at session creation and
  // never client-writable, so this can't be forged by a browser — but
  // this check still guards against the metadata and the price ever
  // silently drifting apart (e.g. a future bug in checkout creation),
  // which would otherwise grant the wrong package for what was actually
  // paid.
  //
  // ALL FOUR price kinds ('growth', 'leadership', 'growth_topup',
  // 'leadership_topup') now resolve through the same market-aware
  // MARKET_PRICE_ENV_VAR lookup — this used to be two different systems
  // (full packages single-price, top-ups market-aware); unified here so
  // there is exactly one price-resolution code path to validate against,
  // not two. Market is read back from metadata (set once, at checkout-
  // creation time, from the real request) rather than re-resolved here,
  // since a webhook delivery has no HTTP request/geo header of its own
  // to resolve from, and must validate against the exact price that was
  // actually shown/charged.
  const priceKind = (session.metadata && session.metadata.price_kind) || packageId;
  const market = session.metadata && session.metadata.market;
  if (!market || !['india', 'international'].includes(market)) {
    console.error(`[stripe] session ${session.id} has missing/invalid market metadata (market=${market}) — not granting entitlement`);
    return;
  }
  const priceEnvVar = resolvePriceEnvVar(priceKind, market);
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

  // ── Revenue architecture: capture the ACTUAL Stripe transaction, never
  // derive revenue from users.market or config/pricing.js's configured
  // list price. session.amount_total/session.currency are the real
  // customer-facing charge (already in scope, no extra call needed) —
  // that's original_amount/original_currency. The USD-normalized
  // settlement amount only exists on the Balance Transaction, one level
  // deeper than anything fetched so far, so one additional read-only
  // Stripe call is made here.
  //
  // Non-fatal by design: if this fails, or the Balance Transaction isn't
  // settled yet (Stripe can lag fractionally behind webhook delivery),
  // amount_usd/stripe_fee_usd are left NULL — the entitlement is still
  // granted normally (a candidate's access must never depend on revenue
  // bookkeeping succeeding), and the row becomes visible to
  // getAcquisitionsPendingRevenueReconciliation() for a later retry. Never
  // estimated, never substituted with the package's list price.
  const paymentIntentId = session.payment_intent || null;
  const originalAmount = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;
  const originalCurrency = session.currency ? session.currency.toUpperCase() : null;
  let chargeId = null;
  let balanceTransactionId = null;
  let amountUsd = null;
  let stripeFeeUsd = null;

  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
      });
      const charge = pi.latest_charge;
      chargeId = charge ? charge.id : null;
      const balanceTransaction = charge && charge.balance_transaction;
      if (balanceTransaction && typeof balanceTransaction === 'object') {
        balanceTransactionId = balanceTransaction.id;
        // Only trust this as amount_usd if the settlement currency really
        // is USD — if this Stripe account ever settles in something else,
        // leave it NULL (pending reconciliation) rather than mislabel a
        // non-USD figure as amount_usd.
        if (balanceTransaction.currency === 'usd') {
          amountUsd = balanceTransaction.amount / 100;
          stripeFeeUsd = balanceTransaction.fee / 100;
        } else {
          console.warn(`[stripe][revenue] session ${session.id}: balance_transaction settled in ${balanceTransaction.currency}, not usd — leaving amount_usd NULL rather than mislabeling it`);
        }
      } else {
        console.warn(`[stripe][revenue] session ${session.id}: balance_transaction not yet available at webhook time — amount_usd left NULL, pending reconciliation`);
      }
    } catch (err) {
      console.error(`[stripe][revenue] session ${session.id}: could not retrieve PaymentIntent/BalanceTransaction (non-fatal — entitlement still granted, revenue pending reconciliation):`, err && err.message);
    }
  }

  try {
    // Idempotency is enforced at the database level (unique partial index
    // on package_acquisitions.purchase_reference) — this reuses the
    // existing transaction-wrapped grant function unchanged. The index
    // is on the Stripe session id itself, so it is inherently
    // package-agnostic: two different legitimate purchases (Growth once,
    // Leadership once) have two different session ids and both grant
    // normally; only a *repeated* delivery for the *same* session id is
    // ever treated as a duplicate.
    const acquisitionRow = await createPackageAcquisition({
      userId: Number(userId),
      packageId,
      expiresAt,
      source: 'purchase',
      purchaseReference: session.id,
      initialMinutes: includedMinutes,
      paymentIntentId,
      chargeId,
      balanceTransactionId,
      originalAmount,
      originalCurrency,
      amountUsd,
      stripeFeeUsd,
    });
    console.log(`[stripe] granted ${packageId} package to user ${userId} (session ${session.id})`);

    // Founder notification — only reached after a genuinely NEW,
    // successfully-inserted acquisition row (the try block above throws
    // on a duplicate session, caught below, which returns before this
    // line ever runs — no notification on a retried/duplicate webhook).
    // Fire-and-forget: sendFounderPurchaseNotification() attaches its
    // own .catch() internally, so a delivery failure here can never turn
    // into a webhook 500 (which would otherwise trigger a Stripe retry
    // of an already-successful grant).
    //
    // Name/email come from the canonical users table (not
    // session.customer_details), per the same "package_acquisitions /
    // users table = source of truth" principle used everywhere else in
    // this codebase.
    getUserById(Number(userId)).then((user) => {
      const plan = PRICING_PLANS.find((p) => p.id === packageId);
      sendFounderPurchaseNotification({
        name: user && user.name,
        email: user ? user.email : null,
        packageId,
        packageLabel: plan && plan.title,
        includedMinutes,
        amountTotal: session.amount_total,
        currency: session.currency,
        purchaseReference: session.id,
        purchasedAt: new Date(),
        expiresAt: acquisitionRow && acquisitionRow.expires_at,
      });
    }).catch(err => {
      console.error('[stripe] founder purchase notification lookup failed (non-fatal):', err && err.message);
    });
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

