// ═══════════════════════════════════════════════════════════════════════════
// tests/jd-weighting-fix.js
//
// Regression suite for the JD weighting bug fix (2026-07-24). Root cause:
// extractJdObjective() only matched a competency's LITERAL taxonomy name
// ("leadership", "system design") as a substring in the job description —
// real JDs almost never use that exact wording, so leadership/strategy
// consistently returned null even on rich, detailed JDs, and jd_scenario
// questions had zero prompt-level instruction to actually lean on the JD,
// silently falling back to the same generic hypothetical framing as any
// story-less turn.
//
// Run with: node tests/jd-weighting-fix.js
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

function loadWithTestExports(relativePath, exportNames) {
  const fullPath = path.join(__dirname, '..', relativePath);
  const original = fs.readFileSync(fullPath, 'utf8');
  const shimLines = exportNames.map((n) => `  __test_${n}: ${n},`).join('\n');
  const patched = original.replace(
    /module\.exports = \{([\s\S]*?)\};/,
    (m, inner) => {
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

console.log('JD Weighting fix — regression suite\n');

const SLALOM_JD = `Slalom is seeking a Senior Consultant to join our Technology Enablement practice.
You will partner with clients to design and deliver cloud migration strategies across AWS and Azure.
The ideal candidate has deep experience leading cross-functional delivery teams and managing complex stakeholder relationships across business and IT.
You will be responsible for driving digital transformation initiatives, translating business requirements into scalable technical architectures, and mentoring junior consultants.
Experience with data platform modernization, agile delivery, and executive-level client communication is essential.
This role requires strong analytical thinking, the ability to navigate ambiguity, and a track record of driving measurable business outcomes for enterprise clients.`;

{
  const iv = loadWithTestExports('services/interview.js', ['extractJdObjective']);
  const extractJdObjective = iv.__test_extractJdObjective;

  check('REGRESSION (the actual bug): leadership resolves to real JD content, not null', () => {
    const result = extractJdObjective(SLALOM_JD, 'leadership');
    assert.notStrictEqual(result, null, 'leadership must not be null on a JD that discusses leading teams and stakeholders');
    assert.ok(/lead|stakeholder/i.test(result));
  });

  check('REGRESSION (the actual bug): strategy resolves to real JD content, not null', () => {
    const result = extractJdObjective(SLALOM_JD, 'strategy');
    assert.notStrictEqual(result, null, 'strategy must not be null on a JD that discusses transformation and strategic thinking');
  });

  check('system_design still resolves correctly (no regression on a competency that worked before)', () => {
    const result = extractJdObjective(SLALOM_JD, 'system_design');
    assert.notStrictEqual(result, null);
    assert.ok(/design|migrat|cloud/i.test(result));
  });

  check('technical still resolves correctly (no regression)', () => {
    const result = extractJdObjective(SLALOM_JD, 'technical');
    assert.notStrictEqual(result, null);
  });

  check('communication still resolves correctly (no regression)', () => {
    const result = extractJdObjective(SLALOM_JD, 'communication');
    assert.notStrictEqual(result, null);
  });

  check('No JD text -> null, never throws', () => {
    assert.strictEqual(extractJdObjective(null, 'leadership'), null);
    assert.strictEqual(extractJdObjective('', 'leadership'), null);
    assert.strictEqual(extractJdObjective(undefined, 'leadership'), null);
  });

  check('Unknown/empty competency -> null, never throws', () => {
    assert.strictEqual(extractJdObjective(SLALOM_JD, ''), null);
    assert.strictEqual(extractJdObjective(SLALOM_JD, undefined), null);
  });

  check('A JD with truly no relevant content for a competency still returns null (not a false positive)', () => {
    const thinJD = 'We are hiring a barista. Must be friendly and punctual.';
    const result = extractJdObjective(thinJD, 'system_design');
    assert.strictEqual(result, null);
  });
}

{
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'interview.js'), 'utf8');

  check('The jd_scenario prompt directive exists and is gated on strategy_source === JDScenario', () => {
    assert.ok(src.includes("questionBlueprint.strategy_source === 'JDScenario'"), 'expected the new JD-scenario directive to gate on strategy_source');
    assert.ok(src.includes('THIS TURN MUST BE DRIVEN BY THE JOB DESCRIPTION'), 'expected the new forceful JD directive text to be present');
  });

  check('The no-story fallback branch now explicitly excludes JDScenario turns (so they get the dedicated directive instead of the generic one)', () => {
    const noStoryBranchMatch = src.match(/\$\{\(!story && !\(isFollowup[\s\S]{0,200}?CRITICAL — NO STORY WAS SELECTED/);
    assert.ok(noStoryBranchMatch, 'expected to find the no-story branch condition');
    assert.ok(noStoryBranchMatch[0].includes("strategy_source === 'JDScenario'"), 'the no-story branch must exclude JDScenario turns from its condition');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
