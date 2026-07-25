// ═══════════════════════════════════════════════════════════════════════════
// tests/session-lifecycle-management.js
//
// Regression suite for server-owned session lifecycle management
// (2026-07-24). Replaces the old client-side stale-session cleanup loop
// with server-side auto-recovery: requireInterviewEntitlement now
// auto-abandons a stale ACTIVE session (no heartbeat/activity within
// SESSION_INACTIVITY_TIMEOUT_MINUTES) before ever returning a conflict —
// entirely server-owned, no frontend cleanup logic required. A genuinely
// recent active session (a real second tab) still returns the conflict
// exactly as before this fix.
//
// Run with: node tests/session-lifecycle-management.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
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

console.log('Server-owned session lifecycle management — regression suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — db/interview.js: abandonStaleActiveSession
// ═══════════════════════════════════════════════════════════════════════════
async function runDbLayerTests() {
  function mockPoolWith(sessions) {
    return {
      query: async (sql, params) => {
        if (sql.includes('UPDATE interview_sessions') && sql.includes('SELECT id FROM interview_sessions')) {
          const [userId, confirmedTimeout, unconfirmedTimeout, reason] = params;
          const nowMs = Date.now();
          const candidates = sessions.filter((s) => {
            if (s.user_id !== userId || s.status !== 'active') return false;
            const neverConfirmed = s.last_activity_at.getTime() === s.started_at.getTime();
            if (neverConfirmed) return (nowMs - s.last_activity_at.getTime()) > unconfirmedTimeout * 60000;
            return (nowMs - s.last_activity_at.getTime()) > confirmedTimeout * 60000;
          });
          if (!candidates.length) return { rows: [] };
          candidates.sort((a, b) => a.last_activity_at - b.last_activity_at);
          const target = candidates[0];
          target.status = 'abandoned';
          target.abandoned_reason = reason;
          return { rows: [{ id: target.id }] };
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
  function confirmed(minutesAgo) {
    // Was confirmed active a while back (last_activity_at moved past
    // started_at at some point), then went silent `minutesAgo` ago.
    return { started_at: new Date(now - (minutesAgo + 20) * 60000), last_activity_at: new Date(now - minutesAgo * 60000) };
  }
  function neverConfirmed(minutesAgo) {
    // Created `minutesAgo` ago, never received a single heartbeat —
    // last_activity_at still exactly equals started_at.
    const t = new Date(now - minutesAgo * 60000);
    return { started_at: t, last_activity_at: t };
  }

  await checkAsync('Clears an entire backlog of stale, CONFIRMED sessions in one call (the original reported bug: id=87 then a different id=86)', async () => {
    const sessions = [
      { id: 87, user_id: 1, status: 'active', ...confirmed(15) },
      { id: 86, user_id: 1, status: 'active', ...confirmed(20) },
      { id: 85, user_id: 1, status: 'active', ...confirmed(12) },
    ];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.strictEqual(abandoned.length, 3, 'expected all 3 stale sessions to be abandoned in one call');
    assert.ok(sessions.every((s) => s.status === 'abandoned'));
  });

  await checkAsync('A genuinely recent CONFIRMED session (within the 10-min timeout) is left untouched', async () => {
    const sessions = [{ id: 90, user_id: 1, status: 'active', ...confirmed(2) }];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.strictEqual(abandoned.length, 0, 'a 2-minute-silent confirmed session must not be abandoned under a 10-minute timeout');
    assert.strictEqual(sessions[0].status, 'active');
  });

  await checkAsync('URGENT FOLLOW-UP (same day): NEVER-CONFIRMED sessions from repeated failed test launches are abandoned under the SHORT 2-min timeout, not the full 10-min one', async () => {
    const sessions = [
      { id: 101, user_id: 1, status: 'active', ...neverConfirmed(45) },
      { id: 102, user_id: 1, status: 'active', ...neverConfirmed(30) },
    ];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.strictEqual(abandoned.length, 2, 'both never-confirmed sessions (well past the 2-min unconfirmed timeout) must be cleared');
  });

  await checkAsync('A just-created, never-confirmed session (30 seconds old, under the 2-min grace window) survives — protects a real in-flight launch from a race', async () => {
    const sessions = [{ id: 104, user_id: 1, status: 'active', ...neverConfirmed(0.5) }];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.strictEqual(abandoned.length, 0, 'a 30-second-old unconfirmed session must survive the 2-minute grace window');
    assert.strictEqual(sessions[0].status, 'active');
  });

  await checkAsync('Mixed: a confirmed-recent session AND a just-created-unconfirmed session both survive in the same pass', async () => {
    const sessions = [
      { id: 103, user_id: 1, status: 'active', ...confirmed(5) },
      { id: 104, user_id: 1, status: 'active', ...neverConfirmed(0.5) },
    ];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.deepStrictEqual(abandoned, []);
    assert.ok(sessions.every((s) => s.status === 'active'));
  });

  await checkAsync('Mixed backlog: stale confirmed + stale unconfirmed sessions cleared, one genuinely recent survives', async () => {
    const sessions = [
      { id: 87, user_id: 1, status: 'active', ...confirmed(15) },
      { id: 101, user_id: 1, status: 'active', ...neverConfirmed(45) },
      { id: 90, user_id: 1, status: 'active', ...confirmed(2) },
    ];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.strictEqual(abandoned.length, 2);
    assert.ok(abandoned.includes(87) && abandoned.includes(101));
    assert.strictEqual(sessions.find((s) => s.id === 90).status, 'active', 'the recent session must survive');
  });

  await checkAsync('No active sessions at all -> returns empty array, never throws', async () => {
    const { abandonStaleActiveSession } = loadWithMockPool([]);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.deepStrictEqual(abandoned, []);
  });

  await checkAsync('Reason is correctly persisted per abandoned session', async () => {
    const sessions = [{ id: 87, user_id: 1, status: 'active', ...confirmed(15) }];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    await abandonStaleActiveSession(1, 10, 'heartbeat_timeout', 2);
    assert.strictEqual(sessions[0].abandoned_reason, 'heartbeat_timeout');
  });

  await checkAsync('Backward compatible: omitting the 4th arg (unconfirmedTimeoutMinutes) falls back to the confirmed timeout for everything', async () => {
    const sessions = [{ id: 87, user_id: 1, status: 'active', ...neverConfirmed(15) }];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    // No 4th arg -> effectiveUnconfirmedTimeout defaults to confirmedTimeoutMinutes (10)
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout');
    assert.strictEqual(abandoned.length, 1, 'a 15-minute-old unconfirmed session must still be caught by the 10-min fallback');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — middleware/guards.js: requireInterviewEntitlement decision logic
// ═══════════════════════════════════════════════════════════════════════════
async function runGuardTests() {
  function loadGuardWithMocks({ hasActiveOnFirstCall, abandonedIds }) {
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
      if (id === '../db/interview') return { abandonStaleActiveSession: async () => abandonedIds, findRecoverableSession: async () => null };
      if (id === '../config/plans') return { LIVE_HEARTBEAT_GRACE_PERIOD_MINUTES: 1.5, SESSION_RECOVERY_WINDOW_MINUTES: 10, SESSION_UNCONFIRMED_TIMEOUT_MINUTES: 2 };
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

  await checkAsync('Stale session detected -> auto-abandoned, request proceeds (next() called, no error response)', async () => {
    const { requireInterviewEntitlement } = loadGuardWithMocks({ hasActiveOnFirstCall: true, abandonedIds: [87] });
    const res = mockRes();
    let nextCalled = false;
    await requireInterviewEntitlement({}, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'expected the request to proceed past the guard');
    assert.strictEqual(res._status, null, 'expected no error status to be set');
  });

  await checkAsync('Genuinely recent active session -> still returns 409 ACTIVE_SESSION_EXISTS, request blocked (unchanged behavior)', async () => {
    const { requireInterviewEntitlement } = loadGuardWithMocks({ hasActiveOnFirstCall: true, abandonedIds: [] });
    const res = mockRes();
    let nextCalled = false;
    await requireInterviewEntitlement({}, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false, 'a genuine conflict must not proceed');
    assert.strictEqual(res._status, 409);
    assert.strictEqual(res._body.reason, 'ACTIVE_SESSION_EXISTS');
  });

  await checkAsync('No active session at all -> proceeds normally (baseline, unaffected by this fix)', async () => {
    const { requireInterviewEntitlement } = loadGuardWithMocks({ hasActiveOnFirstCall: false, abandonedIds: [] });
    const res = mockRes();
    let nextCalled = false;
    await requireInterviewEntitlement({}, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res._status, null);
  });
}

(async () => {
  await runDbLayerTests();
  await runGuardTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
