// config/plans.js
const MAX_SESSION_MINUTES = 25;

// Server-owned session lifecycle management (bug fix, 2026-07-24). If no
// heartbeat/activity has been recorded for an ACTIVE session in this many
// minutes, it's treated as stale and auto-abandoned the next time the same
// user tries to start a new one — never surfaced to the candidate as a
// conflict, and never requiring manual/frontend cleanup. Deliberately
// longer than MAX_SESSION_MINUTES (a real, ongoing interview sends
// heartbeats well within this window) but short enough that a genuinely
// abandoned session doesn't block a new attempt for long.
const SESSION_INACTIVITY_TIMEOUT_MINUTES = 10;

const PLAN_CONFIG = {
  free: {
    unlimited: false,
    interview: {
      includedMinutes: 50,   // Temporary launch value — revisit with pricing decision
      maxSessionMinutes: MAX_SESSION_MINUTES,
    },
  },
  pro: {
    unlimited: true,
    interview: {
      includedMinutes: null,
      maxSessionMinutes: MAX_SESSION_MINUTES,
    },
  },
};

const DEFAULT_TIER = 'free';

module.exports = { PLAN_CONFIG, MAX_SESSION_MINUTES, SESSION_INACTIVITY_TIMEOUT_MINUTES, DEFAULT_TIER };
