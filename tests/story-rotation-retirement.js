// ═══════════════════════════════════════════════════════════════════════════
// tests/story-rotation-retirement.js
//
// Regression suite for the Story Rotation / Retirement fixes (2026-07-28,
// founder-approved). Two independent, additive fixes, both confirmed
// localized to composePrompt()/selectStoryForCompetency() only:
//
//   Fix 1 (no-résumé path): the "no story" prompt instruction now
//   explicitly forbids a PRIMARY question from re-anchoring on an
//   experience the candidate already described in an earlier answer this
//   session — closing the gap where Layer 8 (Conversational History) had
//   no guardrail comparable to Layer 10 (Resume Context)'s. Explicitly
//   scoped to primaries only — a genuine no-résumé follow-up gets a
//   different, correct instruction (deepen the preceding answer).
//
//   Fix 2 (résumé path): selectStoryForCompetency() now hard-excludes any
//   story already used for an earlier primary (retirement), falling back
//   to allowing reuse only when every story has been retired — the
//   founder's explicit exception ("unless there are no alternative
//   stories available").
//
// Run with: node tests/story-rotation-retirement.js
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

function loadInterviewModuleWithTestExports() {
  const fullPath = path.join(__dirname, '..', 'services', 'interview.js');
  const original = fs.readFileSync(fullPath, 'utf8');
  const patched = original.replace(
    /module\.exports = \{([\s\S]*?)\};/,
    (m, inner) => {
      const t = inner.replace(/\s+$/, '');
      const withComma = t.endsWith(',') ? t : t + ',';
      return `module.exports = {${withComma}\n  __test_selectStoryForCompetency: selectStoryForCompetency,\n};`;
    }
  );
  const tempPath = fullPath.replace(/\.js$/, '.__test_shim_rotation__.js');
  fs.writeFileSync(tempPath, patched);
  try {
    delete require.cache[require.resolve(tempPath)];
    return require(tempPath);
  } finally {
    fs.unlinkSync(tempPath);
  }
}

console.log('Story Rotation / Retirement — regression suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — Fix 1: prompt text present and correctly scoped (source check,
// since this is prompt content, not a return-value-testable function).
// ═══════════════════════════════════════════════════════════════════════════
console.log('Part 1 — No-résumé prompt strengthening (source verification)\n');

const interviewSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'interview.js'), 'utf8');

check('The new instruction exists and is gated on !isFollowup (primaries only)', () => {
  assert.ok(interviewSrc.includes('DO NOT RE-ANCHOR ON A PREVIOUSLY-DISCUSSED EXPERIENCE'));
  assert.ok(interviewSrc.includes('${!isFollowup ? `CRITICAL — DO NOT RE-ANCHOR'));
});

check('A genuine no-résumé follow-up gets a distinct, correct instruction (deepen, not broaden)', () => {
  assert.ok(interviewSrc.includes('this IS a follow-up with no résumé story behind it'));
  assert.ok(interviewSrc.includes('deepen the candidate\'s immediately preceding answer'));
});

check('The original career-history restriction is untouched (Fix 1 is additive, not a replacement)', () => {
  assert.ok(interviewSrc.includes('MUST NOT name, reference, or allude to ANY company, employer, customer, or project from the candidate\'s career history'));
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — Fix 2: selectStoryForCompetency retirement, simulated across a
// multi-turn session (standing in for the founder's "live interview"
// validation, deterministically).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nPart 2 — Résumé path: story retirement across a simulated multi-turn session\n');

const storyLibrary = [
  { story_key: 'STORY_A', summary: 'Led a cloud migration', competency_hints: ['leadership'] },
  { story_key: 'STORY_B', summary: 'Negotiated a vendor contract', competency_hints: ['leadership'] },
  { story_key: 'STORY_C', summary: 'Mentored a junior engineer', competency_hints: ['leadership'] },
];

check('Turn 1 (nothing used yet): picks a story normally', () => {
  const iv = loadInterviewModuleWithTestExports();
  const result = iv.__test_selectStoryForCompetency({ storyLibrary, competency: 'leadership', usedStoryKeys: new Set() });
  assert.ok(storyLibrary.some((s) => s.story_key === result));
});

check('A story already used for a primary is hard-excluded from the next selection (retirement, not just a soft penalty)', () => {
  const iv = loadInterviewModuleWithTestExports();
  const result = iv.__test_selectStoryForCompetency({ storyLibrary, competency: 'leadership', usedStoryKeys: new Set(['STORY_A']) });
  assert.notStrictEqual(result, 'STORY_A', 'STORY_A must be retired, not re-selected');
});

check('Simulated 3-turn session: each turn selects a DIFFERENT, not-yet-retired story until the pool is exhausted', () => {
  const iv = loadInterviewModuleWithTestExports();
  const used = new Set();
  const selections = [];
  for (let turn = 0; turn < 3; turn++) {
    const picked = iv.__test_selectStoryForCompetency({ storyLibrary, competency: 'leadership', usedStoryKeys: used });
    assert.ok(picked, `turn ${turn + 1} must select a real story, not null`);
    assert.ok(!used.has(picked), `turn ${turn + 1} selected an already-retired story: ${picked}`);
    selections.push(picked);
    used.add(picked);
  }
  assert.strictEqual(new Set(selections).size, 3, 'all 3 turns must have selected 3 DISTINCT stories');
});

check('THE BUG FOUND DURING IMPLEMENTATION: once every story is retired, the fallback must return a real story, not null', () => {
  const iv = loadInterviewModuleWithTestExports();
  const allUsed = new Set(storyLibrary.map((s) => s.story_key));
  const result = iv.__test_selectStoryForCompetency({ storyLibrary, competency: 'leadership', usedStoryKeys: allUsed });
  assert.notStrictEqual(result, null, 'fallback must allow reuse rather than force a story-less turn — this exact case returned null before the fix');
  assert.ok(storyLibrary.some((s) => s.story_key === result));
});

check('Fallback with exactly one story retired and two remaining: the two remaining are still preferred over the retired one', () => {
  const iv = loadInterviewModuleWithTestExports();
  const result = iv.__test_selectStoryForCompetency({ storyLibrary, competency: 'leadership', usedStoryKeys: new Set(['STORY_A', 'STORY_B']) });
  assert.strictEqual(result, 'STORY_C');
});

check('Empty story library still returns null (unchanged baseline behavior)', () => {
  const iv = loadInterviewModuleWithTestExports();
  const result = iv.__test_selectStoryForCompetency({ storyLibrary: [], competency: 'leadership', usedStoryKeys: new Set() });
  assert.strictEqual(result, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
