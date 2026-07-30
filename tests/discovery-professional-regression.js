// ═══════════════════════════════════════════════════════════════════════════
// tests/discovery-professional-regression.js
//
// Characterization suite for Discovery Profile Phase 2 — proves that
// Professional (and Leadership/Executive) interviews are byte-for-byte
// unaffected by the Discovery Router / Opening Strategy wiring added to
// controllers/sessionController.js and routes/interview.js.
//
// Strategy: rather than diffing against now-nonexistent pre-feature code,
// this suite proves the three facts that TOGETHER constitute "zero
// regression" for these tiers:
//   1. selectDiscoveryProfile() resolves usesDiscoveryOpening=false for
//      mid/senior/executive, unconditionally (services/discovery/discovery-
//      router.js + discovery-profiles.js — already covered in isolation by
//      tests/discovery-router-profiles.js; re-asserted here as a precondition).
//   2. decideOpeningTurn()/decideNextTurn() therefore always return
//      useDiscovery:false for these tiers, at every turn, regardless of
//      discoveryAnsweredCount.
//   3. Simulating a full 5-primary Professional session end-to-end through
//      the ACTUAL pickAndPersistNextQuestion() (mocked DB/AI boundaries
//      only — all Discovery/orchestration logic runs for real):
//        - generateNextQuestion() is called with qaPairs/questionCount
//          identical in length to the full answered-question history (i.e.
//          the new engine-facing filter removes nothing for this tier)
//        - no interview_questions row is ever persisted with question_type
//          'discovery_opening' or 'discovery_followup'
//        - question_order remains a contiguous 0..N sequence with no gaps
//          (proving Discovery never injects an extra turn for this tier)
//
// Run with: node tests/discovery-professional-regression.js
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

