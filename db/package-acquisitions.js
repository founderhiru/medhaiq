// db/package-acquisitions.js — new file, nothing else in the app calls
// this yet. Provides the query building blocks for package_acquisitions
// and credit_ledger (Architecture v1.5, §9.2). Deliberately kept as its
// own module, separate from db/interview.js, since it's a different
// domain (User Management / entitlements, not interview delivery).
const { pool } = require('./index');
const { PACKAGE_TIER_RANK } = require('../config/product-packages');

/**
 * ALL of a user's currently-unexpired package_acquisitions rows, oldest
 * first. A normal single-purchase user has exactly one row here (or
 * zero, for a not-yet-welcomed Explorer). A user who has bought an
 * additional credit pack while a package was already active (Buy More
 * Minutes) will have more than one — this is the shared building block
 * both getActivePackageAcquisition (access level) and
 * getMergedCreditPool (credits) below are built from, replacing the old
 * assumption that a user only ever has one unexpired row at a time.
 */
async function getActiveAcquisitions(userId) {
  const result = await pool.query(
    `SELECT * FROM package_acquisitions
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY acquired_at ASC`,
    [userId]
  );
  return result.rows;
}

/**
 * The user's currently ACTIVE package acquisition — the row that
 * governs their permissions, entitlements, and persona access. Returns
 * null if the user has no unexpired acquisition, which is the normal,
 * expected state for a not-yet-welcomed visitor — it is not an error
 * case.
 *
 * FIX (Buy More Minutes entitlement bug): previously "most recently
 * acquired unexpired row wins," which meant a Leadership user buying a
 * cheaper Growth top-up would incorrectly downgrade to Growth. Now picks
 * the HIGHEST-TIER unexpired row (config/product-packages.js's
 * PACKAGE_TIER_RANK — Explorer < Growth < Leadership); ties at the same
 * tier (e.g. two separate Growth top-ups) fall back to most-recent, same
 * as before. A user with exactly one unexpired acquisition — every
 * purchase before Buy More Minutes existed — gets the IDENTICAL result
 * as the old code, since there's nothing to rank against.
 */
async function getActivePackageAcquisition(userId) {
  const rows = await getActiveAcquisitions(userId);
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    if (!best) return row;
    const bestRank = PACKAGE_TIER_RANK[best.package_id] ?? -1;
    const rowRank = PACKAGE_TIER_RANK[row.package_id] ?? -1;
    if (rowRank > bestRank) return row;
    if (rowRank === bestRank && new Date(row.acquired_at) > new Date(best.acquired_at)) return row;
    return best;
  }, null);
}

/**
 * Total credited minutes (grants + admin adjustments/refunds) for a
 * specific acquisition. This is NOT minutes remaining — consumption
 * (actual interview time used) is calculated separately from
 * interview_sessions, the same live-computation approach
 * services/entitlement.js already uses, scoped to sessions started at or
 * after this acquisition's acquired_at.
 *
 * Kept for API completeness — as of the Buy More Minutes fix,
 * lib/capability-engine.js reads getMergedCreditPool() instead of this
 * for its "credits included" number (a single acquisition's minutes are
 * no longer the right number once a user can have more than one
 * concurrently active acquisition). This function itself is unchanged
 * and still correct for what it does: one acquisition's own credits.
 */
