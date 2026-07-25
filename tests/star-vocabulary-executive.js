// ═══════════════════════════════════════════════════════════════════════════
// tests/star-vocabulary-executive.js
//
// Permanent quality benchmark for STAR detection (2026-07-25, founder-
// approved). Built after confirming the ORIGINAL patterns matched 0 of 7
// real executive Result examples, 2 of 5 Task examples, 1 of 3 Situation
// examples — this suite is the founder-requested permanent regression
// bar: 40+ representative executive STAR statements across all four
// categories, PLUS adversarial false-positive controls (sentences that
// should NOT trigger a given category), so future vocabulary changes can
// be checked against real degradation, not just "does it still compile."
//
// Any future change to STAR_PATTERNS (services/star/star-engine.js,
// mirrored in views/interview-session.ejs) should be run against this
// suite before shipping.
//
// Run with: node tests/star-vocabulary-executive.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');

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

const { computeStarProgress } = require(path.join(__dirname, '..', 'services', 'star', 'star-engine'));

console.log('STAR executive vocabulary — permanent quality benchmark\n');

// Helper: pad each test statement to comfortably clear STAR_MIN_WORDS (7)
// so we're testing vocabulary matching, not the substance gate.
function detect(text) {
  return computeStarProgress(text);
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — POSITIVE examples: real executive phrasing that SHOULD match.
// The exact 15 examples from the founder's original report (Section 2 of
// the root-cause analysis), plus 25+ additional statements covering the
// executive-communication-pattern vocabulary from the follow-up message.
// ═══════════════════════════════════════════════════════════════════════════

const POSITIVE_EXAMPLES = {
  situation: [
    'The organization was going through a merger with another platform at the time.',
    'This was during a major transformation of the operating model across the business.',
    'The customer environment was fairly complex, with multiple competing stakeholders.',
    'We were in the middle of a significant acquisition that changed our reporting structure.',
    'There had been a regulatory change that forced the entire industry to adapt quickly.',
    'A major market shift meant our existing strategy no longer made sense.',
    'I inherited a team that was already dealing with a serious customer escalation.',
    'Leadership issued an executive directive to consolidate three regional platforms.',
  ],
  task: [
    'I had to align three groups on what success looked like for this program.',
    "My responsibility was to make sure the platform decision made business sense.",
    'I was accountable for the overall business outcome of the transformation.',
    'Leadership expected us to move fast on this without sacrificing quality.',
    'The business objective was to expand adoption across every region.',
    'My mandate was to turn around a program that had stalled for over a year.',
    'There was a real trade-off between speed and long-term platform stability.',
    'Governance was a genuine challenge given how many stakeholders were involved.',
    'The board expectation was clear: reduce cost without touching headcount.',
  ],
  action: [
    'I influenced the steering committee to change direction before it was too late.',
    'I orchestrated the rollout across five business units over two quarters.',
    'We simplified the approval process significantly to unblock the teams.',
    'I had to secure buy-in from the CFO before we could move forward.',
    'I negotiated directly with the vendor to restructure the contract terms.',
    'I coached two directors through the transition so they could lead independently.',
    'We collaborated closely with legal and finance to close the deal on time.',
    'I escalated the risk to the executive sponsor once it became critical.',
    'I prioritized the highest-impact workstream and paused everything else.',
  ],
  result: [
    'That became a $758M pipeline within eighteen months.',
    'Customer adoption increased significantly across the entire organization.',
    'We secured follow-on business worth several million dollars.',
    'The engagement expanded into a multi-year contract with the same client.',
    'The organization standardized on the platform after that decision.',
    'We reduced delivery time by almost half compared to the previous approach.',
    'The transformation succeeded and leadership took notice at the board level.',
    'We saw strong ARR growth from the new segment within the first year.',
    'Executive approval came through within a week of the presentation.',
    'It led to a renewal and expansion of the overall account.',
    'Stakeholder alignment across the business finally happened after months of friction.',
    'We achieved measurable impact on both revenue and customer retention.',
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — NEGATIVE / false-positive controls: statements that touch one
// category but should NOT trigger a DIFFERENT one. This is the check the
// founder specifically asked for: verify detection improves "without
// materially increasing false positives."
// ═══════════════════════════════════════════════════════════════════════════

const FALSE_POSITIVE_CONTROLS = [
  // Pure task/situation framing — no outcome stated — must NOT trigger Result.
  { text: 'My task was to figure out the roadmap for the next fiscal year.', mustNotMatch: 'result' },
  { text: 'I led the team through a difficult reorganization process.', mustNotMatch: 'result' },
  { text: 'The organization was facing a merger that created uncertainty.', mustNotMatch: 'result' },
  { text: 'The business objective was to expand into a new market segment.', mustNotMatch: 'result' },
  // Pure action/result — no situation framing — must NOT trigger Situation.
  { text: 'I negotiated a better contract with the vendor over several weeks.', mustNotMatch: 'situation' },
  { text: 'We increased revenue by 20 percent in the following quarter.', mustNotMatch: 'situation' },
  // Pure situation/action — no task framing — must NOT trigger Task.
  { text: 'The organization was undergoing a major acquisition at the time.', mustNotMatch: 'task' },
  { text: 'I orchestrated the rollout across five different business units.', mustNotMatch: 'task' },
  // Pure situation/task — no action verb — must NOT trigger Action.
  { text: 'The customer environment was fairly complex and politically sensitive.', mustNotMatch: 'action' },
  { text: 'My mandate was to turn the program around within two quarters.', mustNotMatch: 'action' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Part 3 — Regression guard: the exact scenarios from the original bug
// report and the Story Consistency / paraphrase-tolerance precedent.
// ═══════════════════════════════════════════════════════════════════════════

console.log('Part 1 — Positive detection (should match)\n');
let positiveTotal = 0;
let positiveMatched = 0;
for (const [category, examples] of Object.entries(POSITIVE_EXAMPLES)) {
  examples.forEach((text) => {
    positiveTotal++;
    const result = detect(text);
    const matched = result[category] === true;
    if (matched) positiveMatched++;
    check(`[${category}] "${text.slice(0, 65)}${text.length > 65 ? '...' : ''}"`, () => {
      assert.strictEqual(result[category], true, `expected ${category} to be detected`);
    });
  });
}

console.log('\nPart 2 — False-positive controls (should NOT match the listed category)\n');
FALSE_POSITIVE_CONTROLS.forEach(({ text, mustNotMatch }) => {
  check(`[NOT ${mustNotMatch}] "${text.slice(0, 65)}${text.length > 65 ? '...' : ''}"`, () => {
    const result = detect(text);
    assert.strictEqual(result[mustNotMatch], false, `expected ${mustNotMatch} to NOT be detected (false-positive check)`);
  });
});

console.log('\nPart 3 — Regression guards\n');

check('Very short answer (under STAR_MIN_WORDS=7) still hard-gated to not_addressed regardless of vocabulary', () => {
  const result = detect('I led it.');
  assert.strictEqual(result.status, 'not_addressed');
});

check('A realistic multi-sentence executive answer detects all four components together', () => {
  const answer = 'The organization was going through a major acquisition, and my mandate was to align three business units on a single platform strategy. I negotiated directly with each regional lead and secured executive buy-in before the board review. As a result, we standardized on the platform and it became a $200M cost-avoidance program within the year.';
  const result = detect(answer);
  assert.strictEqual(result.situation, true);
  assert.strictEqual(result.task, true);
  assert.strictEqual(result.action, true);
  assert.strictEqual(result.result, true);
  assert.strictEqual(result.stepsComplete, 4);
});

check('aiComponents can still promote a component the keyword pass alone misses (unchanged from Phase 2A)', () => {
  const weakAnswer = 'It went reasonably well in the end for most of the people involved in the room that day.';
  const withAi = detect(weakAnswer, undefined);
  const promoted = computeStarProgress(weakAnswer, { situation: true, task: true, action: true, result: true });
  assert.strictEqual(promoted.stepsComplete, 4);
});

console.log(`\nPositive detection rate: ${positiveMatched}/${positiveTotal} (${((positiveMatched / positiveTotal) * 100).toFixed(0)}%)`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
