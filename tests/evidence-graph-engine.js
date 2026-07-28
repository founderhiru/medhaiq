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
// Part 6 — Milestone 2B: Validation against realistic interview scenarios
// The five explicit checks requested: same-experience reuse, different-
// experience diversity, STAR-complete vs incomplete, behavioral evidence
// tied to the correct experience, and coverage summaries matching the
// actual transcript.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 6 — Milestone 2B: validation against realistic interview scenarios\n');

// (TIER_MODERATE, TIER_STRONG, TIER_NONE already declared above — reused directly)

check('SCENARIO A — multiple observations from the SAME experience are correctly attributed to one experience', () => {
  const qaPairs = [
    { question: 'Q1', answer: 'I led the Salesforce migration for the insurance client.', score: 78, wasSkipped: false, storyKey: 'SALESFORCE', competency: 'leadership' },
    { question: 'Q1 fu', answer: 'I convinced the business team Salesforce was the right call.', score: 76, wasSkipped: false, storyKey: 'SALESFORCE', competency: 'leadership' },
    { question: 'Q3 (later, same story revisited)', answer: 'Circling back to that Salesforce project, the contract closed at $3M.', score: 80, wasSkipped: false, storyKey: 'SALESFORCE', competency: 'communication' },
  ];
  const hypothesisMap = { leadership: { evidenceTier: TIER_STRONG }, communication: { evidenceTier: TIER_MODERATE } };
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, {});
  assert.strictEqual(graph.getExperiences().length, 1, 'all three turns share one story_key -> exactly one Experience');
  const leadershipSummary = graph.getCoverageSummary('competency', 'leadership');
  assert.strictEqual(leadershipSummary.distinctExperienceCount, 1, 'leadership evidence came from just 1 experience, even though it was observed once here');
  const exp = graph.getExperience('story:SALESFORCE');
  assert.deepStrictEqual(exp.turnIndices, [0, 1, 2], 'the experience must record all three turns that touched it');
});

check('SCENARIO B — multiple observations from DIFFERENT experiences are correctly kept distinct', () => {
  const qaPairs = [
    { question: 'Q1', answer: 'I led a cloud migration at my previous company.', score: 75, wasSkipped: false, storyKey: 'STORY_X', competency: 'leadership' },
    { question: 'Q2', answer: 'I aligned five VPs with competing priorities on a fresh initiative.', score: 70, wasSkipped: false, storyKey: null, competency: 'leadership' },
    { question: 'Q3', answer: 'I championed a modernization initiative at another org.', score: 74, wasSkipped: false, storyKey: 'STORY_Y', competency: 'leadership' },
  ];
  const hypothesisMap = { leadership: { evidenceTier: TIER_STRONG } };
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, {});
  assert.strictEqual(graph.getExperiences().length, 3, 'three genuinely different experiences must remain three, not collapsed');
  const summary = graph.getCoverageSummary('competency', 'leadership');
  assert.strictEqual(summary.totalObservations, 3);
  assert.strictEqual(summary.distinctExperienceCount, 3, 'THE key distinction Evidence Graph exists for: breadth is visible here, unlike Scenario A');
});

check('SCENARIO C — STAR-complete vs STAR-incomplete evidence is correctly distinguished per node', () => {
  const completeAnswer = 'The situation was a merger. My task was to align teams. I led the transformation and drove adoption across five departments. As a result we saved millions and secured a renewal.';
  const incompleteAnswer = 'I worked on some stuff with the team, it was fine I guess.';
  const qaPairs = [
    { question: 'Q1', answer: completeAnswer, score: 85, wasSkipped: false, storyKey: 'STORY_COMPLETE', competency: 'leadership' },
    { question: 'Q2', answer: incompleteAnswer, score: 40, wasSkipped: false, storyKey: 'STORY_INCOMPLETE', competency: 'leadership' },
  ];
  const hypothesisMap = { leadership: { evidenceTier: TIER_MODERATE } };
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, {});
  const completeNode = graph.getEvidenceForExperience('story:STORY_COMPLETE')[0];
  const incompleteNode = graph.getEvidenceForExperience('story:STORY_INCOMPLETE')[0];
  assert.strictEqual(completeNode.starComplete, true, 'a genuinely STAR-complete answer must be flagged as such');
  assert.strictEqual(incompleteNode.starComplete, false, 'a fragmentary answer must NOT be flagged as STAR-complete');
});