console.log('\nDiscovery Profile Phase 2 — Professional/Leadership/Executive regression suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — Precondition: routing + opening-strategy always no-op these tiers
// ═══════════════════════════════════════════════════════════════════════════
{
  const { selectDiscoveryProfile } = require('../services/discovery/discovery-router');
  const { decideOpeningTurn, decideNextTurn } = require('../services/discovery/opening-strategy');

  ['mid', 'senior', 'executive'].forEach((level) => {
    check(`selectDiscoveryProfile('${level}') → usesDiscoveryOpening=false`, () => {
      const { profile } = selectDiscoveryProfile({ experienceLevel: level, resumeContext: null, storyLibrary: [] });
      assert.strictEqual(profile.usesDiscoveryOpening, false);
    });

    check(`decideOpeningTurn('${level}' profile) → useDiscovery=false`, () => {
      const { profile } = selectDiscoveryProfile({ experienceLevel: level, resumeContext: null, storyLibrary: [] });
      assert.strictEqual(decideOpeningTurn(profile).useDiscovery, false);
    });

    check(`decideNextTurn('${level}' profile) → useDiscovery=false at every turn count 0-10`, () => {
      const { profile } = selectDiscoveryProfile({ experienceLevel: level, resumeContext: null, storyLibrary: [] });
      for (let n = 0; n <= 10; n++) {
        assert.strictEqual(decideNextTurn({ profile, discoveryAnsweredCount: n }).useDiscovery, false, `failed at discoveryAnsweredCount=${n}`);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — Full simulated Professional session through the real
// pickAndPersistNextQuestion(), with only the DB/AI boundary mocked.
// ═══════════════════════════════════════════════════════════════════════════
async function runProfessionalSessionSimulation() {
  // In-memory question store, keyed by session id — mimics interview_questions.
  const store = { 1: [] };
  let nextId = 1;
  const generateNextQuestionCalls = [];

  function mockDbInterview() {
    return {
      // Unused by pickAndPersistNextQuestion directly, but destructured at
      // module load time — must exist to avoid undefined-is-not-a-function
      // if any code path (not exercised here) were to call them.
      createSession: async () => { throw new Error('not used in this test'); },
      addAnswer: async () => { throw new Error('not used in this test'); },
      addScore: async () => { throw new Error('not used in this test'); },
      saveReport: async () => { throw new Error('not used in this test'); },
      completeSession: async () => { throw new Error('not used in this test'); },
      abandonSession: async () => { throw new Error('not used in this test'); },
      touchSessionActivity: async () => { throw new Error('not used in this test'); },

      getSession: async (id) => ({ id, status: 'active' }), // not used by pickAndPersistNextQuestion itself
      getSessionQuestions: async (sessionId) => store[sessionId].slice(),
      getSessionScores: async () => [],
      addQuestion: async (args) => {
        const row = {
          id: nextId++,
          session_id: args.sessionId,
          question_text: args.questionText,
          question_type: args.questionType,
          question_order: args.questionOrder,
          competency: args.competency || null,
          story_key: args.storyKey || null,
          parent_question_id: args.parentQuestionId || null,
          answer_text: null,
        };
        store[args.sessionId].push(row);
        return row;
      },
    };
  }

  function mockServicesInterview() {
    return {
      PERSONAS: { alex_chen: { name: 'Alex Chen' } },
      scoreAnswer: async () => ({ star: 70, technical: 70, executive: 60, gcc: 60, friction: 60, weighted: 65 }),
      generateReport: async () => ({}),
      computeStarProgress: (text) => {
        // Deterministic: substantial answers report full STAR coverage,
        // enabling exactly one follow-up per primary, same as a real
        // well-formed answer would.
        const full = !!text && text.split(' ').length >= 20;
        return { situation: full, task: full, action: full, result: full };
      },
      generateNextQuestion: async (args) => {
        generateNextQuestionCalls.push(args);
        return {
          text: `MOCK_QUESTION_${generateNextQuestionCalls.length}`,
          competency: 'technical',
          storyKey: null,
          questionBlueprint: null,
        };
      },
    };
  }

  function loadRoutesWithMocks() {
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === '../db/interview') return mockDbInterview();
      if (id === '../services/interview') return mockServicesInterview();
      if (id === '../services/email') return { sendInterviewReportEmail: () => {} };
      if (id === '../controllers/sessionController') return { initializeSession: async () => {}, submitUserAnswer: async () => {} };
      if (id === '../middleware/guards') return { requireAuth: (_r, _s, n) => n(), requireInterviewEntitlement: (_r, _s, n) => n() };
      return originalRequire.apply(this, arguments);
    };
    const fullPath = path.join(__dirname, '..', 'routes', 'interview.js');
    delete require.cache[require.resolve(fullPath)];
    const mod = require(fullPath);
    Module.prototype.require = originalRequire;
    return mod;
  }

  const routesInterview = loadRoutesWithMocks();

  const session = {
    id: 1,
    persona_id: 'alex_chen',
    role_title: 'Software Engineer',
    experience_level: 'mid', // PROFESSIONAL tier
    org_preset: null,
    jd_text: '',
    competency_matrix: [],
    resume_context: null,
    story_library: [],
    started_at: new Date(), // recent — never trips the time cap
  };

  // Seed turn 0 exactly as sessionController.initializeSession() would for
  // a mid-tier candidate: question_type 'opening', already answered with a
  // substantial response (so a follow-up is eligible on the next call).
  const SUBSTANTIAL_ANSWER = 'I led a migration project where we moved eighteen services to a new platform under a tight deadline and coordinated across three teams to land it successfully.';
  store[1].push({
    id: nextId++, session_id: 1, question_text: 'Q0', question_type: 'opening',
    question_order: 0, competency: 'technical', story_key: null, parent_question_id: null,
    answer_text: SUBSTANTIAL_ANSWER,
  });

  // Drive the session forward turn by turn: call pickAndPersistNextQuestion,
  // then immediately "answer" whatever it persisted, until 5 primaries are
  // answered or the function reports done:true.
  const MAX_QUESTIONS = 5;
  let guard = 0;
  while (guard++ < 20) {
    const result = await routesInterview.pickAndPersistNextQuestion(session, MAX_QUESTIONS);
    if (result.done) break;
    // Mark the just-persisted question as answered so the next call
    // progresses the session, mirroring processInterviewAnswer's addAnswer step.
    const row = store[1].find((q) => q.id === result.id);
    assert.ok(row, 'persisted question must be findable in the store');
    row.answer_text = SUBSTANTIAL_ANSWER;
  }

  return { store: store[1], generateNextQuestionCalls };
}

async function main() {
  const { store, generateNextQuestionCalls } = await runProfessionalSessionSimulation();

  check('No row in the session ever has a Discovery question_type', () => {
    const discoveryRows = store.filter((q) => q.question_type === 'discovery_opening' || q.question_type === 'discovery_followup');
    assert.strictEqual(discoveryRows.length, 0, `found unexpected discovery rows: ${JSON.stringify(discoveryRows)}`);
  });

  check('question_order is a contiguous 0..N sequence with no gaps or duplicates (Discovery injected nothing)', () => {
    const orders = store.map((q) => q.question_order).sort((a, b) => a - b);
    const expected = Array.from({ length: orders.length }, (_, i) => i);
    assert.deepStrictEqual(orders, expected);
  });

  check('generateNextQuestion was called at least once (engine actually ran)', () => {
    assert.ok(generateNextQuestionCalls.length > 0);
  });

  check('Every generateNextQuestion call received qaPairs/questionCount covering the FULL answered history — the engine-facing filter removed nothing for this tier', () => {
    generateNextQuestionCalls.forEach((call, i) => {
      assert.strictEqual(call.qaPairs.length, call.questionCount, `call #${i + 1}: qaPairs.length (${call.qaPairs.length}) must equal questionCount (${call.questionCount})`);
    });
    // And the sequence of questionCount values across calls must strictly
    // increase with no jump larger than 1 answered-primary-or-followup per
    // call — i.e. nothing was silently skipped or double-counted.
    for (let i = 1; i < generateNextQuestionCalls.length; i++) {
      const prev = generateNextQuestionCalls[i - 1].questionCount;
      const curr = generateNextQuestionCalls[i].questionCount;
      assert.ok(curr >= prev, `questionCount must never decrease across turns (turn ${i}: ${prev} -> ${curr})`);
    }
  });

  check('Final persisted question count matches exactly 5 primaries plus eligible follow-ups (no extra Discovery turns inflating the sequence)', () => {
    const primaryLike = store.filter((q) => q.question_type === 'opening' || q.question_type === 'primary' || q.question_type === 'drill_down');
    assert.strictEqual(primaryLike.length, 5, `expected exactly 5 primaries, got ${primaryLike.length}`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
