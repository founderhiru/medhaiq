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
          const [userId, timeoutMinutes, reason] = params;
          const cutoffMs = Date.now() - timeoutMinutes * 60000;
          const candidates = sessions.filter((s) => s.user_id === userId && s.status === 'active' && s.last_activity_at.getTime() < cutoffMs);
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

  await checkAsync('Clears an entire backlog of stale sessions in one call (the exact reported bug: id=87 then a different id=86)', async () => {
    const sessions = [
      { id: 87, user_id: 1, status: 'active', last_activity_at: new Date(Date.now() - 15 * 60000) },
      { id: 86, user_id: 1, status: 'active', last_activity_at: new Date(Date.now() - 20 * 60000) },
      { id: 85, user_id: 1, status: 'active', last_activity_at: new Date(Date.now() - 12 * 60000) },
    ];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout');
    assert.strictEqual(abandoned.length, 3, 'expected all 3 stale sessions to be abandoned in one call');
    assert.ok(sessions.every((s) => s.status === 'abandoned'));
  });

  await checkAsync('A genuinely recent session (within the timeout) is left untouched', async () => {
    const sessions = [
      { id: 90, user_id: 1, status: 'active', last_activity_at: new Date(Date.now() - 2 * 60000) },
    ];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout');
    assert.strictEqual(abandoned.length, 0, 'a 2-minute-old session must not be abandoned under a 10-minute timeout');
    assert.strictEqual(sessions[0].status, 'active');
  });

  await checkAsync('A mixed backlog: stale sessions are abandoned, the one recent session survives', async () => {
    const sessions = [
      { id: 87, user_id: 1, status: 'active', last_activity_at: new Date(Date.now() - 15 * 60000) },
      { id: 90, user_id: 1, status: 'active', last_activity_at: new Date(Date.now() - 2 * 60000) },
    ];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout');
    assert.deepStrictEqual(abandoned, [87]);
    assert.strictEqual(sessions.find((s) => s.id === 90).status, 'active', 'the recent session must survive');
  });

  await checkAsync('No active sessions at all -> returns empty array, never throws', async () => {
    const { abandonStaleActiveSession } = loadWithMockPool([]);
    const abandoned = await abandonStaleActiveSession(1, 10, 'heartbeat_timeout');
    assert.deepStrictEqual(abandoned, []);
  });

  await checkAsync('Reason is correctly persisted per abandoned session', async () => {
    const sessions = [{ id: 87, user_id: 1, status: 'active', last_activity_at: new Date(Date.now() - 15 * 60000) }];
    const { abandonStaleActiveSession } = loadWithMockPool(sessions);
    await abandonStaleActiveSession(1, 10, 'heartbeat_timeout');
    assert.strictEqual(sessions[0].abandoned_reason, 'heartbeat_timeout');
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
      if (id === '../db/interview') return { abandonStaleActiveSession: async () => abandonedIds };
      if (id === '../config/plans') return { SESSION_INACTIVITY_TIMEOUT_MINUTES: 10 };
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
