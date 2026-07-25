// config/plans.js
const MAX_SESSION_MINUTES = 25;

// Server-owned session lifecycle management (bug fix, 2026-07-24;
// three-tier recovery design, 2026-07-24 follow-up). A confirmed session
// (at least one real heartbeat landed) that's gone quiet is handled in
// THREE tiers, each with its own named threshold below, rather than a
// single cutoff:
//
//   1. Still within LIVE_HEARTBEAT_GRACE_PERIOD_MINUTES since the last
//      heartbeat -> treated as genuinely live elsewhere (a real second
//      tab, most likely) -> a real 409 conflict, no recovery offered.
//      This window is deliberately just over one missed heartbeat tick
//      (the client pings every 60s) plus jitter room -- if it's this
//      fresh, something is very likely still actively pinging.
//
//   2. Between the grace period and SESSION_RECOVERY_WINDOW_MINUTES ->
//      genuinely gone quiet (dropped connection, crash, closed tab) but
//      not so long ago that the candidate's progress should be thrown
//      away. This is the case that used to fall through to a dead-end
//      409 with no way forward -- now surfaced to the candidate as a
//      recoverable conflict (Resume / Start New), not silently resolved
//      and not a permanent block either.
//
//   3. Beyond SESSION_RECOVERY_WINDOW_MINUTES -> auto-abandoned exactly
//      as before this follow-up (see db/interview.js's
//      abandonStaleActiveSession) -- fully automatic, no candidate
//      interaction, unchanged from the original fix.
const LIVE_HEARTBEAT_GRACE_PERIOD_MINUTES = 1.5;
const SESSION_RECOVERY_WINDOW_MINUTES = 10;

// URGENT FOLLOW-UP FIX (2026-07-24, same day): a session that never
// received even ONE real heartbeat — last_activity_at is still exactly
// its creation-time default because the candidate never actually reached
// the live interview page (the launch attempt itself failed, or they
// closed the tab before the page finished loading) — isn't "genuinely
// in progress," it's a failed launch attempt. The full recovery-window
// timeout above is right for a session that WAS active and then went
// silent; it's far too long for one that was never confirmed active at
// all. This shorter timeout applies only to that "never confirmed" case
// (see db/interview.js's abandonStaleActiveSession, which checks
// last_activity_at = started_at as the "never confirmed" signal) —
// combined with the immediate first-heartbeat-on-page-load added in the
// same fix, a genuinely reached interview session confirms itself within
// seconds, well inside this window. Unchanged by the three-tier recovery
// design — never-confirmed sessions still auto-abandon automatically,
// no recovery offer, since there's no real progress to recover.
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

module.exports = {
  PLAN_CONFIG,
  MAX_SESSION_MINUTES,
  LIVE_HEARTBEAT_GRACE_PERIOD_MINUTES,
  SESSION_RECOVERY_WINDOW_MINUTES,
  SESSION_UNCONFIRMED_TIMEOUT_MINUTES,
  DEFAULT_TIER,
};
