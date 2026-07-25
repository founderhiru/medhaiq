// ═══════════════════════════════════════════════════════════════════════════
// tests/session-recovery-three-tier.js
//
// Regression suite for the three-tier session recovery design (2026-07-24
// follow-up). Extends the original server-owned session lifecycle
// management with a middle tier: a confirmed session that's gone quiet
// longer than LIVE_HEARTBEAT_GRACE_PERIOD_MINUTES but is still within
// SESSION_RECOVERY_WINDOW_MINUTES is now offered as Resume/Start New,
// instead of either a permanent 409 (the reported gap) or silent
// auto-resume (explicitly rejected — a live voice interview should never
// restart speaking without the candidate choosing to).
//
// Tier 3 (auto-abandon beyond the window) and Tier 1 (genuinely live,
// real conflict) must remain exactly as they were before this follow-up.
//
// Run with: node tests/session-recovery-three-tier.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Module = require('module');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`      ${err.message}`);
    failed++;
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`      ${err.message}`);
    failed++;
  }
}

console.log('Three-tier session recovery — regression suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — db/interview.js: findRecoverableSession
// ═══════════════════════════════════════════════════════════════════════════
async function runDbLayerTests() {
  function mockPoolWith(sessions) {
    return {
      query: async (sql, params) => {
        if (sql.includes('SELECT s.id') && sql.includes('interview_sessions s')) {
          const [userId, graceMinutes, recoveryWindowMinutes] = params;
          const nowMs = Date.now();
          const graceMs = graceMinutes * 60000;
          const windowMs = recoveryWindowMinutes * 60000;
          const candidates = sessions.filter((s) => {
            if (s.user_id !== userId || s.status !== 'active') return false;
            if (s.last_activity_at.getTime() <= s.started_at.getTime()) return false; // must be confirmed
            const age = nowMs - s.last_activity_at.getTime();
            return age > graceMs && age < windowMs;
          });
          if (!candidates.length) return { rows: [] };
          candidates.sort((a, b) => b.last_activity_at - a.last_activity_at);
          const s = candidates[0];
          return { rows: [{ id: s.id, role_title: s.role_title, persona_id: s.persona_id, started_at: s.started_at, last_activity_at: s.last_activity_at, answered_count: s.answered_count || 0 }] };
        }
        throw new Error('unexpected query shape in mock: ' + sql.slice(0, 80));
      },
    };
  }

  function loadWithMockPool(sessions) {
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === './index') return { pool: mockPoolWith(sessions) };
      return originalRequire.apply(this, arguments);
    };
    const fullPath = path.join(__dirname, '..', 'db', 'interview.js');
    delete require.cache[require.resolve(fullPath)];
    const mod = require(fullPath);
    Module.prototype.require = originalRequire;
    return mod;
  }

  const now = Date.now();
  function confirmedAge(minutesAgo, extra) {
    return { started_at: new Date(now - (minutesAgo + 30) * 60000), last_activity_at: new Date(now - minutesAgo * 60000), ...extra };
  }

  await checkAsync('THE REPORTED GAP: a session quiet for 4 minutes (past 1.5-min grace, within 10-min window) is found as recoverable', async () => {
    const sessions = [{ id: 200, user_id: 1, status: 'active', role_title: 'Product Manager', answered_count: 2, ...confirmedAge(4) }];
    const { findRecoverableSession } = loadWithMockPool(sessions);
    const result = await findRecoverableSession(1, 1.5, 10);
    assert.notStrictEqual(result, null, 'a 4-minute-quiet confirmed session must be found as recoverable');
    assert.strictEqual(result.id, 200);
    assert.strictEqual(result.roleTitle, 'Product Manager');
    assert.strictEqual(result.answeredCount, 2);
  });

  await checkAsync('A session quiet for only 30 seconds (within grace period) is NOT recoverable — genuinely live elsewhere', async () => {
    const sessions = [{ id: 201, user_id: 1, status: 'active', ...confirmedAge(0.5) }];
    const { findRecoverableSession } = loadWithMockPool(sessions);
    const result = await findRecoverableSession(1, 1.5, 10);
    assert.strictEqual(result, null, 'a 30-second-quiet session must NOT be offered recovery — treat as a real conflict instead');
  });

  await checkAsync('A session quiet for 12 minutes (beyond the recovery window) is NOT returned here — that is tier 3 auto-abandon\'s job, not this function\'s', async () => {
    const sessions = [{ id: 202, user_id: 1, status: 'active', ...confirmedAge(12) }];
    const { findRecoverableSession } = loadWithMockPool(sessions);
    const result = await findRecoverableSession(1, 1.5, 10);
    assert.strictEqual(result, null, 'beyond the recovery window must not be offered as recoverable — it should already have been auto-abandoned');
  });

  await checkAsync('A never-confirmed session (last_activity_at === started_at) is never recoverable regardless of age', async () => {
    const t = new Date(now - 5 * 60000);
    const sessions = [{ id: 203, user_id: 1, status: 'active', started_at: t, last_activity_at: t, answered_count: 0 }];
    const { findRecoverableSession } = loadWithMockPool(sessions);
    const result = await findRecoverableSession(1, 1.5, 10);
    assert.strictEqual(result, null, 'a never-confirmed session has no real progress to recover — must not be offered');
  });

  await checkAsync('No active session at all -> null, never throws', async () => {
    const { findRecoverableSession } = loadWithMockPool([]);
    const result = await findRecoverableSession(1, 1.5, 10);
    assert.strictEqual(result, null);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — middleware/guards.js: full three-tier decision logic
// ═══════════════════════════════════════════════════════════════════════════
async function runGuardTests() {
  function loadGuardWithMocks({ hasActiveOnFirstCall, abandonedIds, recoverableSession }) {
    const originalRequire = Module.prototype.require;
    let capabilitiesCallCount = 0;
    Module.prototype.require = function (id) {
      if (id === '../lib/capabilities') {
        return {
          getCapabilities: async () => {
            capabilitiesCallCount++;
            return {
              isAuthenticated: true,
              user: { id: 1 },
              interviewEntitlement: {
                hasActiveInterview: capabilitiesCallCount === 1 ? hasActiveOnFirstCall : false,
                activeSessionId: hasActiveOnFirstCall ? 87 : null,
              },
              actions: { canStartInterview: true },
            };
          },
        };
      }
      if (id === '../db/interview') {
        return {
          abandonStaleActiveSession: async () => abandonedIds,
          findRecoverableSession: async () => recoverableSession,
        };
      }
      if (id === '../config/plans') {
        return { LIVE_HEARTBEAT_GRACE_PERIOD_MINUTES: 1.5, SESSION_RECOVERY_WINDOW_MINUTES: 10, SESSION_UNCONFIRMED_TIMEOUT_MINUTES: 2 };
      }
      return originalRequire.apply(this, arguments);
    };
    const fullPath = path.join(__dirname, '..', 'middleware', 'guards.js');
    delete require.cache[require.resolve(fullPath)];
    const mod = require(fullPath);
    Module.prototype.require = originalRequire;
    return mod;
  }

  function mockRes() {
    const res = { _status: null, _body: null };
    res.status = (code) => { res._status = code; return { json: (body) => { res._body = body; } }; };
    return res;
  }

  await checkAsync('Tier 2 (NEW): recoverable session -> 409 with recoverable:true and session info, request blocked pending candidate choice', async () => {
    const { requireInterviewEntitlement } = loadGuardWithMocks({
      hasActiveOnFirstCall: true,
      abandonedIds: [],
      recoverableSession: { id: 87, roleTitle: 'Product Manager', answeredCount: 2, lastActiveAt: new Date() },
    });
    const res = mockRes();
    let nextCalled = false;
    await requireInterviewEntitlement({}, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res._status, 409);
    assert.strictEqual(res._body.recoverable, true);
    assert.strictEqual(res._body.session.id, 87);
    assert.strictEqual(res._body.session.answeredCount, 2);
  });

  await checkAsync('Tier 1 (unchanged): genuinely live session -> 409 with recoverable:false, no session info offered', async () => {
    const { requireInterviewEntitlement } = loadGuardWithMocks({ hasActiveOnFirstCall: true, abandonedIds: [], recoverableSession: null });
    const res = mockRes();
    let nextCalled = false;
    await requireInterviewEntitlement({}, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res._status, 409);
    assert.strictEqual(res._body.recoverable, false);
    assert.strictEqual(res._body.session, undefined);
  });

  await checkAsync('Tier 3 (unchanged): stale session auto-abandoned -> request proceeds automatically, no recovery offer needed', async () => {
    const { requireInterviewEntitlement } = loadGuardWithMocks({ hasActiveOnFirstCall: true, abandonedIds: [87], recoverableSession: null });
    const res = mockRes();
    let nextCalled = false;
    await requireInterviewEntitlement({}, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res._status, null);
  });

  await checkAsync('No active session at all -> proceeds normally (baseline, unaffected)', async () => {
    const { requireInterviewEntitlement } = loadGuardWithMocks({ hasActiveOnFirstCall: false, abandonedIds: [], recoverableSession: null });
    const res = mockRes();
    let nextCalled = false;
    await requireInterviewEntitlement({}, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res._status, null);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 3 — abandonSession's reason allowlist (trust boundary for the new
// client-supplied 'superseded_by_new_session' outcome)
// ═══════════════════════════════════════════════════════════════════════════
async function runAbandonReasonTests() {
  function mockPoolCapturing(capturedReasons) {
    return {
      query: async (sql, params) => {
        capturedReasons.push(params[1]);
        return { rows: [] };
      },
    };
  }
  function loadWithMockPool(capturedReasons) {
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === './index') return { pool: mockPoolCapturing(capturedReasons) };
      return originalRequire.apply(this, arguments);
    };
    const fullPath = path.join(__dirname, '..', 'db', 'interview.js');
    delete require.cache[require.resolve(fullPath)];
    const mod = require(fullPath);
    Module.prototype.require = originalRequire;
    return mod;
  }

  await checkAsync("'superseded_by_new_session' (the new Start New outcome) is accepted and stored as-is", async () => {
    const captured = [];
    const { abandonSession } = loadWithMockPool(captured);
    await abandonSession(500, 'superseded_by_new_session');
    assert.strictEqual(captured[0], 'superseded_by_new_session');
  });

  await checkAsync('Existing reasons (browser_closed, heartbeat_timeout) still work unchanged', async () => {
    const captured = [];
    const { abandonSession } = loadWithMockPool(captured);
    await abandonSession(501, 'browser_closed');
    await abandonSession(502, 'heartbeat_timeout');
    assert.deepStrictEqual(captured, ['browser_closed', 'heartbeat_timeout']);
  });

  await checkAsync('No reason (voluntary End Session) still stores NULL, distinct from every explicit reason', async () => {
    const captured = [];
    const { abandonSession } = loadWithMockPool(captured);
    await abandonSession(503);
    assert.strictEqual(captured[0], null);
  });

  await checkAsync('An arbitrary, non-allowlisted client-supplied reason is silently downgraded to NULL, not stored verbatim', async () => {
    const captured = [];
    const { abandonSession } = loadWithMockPool(captured);
    await abandonSession(504, 'anything_a_client_could_send');
    assert.strictEqual(captured[0], null, 'a non-allowlisted reason must never reach the database as-is');
  });
}

(async () => {
  await runDbLayerTests();
  await runGuardTests();
  await runAbandonReasonTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
