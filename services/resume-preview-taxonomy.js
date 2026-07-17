// ═══════════════════════════════════════════════════════════════════════════
// services/resume-preview-taxonomy.js — MedhaIQ Career Intelligence Preview
//
// REFACTORED: evidence-extraction taxonomy, not keyword-density scoring.
// Every pattern here is used to pull out the ACTUAL sentence/line of the
// resume that matched — that sentence becomes a piece of evidence, not a
// tally mark. Scoring (in resume-preview-scoring.js) counts DISTINCT pieces
// of evidence, never raw frequency — so a resume that repeats "led" 10 times
// in one bullet scores no higher than one that says it once.
//
// This is deliberately NOT an ATS keyword matcher. The goal is "does this
// resume contain real evidence of X", not "how many times does X appear".
// ═══════════════════════════════════════════════════════════════════════════

// ── Leadership Evidence ──────────────────────────────────────────────────────
const LEADERSHIP_PATTERNS = Object.freeze({
  ExecutiveLeadership: [
    /\bp&l\b/i, /\bboard(s)?\b/i, /\benterprise transformation\b/i, /\bdigital transformation\b/i,
    /\borgani[sz]ational leadership\b/i, /\bstrategic (vision|direction)\b/i,
  ],
  PeopleLeadership: [
    /\bmanaged (a |the )?team\b/i, /\bled (a |the )?team\b/i, /\bmentor(ed|ing|ship)?\b/i,
    /\bcoach(ed|ing)?\b/i, /\bdirect reports?\b/i, /\bhir(e|ed|ing)\b/i,
  ],
  CrossFunctionalLeadership: [
    /\bcross[- ]functional\b/i, /\bstakeholder management\b/i, /\balignment across\b/i,
  ],
});

// ── Business Impact Evidence ─────────────────────────────────────────────────
const BUSINESS_PATTERNS = Object.freeze({
  QuantifiedOutcome: [
    /\$\s?\d[\d,.]*\s?(k|m|mn|million|billion|bn)?/i,
    /\u20b9\s?\d[\d,.]*\s?(k|l|lakh|cr|crore)?/i,
    /\d+(\.\d+)?\s?%/,
    /\d+x\b/i,
  ],
  RevenueGrowth: [/\brevenue\b/i, /\bgrowth\b/i, /\bmargin\b/i],
  BudgetOwnership: [/\bbudget(s|ing)?\b/i, /\bcost (optimi[sz]ation|control|savings|reduction)\b/i, /\broi\b/i],
});

// ── Executive Communication Evidence ─────────────────────────────────────────
const COMMUNICATION_PATTERNS = Object.freeze({
  StakeholderCommunication: [/\bstakeholders?\b/i, /\bexecutive (communication|presentation)s?\b/i, /\binfluenc(e|ing)\b/i],
  ClientFacing: [/\bclient(s)?[- ]facing\b/i, /\bclient management\b/i, /\bcustomer[- ]facing\b/i],
  BoardExecutivePresence: [/\bboard(room)?\b/i, /\bc[- ]suite\b/i, /\bexecutive presence\b/i],
});

// ── Career Readiness Evidence — seniority/scope signals ──────────────────────
// Distinct from the other three: this looks for titles/scope language that
// indicate seniority progression, not competency content.
const SENIORITY_PATTERNS = Object.freeze({
  SeniorTitle: [/\bdirector\b/i, /\bhead of\b/i, /\bvp\b/i, /\bvice president\b/i, /\bchief\b/i, /\bprincipal\b/i],
  ScopeOfOwnership: [/\bglobal(ly)?\b/i, /\benterprise[- ]wide\b/i, /\bmulti[- ]country\b/i, /\bacross \d+ (countries|regions|markets)\b/i],
});

const ALL_TAXONOMIES = Object.freeze({
  careerReadiness: SENIORITY_PATTERNS,
  leadership: LEADERSHIP_PATTERNS,
  business: BUSINESS_PATTERNS,
  communication: COMMUNICATION_PATTERNS,
});

const MAX_EVIDENCE_ITEMS_PER_BUCKET = 5;
const EVIDENCE_SNIPPET_MAX_CHARS = 110;

/**
 * Split raw resume text into candidate evidence lines — one per bullet/
 * sentence, roughly. Deliberately simple (newline + sentence-terminator
 * split) rather than a full NLP sentence splitter; good enough for resume
 * bullet-point structure and keeps this dependency-free.
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoLines(text) {
  if (!text) return [];
  return text
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 8 && l.length <= 400);
}

/**
 * Core evidence extractor: scans every line against every category in a
 * taxonomy, and for each category that matches, keeps the actual line as
 * evidence (deduped, capped). Returns both the evidence snippets (for
 * display / template selection) and the distinct-category count (for
 * scoring — NOT a frequency count).
 * @param {string[]} lines
 * @param {Object<string, RegExp[]>} taxonomy
 * @returns {{ items: string[], distinctCategoryCount: number }}
 */
function extractEvidence(lines, taxonomy) {
  const items = [];
  const categoriesHit = new Set();

  for (const line of lines) {
    for (const [category, patterns] of Object.entries(taxonomy)) {
      if (patterns.some((re) => re.test(line))) {
        categoriesHit.add(category);
        const snippet = line.length > EVIDENCE_SNIPPET_MAX_CHARS
          ? line.slice(0, EVIDENCE_SNIPPET_MAX_CHARS - 1).trim() + '\u2026'
          : line;
        if (!items.includes(snippet) && items.length < MAX_EVIDENCE_ITEMS_PER_BUCKET) {
          items.push(snippet);
        }
      }
    }
  }

  return { items, distinctCategoryCount: categoriesHit.size };
}

/**
 * Build the full Evidence Object for a resume: one evidence extraction per
 * bucket (careerReadiness, leadership, business, communication). This is
 * the single artifact everything downstream (scoring, templates, UI) reads
 * from — nothing downstream re-scans raw text.
 * @param {string} resumeText
 * @returns {Object} e.g. { leadership: {items, distinctCategoryCount}, ... }
 */
function buildEvidenceObject(resumeText) {
  const lines = splitIntoLines(resumeText);
  const evidence = {};
  for (const [bucketKey, taxonomy] of Object.entries(ALL_TAXONOMIES)) {
    evidence[bucketKey] = extractEvidence(lines, taxonomy);
  }
  return evidence;
}

module.exports = {
  LEADERSHIP_PATTERNS,
  BUSINESS_PATTERNS,
  COMMUNICATION_PATTERNS,
  SENIORITY_PATTERNS,
  buildEvidenceObject,
  splitIntoLines,
};
