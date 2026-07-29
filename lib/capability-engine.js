// ═══════════════════════════════════════════════════════════════════════════
// lib/capability-engine.js — MedhaIQ Capability Engine (UNIFIED, ADR-011)
//
// This is now the ONLY capability engine in the app. Prior to this
// revision, two separate engines coexisted: this file (global, wired via
// middleware/capabilities.js, driving nav/CTA rendering) and
// lib/capabilities.js (per-route, wired via middleware/guards.js, driving
// interview-session-conflict logic and a handful of other fields). That
// split was flagged and approved for reconciliation (Architecture v1.5,
// ADR-011) — this revision completes it. lib/capabilities.js and
// services/entitlement.js are retired; every real consumer of their
// output (see the field-by-field list below) is preserved here instead.
//
// Everything downstream — Navigation Resolver, CTA Resolver, preview
// routes, route guards (middleware/guards.js), the homepage header
// (views/partials/header.ejs), the /resume route's careerProfile reuse —
// reads from the single object this produces. Nothing else in the app
// should independently query users/package_acquisitions/interview_sessions
// to re-derive any of this.
//
// SOURCE OF TRUTH (Architecture v1.5, ADR-013): a user's package comes
// from package_acquisitions, not users.subscription_plan/subscription_status
// (legacy, left in place on the users table, no longer read here for
// authorization purposes). capabilities.package.id (explorer/growth/
// leadership) is CANONICAL. capabilities.tier (visitor/free/pro) and
// capabilities.subscriptionTier ('none'/'free'/'pro') are DEPRECATED —
// kept only so nothing that already reads them breaks; new code should
// read capabilities.package.id and capabilities.permissions /
// .entitlements / .personas instead.
//
// Auth identity is the httpOnly `user_id` cookie (unchanged).
// ═══════════════════════════════════════════════════════════════════════════

const { getUserById } = require('../db/auth');
const { getCareerProfile } = require('../db/career-profile');
const { getUserSessions } = require('../db/interview');
const { getActivePackageAcquisition, getCreditedMinutes } = require('../db/package-acquisitions');
const { PRODUCT_PACKAGES, DEFAULT_PACKAGE_ID } = require('../config/product-packages');
const { PERSONA_ENTITLEMENTS } = require('../config/persona-entitlements');
const { MAX_SESSION_MINUTES } = require('../config/plans');
// Reused exactly as-is, not modified — this remains the sole authority
// on Founder status. isFounderAccount below is a read-only DISPLAY flag;
// it never feeds into permissions/entitlements/package resolution, and
// authorization continues to be decided exclusively by founder_access
// via routes/founder.js's requireFounder, completely independently of
// this file.
const { isFounder } = require('../db/founder-access');

/** @deprecated see file header. */
const TIER = Object.freeze({
  VISITOR: 'visitor',
  FREE: 'free',
  PRO: 'pro',
});

function deprecatedTierFromPackageId(packageId) {
  return packageId === 'explorer' ? TIER.FREE : TIER.PRO;
}

// Same rationale as the retired services/entitlement.js: entitlement math
// needs a user's FULL session history, not the 20-row default
// getUserSessions() uses for recent-history display.
const ALL_SESSIONS_LIMIT = 1000;

// Unchanged from the retired services/entitlement.js — minutes
// attributable to one session, capped at the per-session maximum, so a
// session that technically ran long can never debit more than one
// session's worth from the pool.
function cappedSessionMinutes(session, maxSessionMinutes) {
  const start = session.started_at ? new Date(session.started_at).getTime() : null;
  if (!start) return 0;
  const end = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const rawMinutes = (end - start) / 60000;
  if (!Number.isFinite(rawMinutes) || rawMinutes <= 0) return 0;
  return Math.min(rawMinutes, maxSessionMinutes);
}

