// ═══════════════════════════════════════════════════════════════════════════
// tests/story-consistency-and-currency.js
//
// Regression suite for two bug fixes (2026-07-23), scoped separately from
// the Phase 1/2 architecture migration per the founder's explicit
// instruction ("This is a behavioral bug, not architecture refactor"):
//
//   1. Story Consistency Validator (services/interview.js) — a follow-up
//      must never trust a pre-assigned resume story once the candidate's
//      actual answer clearly doesn't support it.
//   2. Spoken-currency normalization (services/voice-tts-proxy.js) — "$25M"
//      must be spoken as "twenty-five million dollars", never "twenty-five em".
//
// Run with: node tests/story-consistency-and-currency.js
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

// ── Load the modules under test via their exported surface. The two
// validator functions and normalizeSpokenCurrency are internal to their
// respective files (not part of the public module.exports, to keep the
// production API surface unchanged) — this suite requires a temporary
// __test_ export shim identical to the one used for the Phase 1
// characterization suite, applied to an in-memory copy only, never to the
// files on disk.
const fs = require('fs');

function loadWithTestExports(relativePath, exportNames) {
  const fullPath = path.join(__dirname, '..', relativePath);
  const original = fs.readFileSync(fullPath, 'utf8');
  const shimLines = exportNames.map((n) => `  __test_${n}: ${n},`).join('\n');
  const patched = original.replace(
    /module\.exports = \{([\s\S]*?)\};/,
    (m, inner) => {
      // Normalize trailing comma — some files' final export line already
      // ends with one (interview.js), some don't (voice-tts-proxy.js's
      // single-line export). Without this, appending shim lines after a
      // key with no trailing comma is a syntax error.
      const innerTrimmed = inner.replace(/\s+$/, '');
      const withComma = innerTrimmed.endsWith(',') ? innerTrimmed : innerTrimmed + ',';
      return `module.exports = {${withComma}\n${shimLines}\n};`;
    }
  );
  const tempPath = fullPath.replace(/\.js$/, '.__test_shim__.js');
  fs.writeFileSync(tempPath, patched);
  try {
    delete require.cache[require.resolve(tempPath)];
    return require(tempPath);
  } finally {
    fs.unlinkSync(tempPath);
  }
}

