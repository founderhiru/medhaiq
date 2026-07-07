// ═══════════════════════════════════════════════════════════════════════════
// services/harmonicAlignmentEngine.js
// MedhaIQ Harmonic Alignment Engine™ (v2.0)
//
// Upgrades the v1 flat competency merge (services/competency-matrix.js) to a
// weighted, AI-assisted alignment pipeline:
//
//   1. AI Competency Extraction — the raw JD is parsed by the LLM into 4–8
//      concise competency names via a strict JSON-schema prompt, with a
//      deterministic keyword-taxonomy fallback so session creation NEVER
//      fails or blocks on an AI hiccup.
//   2. Weighted compile — JD (1.00) > Company (0.80) > Role (0.60), with
//      compound score accumulation, case-insensitive dedupe, deterministic
//      tie-breaking, a hard top-8 ceiling, and a min-5 baseline backfill.
//
// The output remains a plain array of display strings — the exact shape the
// existing `competency_matrix` JSONB column, prompt builder, and dashboard
// already consume. Nothing downstream needs to change.
// ═══════════════════════════════════════════════════════════════════════════

const { chatJSON } = require('../lib/polsia-ai');
const { parseJdCompetencies, MAX_JD_TEXT_CHARS } = require('./competency-matrix');

// ── Immutable weight configuration matrix ───────────────────────────────────
const ALIGNMENT_WEIGHTS = Object.freeze({
  JD_EXTRACTED:    1.00, // 📄 Job Description (AI extracted) — strongest signal
  COMPANY_CONTEXT: 0.80, // 🏢 Company culture/scale vector
  ROLE_BASELINE:   0.60, // 🎯 Role competency mapper
});

const MATRIX_CEILING = 8; // hard slice — never more than 8 entries
const MATRIX_FLOOR   = 5; // safe evaluation baseline — backfill up to 5

// ── 1. AI Competency Extraction Layer ───────────────────────────────────────
/**
 * Extract 4–8 concise competency names from raw JD text via the LLM.
 * Hardened for production:
 *   - empty/short JD → [] immediately (no AI call, no cost)
 *   - output validated: must be an array of 4–8 non-empty strings
 *   - ANY failure (network, JSON, schema) → deterministic keyword fallback
 * @param {string} jobDescriptionText
 * @returns {Promise<{competencies: string[], source: 'ai'|'heuristic'|'none'}>}
 */
async function aiExtractJdCompetencies(jobDescriptionText) {
  if (!jobDescriptionText || typeof jobDescriptionText !== 'string' || jobDescriptionText.trim().length < 40) {
    return { competencies: [], source: 'none' };
  }
  const jd = jobDescriptionText.slice(0, MAX_JD_TEXT_CHARS);

  const system = `You are the MedhaIQ competency extraction engine. You read a job description and return ONLY a JSON object matching this exact schema:
{"competencies": ["Competency Name", ...]}

Rules:
- Between 4 and 8 entries. Never fewer than 4, never more than 8.
- Each entry is a concise competency name of 1–4 words in Title Case
  (e.g. "Distributed Systems", "Cross-Functional Collaboration").
- Extract only competencies EXPLICITLY demanded by the text — technical or
  soft skills. No invented items, no company names, no job titles.
- No duplicates, no markdown, no prose, no keys other than "competencies".`;

  try {
    const parsed = await chatJSON(
      `Extract the competencies from this job description:\n\n"""\n${jd}\n"""`,
      { system, maxTokens: 400 }
    );
    const list = Array.isArray(parsed && parsed.competencies) ? parsed.competencies : null;
    if (list) {
      const clean = list
        .filter((c) => typeof c === 'string')
        .map((c) => c.trim().replace(/\s+/g, ' '))
        .filter((c) => c.length >= 2 && c.length <= 60)
        .slice(0, 8);
      if (clean.length >= 4) return { competencies: clean, source: 'ai' };
      // Fewer than 4 valid items → treat as extraction failure, fall through.
    }
    throw new Error('AI extraction returned an invalid or sparse schema');
  } catch (err) {
    console.warn('[harmonic] AI JD extraction fell back to heuristic parser:', err.message);
    const heuristic = parseJdCompetencies(jd).slice(0, 8);
    return { competencies: heuristic, source: heuristic.length ? 'heuristic' : 'none' };
  }
}

