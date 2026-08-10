// services/free-offer-guardrail.js
//
// Anti-Abuse & Free-Offer Guardrail — orchestration only. Composes
// existing building blocks (db/package-acquisitions.js for the actual
// grant, db/free-offer-claims.js for the risk signal/log) exactly the
// way db/founder-users.js already composes createPackageAcquisition with
// other steps. This file owns no SQL of its own.
//
// Called from ONE place: routes/auth.js, at the moment email ownership
// is actually confirmed (magic-link /auth/verify token consumption, or
// Google OAuth callback — Google already verifies the email). Never
// called from signup itself, and never trusts anything the client sends.
const { createPackageAcquisition } = require('../db/package-acquisitions');
const { assessWelcomeOfferRisk, recordFreeOfferClaim } = require('../db/free-offer-claims');
const { PRODUCT_PACKAGES } = require('../config/product-packages');

const WELCOME_MINUTES = PRODUCT_PACKAGES.explorer.entitlements.includedMinutes;

/**
 * Attempts to grant the one-time Explorer Welcome Offer. Idempotent and
 * safe to call on every verified login, not just the first — the
 * database-level partial unique index (migration 021) is the real
 * guarantee; the checks here just avoid a wasted query/insert attempt
 * and produce a clean, specific result for logging.
 *
 * @returns {Promise<{granted: boolean, reason: string|null}>}
 */
async function grantWelcomeOfferIfEligible({ userId, deviceHash, ipHash }) {
  const risk = await assessWelcomeOfferRisk({ deviceHash, ipHash });
  if (risk.suspicious) {
    // Restricted, not blocked: the account still exists and still works
    // (per spec — never auto-delete/suspend on a promotional-eligibility
    // signal). They simply don't receive the promotional credit.
    await recordFreeOfferClaim({ userId, deviceHash, ipHash, status: 'restricted', riskReason: risk.reason });
    return { granted: false, reason: risk.reason };
  }

  try {
    await createPackageAcquisition({
      userId,
      packageId: 'explorer',
      expiresAt: null,
      source: 'welcome',
      initialMinutes: WELCOME_MINUTES,
    });
  } catch (err) {
    // Unique-violation on the partial index = this user already has a
    // welcome acquisition (e.g. a second /auth/verify hit, or a race
    // between two concurrent requests). Not an error condition — just
    // "already claimed," logged as such rather than surfaced to the user.
    if (err && err.code === '23505') {
      await recordFreeOfferClaim({ userId, deviceHash, ipHash, status: 'restricted', riskReason: 'already_claimed' });
      return { granted: false, reason: 'already_claimed' };
    }
    throw err;
  }

  await recordFreeOfferClaim({ userId, deviceHash, ipHash, status: 'granted', riskReason: null });
  return { granted: true, reason: null };
}

module.exports = { grantWelcomeOfferIfEligible };
