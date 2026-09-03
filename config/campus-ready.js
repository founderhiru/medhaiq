// config/campus-ready.js
//
// Campus Ready V1 — thresholds only, no logic here (project convention:
// no magic numbers inside route/db code). Deliberately separate from
// config/product-packages.js and config/plans.js — Campus Ready is not
// a subscription tier and must never be read by the Capability Engine.

module.exports = {
  // A module is "complete" once BOTH of these are true for that learner:
  //   1. they've submitted at least this many practice prompts (any
  //      topics within the module — modules are independent, not
  //      sequential, so there's no per-topic gate)
  //   2. their quiz accuracy across that module's active quiz questions
  //      is at or above this threshold
  PRACTICE_REQUIRED_PER_MODULE: 3,
  QUIZ_PASS_THRESHOLD: 0.7,
};
