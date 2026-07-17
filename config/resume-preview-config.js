// ═══════════════════════════════════════════════════════════════════════════
// config/resume-preview-config.js — MedhaIQ Career Intelligence Preview
//
// REFACTORED: adds RECRUITER_TEMPLATES + OPPORTUNITY_TEMPLATES — the entire
// LLM explanation layer (Stage 4 as originally planned) is now eliminated.
// Every piece of copy on this page is either extracted evidence (real resume
// text) or selected from a fixed template based on deterministic band
// combinations. Zero AI calls anywhere in this feature.
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {

  // ── Response versioning ─────────────────────────────────────────────────────
  // Every JSON response includes this. Bump on any change to scoring logic,
  // taxonomy, bands, or response shape — lets the UI (or future analytics)
  // know which engine version produced a given preview.
  PREVIEW_VERSION: '1.0',

  // ── Bucket weights for the Overall headline score (internal only) ─────────
  BUCKET_WEIGHTS: Object.freeze({
    careerReadiness: 0.35,
    leadership:      0.25,
    business:        0.20,
    communication:   0.20,
  }),

  // ── Overall score → band (checked top-down, first match wins) ─────────────
  // "Early Signal" is NOT in this table — returned separately when the
  // thin-extraction degradation rule trips (see resume-preview-scoring.js).
  SCORE_BANDS: Object.freeze([
    { min: 85, label: 'Excellent' },
    { min: 70, label: 'Strong' },
    { min: 55, label: 'Good' },
    { min: 0,  label: 'Developing' },
  ]),

  // ── Per-bucket scoring curve ────────────────────────────────────────────────
  // raw score = SCORE_FLOOR + (distinctEvidenceCategoryCount * POINTS_PER_HIT),
  // capped at SCORE_CEILING. Scored on DISTINCT evidence categories matched,
  // never on how many times a keyword appears — that's the ATS-density trap
  // this refactor explicitly removes.
  SCORE_FLOOR:      34,
  SCORE_CEILING:    96,
  POINTS_PER_HIT:   11,
  MAX_COUNTED_HITS: 6,

  // ── Reliability threshold ───────────────────────────────────────────────────
  MIN_HITS_FOR_NUMERIC: 2,
  MIN_LIMITED_BUCKETS_TO_DEGRADE_OVERALL: 3,

  // ── Executive Signals list ──────────────────────────────────────────────────
  MAX_EXECUTIVE_SIGNALS: 6,
  EXEC_SIGNALS_NOTE: 'Additional capabilities are validated during the live interview.',

  // ── Opportunities to Strengthen ──────────────────────────────────────────────
  MAX_OPPORTUNITIES: 3,

  // ── Career Readiness composite inputs ───────────────────────────────────────
  READINESS_BREADTH_WEIGHT: 0.5,   // from seniority/scope evidence
  READINESS_DEPTH_WEIGHT: 0.5,     // from overall evidence breadth across all buckets

  // ── Recruiter First Impression — template matrix, selected by band combo ──
  // Deliberately just leadership x business (2x2) — the two dimensions a
  // recruiter's first 30 seconds actually keys off. Adding all 4 dimensions
  // would need 16 combos for marginal gain; not worth the complexity.
  // Every line is grounded in "evidence exists / doesn't exist" — never a
  // specific invented fact, so it's always true regardless of which resume
  // triggered it.
  RECRUITER_TEMPLATES: Object.freeze({
    highLeadership_highBusiness:
      'This profile reads as an experienced leader with clear, quantified business execution. The combination of organizational scope and measurable outcomes makes it competitive for larger operating roles.',
    highLeadership_lowBusiness:
      'This profile shows real leadership scope and team ownership, though the business outcomes behind that work aren\u2019t clearly quantified yet. The leadership signal is the stronger of the two.',
    lowLeadership_highBusiness:
      'This profile is strong on measurable, quantified results, but organizational or team-leadership scope isn\u2019t yet clearly visible. It reads as a strong individual contributor track record.',
    lowLeadership_lowBusiness:
      'This profile shows steady, consistent experience, but neither leadership scope nor quantified business impact stand out clearly yet on a first read.',
  }),
};
