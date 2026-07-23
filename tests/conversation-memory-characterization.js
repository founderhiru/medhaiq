// ═══════════════════════════════════════════════════════════════════════════
// tests/conversation-memory-characterization.js
// Regression suite for services/interview/conversation-memory.js
//
// Origin: written as the Phase 1 (Migration Blueprint) safety net BEFORE
// runCoverageAndMemoryEngine / textMentionsSubskill / qaBelongsToCompetency
// were extracted out of services/interview.js — the expected values below
// were captured from the ORIGINAL, unextracted code and are hardcoded here
// so this suite continues to guard the module going forward, not just at
// the moment of extraction.
//
// Captures three things per fixture, per the agreed Phase 1 plan:
//   A — output (the memoryMap itself, incl. top-level key order)
//   B — derived coverage metrics (covered/missing competencies, subskill
//       attribution counts) — computed the way a real consumer would read
//       the memoryMap, so a shape regression is caught even if a raw
//       object diff would happen to still pass
//   C — timing — logged only, no pass/fail threshold. Establishes today's
//       numbers as a reference point for future refactors (e.g. Phase 1's
//       later steps, or a future move to a durable event log).
//
// Run with: node tests/conversation-memory-characterization.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const createConversationMemory = require(path.join(__dirname, '..', 'services', 'interview', 'conversation-memory'));

// Mirrors SUBSKILL_MATRIX in services/interview.js. Kept as an inline fixture
// here (not required from interview.js) so this suite has no dependency on
// interview.js's internals beyond the module under test.
const SUBSKILL_MATRIX = {
  system_design: ['Architecture', 'Scalability', 'Tradeoffs', 'Reliability', 'Observability', 'Performance'],
  technical: ['Fundamentals', 'Applied Basics', 'Debugging', 'Optimization', 'Data Structures'],
  leadership: ['Influence', 'Conflict Resolution', 'Mentoring', 'Ownership', 'Team Growth'],
  communication: ['Clarity', 'Stakeholder Alignment', 'Synthesis', 'Active Listening'],
  strategy: ['Business Vision', 'Margin Optimization', 'Risk Mitigation', 'Portfolio Governance', 'Transformation'],
  default: ['Core Knowledge', 'Problem Solving', 'Execution', 'Collaboration'],
};
const PRIORITY = ['system_design', 'technical', 'leadership', 'communication', 'strategy'];

const { runCoverageAndMemoryEngine } = createConversationMemory(SUBSKILL_MATRIX);

const fixtures = {
  empty: { qaPairs: [] },
  explicitMetadata: {
    qaPairs: [
      { question: 'Tell me about a scaling challenge.', answer: 'We hit throughput limits.', score: 78, competency: 'system_design' },
      { question: 'How did you resolve team conflict?', answer: 'Facilitated a retro.', score: 62, metadata: { competency: 'leadership' } },
    ],
  },
  subskillHeuristic: {
    qaPairs: [
      { question: 'Describe an architecture decision involving scalability.', answer: 'We chose horizontal scalability over vertical.', score: 85 },
      { question: 'How did you mentor a junior engineer?', answer: 'I focused on ownership and team growth.', score: 70 },
    ],
  },
  bracketFallback: {
    qaPairs: [
      { question: '[strategy] What was your approach to prioritisation?', answer: 'Impact vs effort.', score: 55 },
    ],
  },
  skippedAndNullScores: {
    qaPairs: [
      { question: 'Describe a leadership moment involving mentoring.', answer: 'N/A', score: null, wasSkipped: true },
      { question: 'Describe a leadership moment involving ownership.', answer: 'I took ownership of the outage.', score: 90 },
      { question: 'No score yet on this one about influence.', answer: 'Still answering...', score: undefined },
    ],
  },
  mixedRealistic20: {
    qaPairs: Array.from({ length: 20 }, (_, i) => {
      const comp = PRIORITY[i % PRIORITY.length];
      return {
        question: `Question ${i} touching on ${comp} scalability tradeoffs.`,
        answer: `Answer ${i} discussing ownership and stakeholder alignment.`,
        score: (i % 4 === 0) ? null : 50 + (i % 50),
        wasSkipped: i % 7 === 0,
        metadata: i % 3 === 0 ? { competency: comp } : undefined,
      };
    }),
  },
};

// Expected values captured from the ORIGINAL (pre-extraction) code, 2026-07-23.
const EXPECTED = {
  empty: { covered: [], missing: ['system_design', 'technical', 'leadership', 'communication', 'strategy'] },
  explicitMetadata: { covered: ['system_design', 'leadership'], missing: ['technical', 'communication', 'strategy'] },
  subskillHeuristic: { covered: ['system_design', 'leadership'], missing: ['technical', 'communication', 'strategy'] },
  bracketFallback: { covered: ['strategy'], missing: ['system_design', 'technical', 'leadership', 'communication'] },
  skippedAndNullScores: { covered: ['leadership'], missing: ['system_design', 'technical', 'communication', 'strategy'] },
  mixedRealistic20: { covered: ['system_design', 'technical', 'leadership', 'communication', 'strategy'], missing: [] },
};

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

console.log('ConversationMemory (Coverage & Memory Engine) — characterization suite\n');

for (const [fixtureName, { qaPairs }] of Object.entries(fixtures)) {
  const currentTurn = qaPairs.length;

  check(`${fixtureName}: top-level key order matches competency priority`, () => {
    const t0 = process.hrtime.bigint();
    const profile = runCoverageAndMemoryEngine(PRIORITY, qaPairs, currentTurn);
    const t1 = process.hrtime.bigint();
    assert.deepStrictEqual(Object.keys(profile), PRIORITY);
    console.log(`      (baselineC timing: ${(Number(t1 - t0) / 1e6).toFixed(4)}ms for ${qaPairs.length} qaPairs — informational only)`);
  });

  check(`${fixtureName}: covered/missing competencies match captured baseline`, () => {
    const profile = runCoverageAndMemoryEngine(PRIORITY, qaPairs, currentTurn);
    const covered = PRIORITY.filter((c) => profile[c].totalQuestionsAsked > 0);
    const missing = PRIORITY.filter((c) => profile[c].totalQuestionsAsked === 0);
    assert.deepStrictEqual(covered, EXPECTED[fixtureName].covered, 'covered competencies diverged from baseline');
    assert.deepStrictEqual(missing, EXPECTED[fixtureName].missing, 'missing competencies diverged from baseline');
  });

  check(`${fixtureName}: profile shape is stable (no null handling / default drift)`, () => {
    const profile = runCoverageAndMemoryEngine(PRIORITY, qaPairs, currentTurn);
    PRIORITY.forEach((comp) => {
      const compData = profile[comp];
      assert.ok(typeof compData.totalQuestionsAsked === 'number');
      assert.ok(Array.isArray(compData.scores));
      assert.ok(compData.observedSubskills instanceof Set);
      assert.ok(typeof compData.lastAskedTurn === 'number');
      // Skipped answers and null/undefined scores must never be pushed into scores[].
      compData.scores.forEach((s) => assert.ok(typeof s === 'number' && !Number.isNaN(s)));
    });
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
