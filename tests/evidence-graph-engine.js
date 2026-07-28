// ═══════════════════════════════════════════════════════════════════════════
// tests/evidence-graph-engine.js
//
// Regression suite for Milestone 2A — Evidence Graph (2026-07-29,
// founder-approved scope). Log-only, read-only aggregation layer.
// Verifies:
//   - the three founder-approved refinements (rich Experience entity,
//     immutable EvidenceNode, first-class EvidenceGraph object)
//   - correct experience grouping for story-backed vs. no-story turns
//   - correct coverage summaries (the actual new value: distinct
//     experience count, not just observation count)
//   - buildInterviewSnapshot's return shape remains EXACTLY unchanged —
//     the structural proof that nothing downstream can consume this data
//     yet, mirroring the same test discipline used for Phase 2B
//
// Run with: node tests/evidence-graph-engine.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

const { Experience, createEvidenceNode, EvidenceGraph, buildEvidenceGraph } = require(
  path.join(__dirname, '..', 'services', 'evidence-graph', 'evidence-graph-engine')
);

console.log('Evidence Graph (Milestone 2A) — regression suite\n');

const TIER_MODERATE = { level: 2, label: 'Moderate Evidence', needsVerification: true };
const TIER_STRONG = { level: 3, label: 'Strong Evidence', needsVerification: false };
const TIER_NONE = { level: 0, label: 'No Evidence', needsVerification: true };

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — Refinement 1: Experience is a rich entity
// ═══════════════════════════════════════════════════════════════════════════
console.log('Part 1 — Experience entity\n');

check('Experience carries id, type, origin, timestamps, and turn membership', () => {
  const exp = new Experience({ id: 'story:X', type: 'resume_story', origin: 'X', firstTurnIdx: 0 });
  assert.strictEqual(exp.id, 'story:X');
  assert.strictEqual(exp.type, 'resume_story');
  assert.strictEqual(exp.origin, 'X');
  assert.strictEqual(exp.firstTurnIdx, 0);
  assert.deepStrictEqual(exp.turnIndices, [0]);
  assert.ok(exp.createdAt);
});

