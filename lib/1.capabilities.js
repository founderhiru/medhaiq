// lib/capabilities.js
//
// The Capability Engine. Called once per request (getCapabilities(req)).
// Pure computation over existing data — nothing here writes to the
// database or persists a "current stage" anywhere. Route guards and
// presentation partials (header.ejs, workspace-shell-top.ejs) consume this
// object's `actions` flags only; neither should re-derive access logic of
// its own.
//
// Five foundational facts, plus a derived lifecycle label and a set of
// derived boolean actions so templates never have to combine raw facts
// themselves.

const { getUserById } = require('../db/auth');
const { getCareerProfile } = require('../db/career-profile');
const { getInterviewEntitlement } = require('../services/entitlement');

/**
 * users.subscription_plan/subscription_status are free-text columns today
 * ("professional", "leadership", inconsistent casing — see
 * db/cost-analytics.js's LOWER() calls). This is the ONE place that maps
 * those raw strings to the 3-value tier enum this app treats as canonical.
 * If new plan names are introduced in Stripe/the DB, this is the only
 * function that needs to change.
 *
 * @returns {'none'|'free'|'pro'}
 */
function normalizeTier(user) {
  if (!user) return 'none';

  const status = (user.subscription_status || '').toLowerCase();
  const plan = (user.subscription_plan || '').toLowerCase();

  const isActivePaid = status === 'active' && (plan === 'professional' || plan === 'leadership' || plan === 'pro');
  return isActivePaid ? 'pro' : 'free';
}

/**
 * Derived lifecycle label per the state-machine directive — computed
 * fresh every call, never stored. NOTE: this collapses the spec's
 * "Interview Complete" step into "Career Workspace" once a user has
 * finished at least one interview, since a real user re-enters
 * "Interview Eligible" repeatedly (starting a 2nd, 3rd interview) rather
 * than progressing linearly past a single completion — the strictly
 * linear FSM in the spec doesn't have a clean re-entry point for that.
 * Flagging this collapse explicitly rather than silently picking a
 * different interpretation.
 */
function deriveLifecycleState({ isAuthenticated, resumeComplete, hasActiveInterview, hasCompletedInterview }) {
  if (!isAuthenticated) return 'Visitor';
  if (!resumeComplete) return 'Resume Intelligence Pending';
  if (hasActiveInterview) return 'Interview Active';
  if (!hasCompletedInterview) return 'Interview Eligible';
  return 'Career Workspace';
}

/**
 * @param {import('express').Request} req
 */
async function getCapabilities(req) {
  const userId = req.cookies?.user_id;

  if (!userId) {
    return {
      isAuthenticated: false,
      subscriptionTier: 'none',
      resumeComplete: false,
      interviewEntitlement: null,
      lifecycleState: 'Visitor',
      user: null,
      careerProfile: null,
      primaryNavigation: null,
      actions: {
        canStartInterview: false,
        canContinueInterview: false,
        canUploadResume: false,
        canUpgrade: false,
        canAccessReports: false,
      },
    };
  }

  const user = await getUserById(userId);

  // Cookie present but user row gone/expired — treat identically to
  // Visitor rather than throwing, same defensive pattern already used by
  // the duplicated requireAuth checks this replaces.
  if (!user) {
    return {
      isAuthenticated: false,
      subscriptionTier: 'none',
      resumeComplete: false,
      interviewEntitlement: null,
      lifecycleState: 'Visitor',
      user: null,
      careerProfile: null,
      primaryNavigation: null,
      actions: {
        canStartInterview: false,
        canContinueInterview: false,
        canUploadResume: false,
        canUpgrade: false,
        canAccessReports: false,
      },
    };
  }

  const subscriptionTier = normalizeTier(user);

  const [careerProfile, interviewEntitlement] = await Promise.all([
    getCareerProfile(userId),
    getInterviewEntitlement(userId, subscriptionTier),
  ]);

  const resumeComplete = !!(careerProfile && careerProfile.resume_parsed_at);
  const { hasActiveInterview, hasCompletedInterview, unlimited, minutesRemaining } = interviewEntitlement;

  const lifecycleState = deriveLifecycleState({
    isAuthenticated: true,
    resumeComplete,
    hasActiveInterview,
    hasCompletedInterview,
  });

  const hasMinutesAvailable = unlimited || minutesRemaining > 0;

  return {
    isAuthenticated: true,
    subscriptionTier,
    resumeComplete,
    interviewEntitlement,
    lifecycleState,
    user,
    careerProfile,
    // Navigation Principle: stable, never state-dependent. Always this
    // exact label/href for every authenticated user — the homepage reads
    // this instead of implementing its own login logic. /dashboard is a
    // thin redirect route (see server.js) to the real /dashboard/history
    // page, added specifically so this href is a real, working path.
    primaryNavigation: {
      label: 'Workspace',
      href: '/dashboard',
    },
    actions: {
      // Per spec Section 5: gating happens at the action level. Resume
      // completion isn't actually required here by the capability matrix
      // (Start Interview is available to any authenticated Free/Pro user),
      // so this only checks auth, no-active-session, and minutes — it does
      // NOT require resumeComplete. Route-level UX (nudging an
      // incomplete-resume user toward Resume Intelligence first) is a
      // guard/redirect concern, not an access-denial concern.
      canStartInterview: !hasActiveInterview && hasMinutesAvailable,
      canContinueInterview: hasActiveInterview,
      // Per Capability Matrix: resume upload is unlocked for any
      // authenticated user regardless of tier or usage limit.
      canUploadResume: true,
      canUpgrade: subscriptionTier !== 'pro',
      // Per Capability Matrix: Dashboard/Reports/Settings remain fully
      // accessible even at usage limit — never gated by entitlement.
      canAccessReports: true,
    },
  };
}

module.exports = { getCapabilities, normalizeTier };