// ── 2. Core alignment algorithm ──────────────────────────────────────────────
/** Normalize a raw label to its case-insensitive tracking key. */
function trackingKey(raw) {
  return String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * compileWeightedCompetencyMatrix — the definitive v2 merge.
 *
 * @param {string[]} roleDefaults  🎯 role card baseline           (weight 0.60)
 * @param {string[]} companyTraits 🏢 company culture/scale vector (weight 0.80)
 * @param {string[]} jdExtracted   📄 AI-extracted JD competencies (weight 1.00)
 * @returns {{ matrix: string[], detailed: Array<{name:string,score:number,sources:string[]}> }}
 *
 * Guarantees:
 *  - whitespace-stripped, null-safe inputs
 *  - "System Design" / "system design " / "SYSTEM DESIGN" share one key
 *  - compound scores when a metric appears in multiple vectors
 *  - display casing taken from the highest-weight source that mentioned it
 *  - deterministic ordering: score desc, then alphabetical
 *  - exactly ≤ 8 entries; backfilled from roleDefaults to a floor of 5
 */
function compileWeightedCompetencyMatrix(roleDefaults, companyTraits, jdExtracted) {
  const channels = [
    { items: jdExtracted,   weight: ALIGNMENT_WEIGHTS.JD_EXTRACTED,    source: 'jd' },
    { items: companyTraits, weight: ALIGNMENT_WEIGHTS.COMPANY_CONTEXT, source: 'company' },
    { items: roleDefaults,  weight: ALIGNMENT_WEIGHTS.ROLE_BASELINE,   source: 'role' },
  ];

  const tracking = new Map(); // key → { display, score, topWeight, sources:Set }

  for (const { items, weight, source } of channels) {
    if (!Array.isArray(items)) continue;
    // Dedupe WITHIN a channel first: the same channel mentioning a metric
    // twice must not double-charge that channel's weight.
    const seenInChannel = new Set();
    for (const raw of items) {
      if (typeof raw !== 'string') continue;
      const display = raw.trim().replace(/\s+/g, ' ');
      if (!display) continue;
      const key = trackingKey(display);
      if (seenInChannel.has(key)) continue;
      seenInChannel.add(key);

      const entry = tracking.get(key);
      if (entry) {
        entry.score += weight; // compound accumulation across vectors
        entry.sources.add(source);
        if (weight > entry.topWeight) { // casing from the highest-weight source
          entry.topWeight = weight;
          entry.display = display;
        }
      } else {
        tracking.set(key, { display, score: weight, topWeight: weight, sources: new Set([source]) });
      }
    }
  }

  // Ranked sort resolution: score desc → alphabetical asc (determinism).
  const ranked = Array.from(tracking.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.display.toLowerCase().localeCompare(b.display.toLowerCase());
  });

  // Architectural ceiling: exactly the top 8.
  const top = ranked.slice(0, MATRIX_CEILING);

  // Guardrail floor: backfill unique roleDefaults up to 5 entries.
  if (top.length < MATRIX_FLOOR && Array.isArray(roleDefaults)) {
    const have = new Set(top.map((e) => trackingKey(e.display)));
    for (const raw of roleDefaults) {
      if (top.length >= MATRIX_FLOOR) break;
      if (typeof raw !== 'string') continue;
      const display = raw.trim().replace(/\s+/g, ' ');
      const key = trackingKey(display);
      if (!display || have.has(key)) continue;
      have.add(key);
      top.push({ display, score: ALIGNMENT_WEIGHTS.ROLE_BASELINE, topWeight: ALIGNMENT_WEIGHTS.ROLE_BASELINE, sources: new Set(['role-backfill']) });
    }
  }

  return {
    matrix: top.map((e) => e.display),
    detailed: top.map((e) => ({
      name: e.display,
      score: Math.round(e.score * 100) / 100,
      sources: Array.from(e.sources),
    })),
  };
}

module.exports = {
  ALIGNMENT_WEIGHTS,
  MATRIX_CEILING,
  MATRIX_FLOOR,
  aiExtractJdCompetencies,
  compileWeightedCompetencyMatrix,
};
