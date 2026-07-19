// ═══════════════════════════════════════════════════════════════════════════
// lib/cta-resolver.js — CTA lifecycle
//
//   Visitor              → "Start Free Trial"
//   Visitor in Preview    → "Create Your Free Account →"
//   Free User             → "Start Interview"
//   Pro User               → "New Interview"
//   Usage Limit hit        → "Upgrade to Pro"
//
// SCOPE OF THIS BATCH: neither resolver is wired into a view yet — that's
// deliberate, matching the agreed sequencing (mega menu / header CTA wiring
// comes after all four preview routes exist). Built now as ready-to-use
// infrastructure so nothing has to change shape later.
//
// NOT wired anywhere yet: the real, authenticated /interview begin button
// currently says "Initialize Session →" for every logged-in user, and
// dashboard-history.ejs / workspace-shell-top.ejs / interview-header.ejs all
// say "New Interview" for every logged-in user, tier-agnostic. Making Free
// vs. Pro differ there touches several already-working production files —
// holding that for explicit sign-off. `resolveAuthenticatedBeginCTA` below
// is ready for that follow-up.
// ═══════════════════════════════════════════════════════════════════════════

const { TIER } = require('./capability-engine');

function resolveHeaderCTA(capabilities) {
  if (!capabilities || capabilities.tier === TIER.VISITOR) {
    return { label: 'Start Free Trial', href: '/auth/signup' };
  }
  if (capabilities.hasHitUsageLimit) {
    return { label: 'Upgrade to Pro', href: '/#pricing' };
  }
  if (capabilities.tier === TIER.PRO) {
    return { label: 'New Interview', href: '/interview' };
  }
  return { label: 'Start Interview', href: '/interview' };
}

// Used on preview pages in place of the real "begin" action. Always a
// visitor in this context — preview routes redirect authenticated users
// to the real page instead of showing them a demo.
function resolvePreviewBeginCTA() {
  return { label: 'Create Your Free Account →', href: '/auth/signup' };
}

// Ready for the follow-up batch described above — not called anywhere yet.
function resolveAuthenticatedBeginCTA(capabilities) {
  if (capabilities && capabilities.hasHitUsageLimit) {
    return { label: 'Upgrade to Pro', href: '/#pricing', disabled: true };
  }
  if (capabilities && capabilities.tier === TIER.PRO) {
    return { label: 'New Interview', action: 'start' };
  }
  return { label: 'Start Interview', action: 'start' };
}

module.exports = { resolveHeaderCTA, resolvePreviewBeginCTA, resolveAuthenticatedBeginCTA };
