// config/persona-entitlements.js
//
// Maps package IDs to which Interview Personas that package's users may
// select. This is the ONLY new file the persona work required — per
// ADR-010 (Architecture v1.3), persona content itself (system prompts,
// tone, orchestration) stays exactly where it already lives, in
// services/interview.js's PERSONAS object. Nothing in this file
// duplicates or touches that content; it only ever handles persona IDs.
//
// Design Principle (Architecture v1.3, §4 #12): the Interview Engine
// owns persona BEHAVIOR. This file — part of User Management — owns
// persona AVAILABILITY. Those are different responsibilities and stay
// in different files, on purpose.

const PERSONA_ENTITLEMENTS = {
  explorer: [],
  // Explorer's persona list is deliberately empty pending a product
  // decision (Architecture v1.5, §12.4 — still open): does Explorer get
  // one default/sample persona, or genuinely none? Leaving this empty
  // for now means Explorer users simply see no persona-selection choice
  // until that's decided — not a bug, a placeholder for a real decision.
  growth: [
    'alex_chen',
    'priya_ramesh',
    'marcus_webb',
  ],
  leadership: [
    'alex_chen',
    'priya_ramesh',
    'marcus_webb',
    'sanjeev_nair',
    'sarah_kim',
    'raj_mehta',
  ],
};

module.exports = { PERSONA_ENTITLEMENTS };
