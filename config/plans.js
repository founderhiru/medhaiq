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

// URGENT FOLLOW-UP FIX (2026-07-24, same day): a session that never
// received even ONE real heartbeat — last_activity_at is still exactly
// its creation-time default because the candidate never actually reached
// the live interview page (the launch attempt itself failed, or they
// closed the tab before the page finished loading) — isn't "genuinely
// in progress," it's a failed launch attempt. The full 10-minute timeout
// above is right for a session that WAS active and then went silent; it's
// far too long for one that was never confirmed active at all. This
// shorter timeout applies only to that "never confirmed" case (see
// db/interview.js's abandonStaleActiveSession, which checks
// last_activity_at = started_at as the "never confirmed" signal) —
// combined with the immediate first-heartbeat-on-page-load added in the
// same fix, a genuinely reached interview session confirms itself within
// seconds, well inside this window.
const SESSION_UNCONFIRMED_TIMEOUT_MINUTES = 2;

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

module.exports = { PLAN_CONFIG, MAX_SESSION_MINUTES, SESSION_INACTIVITY_TIMEOUT_MINUTES, SESSION_UNCONFIRMED_TIMEOUT_MINUTES, DEFAULT_TIER };
