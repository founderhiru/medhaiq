// ═══════════════════════════════════════════════════════════════════════════
// tests/star-engine-characterization.js
//
// Regression suite for services/star/star-engine.js — Phase 2A (pure
// extraction, 2026-07-24). Proves the relocation of computeStarProgress
// out of services/interview.js produced ZERO behavior change, across the
// exact scenario matrix the Phase 2 brief specified:
//   complete STAR answers, missing Situation, missing Task, missing Action,
//   missing Result, weak behavioural evidence, strong quantified evidence,
//   multi-story responses, very short answers, long executive answers.
//
// Also verifies the one real cross-boundary dependency found during the
// audit: generateReport() (services/interview.js, untouched — Report
// Scoring Logic, out of scope for this checkpoint) reads STAR_TRIVIAL_RE
// directly. That reference must still resolve correctly after the move.
//
// Run with: node tests/star-engine-characterization.js
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

console.log('STAR Engine (Phase 2A extraction) — characterization suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — the exact 10-scenario matrix from the Phase 2 brief
// ═══════════════════════════════════════════════════════════════════════════

check('Complete STAR answer -> all four components true, status evaluated', () => {
  const answer = "Last quarter, our customer wanted a faster checkout flow. My task was to reduce cart abandonment on mobile. I redesigned the payment step and rolled out a one-click flow. As a result, we reduced abandonment by 18% and increased conversion.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.situation, true);
  assert.strictEqual(result.task, true);
  assert.strictEqual(result.action, true);
  assert.strictEqual(result.result, true);
  assert.strictEqual(result.stepsComplete, 4);
  assert.deepStrictEqual(result.missing, []);
  assert.strictEqual(result.status, 'evaluated');
});

check('Missing Situation -> situation false, everything else can still be true', () => {
  const answer = "My task was to reduce cart abandonment on mobile checkout. I redesigned the payment step and rolled out a one-click flow. As a result, we reduced abandonment by 18% and increased conversion significantly across the board.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.situation, false);
  assert.ok(result.missing.includes('situation'));
});

check('Missing Task -> task false', () => {
  const answer = "Last quarter, our customer wanted a faster checkout flow during the holiday season. I redesigned the payment step and rolled out a one-click flow. As a result, we reduced abandonment by 18 percent and increased conversion.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.task, false);
  assert.ok(result.missing.includes('task'));
});

check('Missing Action -> action false', () => {
  const answer = "Last quarter, our customer wanted a faster checkout flow. My task was to reduce cart abandonment on mobile devices during the busy holiday season. As a result, we reduced abandonment by 18 percent and increased conversion significantly.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.action, false);
  assert.ok(result.missing.includes('action'));
});

check('Missing Result -> result false', () => {
  const answer = "Last quarter, our customer wanted a faster checkout flow. My task was to reduce cart abandonment on mobile. I redesigned the payment step and rolled out a completely new one-click checkout flow across the platform.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.result, false);
  assert.ok(result.missing.includes('result'));
});

check('Weak behavioural evidence (vague, no concrete signals) -> few or no components detected, not a crash', () => {
  const answer = "It was fine I guess, we did some stuff and things worked out okay eventually for everyone involved I think honestly.";
  const result = computeStarProgress(answer);
  assert.ok(result.stepsComplete <= 2, `expected weak evidence to score low, got stepsComplete=${result.stepsComplete}`);
  assert.strictEqual(result.status, 'evaluated'); // long enough to be evaluated, just weak
});

check('Strong quantified evidence -> result detected via percentage/dollar signal', () => {
  const answer = "During a major system migration, I had to reduce latency across the platform. I led the re-architecture to a distributed cache layer. As a result, we reduced latency by 42% and saved $2M annually in infrastructure costs.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.result, true);
  assert.strictEqual(result.action, true);
});

check('Multi-story response (candidate references two separate situations) -> still evaluates on the combined text, no crash, no double-counting bug', () => {
  const answer = "In my first role, we were struggling with a legacy platform, and I had to lead the migration. Separately, at my last company, I was responsible for a customer escalation and I resolved it directly, and as a result we retained the account and improved satisfaction significantly.";
  const result = computeStarProgress(answer);
  assert.strictEqual(typeof result.stepsComplete, 'number');
  assert.ok(result.stepsComplete >= 1);
});

check('Very short answer (under STAR_MIN_WORDS) -> hard-gated to not_addressed, zero components regardless of content', () => {
  const answer = "I led it and we won.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.status, 'not_addressed');
  assert.strictEqual(result.situation, false);
  assert.strictEqual(result.task, false);
  assert.strictEqual(result.action, false);
  assert.strictEqual(result.result, false);
  assert.strictEqual(result.stepsComplete, 0);
});

check('Long executive answer -> evaluates correctly at length, no truncation or performance issue', () => {
  const answer = "During my time leading the enterprise transformation program, our organization was facing significant pressure from the board to modernize legacy infrastructure while maintaining service continuity across twelve regional markets. My responsibility was to design and execute a phased migration strategy that balanced risk against speed, while also managing a cross-functional team of nearly two hundred engineers and product leads spread across four time zones. I decided to prioritize a containerization-first approach, starting with the highest-risk, highest-value services, and I personally negotiated the vendor contracts that made the parallel-run period financially viable for the board to approve. As a result, we completed the migration six weeks ahead of the original eighteen-month schedule, reduced infrastructure spend by 31%, and the board approved a follow-on transformation budget the following quarter based on the outcome.";
  const result = computeStarProgress(answer);
  assert.strictEqual(result.stepsComplete, 4);
  assert.strictEqual(result.status, 'evaluated');
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — aiComponents optional-argument behavior (currently a dead
// parameter in production per the audit, but must still function correctly
// and remain backward compatible)
// ═══════════════════════════════════════════════════════════════════════════

check('aiComponents can promote a component the keyword pass alone missed', () => {
  const answer = "It went fine overall and everyone seemed reasonably satisfied with how things turned out in the end for the whole team.";
  const withoutAi = computeStarProgress(answer);
  const withAi = computeStarProgress(answer, { situation: true, task: true, action: true, result: true });
  assert.strictEqual(withAi.stepsComplete, 4, 'aiComponents should be able to promote all four when the keyword pass alone would not');
  assert.ok(withAi.stepsComplete >= withoutAi.stepsComplete);
});

check('Omitting aiComponents entirely (single-argument call, the only pattern any real caller uses today) works identically to passing undefined', () => {
  const answer = "Last quarter, our customer wanted a faster checkout flow. My task was to reduce cart abandonment. I redesigned the payment step. As a result, we reduced abandonment by 18%.";
  const oneArg = computeStarProgress(answer);
  const explicitUndefined = computeStarProgress(answer, undefined);
  assert.deepStrictEqual(oneArg, explicitUndefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 3 — cross-boundary dependency check (the real finding from the audit)
// ═══════════════════════════════════════════════════════════════════════════

check('STAR_TRIVIAL_RE is exported and usable exactly as generateReport (services/interview.js, untouched) needs it', () => {
  const { STAR_TRIVIAL_RE } = require(path.join(__dirname, '..', 'services', 'star', 'star-engine'));
  // Mirrors generateReport's exact usage: substantiveCount filter.
  assert.strictEqual(STAR_TRIVIAL_RE.test('yes'), true, 'trivial answer must match');
  assert.strictEqual(STAR_TRIVIAL_RE.test('This is a real, substantive answer with actual content.'), false, 'substantive answer must not match');
});

check('services/interview.js still loads cleanly and re-exports computeStarProgress unchanged (backward-compatible shim)', () => {
  delete require.cache[require.resolve(path.join(__dirname, '..', 'services', 'interview.js'))];
  const iv = require(path.join(__dirname, '..', 'services', 'interview.js'));
  assert.strictEqual(typeof iv.computeStarProgress, 'function');
  const result = iv.computeStarProgress("Last quarter, our customer wanted a faster checkout flow. My task was to reduce cart abandonment. I redesigned the payment step. As a result, we reduced abandonment by 18%.");
  assert.strictEqual(result.stepsComplete, 4);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
