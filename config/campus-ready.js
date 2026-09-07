// config/campus-ready.js
//
// Campus Ready V1 — thresholds only, no logic here (project convention:
// no magic numbers inside route/db code). Deliberately separate from
// config/product-packages.js and config/plans.js — Campus Ready is not
// a subscription tier and must never be read by the Capability Engine.

module.exports = {
  // A topic's quiz is "passed" once every quiz item in that topic has
  // been answered AND accuracy across them is at or above this
  // threshold. Module completion is then a pure function of topic
  // completion (Learn viewed + all Practice submitted + Quiz passed,
  // for every topic in the module) — see db/campus.js getModuleContent().
  // There is deliberately no separate "required practice count" here
  // anymore: Phase 2 replaced that flat, content-agnostic counter with
  // "every practice item this topic actually has," which is data-driven
  // and never goes stale as topics are added or content volume changes.
  QUIZ_PASS_THRESHOLD: 0.7,
};