check('SCENARIO D — behavioral evidence is linked to the CORRECT experience, not just recorded loosely', () => {
  const qaPairs = [
    { question: 'Q1', answer: 'I led the transformation across the org.', score: 80, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
    { question: 'Q2', answer: 'I aligned five VPs with competing priorities.', score: 72, wasSkipped: false, storyKey: 'STORY_B', competency: 'strategy' },
  ];
  const hypothesisMap = { leadership: { evidenceTier: TIER_STRONG }, strategy: { evidenceTier: TIER_MODERATE } };
  const behavioralHypothesisMap = { change_leadership: { evidenceTier: TIER_MODERATE }, stakeholder_management: { evidenceTier: TIER_MODERATE } };
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, behavioralHypothesisMap);

  const changeLeadershipNodes = graph.getEvidenceForBehavior('change_leadership');
  assert.strictEqual(changeLeadershipNodes.length, 1);
  assert.strictEqual(changeLeadershipNodes[0].experienceId, 'story:STORY_A', 'change_leadership evidence ("led the transformation") must be tied to STORY_A specifically, not STORY_B');

  const stakeholderNodes = graph.getEvidenceForBehavior('stakeholder_management');
  assert.strictEqual(stakeholderNodes.length, 1);
  assert.strictEqual(stakeholderNodes[0].experienceId, 'story:STORY_B', 'stakeholder_management evidence ("aligned five VPs") must be tied to STORY_B specifically, not STORY_A');
});

check('SCENARIO E — coverage summaries match the actual transcript exactly (no over- or under-counting)', () => {
  const qaPairs = [
    { question: 'Q1', answer: 'I led the transformation across the org.', score: 80, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
    { question: 'Q1 fu', answer: 'I convinced the board with a clear cost model.', score: 78, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
    { question: 'Q2 (skipped)', answer: '', score: null, wasSkipped: true, storyKey: null, competency: 'communication' },
    { question: 'Q3', answer: 'I built a small internal tool over a weekend.', score: 55, wasSkipped: false, storyKey: null, competency: 'communication' },
  ];
  const hypothesisMap = { leadership: { evidenceTier: TIER_STRONG }, communication: { evidenceTier: TIER_NONE } };
  const graph = buildEvidenceGraph(qaPairs, hypothesisMap, {});
  const leadership = graph.getCoverageSummary('competency', 'leadership');
  assert.strictEqual(leadership.totalObservations, 2, 'exactly 2 real (non-skipped) leadership turns');
  assert.strictEqual(leadership.distinctExperienceCount, 1, 'both from the same story');
  const communication = graph.getCoverageSummary('competency', 'communication');
  assert.strictEqual(communication.totalObservations, 1, 'the skipped turn must NOT be counted — only the one real communication turn');
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 7 — Milestone 2B: full query API correctness
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 7 — Milestone 2B: query API correctness\n');

const apiTestQaPairs = [
  { question: 'Q1', answer: 'I led the transformation and convinced the board.', score: 82, wasSkipped: false, storyKey: 'STORY_A', competency: 'leadership' },
  { question: 'Q1 fu', answer: 'I communicated the plan clearly across teams.', score: 80, wasSkipped: false, storyKey: 'STORY_A', competency: 'communication' },
  { question: 'Q2', answer: 'I aligned five VPs with competing priorities.', score: 70, wasSkipped: false, storyKey: null, competency: 'strategy' },
];
const apiHypothesisMap = { leadership: { evidenceTier: TIER_STRONG }, communication: { evidenceTier: TIER_MODERATE }, strategy: { evidenceTier: TIER_MODERATE } };
const apiBehavioralMap = { executive_influence: { evidenceTier: TIER_MODERATE } };

check('getExperience(id) / getExperiences() — single and full retrieval', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  assert.strictEqual(graph.getExperience('story:STORY_A').type, 'resume_story');
  assert.strictEqual(graph.getExperience('does-not-exist'), undefined);
  assert.strictEqual(graph.getExperiences().length, 2);
});

check('getEvidenceForCompetency() / getEvidenceForBehavior() — dimension-scoped retrieval', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  assert.strictEqual(graph.getEvidenceForCompetency('leadership').length, 1);
  assert.strictEqual(graph.getEvidenceForBehavior('executive_influence').length, 1);
  assert.ok(graph.getEvidenceForCompetency('leadership').every((n) => n.dimension === 'competency'));
  assert.ok(graph.getEvidenceForBehavior('executive_influence').every((n) => n.dimension === 'behavioral'));
});

check('getCoverageSummary() with no arguments returns the full summary array; with two arguments, unchanged single-summary behavior', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const full = graph.getCoverageSummary();
  assert.ok(Array.isArray(full));
  assert.ok(full.length >= 3);
  const single = graph.getCoverageSummary('competency', 'leadership');
  assert.strictEqual(single.dimension, 'competency');
  assert.strictEqual(single.key, 'leadership');
  const fromFull = full.find((s) => s.dimension === 'competency' && s.key === 'leadership');
  assert.deepStrictEqual(fromFull, single, 'the no-arg and two-arg forms must agree for the same key');
});

check('getExperienceCoverage() — inverse view, per experience, matches getEvidenceForExperience()', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const coverage = graph.getExperienceCoverage();
  const storyAEntry = coverage.find((c) => c.experienceId === 'story:STORY_A');
  const rawNodes = graph.getEvidenceForExperience('story:STORY_A');
  assert.strictEqual(storyAEntry.keysCovered.length, rawNodes.length, 'STORY_A touched 3 distinct keys with no duplicate observations in this scenario');
  assert.ok(storyAEntry.keysCovered.some((k) => k.key === 'leadership'));
  assert.ok(storyAEntry.keysCovered.some((k) => k.key === 'communication'));
  assert.ok(storyAEntry.keysCovered.some((k) => k.key === 'executive_influence'));
});

