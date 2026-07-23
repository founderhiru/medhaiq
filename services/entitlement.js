// services/entitlement.js
//
// Calculates interview entitlement (minutes used / remaining) purely from
// existing interview_sessions rows — no new tables, no new columns, no
// persisted counters. Business rules (included minutes, per-session cap)
// come entirely from config/plans.js.
//
// Deliberately named getInterviewEntitlement (not a generic "getEntitlement")
// so that Resume Intelligence credits, AI Report limits, etc. can each get
// their own sibling function later without overloading this one's shape.

const { getUserSessions } = require('../db/interview');
const { PLAN_CONFIG, DEFAULT_TIER } = require('../config/plans');

// interview_sessions has no fixed upper bound on rows-per-user today, and
// getUserSessions() defaults to limit: 20 (built for recent-history display,
// not entitlement math). Entitlement needs the FULL history to sum minutes
// accurately, so this is passed explicitly rather than relying on the
// caller's default. 1000 is a practical ceiling — no real user is
// expected to have more lifetime interview sessions than that; if that
// assumption ever breaks, this should become a SUM() query in
// db/interview.js instead of an in-memory reduce.
const ALL_SESSIONS_LIMIT = 1000;

/**
 * Minutes actually attributable to a single session, capped at the plan's
 * per-session maximum. This is what protects the pool from a session that
 * technically ran long (e.g. abandoned late, cleaned up after the fact)
 * ever debiting more than one session's worth of minutes.
 */
function cappedSessionMinutes(session, maxSessionMinutes) {
  const start = session.started_at ? new Date(session.started_at).getTime() : null;
  if (!start) return 0;

  const end = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const rawMinutes = (end - start) / 60000;

  if (!Number.isFinite(rawMinutes) || rawMinutes <= 0) return 0;
  return Math.min(rawMinutes, maxSessionMinutes);
}

/**
 * @param {number|string} userId
 * @param {'free'|'pro'|string} tier - normalized tier from the Capability
 *   Engine. Unrecognized values fall back to DEFAULT_TIER ('free') rather
 *   than throwing, so a bad/missing subscription_plan string degrades to
 *   the safer (more restrictive) behavior instead of crashing a page.
 * @returns {Promise<{
 *   unlimited: boolean,
 *   minutesUsed: number,
 *   minutesIncluded: number|null,
 *   minutesRemaining: number|null,
 *   interviewsRemaining: number|null,
 *   maxSessionMinutes: number,
 *   hasActiveInterview: boolean,
 *   hasCompletedInterview: boolean
 * }>}
 */
async function getInterviewEntitlement(userId, tier) {
  const planKey = PLAN_CONFIG[tier] ? tier : DEFAULT_TIER;
  const plan = PLAN_CONFIG[planKey].interview;

  const sessions = await getUserSessions(userId, { limit: ALL_SESSIONS_LIMIT, offset: 0 });

  const hasActiveInterview = sessions.some(s => s.status === 'active');
  const hasCompletedInterview = sessions.some(s => s.status === 'completed');
  // P0 fix: expose WHICH session is active, not just whether one is.
  // Previously hasActiveInterview was a bare boolean -- callers had no
  // way to offer "resume your existing session," only "no."
  const activeSession = sessions.find(s => s.status === 'active');
  const activeSessionId = activeSession ? activeSession.id : null;

  // .unlimited lives one level up from .interview in PLAN_CONFIG — read it
  // off the plan root, not off the `plan` local (which is already
  // PLAN_CONFIG[planKey].interview).
  const unlimited = PLAN_CONFIG[planKey].unlimited === true;

  if (unlimited) {
    return {
      unlimited: true,
      minutesUsed: null,
      minutesIncluded: null,
      minutesRemaining: null,
      interviewsRemaining: null,
      maxSessionMinutes: plan.maxSessionMinutes,
      hasActiveInterview,
      hasCompletedInterview,
      activeSessionId,
    };
  }

  // Only completed/abandoned sessions represent "used" minutes for billing
  // purposes; an active session's elapsed time is added on top so someone
  // can't dodge the pool by simply never finishing a session.
  const finishedMinutes = sessions
    .filter(s => s.status === 'completed' || s.status === 'abandoned')
    .reduce((sum, s) => sum + cappedSessionMinutes(s, plan.maxSessionMinutes), 0);

  const activeMinutes = activeSession ? cappedSessionMinutes(activeSession, plan.maxSessionMinutes) : 0;

  const minutesUsed = finishedMinutes + activeMinutes;
  const minutesIncluded = plan.includedMinutes;
  const minutesRemaining = Math.max(0, minutesIncluded - minutesUsed);
  // Displayed as "interviews remaining" in V1 UI per product decision —
  // this is a derived display value, not a separately tracked quantity.
  const interviewsRemaining = Math.floor(minutesRemaining / plan.maxSessionMinutes);

  return {
    unlimited: false,
    minutesUsed,
    minutesIncluded,
    minutesRemaining,
    interviewsRemaining,
    maxSessionMinutes: plan.maxSessionMinutes,
    hasActiveInterview,
    hasCompletedInterview,
    activeSessionId,
  };
}

module.exports = { getInterviewEntitlement };