// Unchanged from the retired lib/capabilities.js, including its original
// note: this collapses "Interview Complete" into "Career Workspace" once
// a user has finished at least one interview, since a real user
// re-enters "Interview Eligible" repeatedly rather than progressing
// linearly past a single completion.
function deriveLifecycleState({ isAuthenticated, resumeComplete, hasActiveInterview, hasCompletedInterview }) {
  if (!isAuthenticated) return 'Visitor';
  if (!resumeComplete) return 'Resume Intelligence Pending';
  if (hasActiveInterview) return 'Interview Active';
  if (!hasCompletedInterview) return 'Interview Eligible';
  return 'Career Workspace';
}

function visitorCapabilities() {
  const packageId = DEFAULT_PACKAGE_ID;
  return {
    // --- canonical fields (Architecture v1.5, ADR-013) ---
    package: { id: packageId, ...PRODUCT_PACKAGES[packageId] },
    permissions: PRODUCT_PACKAGES[packageId].permissions,
    entitlements: { creditsGranted: 0 },
    personas: PERSONA_ENTITLEMENTS[packageId] || [],
    isAuthenticated: false,
    user: null,
    careerProfile: null,
    // Presentation-only — see file header. A visitor is never a Founder.
    isFounderAccount: false,
    // --- preserved from the retired lib/capabilities.js (real consumers: middleware/guards.js, views/partials/header.ejs) ---
    resumeComplete: false,
    interviewEntitlement: null,
    lifecycleState: 'Visitor',
    // Navigation Principle (unchanged): stable, never state-dependent —
    // always this exact label/href, read by the homepage header.
    primaryNavigation: { label: 'Workspace', href: '/dashboard' },
    actions: {
      canStartInterview: false,
      canContinueInterview: false,
      canUploadResume: false,
      canUpgrade: false,
      canAccessReports: false,
    },
    // --- deprecated, backward-compat only ---
    subscriptionTier: 'none',
    tier: TIER.VISITOR,
    previewMode: true,
    hasHitUsageLimit: false,
  };
}