check('getCompetencyCoverage() / getBehavioralCoverage() — dimension-filtered summaries never cross-contaminate', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const compCoverage = graph.getCompetencyCoverage();
  const behCoverage = graph.getBehavioralCoverage();
  assert.ok(compCoverage.every((s) => s.dimension === 'competency'));
  assert.ok(behCoverage.every((s) => s.dimension === 'behavioral'));
  assert.strictEqual(compCoverage.length + behCoverage.length, graph.getObservedKeys().length, 'every observed key must land in exactly one of the two filtered views');
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 8 — Milestone 2B: expanded immutability / determinism checks
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 8 — Milestone 2B: immutability and determinism\n');

check('Every node returned by every query method is frozen — no query method exposes a mutable node', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const allNodes = [
    ...graph.getAllEvidenceNodes(),
    ...graph.getEvidenceForCompetency('leadership'),
    ...graph.getEvidenceForBehavior('executive_influence'),
    ...graph.getEvidenceForExperience('story:STORY_A'),
    ...graph.getEvidenceForTurn(0),
  ];
  assert.ok(allNodes.length > 0);
  assert.ok(allNodes.every((n) => Object.isFrozen(n)), 'every node from every retrieval path must be frozen');
});

check('Building the same qaPairs twice produces identical coverage summaries (deterministic, no hidden state)', () => {
  const graphA = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const graphB = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const summaryA = graphA.getCoverageSummary('competency', 'leadership');
  const summaryB = graphB.getCoverageSummary('competency', 'leadership');
  assert.strictEqual(summaryA.totalObservations, summaryB.totalObservations);
  assert.strictEqual(summaryA.distinctExperienceCount, summaryB.distinctExperienceCount);
  assert.strictEqual(summaryA.bestTierLabel, summaryB.bestTierLabel);
});

check('Repeated calls to the same query method return equivalent (though not necessarily identical-reference) results', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const first = graph.getCoverageSummary('competency', 'leadership');
  const second = graph.getCoverageSummary('competency', 'leadership');
  assert.deepStrictEqual(first, second);
});

check('dumpGraph() produces a readable, structurally correct dump matching the graph contents', () => {
  const graph = buildEvidenceGraph(apiTestQaPairs, apiHypothesisMap, apiBehavioralMap);
  const dump = graph.dumpGraph();
  assert.ok(dump.includes('EvidenceGraph'));
  assert.ok(dump.includes('EXP-1'));
  assert.ok(dump.includes('EXP-2'));
  assert.ok(dump.includes('Leadership'));
  assert.ok(dump.includes('Observations:'));
  assert.ok(dump.includes('Experiences:'));
});

check('dumpGraph() on an empty graph does not throw and reports emptiness clearly', () => {
  const emptyGraph = buildEvidenceGraph([], {}, {});
  const dump = emptyGraph.dumpGraph();
  assert.ok(dump.includes('(none yet)'));
  assert.ok(dump.includes('(no evidence recorded yet)'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
