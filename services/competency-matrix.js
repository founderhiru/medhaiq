// ═══════════════════════════════════════════════════════════════════════════
// services/competency-matrix.js — MedhaIQ.ai competency pipeline (NEW FILE)
//
// Builds the per-session "competency matrix": the top 8 competencies the AI
// interviewer should probe, merged from three sources in priority order:
//
//   1. Role defaults      — from the role card selected at setup
//   2. Company traits     — culture/scale traits of the target company preset
//   3. JD-parsed          — competencies detected in raw Job Description text
//
// Pure functions, zero AI calls, zero external dependencies — deterministic,
// instant, and free to run on every session creation.
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Role default competencies (keys match the setup-page role cards and
//       COMPETENCY_MAP in services/interview.js) ─────────────────────────────
const ROLE_DEFAULT_COMPETENCIES = {
  'Software Engineer':     ['System Design', 'Technical Depth', 'Code Quality', 'Debugging & Problem Solving', 'Collaboration'],
  'Engineering Manager':   ['People Leadership', 'System Design', 'Delivery Execution', 'Stakeholder Communication', 'Hiring & Coaching'],
  'Product Manager':       ['Product Strategy', 'Prioritisation & Trade-offs', 'Stakeholder Communication', 'Data-Driven Decisions', 'Customer Empathy'],
  'Management Consultant': ['Structured Problem Solving', 'Hypothesis-Led Thinking', 'Executive Communication', 'Quantitative Analysis', 'Client Management'],
  'AI Engineer':           ['ML System Design', 'Model Evaluation', 'Data Pipelines', 'Technical Depth', 'Responsible AI'],
  'Data Engineer':         ['Data Pipeline Architecture', 'Data Modeling', 'Scalability & Performance', 'Data Quality', 'Technical Depth'],
  'Executive Leadership':  ['Strategic Vision', 'Organisational Leadership', 'Executive Presence', 'Change Management', 'P&L Ownership'],
  default:                 ['Communication', 'Leadership', 'Strategic Thinking', 'Problem Solving', 'Ownership'],
};

// ── 2. Company-specific culture/scale traits per org preset ──────────────────
const ORG_TRAITS = {
  'faang':              ['Operating at Massive Scale', 'Data-Driven Rigor', 'Ownership & Bias for Action'],
  'fortune500':         ['Enterprise Stakeholder Management', 'Process & Governance', 'Cross-Functional Alignment'],
  'gcc':                ['Global Collaboration Across Time Zones', 'GCC Delivery Ownership', 'HQ Stakeholder Influence'],
  'startup':            ['Ambiguity Tolerance', 'Speed of Execution', 'Wearing Multiple Hats'],
  'consulting':         ['Client-Ready Communication', 'Structured Frameworks', 'Rapid Domain Ramp-Up'],
  default:              ['Cross-Functional Collaboration', 'Results Orientation'],
};

// ── 3. JD text → competency detection taxonomy ───────────────────────────────
// Each entry: canonical competency label + the regex that detects it in raw
// JD text. Word-boundary anchored, case-insensitive. Ordered scan; results
// are ranked by number of pattern hits (stronger JD signal ranks higher).
const JD_TAXONOMY = [
  { label: 'System Design',               re: /\b(system design|architecture|architect(ing|ure)?|distributed systems|microservices|scalab(le|ility))\b/gi },
  { label: 'Technical Depth',             re: /\b(hands[- ]on|coding|programming|algorithms?|data structures|debugging|node\.?js|python|java|golang|typescript)\b/gi },
  { label: 'People Leadership',           re: /\b(lead(ing)? (a )?team|people manage(ment|r)|direct reports|mentor(ing|ship)?|coach(ing)?|hire|hiring|grow(ing)? (the )?team)\b/gi },
  { label: 'Stakeholder Communication',   re: /\b(stakeholders?|executive (communication|presentation)s?|cross[- ]functional|alignment|influenc(e|ing))\b/gi },
  { label: 'Strategic Thinking',          re: /\b(strateg(y|ic)|roadmaps?|vision|long[- ]term|prioriti[sz]ation|okrs?)\b/gi },
  { label: 'Delivery Execution',          re: /\b(deliver(y|ing)?|execution|ship(ping)?|deadlines?|agile|scrum|sprints?|program manage(ment|r))\b/gi },
  { label: 'Data-Driven Decisions',       re: /\b(data[- ]driven|metrics|kpis?|analytics|a\/b test(ing)?|experiments?)\b/gi },
  { label: 'Cloud & Infrastructure',      re: /\b(aws|azure|gcp|cloud|kubernetes|docker|devops|ci\/cd|terraform)\b/gi },
  { label: 'Machine Learning',            re: /\b(machine learning|deep learning|llms?|ai models?|nlp|mlops|model training)\b/gi },
  { label: 'Product Sense',               re: /\b(product (sense|thinking|management)|user (experience|research)|customer (needs|empathy|obsession))\b/gi },
  { label: 'Budget & P&L Ownership',      re: /\b(p&l|budget(s|ing)?|cost (optimi[sz]ation|control)|revenue)\b/gi },
  { label: 'Security & Compliance',       re: /\b(security|compliance|gdpr|soc ?2|iso ?27001|privacy)\b/gi },
  { label: 'Change Management',           re: /\b(change management|transformation|reorgani[sz]ation|restructur(e|ing))\b/gi },
  { label: 'Vendor & Partner Management', re: /\b(vendors?|partners?(hips?)?|outsourc(e|ing)|third[- ]party)\b/gi },
];

const MAX_JD_TEXT_CHARS = 12000; // hard cap — protects the parser and the DB from megabyte pastes

/**
 * Parse raw Job Description text into an ordered array of competency labels.
 * Deterministic keyword extraction — no AI call. Ranked by hit count (desc),
 * ties broken by first appearance in the text.
 * @param {string} jdText
 * @returns {string[]} e.g. ['System Design', 'People Leadership', ...]
 */
function parseJdCompetencies(jdText) {
  if (!jdText || typeof jdText !== 'string') return [];
  const text = jdText.slice(0, MAX_JD_TEXT_CHARS);
  const hits = [];
  for (const { label, re } of JD_TAXONOMY) {
    re.lastIndex = 0; // /g/ regexes are stateful — always reset
    const matches = text.match(re);
    if (matches && matches.length) {
      re.lastIndex = 0;
      const first = re.exec(text);
      hits.push({ label, count: matches.length, firstIndex: first ? first.index : Infinity });
    }
  }
  hits.sort((a, b) => (b.count - a.count) || (a.firstIndex - b.firstIndex));
  return hits.map(h => h.label);
}

/**
 * Core merge: flatten [roleDefaults, companyTraits, jdCompetencies] in that
 * priority order, apply STRICT case-insensitive deduplication (first
 * occurrence wins and keeps its original casing), and slice exactly the top
 * `limit` items (default 8).
 *
 * @param {string[]} roleDefaults    competencies from the selected role card
 * @param {string[]} companyTraits   culture/scale traits for the target company
 * @param {string[]} jdCompetencies  competencies parsed from raw JD text
 * @param {{limit?: number}} [opts]
 * @returns {string[]} exactly ≤ 8 unique competency labels
 */
function buildCompetencyMatrix(roleDefaults, companyTraits, jdCompetencies, opts) {
  const limit = (opts && Number.isInteger(opts.limit) && opts.limit > 0) ? opts.limit : 8;
  const flat = []
    .concat(Array.isArray(roleDefaults) ? roleDefaults : [])
    .concat(Array.isArray(companyTraits) ? companyTraits : [])
    .concat(Array.isArray(jdCompetencies) ? jdCompetencies : []);

  const seen = new Set();
  const merged = [];
  for (const raw of flat) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim().replace(/\s+/g, ' ');
    if (!label) continue;
    const key = label.toLowerCase();       // strict case-insensitive dedupe
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(label);                    // first occurrence keeps its casing
    if (merged.length === limit) break;    // slice exactly the top N
  }
  return merged;
}

