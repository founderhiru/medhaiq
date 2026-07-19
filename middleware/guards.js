// middleware/guards.js
//
// Route Guards. Every guard here is a thin consumer of the Capability
// Engine (lib/capabilities.js) — none of them re-derive access logic of
// their own. This replaces:
//   - the near-identical requireAuth() copy-pasted in routes/dashboard.js,
//     routes/feedback.js, routes/interview.js, routes/resume.js
//   - the inline `if (!req.cookies?.user_id) return res.redirect(...)`
//     checks scattered through server.js's page routes
//
// NOT replaced: routes/founder.js's requireFounder(). Founder/RBAC access
// is a separate authorization system (founder_access table) from
// subscription-tier capability gating, and is out of scope here per
// "minimum viable change per issue."
//
// Two flavors of each guard exist because this codebase has two kinds of
// routes that fail differently:
//   - API routes (mounted under /api/*)  -> JSON error response
//   - Page routes (server.js render calls) -> redirect, preserving intent
//
// All guards attach `req.capabilities` (the full Capability Engine object)
// so downstream handlers/templates never need to call getCapabilities()
// again themselves.

const { getCapabilities } = require('../lib/capabilities');

// ── API guards (JSON responses) ─────────────────────────────────────────

/**
 * Requires authentication. On success, attaches req.capabilities and
 * req.user (kept for compatibility with existing handlers that already
 * read req.user.id — capabilities.js's getUserById already fetched this
 * internally, so this refetch is avoided by reading off the same shape
 * the old requireAuth implementations exposed).
 */
async function requireAuth(req, res, next) {
  const capabilities = await getCapabilities(req);
  if (!capabilities.isAuthenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.capabilities = capabilities;
  // Existing handlers (dashboard.js, feedback.js, interview.js, resume.js)
  // read req.user.id directly — refetch here mirrors that exact prior
  // contract rather than changing every downstream call site's shape.
  const { getUserById } = require('../db/auth');
  req.user = await getUserById(req.cookies.user_id);
  if (!req.user) return res.status(401).json({ error: 'Session expired' });
  next();
}

/**
 * Requires auth AND that no other interview is currently active, AND that
 * entitlement (minutes) remains. Intended for the interview-START action
 * specifically (POST /api/interview/sessions, /session/initialize) — per
 * spec Section 5, gating is at the action level, not the page level.
 *
 * Returns a machine-readable `reason` so the frontend can distinguish
 * "resume your existing session" from "show the upgrade modal" without
 * parsing message strings.
 */
async function requireInterviewEntitlement(req, res, next) {
  const capabilities = await getCapabilities(req);
  if (!capabilities.isAuthenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.capabilities = capabilities;

  if (capabilities.interviewEntitlement.hasActiveInterview) {
    return res.status(409).json({
      error: 'An interview session is already active',
      reason: 'ACTIVE_SESSION_EXISTS',
    });
  }
  if (!capabilities.actions.canStartInterview) {
    return res.status(403).json({
      error: 'Interview entitlement exhausted',
      reason: 'ENTITLEMENT_EXHAUSTED',
      entitlement: capabilities.interviewEntitlement,
    });
  }

  const { getUserById } = require('../db/auth');
  req.user = await getUserById(req.cookies.user_id);
  next();
}

// ── Page guards (redirects, Intent-Return pattern) ──────────────────────

/**
 * Requires authentication for a rendered page. Preserves the originally
 * requested URL via ?next=, standardizing what server.js currently does
 * inconsistently (some page routes pass next=, some don't).
 */
async function requireAuthPage(req, res, next) {
  const capabilities = await getCapabilities(req);
  if (!capabilities.isAuthenticated) {
    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  }
  req.capabilities = capabilities;
  // Several page routes (dashboard/history, resume, settings) immediately
  // did their own getUserById(userId) right after the old inline check —
  // attaching it here means those call sites use req.user directly instead
  // of re-fetching the same row a second time.
  const { getUserById } = require('../db/auth');
  req.user = await getUserById(req.cookies.user_id);
  next();
}

module.exports = {
  requireAuth,
  requireInterviewEntitlement,
  requireAuthPage,
};
