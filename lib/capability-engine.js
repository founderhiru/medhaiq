// ═══════════════════════════════════════════════════════════════════════════
// lib/capability-engine.js — MedhaIQ Capability Engine
//
// Single source of truth for "who is looking at this page right now."
// Everything downstream (Navigation Resolver, CTA Resolver, preview routes)
// reads from the capabilities object this produces — nothing else in the
// app should independently re-derive tier from cookies/DB columns.
//
// Normalization table (confirmed):
//   No user_id cookie                                          → visitor
//   subscription_status = 'active' AND
//     subscription_plan IN ('professional','leadership')       → pro
//   Trial users (any non-'active' status incl. trialing)       → free
//     (until a separate trial experience is introduced)
//   subscription_status = cancelled / expired / none / missing → free
//
// The database stays flexible (whatever Stripe/founder-dashboard needs);
// the rest of the app only ever sees the three stable tiers below. Raw
// subscription_plan/subscription_status values are read here and nowhere
// else — they are NOT included in the returned capabilities object, so
// nothing downstream (templates, resolvers, routes) can accidentally
// branch on a raw DB string instead of the normalized tier.
//
// Auth identity is the httpOnly `user_id` cookie (set identically by
// password login, magic-link, and Google OAuth — verified in routes/auth.js).
//
// There is no usage-limit/quota column in the schema yet. The "Usage Limit"
// CTA state referenced in product docs is therefore NOT derivable today.
// `hasHitUsageLimit` is wired as an explicit stub returning false, with a
// single obvious place to plug in real quota logic once that table exists —
// see the TODO below. Nothing fabricates a limit that isn't real.
// ═══════════════════════════════════════════════════════════════════════════

const { getUserById } = require('../db/auth');

const TIER = Object.freeze({
  VISITOR: 'visitor',
  FREE: 'free',
  PRO: 'pro',
});

const PRO_PLANS = ['professional', 'leadership'];

function visitorCapabilities() {
  return {
    tier: TIER.VISITOR,
    isAuthenticated: false,
    previewMode: true,
    user: null,
    hasHitUsageLimit: false,
  };
}

// TODO(usage-limit): once a real quota/usage table exists, replace this
// stub. Signature is intentionally stable so callers never need to change.
function hasHitUsageLimit(_user) {
  return false;
}

async function resolveCapabilities(req) {
  const userId = req.cookies && req.cookies.user_id;
  if (!userId) return visitorCapabilities();

  const user = await getUserById(userId);
  if (!user) return visitorCapabilities(); // stale/invalid cookie — treat as visitor, never throw

  const plan = (user.subscription_plan || '').toLowerCase();
  const status = (user.subscription_status || '').toLowerCase();
  const isPro = status === 'active' && PRO_PLANS.includes(plan);

  return {
    tier: isPro ? TIER.PRO : TIER.FREE,
    isAuthenticated: true,
    previewMode: false,
    user: { id: user.id, name: user.name, email: user.email },
    hasHitUsageLimit: hasHitUsageLimit(user),
  };
}

module.exports = { resolveCapabilities, TIER };
