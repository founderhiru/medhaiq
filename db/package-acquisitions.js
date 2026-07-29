// db/package-acquisitions.js — new file, nothing else in the app calls
// this yet. Provides the query building blocks for package_acquisitions
// and credit_ledger (Architecture v1.5, §9.2). Deliberately kept as its
// own module, separate from db/interview.js, since it's a different
// domain (User Management / entitlements, not interview delivery).
const { pool } = require('./index');

/**
 * The user's currently ACTIVE package acquisition — the single row that
 * governs their permissions, entitlements, and persona access all
 * together. Returns null if the user has no unexpired acquisition, which
 * is the normal, expected state for an Explorer (free) user — it is not
 * an error case.
 *
 * If a user has more than one unexpired acquisition (e.g. bought
 * Leadership while Growth credits still remained), the most recently
 * acquired one wins — see Architecture v1.5 §9.2's noted open item on
 * whether older unused credits should instead be preserved/merged.
 */
async function getActivePackageAcquisition(userId) {
  const result = await pool.query(
    `SELECT * FROM package_acquisitions
     WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY acquired_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Total credited minutes (grants + admin adjustments/refunds) for a
 * specific acquisition. This is NOT minutes remaining — consumption
 * (actual interview time used) is calculated separately from
 * interview_sessions, the same live-computation approach
 * services/entitlement.js already uses, scoped to sessions started at or
 * after this acquisition's acquired_at.
 */
async function getCreditedMinutes(packageAcquisitionId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(minutes), 0) AS total FROM credit_ledger WHERE package_acquisition_id = $1`,
    [packageAcquisitionId]
  );
  return Number(result.rows[0].total);
}

/**
 * Records a new package acquisition plus its initial credit grant, in a
 * single transaction — used by both the (future) real checkout flow and
 * any admin-driven "grant a package" action. Never used to grant zero
 * rows independently; a package and its starting credits are always
 * created together, per the "one bundle, one expiry" design.
 */
async function createPackageAcquisition({ userId, packageId, expiresAt, source, grantedBy, purchaseReference, initialMinutes }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acquisition = await client.query(
      `INSERT INTO package_acquisitions (user_id, package_id, expires_at, source, granted_by, purchase_reference)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, packageId, expiresAt || null, source || 'purchase', grantedBy || null, purchaseReference || null]
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

module.exports = { getActivePackageAcquisition, getCreditedMinutes, createPackageAcquisition };