async function resolveCapabilities(req) {
  const userId = req.cookies && req.cookies.user_id;
  if (!userId) return visitorCapabilities();

  // Four independent lookups, none depending on another's result, run
  // concurrently rather than sequentially — same reasoning documented in
  // the Step 2 impact summary, now extended to the two additional
  // lookups (careerProfile, sessions) this reconciliation absorbs.
  const [user, activeAcquisition, careerProfile, sessions, isFounderAccount] = await Promise.all([
    getUserById(userId),
    getActivePackageAcquisition(userId),
    getCareerProfile(userId),
    getUserSessions(userId, { limit: ALL_SESSIONS_LIMIT, offset: 0 }),
    isFounder(userId),
  ]);

  if (!user) return visitorCapabilities(); // stale/invalid cookie — treat as visitor, never throw

  const packageId = (activeAcquisition && PRODUCT_PACKAGES[activeAcquisition.package_id])
    ? activeAcquisition.package_id
    : DEFAULT_PACKAGE_ID;
  const pkg = PRODUCT_PACKAGES[packageId];

  const hasActiveInterview = sessions.some(s => s.status === 'active');
  const hasCompletedInterview = sessions.some(s => s.status === 'completed');
  const activeSession = sessions.find(s => s.status === 'active');
  const activeSessionId = activeSession ? activeSession.id : null;

  // Credits included + which sessions count against them. One real
  // judgment call this reconciliation makes, flagged explicitly rather
  // than buried: consumption is scoped to sessions since the ACTIVE
  // acquisition's acquired_at, so switching/renewing a package doesn't
  // count old usage against the new pool. Explorer has no acquisition
  // row by design (its 30 minutes is a flat, one-time, lifetime
  // allowance per config/product-packages.js's own comment), so ALL of
  // a user's lifetime sessions count against it there, unchanged from
  // how the pre-package-model free tier always worked.
  let creditsIncluded;
  let sessionsForConsumption;
  if (activeAcquisition) {
    creditsIncluded = await getCreditedMinutes(activeAcquisition.id);
    const acquiredAtMs = new Date(activeAcquisition.acquired_at).getTime();
    sessionsForConsumption = sessions.filter(s => s.started_at && new Date(s.started_at).getTime() >= acquiredAtMs);
  } else {
    creditsIncluded = pkg.entitlements.includedMinutes;
    sessionsForConsumption = sessions;
  }

  const finishedMinutes = sessionsForConsumption
    .filter(s => s.status === 'completed' || s.status === 'abandoned')
    .reduce((sum, s) => sum + cappedSessionMinutes(s, MAX_SESSION_MINUTES), 0);
  const activeMinutes = (activeSession && sessionsForConsumption.includes(activeSession))
    ? cappedSessionMinutes(activeSession, MAX_SESSION_MINUTES)
    : 0;
  const minutesUsed = finishedMinutes + activeMinutes;
  const minutesIncluded = creditsIncluded;
  const minutesRemaining = Math.max(0, minutesIncluded - minutesUsed);
  const interviewsRemaining = MAX_SESSION_MINUTES > 0 ? Math.floor(minutesRemaining / MAX_SESSION_MINUTES) : 0;

  // No package is unlimited today (Explorer/Growth/Leadership are all
  // finite pools) — kept as a field for shape stability and so a future
  // genuinely-unlimited package (e.g. an enterprise tier) doesn't need
  // this shape to change, not because it's a live branch right now.
  const interviewEntitlement = {
    unlimited: false,
    minutesUsed,
    minutesIncluded,
    minutesRemaining,
    interviewsRemaining,
    maxSessionMinutes: MAX_SESSION_MINUTES,
    hasActiveInterview,
    hasCompletedInterview,
    activeSessionId,
  };

  const resumeComplete = !!(careerProfile && careerProfile.resume_parsed_at);
  const hasMinutesAvailable = interviewEntitlement.unlimited || interviewEntitlement.minutesRemaining > 0;
  const lifecycleState = deriveLifecycleState({ isAuthenticated: true, resumeComplete, hasActiveInterview, hasCompletedInterview });
  const deprecatedTier = deprecatedTierFromPackageId(packageId);

  return {
    // --- canonical fields (Architecture v1.5, ADR-013) ---
    package: { id: packageId, ...pkg },
    permissions: pkg.permissions,
    entitlements: { creditsGranted: creditsIncluded },
    personas: PERSONA_ENTITLEMENTS[packageId] || [],
    isAuthenticated: true,
    user: { id: user.id, name: user.name, email: user.email },
    careerProfile,
    // Presentation-only display flag (see file header) — computed from
    // the unmodified, existing founder_access check. package/permissions/
    // entitlements above are entirely unaffected by this; a Founder's
    // resolved package is still whatever package_acquisitions says
    // (typically Explorer, since Founders don't purchase anything) —
    // this flag only tells the UI to additionally show "Founder" as a
    // Role, never to substitute it into the package itself.
    isFounderAccount,
    // --- preserved from the retired lib/capabilities.js ---
    resumeComplete,
    interviewEntitlement,
    lifecycleState,
    primaryNavigation: { label: 'Workspace', href: '/dashboard' },
    actions: {
      // Per Capability Matrix: Start Interview does NOT require
      // resumeComplete — only auth, no-active-session, and minutes.
      canStartInterview: !hasActiveInterview && hasMinutesAvailable,
      canContinueInterview: hasActiveInterview,
      canUploadResume: true,
      canUpgrade: packageId !== 'leadership',
      canAccessReports: true,
    },
    // --- deprecated, backward-compat only ---
    subscriptionTier: deprecatedTier === TIER.PRO ? 'pro' : 'free',
    tier: deprecatedTier,
    previewMode: false,
    // Real usage-limit detection, now possible for the first time — Step
    // 2 left this a stub specifically because credits weren't computed
    // yet; this reconciliation is what makes it a real value instead.
    hasHitUsageLimit: !interviewEntitlement.unlimited && interviewEntitlement.minutesRemaining <= 0,
  };
}

module.exports = {
  resolveCapabilities,
  // Alias so middleware/guards.js's existing `const { getCapabilities } =
  // require(...)` works by changing only the require PATH, not any
  // variable name inside that file — minimizes the diff on a
  // business-logic-heavy file per "minimize breaking changes."
  getCapabilities: resolveCapabilities,
  TIER,
};
