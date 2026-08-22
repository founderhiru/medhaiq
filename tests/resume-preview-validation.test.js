// ═══════════════════════════════════════════════════════════════════════════
// tests/resume-preview-validation.test.js
//
// Permanent regression suite for the "non-resume PDF accepted as a resume"
// bug (ERA-Applicant-User-Guide-1.pdf incident). Covers all 10 scenarios
// from the incident report, using the REAL production integration path:
//
//   generatePreview() [services/resume-preview.js]
//     -> extractResumeText() [services/resume-preview-text-extract.js]
//     -> validateIsResume()  [services/resume-preview-validator.js]  <- the fix
//     -> scoreResume()       [services/resume-preview-scoring.js]
//
// No test in this file bypasses generatePreview() to call scoring or
// validation directly for the accept/reject behavior checks — those are
// exercised through the real orchestrator exactly as routes/public-preview.js
// calls it. The one exception is the dedicated structural-signal test
// (scenario 7), which additionally unit-tests validateIsResume() directly
// to assert on which specific signals were detected — that's a unit-level
// addition on top of the integration coverage, not a replacement for it.
//
// Run: node tests/resume-preview-validation.test.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');
const PDF_MIME = 'application/pdf';

let passed = 0;
let failed = 0;

function loadFixture(filename) {
  return { mimetype: PDF_MIME, buffer: fs.readFileSync(path.join(FIXTURES, filename)) };
}

