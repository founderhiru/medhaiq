// lib/stripe-revenue-reconciliation.js
//
// The retry/reconciliation half of the Stripe revenue architecture. The
// webhook (routes/stripe.js) captures amount_usd/stripe_fee_usd at
// purchase time on a best-effort basis — if Stripe's Balance Transaction
// isn't settled yet at that exact moment, those fields are left NULL
// rather than estimated. This module is the ONLY place that goes back
// and fills them in later, once Stripe has actually settled the charge.
//
// SAFETY CONTRACT, same as lib/cost-recorder.js's:
//   - Never estimates, never substitutes a package's list price.
//   - Never touches package_id, entitlement, expiry, or credit_ledger —
//     those were already correctly granted at purchase time regardless
//     of revenue-reporting status.
//   - A single row's reconciliation failure never aborts the batch; every
//     row is attempted independently and errors are collected, not thrown.
//
// Triggered on demand via POST /api/admin/reconcile-revenue (routes/admin.js).
// Not on a schedule from within this app — if you want it automatic, point
// a Render Cron Job (or similar) at that endpoint; no code change needed
// for that.
const { stripe, isStripeConfigured } = require('../services/stripe-client');
const {
  getAcquisitionsPendingRevenueReconciliation,
  updateAcquisitionRevenue,
} = require('../db/package-acquisitions');

async function reconcileOne(acquisition) {
  try {
    const pi = await stripe.paymentIntents.retrieve(acquisition.payment_intent_id, {
      expand: ['latest_charge.balance_transaction'],
    });
    const charge = pi.latest_charge;
    const balanceTransaction = charge && charge.balance_transaction;

    if (!balanceTransaction || typeof balanceTransaction !== 'object') {
      return { acquisitionId: acquisition.id, resolved: false, reason: 'balance_transaction still not available' };
    }
    if (balanceTransaction.currency !== 'usd') {
      // Same rule as the webhook: never mislabel a non-USD settlement as
      // amount_usd. Left pending rather than guessed.
      return { acquisitionId: acquisition.id, resolved: false, reason: `settled in ${balanceTransaction.currency}, not usd` };
    }

    const amountUsd = balanceTransaction.amount / 100;
    const stripeFeeUsd = balanceTransaction.fee / 100;
    await updateAcquisitionRevenue({
      acquisitionId: acquisition.id,
      chargeId: charge.id,
      balanceTransactionId: balanceTransaction.id,
      amountUsd,
      stripeFeeUsd,
    });
    return { acquisitionId: acquisition.id, resolved: true, amountUsd };
  } catch (err) {
    return { acquisitionId: acquisition.id, resolved: false, reason: `error: ${err.message}` };
  }
}

/**
 * Runs one reconciliation pass over every purchase still missing its
 * settled USD amount. Safe to call repeatedly (e.g. on every dashboard
 * refresh, or from a scheduled trigger) — a row that's still not settled
 * simply comes back again next time, and a row that IS now settled is
 * fixed permanently. Never throws; returns a summary either way.
 */
async function reconcilePendingRevenue() {
  if (!isStripeConfigured()) {
    return { checked: 0, resolved: 0, stillPending: 0, results: [], skipped: 'Stripe not configured in this environment' };
  }
  let pending;
  try {
    pending = await getAcquisitionsPendingRevenueReconciliation();
  } catch (err) {
    console.error('[stripe-revenue-reconciliation] could not load pending acquisitions:', err.message);
    return { checked: 0, resolved: 0, stillPending: 0, results: [], error: 'Failed to load pending acquisitions' };
  }

  if (pending.length === 0) {
    return { checked: 0, resolved: 0, stillPending: 0, results: [] };
  }

  const results = await Promise.all(pending.map(reconcileOne));
  const resolved = results.filter((r) => r.resolved).length;
  console.log(`[stripe-revenue-reconciliation] checked=${pending.length} resolved=${resolved} stillPending=${pending.length - resolved}`);
  return { checked: pending.length, resolved, stillPending: pending.length - resolved, results };
}

module.exports = { reconcilePendingRevenue };