check('addTurn() accumulates turn membership without duplicating', () => {
  const exp = new Experience({ id: 'story:X', type: 'resume_story', origin: 'X', firstTurnIdx: 0 });
  exp.addTurn(1);
  exp.addTurn(1); // duplicate call must not double-add
  assert.deepStrictEqual(exp.turnIndices, [0, 1]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — Refinement 2: EvidenceNode is immutable
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 2 — EvidenceNode immutability\n');

check('createEvidenceNode returns a frozen object', () => {
  const node = createEvidenceNode({ dimension: 'competency', key: 'leadership', turnIdx: 0, experienceId: 'story:X', evidenceTier: TIER_STRONG, starComplete: true });
  assert.ok(Object.isFrozen(node));
});

check('Attempting to mutate a node does not change its value', () => {
  const node = createEvidenceNode({ dimension: 'competency', key: 'leadership', turnIdx: 0, experienceId: 'story:X', evidenceTier: TIER_STRONG, starComplete: true });
  try { node.evidenceTier = TIER_NONE; } catch (e) { /* strict mode may throw -- either way, value must not change */ }
  assert.strictEqual(node.evidenceTier, TIER_STRONG);
});

check('Confidence changes happen by adding a NEW node, not editing an old one', () => {
  const graph = new EvidenceGraph();
  const nodeA = createEvidenceNode({ dimension: 'competency', key: 'leadership', turnIdx: 0, experienceId: 'story:X', evidenceTier: TIER_MODERATE, starComplete: false });
  graph.addEvidenceNode(nodeA);
  const nodeB = createEvidenceNode({ dimension: 'competency', key: 'leadership', turnIdx: 1, experienceId: 'story:X', evidenceTier: TIER_STRONG, starComplete: true });
  graph.addEvidenceNode(nodeB);
  assert.strictEqual(graph.evidenceNodes.length, 2, 'both observations must coexist');
  assert.strictEqual(nodeA.evidenceTier, TIER_MODERATE, 'the original node must remain exactly as it was created');
  assert.strictEqual(graph.getCoverageSummary('competency', 'leadership').bestTierLabel, 'Strong Evidence', 'aggregation surfaces the best tier without touching either node');
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 3 — Refinement 3: EvidenceGraph is a first-class object
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 3 — EvidenceGraph as a first-class object\n');

check('EvidenceGraph owns both experiences and evidenceNodes internally', () => {
  const graph = new EvidenceGraph();
  assert.ok(graph.experiences instanceof Map);
  assert.ok(Array.isArray(graph.evidenceNodes));
});

check('getOrCreateExperience reuses an existing experience by id rather than duplicating it', () => {
  const graph = new EvidenceGraph();
  const a = graph.getOrCreateExperience({ id: 'story:X', type: 'resume_story', origin: 'X', turnIdx: 0 });
  const b = graph.getOrCreateExperience({ id: 'story:X', type: 'resume_story', origin: 'X', turnIdx: 1 });
  assert.strictEqual(a, b, 'must be the same Experience instance');
  assert.strictEqual(graph.experiences.size, 1);
  assert.deepStrictEqual(a.turnIndices, [0, 1]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 4 — buildEvidenceGraph: the actual value proposition
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 4 — buildEvidenceGraph: experience grouping and coverage summaries\n');

const hypothesisMap = {
  leadership: { evidenceTier: TIER_STRONG },
  strategy: { evidenceTier: TIER_MODERATE },
};
const behavioralHypothesisMap = {
  executive_influence: { evidenceTier: TIER_MODERATE },
  stakeholder_management: { evidenceTier: TIER_MODERATE },
};

check('A primary + follow-up sharing the same story_key are grouped into ONE experience', () => {
  const qaPairs = [
    { question: 'Q1', answer: 'I led the transformation across the org.', score: 82, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
    { question: 'Q1 follow-up', answer: 'I convinced the board with a cost model.', score: 78, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
  ];
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, behavioralHypothesisMap);
  assert.strictEqual(graph.experiences.size, 1);
  const summary = graph.getCoverageSummary('competency', 'leadership');
  assert.strictEqual(summary.totalObservations, 2, 'two turns of evidence');
  assert.strictEqual(summary.distinctExperienceCount, 1, 'THE core value: same story used twice is now visible as 1 experience, not 2');
});

check('Two different no-story turns are correctly treated as two distinct experiences', () => {
  const qaPairs = [
    { question: 'Q2', answer: 'I aligned five VPs with competing priorities.', score: 70, wasSkipped: false, storyKey: null, competency: 'strategy' },
    { question: 'Q3', answer: 'I led the modernization initiative across the org.', score: 72, wasSkipped: false, storyKey: null, competency: 'strategy' },
  ];
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, behavioralHypothesisMap);
  assert.strictEqual(graph.experiences.size, 2, 'two distinct no-story turns must be two distinct experiences');
});

check('A skipped turn produces NO evidence nodes at all', () => {
  const qaPairs = [
    { question: 'Q1', answer: '', score: null, wasSkipped: true, storyKey: null, competency: 'leadership' },
  ];
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, behavioralHypothesisMap);
  assert.strictEqual(graph.evidenceNodes.length, 0);
  assert.strictEqual(graph.experiences.size, 0);
});

check('starComplete is correctly true only for a genuinely STAR-complete answer', () => {
  const qaPairs = [
    { question: 'Q1', answer: 'The situation was a merger. My task was to align teams. I led the transformation and drove adoption across five departments. As a result we saved millions and secured a renewal.', score: 85, wasSkipped: false, storyKey: 'STORY_B', competency: 'leadership' },
  ];
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, behavioralHypothesisMap);
  const node = graph.getNodesFor('competency', 'leadership')[0];
  assert.strictEqual(node.starComplete, true);
});

check('Empty qaPairs produces an empty, valid graph without throwing', () => {
  const graph = buildEvidenceGraph([], hypothesisMap, behavioralHypothesisMap);
  assert.strictEqual(graph.experiences.size, 0);
  assert.strictEqual(graph.evidenceNodes.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 5 — Integration: buildInterviewSnapshot's return shape is untouched
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 5 — Integration: log-only, no downstream consumers\n');

function loadInterviewModuleWithTestExports() {
  const fullPath = path.join(__dirname, '..', 'services', 'interview.js');
  const original = fs.readFileSync(fullPath, 'utf8');
  const patched = original.replace(
    /module\.exports = \{([\s\S]*?)\};/,
    (m, inner) => {
      const t = inner.replace(/\s+$/, '');
      const withComma = t.endsWith(',') ? t : t + ',';
      return `module.exports = {${withComma}\n  __test_buildInterviewSnapshot: buildInterviewSnapshot,\n};`;
    }
  );
  const tempPath = fullPath.replace(/\.js$/, '.__test_shim_evidencegraph__.js');
  fs.writeFileSync(tempPath, patched);
  try {
    delete require.cache[require.resolve(tempPath)];
    return require(tempPath);
  } finally {
    fs.unlinkSync(tempPath);
  }
}

check('buildInterviewSnapshot return shape is EXACTLY unchanged after Evidence Graph integration (roleKey, priority, currentTurn, memoryMap, hypothesisMap, globalMaturityTiers only)', () => {
  const iv = loadInterviewModuleWithTestExports();
  const qaPairs = [
    { question: 'Q1', answer: 'I led the transformation across the org.', score: 82, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
  ];
  const snapshot = iv.__test_buildInterviewSnapshot({ roleTitle: 'Product Manager', qaPairs, questionCount: 1 });
  assert.deepStrictEqual(
    Object.keys(snapshot).sort(),
    ['currentTurn', 'globalMaturityTiers', 'hypothesisMap', 'memoryMap', 'priority', 'roleKey'].sort()
  );
});

check('buildInterviewSnapshot does not throw with an empty session (turn 0)', () => {
  const iv = loadInterviewModuleWithTestExports();
  assert.doesNotThrow(() => {
    iv.__test_buildInterviewSnapshot({ roleTitle: 'Product Manager', qaPairs: [], questionCount: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 6 — Future-friendly query methods (non-functional hardening, 2026-07-29)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 6 — Query methods: experience, evidence, summary\n');

const queryTestQaPairs = [
  { question: 'Q1', answer: 'I led the transformation across the org.', score: 82, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
  { question: 'Q1 follow-up', answer: 'I convinced the board with a cost model.', score: 78, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
  { question: 'Q2', answer: 'I aligned five VPs with competing priorities.', score: 70, wasSkipped: false, storyKey: null, competency: 'strategy' },
];

check('getExperience() returns the matching Experience by id, undefined if not found', () => {
  const graph = buildEvidenceGraph(queryTestQaPairs, hypothesisMap, behavioralHypothesisMap);
  assert.strictEqual(graph.getExperience('story:STORY_A').type, 'resume_story');
  assert.strictEqual(graph.getExperience('does-not-exist'), undefined);
});

check('getAllExperiences() and getExperiencesByType() return the correct counts', () => {
  const graph = buildEvidenceGraph(queryTestQaPairs, hypothesisMap, behavioralHypothesisMap);
  assert.strictEqual(graph.getAllExperiences().length, 2);
  assert.strictEqual(graph.getExperiencesByType('resume_story').length, 1);
  assert.strictEqual(graph.getExperiencesByType('no_story_turn').length, 1);
});

check('getAllEvidenceNodes() returns a mutation-safe copy, not the live internal array', () => {
  const graph = buildEvidenceGraph(queryTestQaPairs, hypothesisMap, behavioralHypothesisMap);
  const nodes = graph.getAllEvidenceNodes();
  const originalLength = graph.evidenceNodes.length;
  nodes.push('should not affect the graph');
  assert.strictEqual(graph.evidenceNodes.length, originalLength, 'mutating the returned array must not affect the graph');
});

check('getEvidenceForExperience() returns only nodes tied to that experience', () => {
  const graph = buildEvidenceGraph(queryTestQaPairs, hypothesisMap, behavioralHypothesisMap);
  const nodes = graph.getEvidenceForExperience('story:STORY_A');
  assert.ok(nodes.length > 0);
  assert.ok(nodes.every((n) => n.experienceId === 'story:STORY_A'));
});

check('getEvidenceForTurn() returns only nodes recorded at that turn index', () => {
  const graph = buildEvidenceGraph(queryTestQaPairs, hypothesisMap, behavioralHypothesisMap);
  const nodes = graph.getEvidenceForTurn(0);
  assert.ok(nodes.length > 0);
  assert.ok(nodes.every((n) => n.turnIdx === 0));
});

check('getObservedKeys() lists every distinct (dimension, key) pair present, no duplicates', () => {
  const graph = buildEvidenceGraph(queryTestQaPairs, hypothesisMap, behavioralHypothesisMap);
  const keys = graph.getObservedKeys();
  const asStrings = keys.map((k) => `${k.dimension}:${k.key}`);
  assert.strictEqual(new Set(asStrings).size, asStrings.length, 'no duplicate keys');
  assert.ok(asStrings.includes('competency:leadership'));
  assert.ok(asStrings.includes('competency:strategy'));
});

check('getFullSummary() matches getCoverageSummary() called individually for the same key', () => {
  const graph = buildEvidenceGraph(queryTestQaPairs, hypothesisMap, behavioralHypothesisMap);
  const full = graph.getFullSummary();
  const individual = graph.getCoverageSummary('competency', 'leadership');
  const fromFull = full.find((s) => s.dimension === 'competency' && s.key === 'leadership');
  assert.deepStrictEqual(fromFull, individual);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