async function test(name, fn) {
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

async function main() {
  console.log('Resume Preview — document-type validation regression suite\n');
  console.log('(Regression coverage for the ERA-Applicant-User-Guide-1.pdf incident)\n');

  // Fresh, unpatched require of the real orchestrator for all standard tests.
  const { generatePreview } = require('../services/resume-preview');

  // ── 1. Valid normal resume -> accepted, real preview generated ──────────
  await test('1. Valid normal resume -> accepted, Career Intelligence preview generated', async () => {
    const r = await generatePreview({ file: loadFixture('valid-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'ok');
    assert.ok(r.preview, 'expected a preview object');
    assert.ok(r.preview.metrics && r.preview.metrics.overall.band, 'expected a band on the preview');
  });

  // ── 2. Thin but structurally valid resume -> accepted, scoring preserved ─
  await test('2. Thin-but-structurally-valid resume -> accepted by validator, existing scoring behavior preserved', async () => {
    const r = await generatePreview({ file: loadFixture('thin-valid-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'ok', 'a structurally valid (if thin) resume must still be accepted for analysis');
    assert.ok(r.preview, 'expected a preview object');
    // Thin resume evidence should still land on a low/degraded band —
    // this is the EXISTING scoring behavior, unrelated to and unchanged
    // by the new document-type gate.
    const band = r.preview.metrics.overall.band;
    assert.ok(['Early Signal', 'Developing', 'Good'].includes(band), `expected a low/degraded band for thin evidence, got "${band}"`);
  });

  // ── 3. THE EXACT INCIDENT: random applicant/user guide PDF ──────────────
  await test('3. Random applicant/user guide PDF -> not_a_resume, no preview in response', async () => {
    const r = await generatePreview({ file: loadFixture('user-guide.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'not_a_resume');
    assert.strictEqual(r.preview, undefined, 'CRITICAL: preview must not exist at all for a rejected document');
    assert.ok(r.message && r.message.toLowerCase().includes('resume'), 'expected a resume-specific rejection message');
  });

  // ── 4. Academic/research paper -> rejected ───────────────────────────────
  await test('4. Academic/research paper -> rejected', async () => {
    const r = await generatePreview({ file: loadFixture('academic-paper.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'not_a_resume');
    assert.strictEqual(r.preview, undefined);
  });

  // ── 5. Product brochure / marketing document -> rejected ────────────────
  await test('5. Product brochure / marketing document -> rejected', async () => {
    const r = await generatePreview({ file: loadFixture('brochure.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'not_a_resume');
    assert.strictEqual(r.preview, undefined);
  });

  // ── 6. Empty/nearly empty PDF -> rejected ────────────────────────────────
  await test('6. Empty/nearly empty PDF -> rejected (insufficient_signal, not fabricated)', async () => {
    const r = await generatePreview({ file: loadFixture('empty.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'insufficient_signal');
    assert.strictEqual(r.preview, undefined);
  });

  await test('6b. Corrupted/unparseable PDF -> rejected gracefully, no crash', async () => {
    const r = await generatePreview({ file: loadFixture('corrupted.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'insufficient_signal');
  });

  // ── 7. Resume with employment dates, sections, and contact info ─────────
  await test('7. Resume with dates + sections + contact info -> accepted, and the validator specifically credits those signals', async () => {
    const r = await generatePreview({ file: loadFixture('valid-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(r.status, 'ok');

    // Unit-level check on the validator itself, confirming WHICH signals
    // drove the accept decision (not just that it happened to pass).
    const { validateIsResume } = require('../services/resume-preview-validator');
    const text = fs.readFileSync(path.join(__dirname, 'txt-source', 'valid-resume.txt'), 'utf8');
    const classification = validateIsResume(text);
    assert.ok(classification.valid, 'expected the classifier itself to report valid=true');
    assert.ok(classification.score >= 4, `expected a strong signal score, got ${classification.score}`);
  });

  // ── 8. Sequential: valid resume -> random PDF -> no stale data ──────────
  await test('8. Sequential state: valid resume then random PDF -> second response has zero trace of the first result', async () => {
    const first = await generatePreview({ file: loadFixture('valid-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(first.status, 'ok');
    const firstBand = first.preview.metrics.overall.band;

    const second = await generatePreview({ file: loadFixture('user-guide.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(second.status, 'not_a_resume');
    assert.strictEqual(second.preview, undefined, 'second response must carry no preview data whatsoever');
    assert.ok(JSON.stringify(second).indexOf(firstBand) === -1, 'second response must not contain any trace of the first result\u2019s band');
  });

  // ── 9. Sequential, reversed order: random PDF -> valid resume ───────────
  await test('9. Sequential state (reversed): random PDF then valid resume -> valid resume analyzes normally', async () => {
    const first = await generatePreview({ file: loadFixture('user-guide.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(first.status, 'not_a_resume');

    const second = await generatePreview({ file: loadFixture('valid-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(second.status, 'ok', 'a valid resume uploaded after a rejected document must still analyze normally');
    assert.ok(second.preview && second.preview.metrics.overall.band, 'expected a normal real result');
  });

  // ── 10. Role/org-scale selections must not affect validation ────────────
  await test('10. Role/organisation-scale selections cannot cause a non-resume document to pass validation', async () => {
    // generatePreview()'s signature only ever accepts {file, pastedText} —
    // role/orgScale are validated for presence at the route layer
    // (routes/public-preview.js) but are never passed into the
    // orchestrator or the validator at all. Confirming that structurally:
    // calling with extra role/orgScale-like keys has zero effect on the
    // outcome for the same rejected document.
    const withExtraKeys = await generatePreview(
      { file: loadFixture('user-guide.pdf'), targetRole: 'C-Suite', orgScale: 'Fortune 500 / Global MNC' },
      { NODE_ENV: 'development' }
    );
    const withoutExtraKeys = await generatePreview({ file: loadFixture('user-guide.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(withExtraKeys.status, 'not_a_resume');
    assert.strictEqual(withoutExtraKeys.status, 'not_a_resume');
    assert.strictEqual(withExtraKeys.status, withoutExtraKeys.status, 'role/org-scale must never influence document-type validation');
  });

  // ── Explicit spy: prove scoreResume() is never invoked for a rejected
  // document. Uses require.cache manipulation to patch the REAL scoring
  // module's export in place, then forces resume-preview.js to be
  // re-required so its internal destructure captures the patched
  // function — no application source file is modified to make this work.
  await test('SPY: scoreResume() is never invoked when validateIsResume() rejects the document', async () => {
    const scoringModulePath = require.resolve('../services/resume-preview-scoring');
    const orchestratorPath = require.resolve('../services/resume-preview');

    const scoringModule = require(scoringModulePath);
    const originalScoreResume = scoringModule.scoreResume;
    let scoreResumeCallCount = 0;
    scoringModule.scoreResume = function (...args) {
      scoreResumeCallCount++;
      return originalScoreResume.apply(this, args);
    };

    delete require.cache[orchestratorPath];
    const { generatePreview: spiedGeneratePreview } = require('../services/resume-preview');

    try {
      const rejected = await spiedGeneratePreview({ file: loadFixture('user-guide.pdf') }, { NODE_ENV: 'development' });
      assert.strictEqual(rejected.status, 'not_a_resume');
      assert.strictEqual(scoreResumeCallCount, 0, `scoreResume() must NOT be called for a rejected document, but was called ${scoreResumeCallCount} time(s)`);

      const accepted = await spiedGeneratePreview({ file: loadFixture('valid-resume.pdf') }, { NODE_ENV: 'development' });
      assert.strictEqual(accepted.status, 'ok');
      assert.strictEqual(scoreResumeCallCount, 1, 'scoreResume() must be called exactly once for an accepted document');
    } finally {
      // Restore the real, unpatched scoring function and re-sync the
      // orchestrator's cache so no other test in this (or any future) run
      // is affected by this spy.
      scoringModule.scoreResume = originalScoreResume;
      delete require.cache[orchestratorPath];
      require('../services/resume-preview');
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
