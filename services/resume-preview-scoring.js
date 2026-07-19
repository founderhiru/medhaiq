// ═══════════════════════════════════════════════════════════════════════════
// services/resume-preview-scoring.js — MedhaIQ Career Intelligence Preview
//
// REFACTORED, zero-LLM. Pipeline is now:
//   raw resume text -> buildEvidenceObject() -> score the evidence ->
//   select templates -> return
// NO AI calls anywhere in this file or anything it depends on. Every score
// is derived from the Evidence Object's distinct-category counts, never
// from raw keyword frequency (that ATS-density approach is deliberately
// removed). Every function is a pure function of plain objects/arrays —
// independently testable with no mocking required.
// ═══════════════════════════════════════════════════════════════════════════

const CFG = require('../config/resume-preview-config');
const { buildEvidenceObject } = require('./resume-preview-taxonomy');

/** Convert a distinct-category-count into a bucket score, or Limited Signal. */
function hitsToScore(distinctCategoryCount) {
  if (distinctCategoryCount < CFG.MIN_HITS_FOR_NUMERIC) {
    return { numeric: false, score: null, hitCount: distinctCategoryCount };
  }
  const countedHits = Math.min(distinctCategoryCount, CFG.MAX_COUNTED_HITS);
  const score = Math.min(CFG.SCORE_FLOOR + countedHits * CFG.POINTS_PER_HIT, CFG.SCORE_CEILING);
  return { numeric: true, score, hitCount: distinctCategoryCount };
}

function calculateLeadershipEvidence(evidence) {
  return { key: 'leadership', label: 'Leadership Evidence', ...hitsToScore(evidence.leadership.distinctCategoryCount) };
}

function calculateBusinessImpact(evidence) {
  return { key: 'business', label: 'Business Impact', ...hitsToScore(evidence.business.distinctCategoryCount) };
}

function calculateCommunication(evidence) {
  return { key: 'communication', label: 'Executive Communication', ...hitsToScore(evidence.communication.distinctCategoryCount) };
}

/**
 * Career Readiness — composite of seniority/scope evidence (its own bucket)
 * plus overall evidence breadth (how many of the other three buckets have
 * ANY evidence at all). Both are evidence-derived, neither is a frequency
 * count.
 */
function calculateCareerReadiness(evidence) {
  const seniorityHits = evidence.careerReadiness.distinctCategoryCount; // 0-2 (SeniorTitle, ScopeOfOwnership)
  const otherBucketsWithEvidence = ['leadership', 'business', 'communication']
    .filter((k) => evidence[k].distinctCategoryCount > 0).length; // 0-3

  const totalSignal = seniorityHits + otherBucketsWithEvidence; // 0-5 combined
  return { key: 'careerReadiness', label: 'Career Readiness', ...hitsToScore(totalSignal >= 2 ? Math.min(totalSignal, CFG.MAX_COUNTED_HITS) : totalSignal) };
}

/** Overall headline: band only in the public shape, numeric kept internal. */
function calculateOverall(buckets) {
  const limitedCount = buckets.filter((b) => !b.numeric).length;

  if (limitedCount >= CFG.MIN_LIMITED_BUCKETS_TO_DEGRADE_OVERALL) {
    return {
      numeric: false,
      score: null,
      band: 'Early Signal',
      caption: 'Not enough resume evidence yet to estimate a reliable preview \u2014 this sharpens significantly in a live interview.',
    };
  }

  const numericBuckets = buckets.filter((b) => b.numeric);
  const weightMap = CFG.BUCKET_WEIGHTS;
  const totalWeight = numericBuckets.reduce((sum, b) => sum + (weightMap[b.key] || 0), 0);
  const weightedSum = numericBuckets.reduce((sum, b) => sum + b.score * (weightMap[b.key] || 0), 0);
  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;

  const bandMatch = CFG.SCORE_BANDS.find((b) => score >= b.min) || CFG.SCORE_BANDS[CFG.SCORE_BANDS.length - 1];
  return { numeric: true, score, band: bandMatch.label, caption: 'Estimated from Resume' };
}

function calculateConfidence(buckets) {
  const numericCount = buckets.filter((b) => b.numeric).length;
  if (numericCount >= 4) return 'High';
  if (numericCount >= 2) return 'Medium';
  return 'Low';
}

/** Executive Signals Detected — one entry per bucket that has evidence, using the actual evidence items as the checklist content (never invented). */
function buildExecutiveSignals(evidence) {
  const labelMap = {
    careerReadiness: 'Career Scope & Seniority',
    leadership: 'Leadership Evidence',
    business: 'Quantified Business Impact',
    communication: 'Executive Communication',
  };
  const signals = [];
  for (const key of ['careerReadiness', 'leadership', 'business', 'communication']) {
    if (evidence[key].distinctCategoryCount > 0) {
      signals.push(labelMap[key]);
    }
    if (signals.length >= CFG.MAX_EXECUTIVE_SIGNALS) break;
  }
  return { signals, note: CFG.EXEC_SIGNALS_NOTE };
}