async function getCreditedMinutes(packageAcquisitionId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(minutes), 0) AS total FROM credit_ledger WHERE package_acquisition_id = $1`,
    [packageAcquisitionId]
  );
  return Number(result.rows[0].total);
}

/**
 * Merges credited minutes across ALL of a user's currently-unexpired
 * acquisitions into a single pool, and returns the EARLIEST of those
 * acquisitions' acquired_at as the consumption boundary. This is the
 * exact generalization of the old single-acquisition formula
 * (getCreditedMinutes(activeAcquisition.id) + "sessions since
 * activeAcquisition.acquired_at") to the "more than one concurrently
 * active acquisition" case Buy More Minutes introduces:
 *
 *   - A user with exactly ONE unexpired acquisition gets numerically
 *     IDENTICAL totalMinutes/earliestAcquiredAt to the old code path —
 *     this is a strict generalization, not a new formula.
 *   - A user with several (e.g. Leadership + a Growth top-up) gets their
 *     minutes summed (300 + 120 = 420) and the consumption window
 *     anchored to whichever acquisition came FIRST — so a later top-up
 *     never retroactively excludes usage that already happened, and
 *     usage from BEFORE the earliest unexpired acquisition (i.e. from an
 *     already-expired prior package) still correctly does not count.
 *   - Every session is counted at most once (a single boundary, not a
 *     per-acquisition sum), so there is no double-counting risk.
 */
async function getMergedCreditPool(userId) {
  const acquisitions = await getActiveAcquisitions(userId);
  if (acquisitions.length === 0) {
    return { totalMinutes: 0, earliestAcquiredAt: null, acquisitionIds: [] };
  }
  const ids = acquisitions.map((a) => a.id);
  const result = await pool.query(
    `SELECT COALESCE(SUM(minutes), 0) AS total FROM credit_ledger WHERE package_acquisition_id = ANY($1::int[])`,
    [ids]
  );
  return {
    totalMinutes: Number(result.rows[0].total),
    earliestAcquiredAt: acquisitions[0].acquired_at, // getActiveAcquisitions is already sorted ASC
    acquisitionIds: ids,
  };
}

/**
 * Records a new package acquisition plus its initial credit grant, in a
 * single transaction — used by both the real checkout flow and any
 * admin-driven "grant a package" action. Never used to grant zero rows
 * independently; a package and its starting credits are always created
 * together, per the "one bundle, one expiry" design.
 *
 * Stripe revenue fields (paymentIntentId, chargeId, balanceTransactionId,
 * originalAmount, originalCurrency, amountUsd, stripeFeeUsd) are all
 * optional — an admin_grant (no real Stripe transaction behind it) simply
 * omits them, which correctly stores NULL in every one of those columns
 * rather than a fabricated value. See routes/stripe.js's webhook for the
 * one real caller that populates them from an actual Stripe transaction.
 */
async function createPackageAcquisition({
  userId, packageId, expiresAt, source, grantedBy, purchaseReference, initialMinutes,
  paymentIntentId, chargeId, balanceTransactionId, originalAmount, originalCurrency, amountUsd, stripeFeeUsd,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acquisition = await client.query(
      `INSERT INTO package_acquisitions (
         user_id, package_id, expires_at, source, granted_by, purchase_reference,
         payment_intent_id, charge_id, balance_transaction_id,
         original_amount, original_currency, amount_usd, stripe_fee_usd
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        userId, packageId, expiresAt || null, source || 'purchase', grantedBy || null, purchaseReference || null,
        paymentIntentId || null, chargeId || null, balanceTransactionId || null,
        originalAmount ?? null, originalCurrency || null, amountUsd ?? null, stripeFeeUsd ?? null,
      ]
    );
    const acquisitionRow = acquisition.rows[0];
    if (initialMinutes) {
      await client.query(
        `INSERT INTO credit_ledger (user_id, package_acquisition_id, minutes, reason, granted_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, acquisitionRow.id, initialMinutes, source === 'purchase' ? 'package_grant' : (source || 'admin_grant'), grantedBy || null]
      );
    }
    await client.query('COMMIT');
    return acquisitionRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Purchases whose actual Stripe settlement amount hasn't been captured
 * yet — has a payment_intent_id on file (so we know a real transaction
 * exists) but amount_usd is still NULL (Stripe's balance_transaction
 * wasn't available at webhook-delivery time). Read-only; the actual
 * Stripe re-fetch and the matching UPDATE (updateAcquisitionRevenue,
 * below) are separate steps, kept in the caller (routes/stripe.js /
 * lib/stripe-revenue-reconciliation.js) so this file never makes an
 * outbound Stripe API call itself — it stays a pure DB-access module,
 * same convention as every other function here.
 */
async function getAcquisitionsPendingRevenueReconciliation() {
  const result = await pool.query(
    `SELECT id, user_id, package_id, purchase_reference, payment_intent_id, acquired_at
     FROM package_acquisitions
     WHERE source = 'purchase' AND amount_usd IS NULL AND payment_intent_id IS NOT NULL
     ORDER BY acquired_at ASC`
  );
  return result.rows;
}

/**
 * Fills in the settled USD amount + fee for one already-existing
 * acquisition row, once the Balance Transaction becomes available. Never
 * touches package_id, entitlement, expiry, or credit_ledger — those were
 * already correctly granted at purchase time regardless of whether
 * revenue reconciliation has happened yet; this only ever updates the
 * revenue-reporting columns.
 */
async function updateAcquisitionRevenue({ acquisitionId, chargeId, balanceTransactionId, amountUsd, stripeFeeUsd }) {
  const result = await pool.query(
    `UPDATE package_acquisitions
     SET charge_id = COALESCE($2, charge_id),
         balance_transaction_id = COALESCE($3, balance_transaction_id),
         amount_usd = $4,
         stripe_fee_usd = $5
     WHERE id = $1
     RETURNING *`,
    [acquisitionId, chargeId || null, balanceTransactionId || null, amountUsd, stripeFeeUsd]
  );
  return result.rows[0] || null;
}

/**
 * Bulk version of getActivePackageAcquisition, for listing many users at
 * once (Founder Dashboard → User Management table) without an N+1 query
 * per row. Same tier-first-then-recency rule as the single-user function
 * (see its comment for the Buy More Minutes fix rationale) — the ranking
 * is duplicated here as a SQL CASE (rather than shared JS) because this
 * is a single bulk query, not a per-user fetch-then-reduce; if
 * PACKAGE_TIER_RANK in config/product-packages.js ever changes, this
 * CASE must be updated to match.
 *
 * @param {number[]} userIds
 * @returns {Promise<Object<number,string>>} map of user_id -> package_id.
 *   A user_id absent from the map has no active acquisition (Explorer,
 *   by the resolution convention used everywhere else in this codebase).
 */
async function getActivePackageAcquisitionsForUsers(userIds) {
  if (!userIds || userIds.length === 0) return {};
  const result = await pool.query(
    `SELECT DISTINCT ON (user_id) user_id, package_id
     FROM package_acquisitions
     WHERE user_id = ANY($1::int[]) AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY user_id,
       CASE package_id WHEN 'leadership' THEN 2 WHEN 'growth' THEN 1 WHEN 'explorer' THEN 0 ELSE -1 END DESC,
       acquired_at DESC`,
    [userIds]
  );
  const map = {};
  for (const row of result.rows) map[row.user_id] = row.package_id;
  return map;
}

/**
 * Founder-driven package reassignment (Founder Dashboard → "Manage
 * Package"). Atomically:
 *   1. Ends the user's current active acquisition, if any, by setting
 *      its expires_at to NOW() — an explicit, honest "this was ended by
 *      an admin action on this date," not a silent supersede-by-ordering
 *      (which is how a *second purchase* is allowed to behave, but an
 *      admin reassignment should read clearly in the history).
 *   2. Creates the new acquisition (source: 'admin_grant', open-ended —
 *      no expiry — since this is for testing/beta/support, not a timed
 *      purchase) with a starting credit grant matching that package's
 *      configured included minutes.
 * Both steps happen in one transaction — never leaves a user with either
 * zero active packages or two simultaneously "current" ones.
 */
async function reassignPackage({ userId, packageId, grantedBy, initialMinutes }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE package_acquisitions
       SET expires_at = NOW()
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    const inserted = await client.query(
      `INSERT INTO package_acquisitions (user_id, package_id, expires_at, source, granted_by)
       VALUES ($1, $2, NULL, 'admin_grant', $3) RETURNING *`,
      [userId, packageId, grantedBy || null]
    );
    const acquisitionRow = inserted.rows[0];
    if (initialMinutes) {
      await client.query(
        `INSERT INTO credit_ledger (user_id, package_acquisition_id, minutes, reason, granted_by)
         VALUES ($1, $2, $3, 'admin_grant', $4)`,
        [userId, acquisitionRow.id, initialMinutes, grantedBy || null]
      );
    }
    await client.query('COMMIT');
    return acquisitionRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getActiveAcquisitions,
  getActivePackageAcquisition,
  getCreditedMinutes,
  getMergedCreditPool,
  createPackageAcquisition,
  getActivePackageAcquisitionsForUsers,
  reassignPackage,
  getAcquisitionsPendingRevenueReconciliation,
  updateAcquisitionRevenue,
};
