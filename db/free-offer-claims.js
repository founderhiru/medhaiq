// db/free-offer-claims.js
//
// Anti-Abuse & Free-Offer Guardrail. This is the ONE genuinely new table
// this feature adds (free_offer_claims — migration 021, db/migrate.js).
// It exists purely as an abuse SIGNAL log (device/IP risk history +
// Founder visibility) — it is never the source of truth for whether a
// user has credits. That remains package_acquisitions + credit_ledger,
// unchanged (see db/package-acquisitions.js).
//
// Idempotency for "can a user claim the Welcome Offer twice" is enforced
// one layer down, at the database level, by a partial unique index on
// package_acquisitions (user_id) WHERE source = 'welcome' — see
// migration 021. That means even a race (two concurrent requests) can't
// double-grant; this module only decides whether a claim looks risky
// enough to withhold the grant in the first place.
const { pool } = require('./index');

// A device that already has a GRANTED welcome claim is the strongest
// signal: someone is very likely re-registering on the same browser.
async function deviceAlreadyClaimed(deviceHash) {
  if (!deviceHash) return false;
  const res = await pool.query(
    `SELECT 1 FROM free_offer_claims WHERE device_hash = $1 AND status = 'granted' LIMIT 1`,
    [deviceHash]
  );
  return res.rows.length > 0;
}

// IP is explicitly a soft, secondary signal (shared office/campus/mobile
// NAT networks are expected and legitimate) — so this only flags
// unusually HIGH velocity, not any repeat use.
async function recentGrantedClaimsForIp(ipHash, windowHours = 24) {
  if (!ipHash) return 0;
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM free_offer_claims
     WHERE ip_hash = $1 AND status = 'granted' AND claimed_at >= NOW() - ($2 || ' hours')::interval`,
    [ipHash, windowHours]
  );
  return res.rows[0].count;
}

const IP_VELOCITY_THRESHOLD = 5; // more than this many welcome grants from one IP hash in 24h is flagged, not blocked-forever

/**
 * Risk assessment only — never deletes, bans, or touches the user
 * account. Returns { suspicious, reason } where reason is a short,
 * Founder-readable string (surfaced via getFreeOfferOverview below).
 */
async function assessWelcomeOfferRisk({ deviceHash, ipHash }) {
  if (await deviceAlreadyClaimed(deviceHash)) {
    return { suspicious: true, reason: 'device_already_claimed' };
  }
  const ipClaims = await recentGrantedClaimsForIp(ipHash);
  if (ipClaims >= IP_VELOCITY_THRESHOLD) {
    return { suspicious: true, reason: 'ip_velocity' };
  }
  return { suspicious: false, reason: null };
}

/**
 * One row per welcome-offer attempt (granted or restricted) — an
 * append-only log, not a per-user upsert, so Founder visibility shows
 * real history rather than only the latest outcome.
 */
async function recordFreeOfferClaim({ userId, deviceHash, ipHash, status, riskReason }) {
  await pool.query(
    `INSERT INTO free_offer_claims (user_id, device_hash, ip_hash, status, risk_reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, deviceHash || null, ipHash || null, status, riskReason || null]
  );
}

/**
 * Founder Dashboard — lightweight counters only (per spec: "do not build
 * a large fraud dashboard"). Mirrors the shape/style of
 * db/founder-stats.js::getOverviewStats.
 */
async function getFreeOfferOverview() {
  const [granted, restricted, suspiciousDevices] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM free_offer_claims WHERE status = 'granted'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM free_offer_claims WHERE status = 'restricted'`),
    pool.query(
      `SELECT COUNT(DISTINCT device_hash)::int AS count FROM free_offer_claims
       WHERE status = 'restricted' AND device_hash IS NOT NULL`
    ),
  ]);
  return {
    welcomeOffersGranted: granted.rows[0].count,
    restrictedClaims: restricted.rows[0].count,
    suspiciousDevices: suspiciousDevices.rows[0].count,
  };
}

/**
 * Founder Dashboard drill-down — "why was this restricted." Most recent
 * first, capped, no pagination (per "lightweight, not a large dashboard").
 */
async function getRecentRestrictedClaims(limit = 20) {
  const res = await pool.query(
    `SELECT fc.id, fc.user_id, fc.status, fc.risk_reason, fc.claimed_at, u.email, u.name
     FROM free_offer_claims fc
     LEFT JOIN users u ON u.id = fc.user_id
     WHERE fc.status = 'restricted'
     ORDER BY fc.claimed_at DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = {
  assessWelcomeOfferRisk,
  recordFreeOfferClaim,
  getFreeOfferOverview,
  getRecentRestrictedClaims,
};