/**
 * Opportunities to Strengthen — deterministic, constructive-only, capped at 3.
 * Each rule reads directly off the evidence object (absence of evidence in
 * a bucket = the opportunity), never off word frequency.
 */
function buildOpportunities(buckets, evidence) {
  const rules = [];
  const businessBucket = buckets.find((b) => b.key === 'business');
  const commsBucket = buckets.find((b) => b.key === 'communication');
  const leadershipBucket = buckets.find((b) => b.key === 'leadership');

  if (evidence.business.items.length === 0) {
    rules.push('Achievements could be strengthened with a measurable ($ / % / outcome) result attached.');
  }
  if (commsBucket && !commsBucket.numeric) {
    rules.push('Executive communication experience isn\u2019t yet clearly visible in the resume.');
  }
  if (leadershipBucket && !leadershipBucket.numeric) {
    rules.push('Leadership scope could be described more explicitly.');
  }
  if (businessBucket && businessBucket.numeric && businessBucket.score < 60) {
    rules.push('Business impact could be framed with stronger, more specific numbers.');
  }
  return rules.slice(0, CFG.MAX_OPPORTUNITIES);
}

/**
 * Recruiter First Impression — TEMPLATE SELECTION, not generation. Picks one
 * of 4 fixed paragraphs based on the leadership x business band combination.
 * Zero AI calls; this replaces what was originally planned as an LLM step.
 */
function selectRecruiterTemplate(buckets) {
  const leadershipBucket = buckets.find((b) => b.key === 'leadership');
  const businessBucket = buckets.find((b) => b.key === 'business');
  // "High" = at least 3 distinct evidence categories (score ~67+), not an
  // arbitrary score threshold — a bucket that just cleared numeric (2 hits,
  // score 56) is real evidence, not "low", so a raw score>=70 cutoff was
  // silently contradicting resumes with solid-but-not-maximal evidence.
  const isHighLeadership = leadershipBucket.numeric && leadershipBucket.hitCount >= 3;
  const isHighBusiness = businessBucket.numeric && businessBucket.hitCount >= 3;

  if (isHighLeadership && isHighBusiness) return CFG.RECRUITER_TEMPLATES.highLeadership_highBusiness;
  if (isHighLeadership && !isHighBusiness) return CFG.RECRUITER_TEMPLATES.highLeadership_lowBusiness;
  if (!isHighLeadership && isHighBusiness) return CFG.RECRUITER_TEMPLATES.lowLeadership_highBusiness;
  return CFG.RECRUITER_TEMPLATES.lowLeadership_lowBusiness;
}

/**
 * Main entry point. Input is now RAW RESUME TEXT (plain-text extracted from
 * PDF/DOCX with no AI involved — see route/orchestrator, not built yet) —
 * not structured JSON from the AI-based resume-parser.js. This is the key
 * architectural change: nothing in this feature calls an LLM, ever.
 * @param {string} resumeText
 * @returns {Object} full PreviewResponse-shaped result
 */
function scoreResume(resumeText) {
  const evidence = buildEvidenceObject(resumeText);

  const buckets = [
    calculateCareerReadiness(evidence),
    calculateLeadershipEvidence(evidence),
    calculateBusinessImpact(evidence),
    calculateCommunication(evidence),
  ];

  const overall = calculateOverall(buckets);
  const confidence = calculateConfidence(buckets);
  const executiveSignals = buildExecutiveSignals(evidence);
  const opportunities = buildOpportunities(buckets, evidence);
  const recruiterFirstImpression = selectRecruiterTemplate(buckets);

  return {
    metrics: {
      overall: { band: overall.band, caption: overall.caption, confidence },
      internal: { score: overall.score }, // strip in production responses — see stripInternalMetrics()
    },
    buckets,
    executiveSignals,
    opportunities,
    recruiterFirstImpression,
    evidence, // raw evidence object — useful for debugging/future tuning, strip before sending to client if not needed there
  };
}

function isExtractionTooThin(scoredResult) {
  return scoredResult.metrics.overall.band === 'Early Signal';
}

function stripInternalMetrics(scoredResult) {
  const clone = JSON.parse(JSON.stringify(scoredResult));
  delete clone.metrics.internal;
  delete clone.evidence; // raw snippets are a debugging aid, not client-facing
  return clone;
}

module.exports = {
  scoreResume,
  isExtractionTooThin,
  stripInternalMetrics,
  calculateCareerReadiness,
  calculateLeadershipEvidence,
  calculateBusinessImpact,
  calculateCommunication,
  calculateOverall,
  calculateConfidence,
  buildExecutiveSignals,
  buildOpportunities,
  selectRecruiterTemplate,
};