/** Role-card label → its default competency array (safe fallback). */
function getRoleDefaults(roleTitle) {
  return ROLE_DEFAULT_COMPETENCIES[roleTitle] || ROLE_DEFAULT_COMPETENCIES.default;
}

/** Org preset key/label → its culture/scale trait array (safe fallback). */
function getOrgTraits(orgPreset) {
  if (!orgPreset) return ORG_TRAITS.default;
  const key = String(orgPreset).toLowerCase().trim();
  if (ORG_TRAITS[key]) return ORG_TRAITS[key];
  // Loose matching so labels like "Fortune 500 Enterprise" or "GCC / India
  // Capability Center" still map to the right trait set.
  if (/faang|big ?tech|amazon|google|meta|apple|microsoft/.test(key)) return ORG_TRAITS.faang;
  if (/fortune|enterprise/.test(key))  return ORG_TRAITS.fortune500;
  if (/gcc|capability cent/.test(key)) return ORG_TRAITS.gcc;
  if (/start ?up|scale ?up/.test(key)) return ORG_TRAITS.startup;
  if (/consult/.test(key))             return ORG_TRAITS.consulting;
  return ORG_TRAITS.default;
}

module.exports = {
  buildCompetencyMatrix,
  parseJdCompetencies,
  getRoleDefaults,
  getOrgTraits,
  ROLE_DEFAULT_COMPETENCIES,
  ORG_TRAITS,
  MAX_JD_TEXT_CHARS,
};
