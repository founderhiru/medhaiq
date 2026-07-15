// ═══════════════════════════════════════════════════════════════════════════
// services/resume-parser.js — MedhaIQ Resume Intelligence (NEW FILE)
//
// A single lightweight AI extraction that produces exactly two logical
// outputs from one resume (raw pasted text OR text extracted from an
// uploaded PDF/DOCX upstream in routes/resume.js):
//
//   1. resume_competencies — WHAT to assess. Feeds into the existing
//      Harmonic Alignment Engine as one additional weighted channel
//      (services/harmonicAlignmentEngine.js). Never anything else.
//
//   2. resume_context — HOW to personalize questions. A small object of
//      professional-summary-level facts (career level, industries,
//      companies, customers, products, leadership scope, achievements).
//      Passed only into the interview prompt as a trailing, display-only
//      context layer. NEVER participates in competency weighting or scoring.
//
// The actual prompt text lives in services/prompts/resume-intelligence.prompt.js —
// this file only calls it and validates/sanitizes the response. This is
// intentionally the ONLY new engine-shaped file in Resume Intelligence: one
// AI call, a strict JSON schema, and a deterministic fallback so a resume
// upload can never fail the request or block the caller.
// ═══════════════════════════════════════════════════════════════════════════

const { chatJSON } = require('../lib/polsia-ai');
const {
  RESUME_INTELLIGENCE_SYSTEM_PROMPT,
  buildResumeIntelligenceUserMessage,
} = require('./prompts/resume-intelligence.prompt');

const MAX_RESUME_TEXT_CHARS = 12000; // same cap discipline as MAX_JD_TEXT_CHARS

const CAREER_LEVELS = new Set([
  'IC', 'Senior IC', 'Lead', 'Manager', 'Senior Manager',
  'Director', 'Senior Director', 'VP', 'Executive', 'Unknown',
]);

const EMPTY_RESULT = Object.freeze({
  resume_competencies: [],
  resume_context: Object.freeze({
    summary: null,
    career_level: 'Unknown',
    industries: [],
    companies: [],
    customers: [],
    products: [],
    leadership_scope: 'Not explicitly stated',
    top_achievements: [],
  }),
  career_story_library: Object.freeze([]),
  source: 'none',
});

// Explicit parse outcome — every parse attempt returns exactly one of
// these, never silently collapsing to "0 competencies" with no signal of
// WHY. SUCCESS means the AI call completed and its JSON parsed correctly —
// it says nothing about how RICH the result is; a technically-successful
// parse that finds little is still SUCCESS. The save-layer (career-profile.js)
// is what decides whether a low-content SUCCESS should overwrite existing
// good data (see migration 011 / saveResumeIntelligence).
const PARSE_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',                     // AI call + JSON parse both completed
  PARSE_FAILED: 'PARSE_FAILED',           // input text missing/too short — never reached the AI call
  MODEL_TRUNCATED: 'MODEL_TRUNCATED',     // response was cut off before valid JSON completed
  INVALID_JSON: 'INVALID_JSON',           // response came back but wasn't valid JSON
  EXTRACTION_FAILED: 'EXTRACTION_FAILED', // any other failure (network, auth, rate limit, timeout, etc.)
});

/**
 * Best-effort classification of a chatJSON failure into one of the four
 * failure statuses, using only the error message text — this file doesn't
 * have access to the raw API response's stop_reason without changing the
 * shared ai/providers/anthropic.js chatJSON implementation used by many
 * other callers, so this is a heuristic based on how JSON.parse typically
 * fails on truncated vs. malformed input. Not perfect, but far better than
 * collapsing every failure into one undifferentiated bucket.
 */
function classifyParseError(err) {
  const msg = String((err && err.message) || '').toLowerCase();
  if (/unexpected end of json input|unterminated/.test(msg)) return PARSE_STATUS.MODEL_TRUNCATED;
  if (/json|unexpected token|position \d+/.test(msg)) return PARSE_STATUS.INVALID_JSON;
  return PARSE_STATUS.EXTRACTION_FAILED;
}

