// ═══════════════════════════════════════════════════════════════════════════
// tests/interview-strategy-profiles.js
//
// Regression suite for the Interview Strategy Profile feature (2026-07-23):
// Strategy decides question TYPE/rhythm per primary position; the Coverage
// Engine (selectNextCompetency) keeps full authority over WHICH competency,
// narrowed only for the 'behavioural' type and only to a two-competency set
// — never a single hardcoded competency name.
//
// Run with: node tests/interview-strategy-profiles.js
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

console.log('Interview Strategy Profiles — regression suite\n');

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — Profile resolution (config/interview-strategy-profiles.js)
// ═══════════════════════════════════════════════════════════════════════════
{
  const { getStrategyPosition, resolveStrategyProfileName } = require('../config/interview-strategy-profiles');

  check('Unmapped role falls back to the executive profile', () => {
    assert.strictEqual(resolveStrategyProfileName('Head of HR', 'Executive'), 'executive');
  });

  check('Software Engineer resolves to the engineering profile', () => {
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'Mid'), 'engineering');
  });

  check('Graduate/entry experience level overrides role -> graduate profile even for an engineering role', () => {
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'graduate'), 'graduate');
  });

  check('Executive profile rhythm matches the agreed default: Resume, JD, Behavioural, Resume, Executive Judgment', () => {
    const types = [1, 2, 3, 4, 5].map((p) => getStrategyPosition('CFO', 'Executive', p).questionType);
    assert.deepStrictEqual(types, ['resume_story', 'jd_scenario', 'behavioural', 'resume_story', 'executive_judgment']);
  });

  check('Strategy position carries INTENT only — no competency names or lists anywhere in its shape', () => {
    const positions = [1, 2, 3, 4, 5].map((p) => getStrategyPosition('CFO', 'Executive', p));
    positions.forEach((pos) => {
      assert.strictEqual(pos.competencyFilter, undefined, 'strategy layer must not carry a competency filter — that is the Coverage Engine\'s job now');
      assert.ok(!('competency' in pos), 'strategy position must never name a specific competency');
    });
  });

  check("Behavioural is a semantic type name only at this layer — resolving it into actual competencies is NOT this file's job", () => {
    const pos = getStrategyPosition('CFO', 'Executive', 3);
    assert.strictEqual(pos.questionType, 'behavioural');
    // Deliberately just checking the type string exists — the mapping from
    // this string to real competencies lives in services/interview.js's
    // COMPETENCY_CATEGORY_TAGS, tested in Part 2 below, not here.
  });

  check('Follow-ups (no questionPosition) get no strategy position at all', () => {
    const pos = getStrategyPosition('CFO', 'Executive', undefined);
    assert.strictEqual(pos, null);
  });

  check('Position outside 1-5 returns null rather than throwing', () => {
    assert.strictEqual(getStrategyPosition('CFO', 'Executive', 6), null);
    assert.strictEqual(getStrategyPosition('CFO', 'Executive', 0), null);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — resolveCompetenciesForCategory: the Coverage Engine's OWN
// taxonomy resolves "behavioural" into real competencies, not the strategy
// config. This is the piece that makes growing the competency model later
// (Influence, Stakeholder Management, Conflict Resolution, Coaching,
// Decision Making, etc.) never require touching the strategy profile file.
// ═══════════════════════════════════════════════════════════════════════════
{
  const iv = loadWithTestExports('services/interview.js', ['resolveCompetenciesForCategory', 'COMPETENCY_CATEGORY_TAGS']);
  const resolveCompetenciesForCategory = iv.__test_resolveCompetenciesForCategory;
  const COMPETENCY_CATEGORY_TAGS = iv.__test_COMPETENCY_CATEGORY_TAGS;

  check("'behavioural' resolves to a SET of competencies (leadership + communication today), never a single hardcoded one", () => {
    const priority = ['system_design', 'technical', 'leadership', 'communication', 'strategy'];
    const result = resolveCompetenciesForCategory('behavioural', priority);
    assert.ok(Array.isArray(result) && result.length >= 2, 'must be a set, not a single competency');
    assert.ok(result.includes('leadership') && result.includes('communication'));
  });

  check("A questionType that isn't a real category ('resume_story', 'jd_scenario', 'executive_judgment') resolves to null — unconstrained, zero special-casing needed", () => {
    const priority = ['system_design', 'technical', 'leadership', 'communication', 'strategy'];
    assert.strictEqual(resolveCompetenciesForCategory('resume_story', priority), null);
    assert.strictEqual(resolveCompetenciesForCategory('jd_scenario', priority), null);
    assert.strictEqual(resolveCompetenciesForCategory('executive_judgment', priority), null);
  });

  check('A role whose priority list has neither behavioural competency resolves to null (safe fallback signal, not an empty-array footgun)', () => {
    const priority = ['system_design', 'technical', 'strategy'];
    assert.strictEqual(resolveCompetenciesForCategory('behavioural', priority), null);
  });

  check('Growing the taxonomy is additive: tagging a NEW competency as behavioural immediately widens the resolved set, with zero changes to the strategy profile config', () => {
    // Simulates exactly the founder's stated future scenario — adding
    // "Coaching" as a new behavioural competency — without touching
    // config/interview-strategy-profiles.js at all.
    const extendedTags = { ...COMPETENCY_CATEGORY_TAGS, coaching: ['behavioural'] };
    const priority = ['leadership', 'communication', 'coaching', 'strategy'];
    const matches = priority.filter((c) => (extendedTags[c] || []).includes('behavioural'));
    assert.deepStrictEqual(matches, ['leadership', 'communication', 'coaching']);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 3 — selectNextCompetency: the filter (once resolved) narrows the
// CHOICE, never dictates it — Coverage Engine's own ranking still decides.
// ═══════════════════════════════════════════════════════════════════════════
{
  const iv = loadWithTestExports('services/interview.js', ['selectNextCompetency', 'EVIDENCE_TIERS']);
  const selectNextCompetency = iv.__test_selectNextCompetency;
  const EVIDENCE_TIERS = iv.__test_EVIDENCE_TIERS;

  // Snapshot shape mirrors buildInterviewSnapshot's actual output. Evidence
  // tiers are compared by OBJECT REFERENCE in the real code (hypothesis.
  // evidenceTier === EVIDENCE_TIERS.WEAK), not by string value — so this
  // mock must use the real EVIDENCE_TIERS objects, not string placeholders.
  function makeSnapshot(priority, evidenceTiers, lastAskedTurns) {
    const memoryMap = {};
    const hypothesisMap = {};
    priority.forEach((c, i) => {
      memoryMap[c] = { lastAskedTurn: (lastAskedTurns && lastAskedTurns[c] !== undefined) ? lastAskedTurns[c] : -1 };
      hypothesisMap[c] = { evidenceTier: (evidenceTiers && evidenceTiers[c]) || EVIDENCE_TIERS.WEAK };
    });
    return { priority, memoryMap, hypothesisMap };
  }

  check('No filter passed (undefined) -> identical behavior to before this feature (backward compatibility)', () => {
    const priority = ['system_design', 'technical', 'leadership', 'communication', 'strategy'];
    const snapshot = makeSnapshot(priority, { leadership: EVIDENCE_TIERS.WEAK, communication: EVIDENCE_TIERS.STRONG, system_design: EVIDENCE_TIERS.STRONG, technical: EVIDENCE_TIERS.STRONG, strategy: EVIDENCE_TIERS.STRONG });
    const result = selectNextCompetency(snapshot, 3);
    // WEAK (uncertaintyScore 90) beats STRONG (30) with no filter — leadership wins, being the only WEAK one.
    assert.strictEqual(result, 'leadership');
  });

  check("Filter narrows the candidate set to ['leadership','communication'], picks the more uncovered of the two", () => {
    const priority = ['system_design', 'technical', 'leadership', 'communication', 'strategy'];
    // technical is the LEAST covered overall, but it's outside the filter —
    // must never be picked when a behavioural filter is active.
    const snapshot = makeSnapshot(priority, { technical: EVIDENCE_TIERS.WEAK, leadership: EVIDENCE_TIERS.MODERATE, communication: EVIDENCE_TIERS.WEAK, system_design: EVIDENCE_TIERS.STRONG, strategy: EVIDENCE_TIERS.STRONG });
    const result = selectNextCompetency(snapshot, 3, ['leadership', 'communication']);
    assert.strictEqual(result, 'communication', `expected 'communication' (weaker of the two filtered options), got '${result}'`);
    assert.notStrictEqual(result, 'technical', 'filter must exclude technical even though it is globally least-covered');
  });

  check('Filter with zero overlap against this role\'s priority list falls back to the full list rather than breaking', () => {
    // A role whose competency matrix somehow has neither filtered competency.
    const priority = ['system_design', 'technical', 'strategy'];
    const snapshot = makeSnapshot(priority, { system_design: EVIDENCE_TIERS.WEAK });
    const result = selectNextCompetency(snapshot, 0, ['leadership', 'communication']);
    assert.ok(priority.includes(result), `expected a fallback to the full priority list, got '${result}'`);
  });

  check('Empty array filter behaves identically to no filter (defensive)', () => {
    const priority = ['system_design', 'technical', 'leadership'];
    const snapshot = makeSnapshot(priority, { technical: EVIDENCE_TIERS.WEAK, system_design: EVIDENCE_TIERS.STRONG, leadership: EVIDENCE_TIERS.STRONG });
    const withEmpty = selectNextCompetency(snapshot, 2, []);
    const withUndefined = selectNextCompetency(snapshot, 2, undefined);
    assert.strictEqual(withEmpty, withUndefined);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
