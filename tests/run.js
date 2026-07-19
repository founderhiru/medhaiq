// ═══════════════════════════════════════════════════════════════════════════
// tests/run.js — MedhaIQ Career Intelligence Preview regression suite
//
// Plain Node + assert — no Jest/Mocha dependency added, since the repo
// doesn't have a test framework configured and this feature doesn't need one.
// Run with: node tests/run.js
// Intended to run on every commit that touches config/resume-preview-config.js,
// services/resume-preview-*.js, or tests/fixtures/* — deterministic engines
// drift silently over time as taxonomy/config changes; this suite is the
// guardrail against that.
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { generatePreview } = require('../services/resume-preview');

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
  console.log('Resume Preview Engine — regression suite\n');

  await test('strong-vp-resume.pdf produces a numeric, non-Early-Signal band', async () => {
    const result = await generatePreview({ file: loadFixture('strong-vp-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(result.status, 'ok');
    assert.notStrictEqual(result.preview.metrics.overall.band, 'Early Signal');
    assert.ok(result.preview.metrics.internal.score >= 65, `expected a strong score, got ${result.preview.metrics.internal.score}`);
  });

  await test('strong-vp-resume.pdf recruiter template matches its own evidence (no contradiction)', async () => {
    const result = await generatePreview({ file: loadFixture('strong-vp-resume.pdf') }, { NODE_ENV: 'development' });
    const leadership = result.preview.buckets.find((b) => b.key === 'leadership');
    const text = result.preview.recruiterFirstImpression;
    if (leadership.numeric && leadership.hitCount >= 3) {
      assert.ok(/leadership/i.test(text), 'expected leadership strength to be reflected in the recruiter paragraph');
    }
  });

  await test('average-manager-resume.pdf produces a mid-range result, not Early Signal', async () => {
    const result = await generatePreview({ file: loadFixture('average-manager-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(result.status, 'ok');
    assert.notStrictEqual(result.preview.metrics.overall.band, 'Early Signal');
  });

  await test('junior-engineer.pdf degrades gracefully (Early Signal or clearly low band)', async () => {
    const result = await generatePreview({ file: loadFixture('junior-engineer.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(result.status, 'ok');
    const band = result.preview.metrics.overall.band;
    assert.ok(['Early Signal', 'Developing'].includes(band), `expected a low/degraded band, got "${band}"`);
    assert.ok(result.preview.opportunities.length > 0, 'expected at least one constructive opportunity for a thin resume');
  });

  await test('junior-engineer.pdf opportunities are constructively framed (no discouraging language)', async () => {
    const result = await generatePreview({ file: loadFixture('junior-engineer.pdf') }, { NODE_ENV: 'development' });
    const banned = /\bfail(ed|ure)?\b|\bweak\b|\bpoor\b|\binadequate\b/i;
    result.preview.opportunities.forEach((line) => {
      assert.ok(!banned.test(line), `opportunity line reads as discouraging: "${line}"`);
    });
  });

  await test('empty.pdf triggers insufficient_signal (not a crash, not a false score)', async () => {
    const result = await generatePreview({ file: loadFixture('empty.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(result.status, 'insufficient_signal');
    assert.ok(result.message && result.message.length > 0);
  });

  await test('corrupted.pdf fails gracefully — no thrown error, no 500-worthy crash', async () => {
    const result = await generatePreview({ file: loadFixture('corrupted.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(result.status, 'insufficient_signal');
  });

  await test('every response shape (ok + insufficient_signal) carries preview_version', async () => {
    const ok = await generatePreview({ file: loadFixture('strong-vp-resume.pdf') }, { NODE_ENV: 'development' });
    const thin = await generatePreview({ file: loadFixture('empty.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(ok.preview_version, '1.0');
    assert.strictEqual(thin.preview_version, '1.0');
  });

  await test('production NODE_ENV strips internal.score from every scored response', async () => {
    const prod = await generatePreview({ file: loadFixture('strong-vp-resume.pdf') }, { NODE_ENV: 'production' });
    assert.strictEqual(prod.preview.metrics.internal, undefined);
    assert.ok(prod.preview.metrics.overall.band, 'band must still be present');
  });

  await test('development NODE_ENV keeps internal.score for debugging', async () => {
    const dev = await generatePreview({ file: loadFixture('strong-vp-resume.pdf') }, { NODE_ENV: 'development' });
    assert.strictEqual(typeof dev.preview.metrics.internal.score, 'number');
  });

  await test('no file and no pastedText input does not throw (route handles the 400, but the service layer must be safe standalone)', async () => {
    const result = await generatePreview({}, { NODE_ENV: 'development' });
    assert.strictEqual(result.status, 'insufficient_signal');
  });

  await test('strong resume scores strictly higher than average, which scores strictly higher than junior (ordering sanity check)', async () => {
    const rankScore = async (fixture) => {
      const r = await generatePreview({ file: loadFixture(fixture) }, { NODE_ENV: 'development' });
      return r.preview.metrics.internal.score || 0; // Early Signal -> null -> treat as 0 for ordering
    };
    const strong = await rankScore('strong-vp-resume.pdf');
    const average = await rankScore('average-manager-resume.pdf');
    const junior = await rankScore('junior-engineer.pdf');
    assert.ok(strong > average, `expected strong (${strong}) > average (${average})`);
    assert.ok(average > junior, `expected average (${average}) > junior (${junior})`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