/** Turn arbitrary model output into a safe, stable story_key: uppercase,
 * alphanumeric + underscores only, capped length. Never throws. */
function sanitizeStoryKey(raw) {
  const s = String(raw || '').toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s.slice(0, 40) || null;
}

/**
 * Parse raw resume text into { resume_competencies, resume_context }.
 * Hardened for production:
 *   - empty/too-short text → EMPTY_RESULT immediately, no AI call, no cost
 *   - output validated against a strict shape
 *   - ANY failure (network, JSON, schema) → EMPTY_RESULT, never throws
 *
 * @param {string} resumeText
 * @returns {Promise<{resume_competencies: string[], resume_context: object, source: 'ai'|'none'}>}
 */
async function parseResume(resumeText) {
  const textLength = (typeof resumeText === 'string') ? resumeText.trim().length : 0;
  console.log(`[resume-parser] stage=text_extraction textLength=${textLength}`);

  if (!resumeText || typeof resumeText !== 'string' || textLength < 40) {
    console.warn(`[resume-parser] stage=text_extraction status=${PARSE_STATUS.PARSE_FAILED} reason=input_missing_or_too_short textLength=${textLength}`);
    return { ...EMPTY_RESULT, parse_status: PARSE_STATUS.PARSE_FAILED };
  }
  const text = resumeText.slice(0, MAX_RESUME_TEXT_CHARS);

  console.log(`[resume-parser] stage=ai_request sending, textLength=${text.length}`);

  let parsed;
  try {
    parsed = await chatJSON(
      buildResumeIntelligenceUserMessage(text),
      { system: RESUME_INTELLIGENCE_SYSTEM_PROMPT, maxTokens: 4000 }
    );
    console.log(`[resume-parser] stage=ai_response status=SUCCESS responseLength=${JSON.stringify(parsed).length}`);
  } catch (err) {
    const status = classifyParseError(err);
    console.error(`[resume-parser] stage=ai_response status=${status} error="${err.message}"`);
    return { ...EMPTY_RESULT, parse_status: status };
  }

  try {
    const competencies = Array.isArray(parsed && parsed.resume_competencies)
      ? parsed.resume_competencies
          .filter((c) => typeof c === 'string')
          .map((c) => c.trim().replace(/\s+/g, ' '))
          .filter((c) => c.length >= 2 && c.length <= 60)
          .slice(0, 20) // schema ceiling — 8 to 20, ranked highest-significance first
      : [];

    const ctxRaw = (parsed && typeof parsed.resume_context === 'object' && parsed.resume_context) || {};
    const asStringArray = (v, max) => Array.isArray(v)
      ? v.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean).slice(0, max)
      : [];

    // Fixed taxonomy for story hooks — an object with a type outside this
    // set, or with no usable detail, is dropped individually rather than
    // invalidating the whole story (hooks are an enhancement, not required).
    const HOOK_TYPES = new Set([
      'Biggest decision', 'Biggest trade-off', 'Biggest risk',
      'Biggest stakeholder challenge', 'Most surprising outcome',
      'Leadership tension', 'Business impact',
    ]);
    const asHookArray = (v, max) => Array.isArray(v)
      ? v
          .map((h) => {
            if (!h || typeof h !== 'object') return null;
            const type = (typeof h.type === 'string') ? h.type.trim() : '';
            const detail = (typeof h.detail === 'string') ? h.detail.trim().slice(0, 120) : '';
            if (!HOOK_TYPES.has(type) || !detail) return null;
            return { type, detail };
          })
          .filter(Boolean)
          .slice(0, max)
      : [];

    const careerLevel = (typeof ctxRaw.career_level === 'string' && CAREER_LEVELS.has(ctxRaw.career_level))
      ? ctxRaw.career_level
      : 'Unknown';

    const top_achievements = asStringArray(ctxRaw.top_achievements, 8);

    // Career Story Library — stable story_key per story, not free-text.
    // Any single malformed story entry is dropped silently; it never
    // collapses the whole parse to EMPTY_RESULT.
    const seenKeys = new Set();
    const rawStories = Array.isArray(parsed && parsed.career_story_library) ? parsed.career_story_library : [];
    const career_story_library = rawStories
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        let story_key = sanitizeStoryKey(s.story_key);
        const company = (typeof s.company === 'string' && s.company.trim()) ? s.company.trim().slice(0, 100) : null;
        const summary = (typeof s.summary === 'string' && s.summary.trim()) ? s.summary.trim().slice(0, 300) : null;
        const competency_hints = asStringArray(s.competency_hints, 4).map((h) => h.slice(0, 40));
        const business_context = asStringArray(s.business_context, 3).map((h) => h.slice(0, 40));
        const jd_alignment_tags = asStringArray(s.jd_alignment_tags, 4).map((h) => h.slice(0, 40));
        const hooks = asHookArray(s.hooks, 3);
        // Strict validation: company, summary, AND at least one competency_hint
        // are all required. A story missing any of the three is dropped
        // entirely — never kept as a partial/degraded story. business_context,
        // jd_alignment_tags, and hooks are NOT required (they default to []
        // and the story is still usable without them, just with less
        // matching signal / a less specific conversational angle).
        if (!story_key || !summary || !company || !competency_hints.length) return null;
        // De-dupe collisions (two stories the model gave the same key) by
        // appending a numeric suffix rather than silently dropping one —
        // keeps every genuine story available to the interview engine.
        if (seenKeys.has(story_key)) {
          let n = 2;
          while (seenKeys.has(`${story_key}_${n}`)) n++;
          story_key = `${story_key}_${n}`;
        }
        seenKeys.add(story_key);
        return { story_key, company, summary, competency_hints, business_context, jd_alignment_tags, hooks };
      })
      .filter(Boolean)
      .slice(0, 10); // schema ceiling — 4 to 10 distinct stories

    const resume_context = {
      summary: (typeof ctxRaw.summary === 'string' && ctxRaw.summary.trim()) ? ctxRaw.summary.trim().slice(0, 500) : null,
      career_level: careerLevel,
      industries: asStringArray(ctxRaw.industries, 12),
      companies: asStringArray(ctxRaw.companies, 12),
      customers: asStringArray(ctxRaw.customers, 12),
      products: asStringArray(ctxRaw.products, 12),
      leadership_scope: (typeof ctxRaw.leadership_scope === 'string' && ctxRaw.leadership_scope.trim())
        ? ctxRaw.leadership_scope.trim().slice(0, 300)
        : 'Not explicitly stated',
      top_achievements,
    };

    const totalHooks = career_story_library.reduce((sum, s) => sum + (s.hooks ? s.hooks.length : 0), 0);
    console.log(`[resume-parser] Resume extracted: competencies=${competencies.length} stories=${career_story_library.length} companies=${resume_context.companies.length} hooks=${totalHooks}`);

    // Fewer than 8 valid competencies is sparse but still usable — SUCCESS
    // is about the AI call/JSON parse succeeding technically, not about
    // content richness. The save layer decides what to do with a thin result.
    return {
      resume_competencies: competencies,
      resume_context,
      career_story_library,
      source: 'ai',
      parse_status: PARSE_STATUS.SUCCESS,
    };
  } catch (err) {
    // A well-formed JSON response that fails OUR OWN validation/sanitization
    // logic (e.g. unexpected shape) — still a real failure, just caught at
    // a different point than the chatJSON call itself. Classified as
    // INVALID_JSON since the root cause is "the response didn't match the
    // shape we validate against."
    console.error(`[resume-parser] stage=validation status=${PARSE_STATUS.INVALID_JSON} error="${err.message}"`);
    return { ...EMPTY_RESULT, parse_status: PARSE_STATUS.INVALID_JSON };
  }
}

module.exports = {
  parseResume,
  MAX_RESUME_TEXT_CHARS,
  EMPTY_RESULT,
  CAREER_LEVELS,
  sanitizeStoryKey,
  PARSE_STATUS,
};
