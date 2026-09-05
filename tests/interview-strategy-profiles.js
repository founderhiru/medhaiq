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

  // PATCH A (2026-09-04): this test previously asserted Software Engineer
  // + Mid -> 'engineering' via ROLE_TO_PROFILE. That was itself the
  // "Mid inherits role-mapping instead of a proper Mid resolution" gap
  // identified in the forensic report -- 'Mid' has a dedicated resolution
  // now (-> 'professional', same safe rhythm as 'engineering' had, just
  // reached the correct way). See the "PATCH A: ... + Mid -> professional"
  // checks further down for the full role x stage matrix.
  check('SUPERSEDED BY PATCH A: Software Engineer + Mid now resolves to professional (not engineering, which is role-fallback-only post-Patch-A)', () => {
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'Mid'), 'professional');
  });

  check('Software Engineer with a missing experience level still resolves to the engineering profile (ROLE_TO_PROFILE fallback path, unchanged)', () => {
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', undefined), 'engineering');
  });

  check('Graduate/entry experience level overrides role -> graduate profile even for an engineering role', () => {
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'graduate'), 'graduate');
  });

  check('Executive profile rhythm matches the agreed default: Resume, JD, Behavioural, Resume, Executive Judgment', () => {
    const types = [1, 2, 3, 4, 5].map((p) => getStrategyPosition('CFO', 'Executive', p).questionType);
    assert.deepStrictEqual(types, ['resume_story', 'jd_scenario', 'behavioural', 'resume_story', 'executive_judgment']);
  });

  // ── BUG FIX REGRESSION (2026-09-03) ─────────────────────────────────────
  // 'fresher' is the ACTUAL value views/interview-setup.ejs sends
  // (data-exp="fresher" -> state.exp -> experienceLevel: state.exp). It was
  // never in GRADUATE_EXPERIENCE_LEVELS, so every Fresher session fell
  // through to the 'executive' hard fallback -- Q3 (behavioural, unfiltered
  // competency pool) and Q5 (executive_judgment) surfaced board-level/
  // executive-scoped questions for entry-level candidates. Root-caused via
  // an end-to-end session log trace showing "Profile: executive" for a
  // Fresher-selected interview.
  check('BUG FIX: fresher resolves to the graduate profile (was falling through to executive)', () => {
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'fresher'), 'graduate');
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'fresher'), 'graduate', 'experience level must win over role, same as the existing graduate/entry/junior/intern cases');
  });

  check('BUG FIX: junior and entry-level variants also resolve to graduate (unaffected by the fresher fix, confirming no regression to the existing aliases)', () => {
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'junior'), 'graduate');
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'entry'), 'graduate');
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'intern'), 'graduate');
  });

  check('BUG FIX: fresher resolution is case/whitespace tolerant, same as the pre-existing aliases', () => {
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'Fresher'), 'graduate');
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', '  fresher  '), 'graduate');
  });

  // NOTE (2026-09-04): these two checks previously asserted that 'mid' and
  // 'senior' fell through to 'executive' — that WAS correct at the time
  // (mid/senior had no dedicated resolution yet, a gap the forensic
  // report explicitly flagged) but is now SUPERSEDED by Patch A below,
  // which gives mid/senior their own 'professional' resolution. Kept as a
  // single explicit superseded-check rather than deleted silently, so the
  // history is visible; the authoritative Patch A checks are further down.
  check('SUPERSEDED BY PATCH A: mid-level no longer resolves to executive -- see "PATCH A: ... + Mid -> professional" below', () => {
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'mid'), 'professional');
  });

  check('SUPERSEDED BY PATCH A: senior no longer resolves to executive (mid/senior share the professional profile) -- executive experience level itself is still executive', () => {
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'senior'), 'professional');
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', 'executive'), 'executive');
  });

  check('BUG FIX: fresher Q1-Q5 rhythm is Resume, Resume, JD, Behavioural, JD -- NEVER executive_judgment anywhere in the flow', () => {
    const types = [1, 2, 3, 4, 5].map((p) => getStrategyPosition('Custom Unmapped Role', 'fresher', p).questionType);
    assert.deepStrictEqual(types, ['resume_story', 'resume_story', 'jd_scenario', 'behavioural', 'jd_scenario']);
    types.forEach((t, i) => assert.notStrictEqual(t, 'executive_judgment', `fresher Q${i + 1} must never be executive_judgment`));
  });

  check('BUG FIX: the same fresher rhythm holds even for a role that would otherwise map to the engineering profile (experience level wins)', () => {
    const types = [1, 2, 3, 4, 5].map((p) => getStrategyPosition('Software Engineer', 'fresher', p).questionType);
    assert.deepStrictEqual(types, ['resume_story', 'resume_story', 'jd_scenario', 'behavioural', 'jd_scenario']);
  });

  check('BUG FIX: executive rhythm is UNCHANGED after the graduate-profile edit (Resume, JD, Behavioural, Resume, Executive Judgment)', () => {
    const types = [1, 2, 3, 4, 5].map((p) => getStrategyPosition('CFO', 'executive', p).questionType);
    assert.deepStrictEqual(types, ['resume_story', 'jd_scenario', 'behavioural', 'resume_story', 'executive_judgment'], 'executive candidates must still receive the executive_judgment close -- this fix must not regress them');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PATCH A REGRESSION (2026-09-04): Career Stage -> Strategy Profile
  // resolution order. Recognized experienceLevel now wins over role for
  // ALL four stages (previously only the Fresher family had this
  // precedence -- Mid/Senior/Executive fell through to role mapping or
  // the hard executive fallback with no dedicated resolution at all).
  // Desired table: Fresher->graduate, Mid->professional,
  // Senior->professional, Executive->executive, tested across 4 roles
  // spanning both "has an explicit ROLE_TO_PROFILE entry" (Software
  // Engineer) and "has none, previously fell to executive" (Engineering
  // Manager, Product Manager, Business Analyst).
  // ═══════════════════════════════════════════════════════════════════════
  const PATCH_A_ROLES = ['Software Engineer', 'Engineering Manager', 'Product Manager', 'Business Analyst'];

  PATCH_A_ROLES.forEach((role) => {
    check(`PATCH A: ${role} + Fresher -> graduate`, () => {
      assert.strictEqual(resolveStrategyProfileName(role, 'fresher'), 'graduate');
    });
    check(`PATCH A: ${role} + Mid -> professional`, () => {
      assert.strictEqual(resolveStrategyProfileName(role, 'mid'), 'professional');
    });
    check(`PATCH A: ${role} + Senior -> professional`, () => {
      assert.strictEqual(resolveStrategyProfileName(role, 'senior'), 'professional');
    });
    check(`PATCH A: ${role} + Executive -> executive`, () => {
      assert.strictEqual(resolveStrategyProfileName(role, 'executive'), 'executive');
    });
  });

  check('PATCH A CRITICAL: Software Engineer + Executive MUST NOT resolve to engineering (the inversion bug found in the forensic report)', () => {
    assert.notStrictEqual(resolveStrategyProfileName('Software Engineer', 'executive'), 'engineering');
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'executive'), 'executive');
  });

  check('PATCH A CRITICAL: Business Analyst + Mid MUST NOT resolve to executive (the Mid-as-Executive bug found in the forensic report)', () => {
    assert.notStrictEqual(resolveStrategyProfileName('Business Analyst', 'mid'), 'executive');
    assert.strictEqual(resolveStrategyProfileName('Business Analyst', 'mid'), 'professional');
  });

  check('PATCH A: the professional profile has no executive_judgment slot anywhere in its 5-question rhythm', () => {
    const types = [1, 2, 3, 4, 5].map((p) => getStrategyPosition('Business Analyst', 'mid', p).questionType);
    assert.ok(!types.includes('executive_judgment'), 'Mid/Senior candidates must not receive the executive_judgment close');
    assert.deepStrictEqual(types, ['resume_story', 'jd_scenario', 'behavioural', 'jd_scenario', 'resume_story']);
  });

  check('PATCH A: ROLE_TO_PROFILE fallback still works for a missing/unrecognized experience level (explicitly required to remain intact)', () => {
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', undefined), 'engineering');
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', ''), 'engineering');
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'some-unrecognized-value'), 'engineering');
  });

  check('PATCH A: a role with no ROLE_TO_PROFILE entry AND a missing experience level still falls all the way to executive (final hard fallback, unchanged)', () => {
    assert.strictEqual(resolveStrategyProfileName('Business Analyst', undefined), 'executive');
    assert.strictEqual(resolveStrategyProfileName('Custom Unmapped Role', ''), 'executive');
  });

  check('PATCH A: recognized experience level wins even when role also has an explicit ROLE_TO_PROFILE mapping (Mid/Senior no longer special-cased by role)', () => {
    // Before Patch A: Software Engineer + Mid -> 'engineering' (via ROLE_TO_PROFILE).
    // After Patch A: Software Engineer + Mid -> 'professional' (experience level wins).
    // Functionally near-identical rhythm (both are Resume/JD/Behavioural/JD/Resume),
    // but resolved through the correct, role-independent path now.
    assert.strictEqual(resolveStrategyProfileName('Software Engineer', 'mid'), 'professional');
    assert.strictEqual(resolveStrategyProfileName('AI Engineer', 'senior'), 'professional');
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

// ═══════════════════════════════════════════════════════════════════════════
// Part 4 — BUG FIX REGRESSION (2026-09-03): composePrompt's actual
// generated TEXT, not just the strategy-type enum. Fixing the strategy
// profile alone was not sufficient -- two hardcoded phrases inside
// composePrompt() ("executive voice" in SCENARIO_FORMAT_TEXT.behavioral,
// and the "board-level judgment"/"executive scenario" suggestion list in
// the DO-NOT-RE-ANCHOR guardrail) fired identically regardless of
// experience level. This section proves those two phrases are now gated
// on isFresherStyle (folded from calibrationState.adjustedLevelNum via
// the EXISTING styleKeyForLevel function -- no new calibration system),
// AND that Mid/Senior/Executive get byte-for-byte identical text to
// before this fix.
// ═══════════════════════════════════════════════════════════════════════════
{
  const iv = loadWithTestExports('services/interview.js', ['composePrompt', 'EVIDENCE_TIERS']);
  const composePrompt = iv.__test_composePrompt;
  const EVIDENCE_TIERS = iv.__test_EVIDENCE_TIERS;

  function baseArgs(overrides) {
    return Object.assign({
      competency: 'leadership',
      calibrationState: Object.assign({
        activeLevelKey: 'L1',
        activeStageSchema: { level: 'L1', stage: 'Student/Fresher', style: 'Fundamentals & Applied Basics', scope: 'Individual task execution with clear guardrails' },
        isAiDataDomain: false,
        scenarioFormatTag: 'behavioral',
        caseTierBand: null,
        experienceStyle: 'test style',
        adjustedLevelNum: 1,
      }, overrides && overrides.calibrationState),
      evidenceProfile: { evidenceTier: EVIDENCE_TIERS.WEAK, leastValidatedSubskill: 'test_subskill' },
      strategy: { phase: 'test', mode: 'test', operationalDirective: 'test directive' },
      candidateModel: { confidence: 50, ownership: 50, communication: 50, technicalDepth: 50, leadership: 50, decisionMaking: 50, learningAgility: 50, businessThinking: 50 },
      difficulty: 'medium',
      hasResumeContext: false,
      isFollowup: false,
      questionBlueprint: null,
    }, overrides && Object.keys(overrides).filter(k => k !== 'calibrationState').reduce((o, k) => { o[k] = overrides[k]; return o; }, {}));
  }

  const fresherPrompt = composePrompt(baseArgs({ calibrationState: { adjustedLevelNum: 1 } }));   // L1 Fresher
  const juniorPrompt  = composePrompt(baseArgs({ calibrationState: { adjustedLevelNum: 2 } }));   // L2 Junior -- folds into 'fresher' style too
  const midPrompt      = composePrompt(baseArgs({ calibrationState: { adjustedLevelNum: 3 } }));  // L3 Mid -- must be UNCHANGED
  const seniorPrompt   = composePrompt(baseArgs({ calibrationState: { adjustedLevelNum: 4 } }));  // L4 Senior -- must be UNCHANGED
  const execPrompt     = composePrompt(baseArgs({ calibrationState: { adjustedLevelNum: 7 } }));  // L7 Executive -- must be UNCHANGED

  check('BUG FIX: Fresher (L1) prompt does NOT contain "executive voice"', () => {
    assert.ok(!fresherPrompt.includes('executive voice'), 'Fresher prompt must not instruct the model to use an executive voice');
  });

  check('BUG FIX: Fresher (L1) prompt uses the new peer-level voice instruction instead', () => {
    assert.ok(fresherPrompt.includes('authentic peer-level voice'));
  });

  check('BUG FIX: Junior (L2) gets the same fresher-style text as L1 (styleKeyForLevel folds L1+L2 together)', () => {
    assert.ok(!juniorPrompt.includes('executive voice'));
    assert.ok(juniorPrompt.includes('authentic peer-level voice'));
  });

  check('BUG FIX: Fresher (L1) prompt does NOT contain "board-level judgment" or "executive scenario"', () => {
    assert.ok(!fresherPrompt.includes('board-level judgment'));
    assert.ok(!fresherPrompt.includes('a hypothetical executive scenario'));
  });

  check('BUG FIX: Fresher (L1) prompt uses the new entry-level suggestion list instead', () => {
    assert.ok(fresherPrompt.includes('a peer-collaboration challenge'));
    assert.ok(fresherPrompt.includes('skill-gap or learning-curve scenario'));
  });

  check('REGRESSION GUARD: Mid (L3) prompt is UNCHANGED -- still contains "executive voice" and "board-level judgment", exactly as before this fix', () => {
    assert.ok(midPrompt.includes('executive voice'), 'mid-level was never part of this bug and must not be touched');
    assert.ok(midPrompt.includes('board-level judgment'));
    assert.ok(!midPrompt.includes('authentic peer-level voice'), 'mid must not accidentally receive the fresher-only text');
  });

  check('REGRESSION GUARD: Senior (L4) prompt is UNCHANGED -- still contains "executive voice" and "board-level judgment"', () => {
    assert.ok(seniorPrompt.includes('executive voice'));
    assert.ok(seniorPrompt.includes('board-level judgment'));
  });

  check('REGRESSION GUARD: Executive (L7) prompt is UNCHANGED -- still contains "executive voice" and "board-level judgment"', () => {
    assert.ok(execPrompt.includes('executive voice'));
    assert.ok(execPrompt.includes('board-level judgment'));
  });

  check('REGRESSION GUARD: Senior/Executive/Mid all produce byte-identical scenario-format text to each other (nothing accidentally level-branched beyond fresher)', () => {
    const extractFramingFormat = (p) => p.match(/Framing Format: ([\s\S]*?)\n/)[1];
    assert.strictEqual(extractFramingFormat(midPrompt), extractFramingFormat(seniorPrompt));
    assert.strictEqual(extractFramingFormat(seniorPrompt), extractFramingFormat(execPrompt));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 5 — PATCH C REGRESSION (2026-09-04): the three confirmed
// prompt-calibration leaks (COMPETENCY_PROMPTS.system_design,
// COMPETENCY_PROMPTS.communication, jd_scenario CRITICAL directive).
// Verifies the ACTUAL COMPOSED PROMPT TEXT the engine sends — never the
// LLM's output — per explicit instruction.
// ═══════════════════════════════════════════════════════════════════════════
{
  const iv = loadWithTestExports('services/interview.js', ['composePrompt', 'EVIDENCE_TIERS', 'resolveCompetencyPrompt']);
  const composePrompt = iv.__test_composePrompt;
  const EVIDENCE_TIERS = iv.__test_EVIDENCE_TIERS;
  const resolveCompetencyPrompt = iv.__test_resolveCompetencyPrompt;

  function jdScenarioArgs(overrides) {
    return Object.assign({
      competency: 'system_design',
      calibrationState: Object.assign({
        activeLevelKey: 'L1',
        activeStageSchema: { level: 'L1', stage: 'Student/Fresher', style: 'Fundamentals & Applied Basics', scope: 'Individual task execution with clear guardrails' },
        isAiDataDomain: false,
        scenarioFormatTag: 'analytical',
        caseTierBand: null,
        experienceStyle: 'test style',
        adjustedLevelNum: 1,
      }, overrides && overrides.calibrationState),
      evidenceProfile: { evidenceTier: EVIDENCE_TIERS.WEAK, leastValidatedSubskill: 'test_subskill' },
      strategy: { phase: 'test', mode: 'test', operationalDirective: 'test directive' },
      candidateModel: { confidence: 50, ownership: 50, communication: 50, technicalDepth: 50, leadership: 50, decisionMaking: 50, learningAgility: 50, businessThinking: 50 },
      difficulty: 'medium',
      hasResumeContext: false,
      isFollowup: false,
      questionBlueprint: { strategy_source: 'JDScenario', jd_objective: 'design and scale backend systems for high traffic', competency: 'system_design', interview_intent: 'test' },
    }, overrides && Object.keys(overrides).filter(k => k !== 'calibrationState').reduce((o, k) => { o[k] = overrides[k]; return o; }, {}));
  }

  // 1. Fresher + system_design -> Fresher-safe framing (composed prompt, not LLM output)
  check('PATCH C #1: Fresher composed prompt for system_design does not contain "scalability trade-offs" and does contain the new implementation-choice framing', () => {
    const fresherSystemDesign = resolveCompetencyPrompt('system_design', true);
    assert.ok(!fresherSystemDesign.includes('scalability trade-offs'));
    assert.ok(fresherSystemDesign.includes('Do not introduce enterprise-scale'), 'the fresher text should explicitly instruct AGAINST enterprise-scale framing, not merely omit the word');
    assert.ok(fresherSystemDesign.includes('hands-on implementation choices'));
  });

  check('PATCH C: non-fresher system_design framing is BYTE-IDENTICAL to the original text', () => {
    const original = 'Focus this question on system design, architecture decisions, scalability trade-offs, or technical infrastructure choices.';
    assert.strictEqual(resolveCompetencyPrompt('system_design', false), original);
  });

  // 2. Fresher + communication -> no "executive presence"
  check('PATCH C #2: Fresher composed prompt for communication does not contain "executive presence"', () => {
    const fresherComm = resolveCompetencyPrompt('communication', true);
    assert.ok(!fresherComm.includes('executive presence'));
    assert.ok(fresherComm.includes('team-level communication') || fresherComm.includes('teammate'));
  });

  check('PATCH C: non-fresher communication framing is BYTE-IDENTICAL to the original text', () => {
    const original = 'Focus this question on stakeholder communication, executive presence, delivering difficult messages, or cross-functional alignment.';
    assert.strictEqual(resolveCompetencyPrompt('communication', false), original);
  });

  check('PATCH C: leadership/strategy/technical framings are completely UNTOUCHED by this patch (not part of the confirmed leak list)', () => {
    assert.strictEqual(resolveCompetencyPrompt('leadership', true), 'Focus this question on team leadership, people management, influencing without authority, or navigating org conflict.');
    assert.strictEqual(resolveCompetencyPrompt('strategy', true), 'Focus this question on strategic thinking, roadmap prioritisation, business trade-offs, or long-term vision setting.');
    assert.strictEqual(resolveCompetencyPrompt('technical', true), 'Focus this question on domain-specific technical knowledge, implementation depth, debugging approaches, or engineering best practices.');
  });

  // 3. Fresher + jd_scenario -> Fresher scope ceiling (in the actual composed prompt)
  const fresherJdPrompt = composePrompt(jdScenarioArgs({ calibrationState: { adjustedLevelNum: 1 } }));
  const midJdPrompt      = composePrompt(jdScenarioArgs({ calibrationState: { adjustedLevelNum: 3 } }));
  const seniorJdPrompt   = composePrompt(jdScenarioArgs({ calibrationState: { adjustedLevelNum: 4 } }));
  const execJdPrompt     = composePrompt(jdScenarioArgs({ calibrationState: { adjustedLevelNum: 7 } }));

  check('PATCH C #3: Fresher jd_scenario composed prompt contains the new scope-ceiling directive', () => {
    assert.ok(fresherJdPrompt.includes('FRESHER/JUNIOR SCOPE CEILING'));
    assert.ok(fresherJdPrompt.includes('individual-contributor-level task'));
  });

  check('PATCH C: Mid/Senior/Executive jd_scenario composed prompts do NOT contain the Fresher scope-ceiling directive', () => {
    assert.ok(!midJdPrompt.includes('FRESHER/JUNIOR SCOPE CEILING'));
    assert.ok(!seniorJdPrompt.includes('FRESHER/JUNIOR SCOPE CEILING'));
    assert.ok(!execJdPrompt.includes('FRESHER/JUNIOR SCOPE CEILING'));
  });

  check('PATCH C: the original jd_scenario CRITICAL directive text is still present, unchanged, for every level (this is an ADDITION, not a replacement)', () => {
    const originalDirectiveSnippet = 'THIS TURN MUST BE DRIVEN BY THE JOB DESCRIPTION, NOT A GENERIC SCENARIO';
    [fresherJdPrompt, midJdPrompt, seniorJdPrompt, execJdPrompt].forEach((p) => {
      assert.ok(p.includes(originalDirectiveSnippet));
    });
  });

  check('PATCH C: Mid/Senior/Executive jd_scenario prompts are BYTE-IDENTICAL to each other (only Fresher branch changed)', () => {
    // Extract just the JD-scenario CRITICAL block for a precise comparison
    // (the full prompt also embeds calibration text which legitimately
    // differs by level, so a whole-prompt diff would be a false negative).
    const extractJdBlock = (p) => {
      const start = p.indexOf('THIS TURN MUST BE DRIVEN BY THE JOB DESCRIPTION');
      const end = p.indexOf('DO NOT RE-ANCHOR', start);
      return p.slice(start, end === -1 ? start + 800 : end);
    };
    assert.strictEqual(extractJdBlock(midJdPrompt), extractJdBlock(seniorJdPrompt));
    assert.strictEqual(extractJdBlock(seniorJdPrompt), extractJdBlock(execJdPrompt));
  });

  // 4, 5, 6. Mid/Senior/Executive + system_design retains professional/senior/executive framing
  check('PATCH C #4: Mid + system_design retains the original professional-level framing', () => {
    assert.strictEqual(resolveCompetencyPrompt('system_design', false), 'Focus this question on system design, architecture decisions, scalability trade-offs, or technical infrastructure choices.');
  });

  check('PATCH C #5: Senior + system_design retains the original senior-level framing (same function, isFresherStyle=false)', () => {
    assert.strictEqual(resolveCompetencyPrompt('system_design', false), 'Focus this question on system design, architecture decisions, scalability trade-offs, or technical infrastructure choices.');
  });

  check('PATCH C #6: Executive + system_design retains the original executive-level framing (same function, isFresherStyle=false)', () => {
    assert.strictEqual(resolveCompetencyPrompt('system_design', false), 'Focus this question on system design, architecture decisions, scalability trade-offs, or technical infrastructure choices.');
  });

  // 7. Direct end-to-end composed-prompt test: Software Engineer + Fresher + no resume/JD context
  check('DIRECT TEST: Software Engineer + Fresher + no resume/JD context — composed prompt contains none of the flagged senior/executive phrases', () => {
    const noContextArgs = jdScenarioArgs({
      calibrationState: { adjustedLevelNum: 1, scenarioFormatTag: 'behavioral' },
      hasResumeContext: false,
      questionBlueprint: null, // no JD/resume context at all -> falls into the no-story guardrail, not the JD branch
    });
    const prompt = composePrompt(noContextArgs);
    const forbiddenPhrases = ['board-level', 'executive presence', 'enterprise-scale', '10x', 'large distributed', 'executive voice', 'scalability trade-offs'];
    forbiddenPhrases.forEach((phrase) => {
      assert.ok(!prompt.toLowerCase().includes(phrase.toLowerCase()), `composed prompt must not contain "${phrase}" for a Fresher with no resume/JD context`);
    });
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
