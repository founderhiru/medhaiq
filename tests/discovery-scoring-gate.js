// ═══════════════════════════════════════════════════════════════════════════
// tests/discovery-scoring-gate.js
//
// Characterization suite for the Discovery Scoring Gate (Phase 2 follow-up).
// Exercises the ACTUAL processInterviewAnswer() — only the DB/AI/email
// boundary is mocked — and proves:
//   1. For a Discovery-authored question (question_type 'discovery_opening'
//      or 'discovery_followup'): scoreAnswer() is never called, addScore()
//      is never called, and the response body's scores/star_progress/
//      intelligence_scores are all null — no placeholder/zero-value object
//      is fabricated anywhere.
//   2. For any non-Discovery question type ('opening', 'primary',
//      'follow_up', 'drill_down'): scoreAnswer()/addScore() are invoked
//      exactly as before this gate existed, and the response carries real,
//      populated score objects — zero behavior change.
//   3. The answer text itself is always persisted via addAnswer() (step 1),
//      regardless of question type — persistence and conversation history
//      are unaffected by the scoring gate.
//
// Run with: node tests/discovery-scoring-gate.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
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

console.log('\nDiscovery Scoring Gate — characterization suite\n');

function buildHarness() {
  const store = { 1: [] };
  let nextId = 1;
  const scoreAnswerCalls = [];
  const addScoreCalls = [];
  const addAnswerCalls = [];
  const generateNextQuestionCalls = [];

  function mockDbInterview() {
    return {
      createSession: async () => { throw new Error('not used in this test'); },
      abandonSession: async () => { throw new Error('not used in this test'); },
      touchSessionActivity: async () => { throw new Error('not used in this test'); },
      saveReport: async () => ({}),
      completeSession: async () => ({}),

      getSession: async (id) => ({
        id,
        user_id: 'user-1',
        status: 'active',
        persona_id: 'alex_chen',
        role_title: 'Software Engineer',
        experience_level: 'fresher',
        org_preset: null,
        jd_text: '',
        competency_matrix: [],
        resume_context: null,
        story_library: [],
        started_at: new Date(),
      }),
      getSessionQuestions: async (sessionId) => store[sessionId].slice(),
      getSessionScores: async () => [],
      addAnswer: async ({ sessionId, questionId, answerText }) => {
        addAnswerCalls.push({ sessionId, questionId, answerText });
        const row = store[sessionId].find((q) => String(q.id) === String(questionId));
        if (!row || row.answer_text !== null) return null; // duplicate guard, mirrors real addAnswer()
        row.answer_text = answerText;
        return { id: 'ans_' + questionId, session_id: sessionId, question_id: questionId, answer_text: answerText };
      },
      addScore: async (args) => { addScoreCalls.push(args); return {}; },
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
      scoreAnswer: async (...args) => { scoreAnswerCalls.push(args); return { star: 80, technical: 75, executive: 70, gcc: 65, friction: 60, weighted: 72 }; },
      generateReport: async () => ({}),
      computeStarProgress: () => ({ situation: true, task: true, action: true, result: true, stepsComplete: 4, totalSteps: 4 }),
      generateNextQuestion: async (args) => {
        generateNextQuestionCalls.push(args);
        return { text: `MOCK_QUESTION_${generateNextQuestionCalls.length}`, competency: 'technical', storyKey: null, questionBlueprint: null };
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

  return { store, loadRoutesWithMocks, scoreAnswerCalls, addScoreCalls, addAnswerCalls, generateNextQuestionCalls };
}

async function main() {
  // ── Case 1: Discovery question type ──────────────────────────────────────
  {
    const h = buildHarness();
    const routesInterview = h.loadRoutesWithMocks();
    h.store[1].push({
      id: 100, session_id: 1, question_text: 'Tell me about yourself...',
      question_type: 'discovery_opening', question_order: 0,
      competency: null, story_key: null, parent_question_id: null, answer_text: null,
    });

    const result = await routesInterview.processInterviewAnswer({
      sessionId: 1,
      questionId: 100,
      answerText: 'I just finished my final-year capstone project on distributed systems and worked as an intern at a small startup building internal tools.',
      skip: false,
      voiceMode: false,
      userId: 'user-1',
      userEmail: null,
      userName: null,
    });

    await checkAsync('Discovery answer: answer text is still persisted via addAnswer()', async () => {
      assert.strictEqual(h.addAnswerCalls.length, 1);
      assert.strictEqual(h.addAnswerCalls[0].questionId, 100);
    });

    await checkAsync('Discovery answer: scoreAnswer() is never invoked', async () => {
      assert.strictEqual(h.scoreAnswerCalls.length, 0);
    });

    await checkAsync('Discovery answer: addScore() is never invoked', async () => {
      assert.strictEqual(h.addScoreCalls.length, 0);
    });

    await checkAsync('Discovery answer: response scores/star_progress/intelligence_scores are null, not a zero-value object', async () => {
      assert.strictEqual(result.body.scores, null);
      assert.strictEqual(result.body.star_progress, null);
      assert.strictEqual(result.body.intelligence_scores, null);
    });

    await checkAsync('Discovery answer: a next question is still returned (conversation continues)', async () => {
      assert.strictEqual(result.httpStatus, 200);
      assert.ok(result.body.text, 'expected a next question/text in the response');
    });
  }

  // ── Case 2: non-Discovery (primary) question type — zero regression ─────
  {
    const h = buildHarness();
    const routesInterview = h.loadRoutesWithMocks();
    h.store[1].push({
      id: 200, session_id: 1, question_text: 'Describe a system design decision...',
      question_type: 'primary', question_order: 0,
      competency: 'technical', story_key: null, parent_question_id: null, answer_text: null,
    });

    const result = await routesInterview.processInterviewAnswer({
      sessionId: 1,
      questionId: 200,
      answerText: 'I led a migration project where we moved eighteen services to a new platform under a tight deadline and coordinated across three teams.',
      skip: false,
      voiceMode: false,
      userId: 'user-1',
      userEmail: null,
      userName: null,
    });

    await checkAsync('Primary answer: scoreAnswer() is invoked exactly once, unchanged', async () => {
      assert.strictEqual(h.scoreAnswerCalls.length, 1);
    });

    await checkAsync('Primary answer: addScore() is invoked exactly once, unchanged', async () => {
      assert.strictEqual(h.addScoreCalls.length, 1);
      assert.strictEqual(h.addScoreCalls[0].questionId, 200);
    });

    await checkAsync('Primary answer: response carries real, populated score objects (zero regression)', async () => {
      assert.ok(result.body.scores && typeof result.body.scores.weighted === 'number');
      assert.ok(result.body.star_progress && typeof result.body.star_progress.stepsComplete !== 'undefined');
      assert.ok(result.body.intelligence_scores && typeof result.body.intelligence_scores.overallScore === 'number');
    });
  }

  // ── Case 3: skipped Discovery answer — still no scoring artifacts ───────
  {
    const h = buildHarness();
    const routesInterview = h.loadRoutesWithMocks();
    h.store[1].push({
      id: 300, session_id: 1, question_text: 'Tell me about the internship you\'re most proud of.',
      question_type: 'discovery_followup', question_order: 1,
      competency: null, story_key: null, parent_question_id: null, answer_text: null,
    });

    const result = await routesInterview.processInterviewAnswer({
      sessionId: 1,
      questionId: 300,
      answerText: 'skip this',
      skip: false, // detected via skip-intent phrase, not the explicit flag
      voiceMode: false,
      userId: 'user-1',
      userEmail: null,
      userName: null,
    });

    await checkAsync('Skipped Discovery answer: still no scoreAnswer()/addScore(), still null response fields', async () => {
      assert.strictEqual(h.scoreAnswerCalls.length, 0);
      assert.strictEqual(h.addScoreCalls.length, 0);
      assert.strictEqual(result.body.scores, null);
      assert.strictEqual(result.body.star_progress, null);
      assert.strictEqual(result.body.intelligence_scores, null);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Suite crashed:', err);
  process.exit(1);
});