console.log('Story Consistency Validator + Spoken Currency — regression suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — Story Consistency Validator
// ═══════════════════════════════════════════════════════════════════════════
{
  const iv = loadWithTestExports('services/interview.js', ['computeStoryConsistency', 'findRebindStory']);
  const { __test_computeStoryConsistency: computeStoryConsistency, __test_findRebindStory: findRebindStory } = iv;

  const AWS_STORY = {
    story_key: 'AWS_CLOUD_MODERNIZATION_25M',
    company: 'Amazon Web Services',
    customer: 'Enterprise Retail Client',
    technologies: ['AWS', 'Kubernetes', 'EKS', 'containerization'],
    industry: 'Cloud Infrastructure',
    challenge: 'Legacy monolith migration under tight deadline',
    decision: 'Chose containerization pilot over full rewrite',
    outcome: 'Achieved 10 out of 10 CSAT and reduced deployment time',
  };
  const SALESFORCE_STORY = {
    story_key: 'SALESFORCE_INSURANCE_IMPL',
    company: 'Deloitte',
    customer: 'Insurance Client',
    technologies: ['Salesforce', 'Heroku'],
    industry: 'Insurance',
    challenge: 'UI customization vs standardization trade-off',
    decision: 'Chose Salesforce enterprise license over custom Heroku build',
    outcome: '90 percent functionality match accepted by stakeholders',
  };
  const SALESFORCE_ANSWER = "It was more of a customer where I was managing a Salesforce implementation. So insurance customer, they had a Salesforce license, but the UI look and feel was good on the Heroku platform. Salesforce enterprise license, the account team, the enterprise customer already had it. Salesforce we can achieve all the functionality, maybe not the best UI and UX, but it was like a 90 percent versus hundred percent.";
  const AWS_PARAPHRASED_ANSWER = 'We containerized the legacy platform using EKS and Kubernetes, migrating from a monolith, and achieved a 10 out of 10 CSAT score from the client.';

  check('REGRESSION (the actual staging bug): wrong story forced, candidate answered a completely different one -> confidence is low', () => {
    const result = computeStoryConsistency(SALESFORCE_ANSWER, AWS_STORY);
    assert.strictEqual(result.label, 'low', `expected 'low', got '${result.label}' (confidence ${result.confidence})`);
  });

  check('FALSE-POSITIVE GUARD: candidate paraphrases (containerized vs containerization) but stays on the correct planned story -> must NOT be flagged low', () => {
    const result = computeStoryConsistency(AWS_PARAPHRASED_ANSWER, AWS_STORY);
    assert.notStrictEqual(result.label, 'low', `paraphrase incorrectly flagged as mismatch (confidence ${result.confidence})`);
  });

  check('Correct story, exact-ish match -> high confidence, unambiguously kept', () => {
    const result = computeStoryConsistency(SALESFORCE_ANSWER, SALESFORCE_STORY);
    assert.strictEqual(result.label, 'high', `expected 'high', got '${result.label}'`);
  });

  check('REBINDING: wrong story forced, but a different story in the library matches the answer -> rebinds to it', () => {
    const rebind = findRebindStory(SALESFORCE_ANSWER, [AWS_STORY, SALESFORCE_STORY], 'AWS_CLOUD_MODERNIZATION_25M');
    assert.ok(rebind, 'expected a rebind match, got null');
    assert.strictEqual(rebind.story.story_key, 'SALESFORCE_INSURANCE_IMPL');
  });

  check('NO REBIND AVAILABLE: wrong story forced, no matching alternative exists -> returns null (caller falls back to answer-only grounding)', () => {
    const rebind = findRebindStory(SALESFORCE_ANSWER, [AWS_STORY], 'AWS_CLOUD_MODERNIZATION_25M');
    assert.strictEqual(rebind, null);
  });

  check('Empty/missing answer text -> insufficient_answer, never mistaken for a mismatch', () => {
    const result = computeStoryConsistency('', AWS_STORY);
    assert.strictEqual(result.label, 'insufficient_answer');
  });

  check('Thin story with no checkable signals -> insufficient_signal, never mistaken for a mismatch', () => {
    const result = computeStoryConsistency('some perfectly normal answer', { story_key: 'THIN', summary: 'not much here' });
    assert.strictEqual(result.label, 'insufficient_signal');
  });

  check('No story planned at all (forcedStoryKey was never set) -> no_story, not an error', () => {
    const result = computeStoryConsistency('anything', null);
    assert.strictEqual(result.label, 'no_story');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — Spoken currency normalization
// ═══════════════════════════════════════════════════════════════════════════
{
  const tts = loadWithTestExports('services/voice-tts-proxy.js', ['normalizeSpokenCurrency']);
  const normalizeSpokenCurrency = tts.__test_normalizeSpokenCurrency;

  const FOUNDER_EXAMPLES = [
    ['$25M', 'twenty-five million dollars'],
    ['$1M', 'one million dollars'],
    ['$100K', 'one hundred thousand dollars'],
    ['$750K', 'seven hundred fifty thousand dollars'],
    ['$2.5M', 'two point five million dollars'],
    ['₹5Cr', 'five crore rupees'],
    ['₹25L', 'twenty-five lakh rupees'],
    ['€3M', 'three million euros'],
    ['£750K', 'seven hundred fifty thousand pounds'],
  ];

  FOUNDER_EXAMPLES.forEach(([input, expected]) => {
    check(`"${input}" spoken as "${expected}"`, () => {
      assert.strictEqual(normalizeSpokenCurrency(input), expected);
    });
  });

  check('Normalizes correctly in the middle of a full sentence', () => {
    const result = normalizeSpokenCurrency('During that $25M engagement, you achieved 10/10 CSAT on the containerization pilot.');
    assert.strictEqual(result, 'During that twenty-five million dollars engagement, you achieved 10/10 CSAT on the containerization pilot.');
  });

  check('Text with no currency is left completely untouched', () => {
    const input = 'Tell me about a time you led a team through a difficult transition.';
    assert.strictEqual(normalizeSpokenCurrency(input), input);
  });

  check('Unknown currency symbols are left untouched rather than guessed at', () => {
    const input = 'The budget was ¥500M.';
    assert.strictEqual(normalizeSpokenCurrency(input), input);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
