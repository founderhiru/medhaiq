// ═══════════════════════════════════════════════════════════════════════════
// tests/discovery-router-profiles.js
//
// Characterization suite for Phase 1 of the Discovery Profile feature:
// services/discovery/discovery-profiles.js (config) and
// services/discovery/discovery-router.js (routing).
//
// Nothing in the live app calls these files yet — this suite exists to
// establish the correctness baseline BEFORE Phase 2 wires anything into
// controllers/sessionController.js or routes/interview.js.
//
// Run with: node tests/discovery-router-profiles.js
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const { selectDiscoveryProfile } = require('../services/discovery/discovery-router');
const { DISCOVERY_PROFILES } = require('../services/discovery/discovery-profiles');

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

function main() {
  console.log('\nDiscovery Router — Phase 1 characterization suite\n');

  // ── Layer 1: Career Stage is authoritative for mid/senior/executive ──
  check('mid always resolves to PROFESSIONAL, regardless of resume', () => {
    const r = selectDiscoveryProfile({ experienceLevel: 'mid', resumeContext: null, storyLibrary: [] });
    assert.strictEqual(r.profileKey, 'PROFESSIONAL');
  });

  check('senior always resolves to LEADERSHIP, regardless of resume', () => {
    const r = selectDiscoveryProfile({
      experienceLevel: 'senior',
      resumeContext: { companies: [], summary: 'university capstone hackathon intern' }, // adversarial: campus keywords present
      storyLibrary: [],
    });
    assert.strictEqual(r.profileKey, 'LEADERSHIP', 'career stage must override resume signal outside fresher tier');
  });

  check('executive always resolves to EXECUTIVE, regardless of resume', () => {
    const r = selectDiscoveryProfile({ experienceLevel: 'executive', resumeContext: null, storyLibrary: null });
    assert.strictEqual(r.profileKey, 'EXECUTIVE');
  });

  check('unrecognized experienceLevel fails safe to PROFESSIONAL (mirrors sessionController default)', () => {
    const r = selectDiscoveryProfile({ experienceLevel: 'staff', resumeContext: null, storyLibrary: null });
    assert.strictEqual(r.profileKey, 'PROFESSIONAL');
  });

  // ── Layer 2: fresher tier, resume-driven heuristic ──
  check('fresher + empty resume (no upload) → EARLY_CAMPUS (safe default)', () => {
    const r = selectDiscoveryProfile({ experienceLevel: 'fresher', resumeContext: null, storyLibrary: null });
    assert.strictEqual(r.profileKey, 'EARLY_CAMPUS');
  });

  check('fresher + capstone project resume, zero employers → EARLY_CAMPUS', () => {
    const r = selectDiscoveryProfile({
      experienceLevel: 'fresher',
      resumeContext: { companies: [], summary: 'Final-year capstone project on distributed systems.' },
      storyLibrary: [],
    });
    assert.strictEqual(r.profileKey, 'EARLY_CAMPUS');
  });

  check('fresher + internship only (no full-time employer) → EARLY_CAMPUS', () => {
    const r = selectDiscoveryProfile({
      experienceLevel: 'fresher',
      resumeContext: { companies: ['Acme Corp'], summary: 'Completed a 3-month internship at Acme Corp.' },
      storyLibrary: [],
    });
    assert.strictEqual(r.profileKey, 'EARLY_CAMPUS', 'a single internship employer should still read as campus, not professional');
  });

  check('fresher + 18 months at Infosys, no campus keywords → EARLY_PROFESSIONAL', () => {
    const r = selectDiscoveryProfile({
      experienceLevel: 'fresher',
      resumeContext: { companies: ['Infosys'], summary: '18 months as a software engineer at Infosys.' },
      storyLibrary: [],
    });
    assert.strictEqual(r.profileKey, 'EARLY_PROFESSIONAL');
  });

  check('fresher + 2 employers + incidental "hackathon" mention → EARLY_PROFESSIONAL (employer history wins)', () => {
    const r = selectDiscoveryProfile({
      experienceLevel: 'fresher',
      resumeContext: {
        companies: ['Startup A', 'Startup B'],
        summary: 'Worked at Startup A and Startup B; won a hackathon in college for fun.',
      },
      storyLibrary: [],
    });
    assert.strictEqual(r.profileKey, 'EARLY_PROFESSIONAL');
  });

  check('fresher + keyword only in story_library summary (not resume_context) is still detected', () => {
    const r = selectDiscoveryProfile({
      experienceLevel: 'fresher',
      resumeContext: { companies: ['Acme Corp'] },
      storyLibrary: [{ story_key: 'X', company: 'Acme Corp', summary: 'Built a tool during my graduate trainee program.' }],
    });
    assert.strictEqual(r.profileKey, 'EARLY_CAMPUS', 'keyword in story_library.summary must be scanned, not just resume_context');
  });

  check('case-insensitive keyword match ("UNIVERSITY" in caps)', () => {
    const r = selectDiscoveryProfile({
      experienceLevel: 'fresher',
      resumeContext: { companies: [], summary: 'Graduated from UNIVERSITY with honors.' },
      storyLibrary: [],
    });
    assert.strictEqual(r.profileKey, 'EARLY_CAMPUS');
  });

  // ── Config integrity (Phase 1 contract) ──
  check('v1: only EARLY_CAMPUS and EARLY_PROFESSIONAL have usesDiscoveryOpening=true', () => {
    const trueKeys = Object.values(DISCOVERY_PROFILES).filter(p => p.usesDiscoveryOpening).map(p => p.key).sort();
    assert.deepStrictEqual(trueKeys, ['EARLY_CAMPUS', 'EARLY_PROFESSIONAL']);
  });

  check('PROFESSIONAL/LEADERSHIP/EXECUTIVE openingQuestion is null (proves no accidental content authored for pass-through tiers)', () => {
    assert.strictEqual(DISCOVERY_PROFILES.PROFESSIONAL.openingQuestion, null);
    assert.strictEqual(DISCOVERY_PROFILES.LEADERSHIP.openingQuestion, null);
    assert.strictEqual(DISCOVERY_PROFILES.EXECUTIVE.openingQuestion, null);
  });

  check('discovery-profiles.js exports frozen config (accidental mutation is impossible)', () => {
    assert.ok(Object.isFrozen(DISCOVERY_PROFILES));
    assert.ok(Object.isFrozen(DISCOVERY_PROFILES.EARLY_CAMPUS));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
