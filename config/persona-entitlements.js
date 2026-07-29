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
  // FIXED as part of enforcement work: this was previously an empty array
  // pending an open product question (Architecture v1.5 §12.4 — does
  // Explorer get a default/sample persona, or genuinely none?). Enforcing
  // entitlement in the UI/backend (see views/interview-setup.ejs,
  // controllers/sessionController.js) surfaced the real consequence of
  // leaving this empty: an Explorer user would see zero persona options
  // and be unable to start ANY interview — the free tier would be
  // completely non-functional, not just limited. Defaulting to one
  // persona here keeps Explorer usable. This is a pragmatic default, not
  // a confirmed business decision — revisit if the real answer differs.
  explorer: ['alex_chen'],
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
