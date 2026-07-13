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
  source: 'none',
});

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
  if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length < 40) {
    return { ...EMPTY_RESULT };
  }
  const text = resumeText.slice(0, MAX_RESUME_TEXT_CHARS);

  try {
    const parsed = await chatJSON(
      buildResumeIntelligenceUserMessage(text),
      { system: RESUME_INTELLIGENCE_SYSTEM_PROMPT, maxTokens: 1200 }
    );

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

    const careerLevel = (typeof ctxRaw.career_level === 'string' && CAREER_LEVELS.has(ctxRaw.career_level))
      ? ctxRaw.career_level
      : 'Unknown';

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
      top_achievements: asStringArray(ctxRaw.top_achievements, 8),
    };

    // Fewer than 8 valid competencies is sparse but still usable — only a
    // genuine error/throw below collapses the whole result to EMPTY_RESULT.
    return {
      resume_competencies: competencies,
      resume_context,
      source: 'ai',
    };
  } catch (err) {
    console.warn('[resume-parser] AI extraction failed, returning empty result:', err.message);
    return { ...EMPTY_RESULT };
  }
}

module.exports = {
  parseResume,
  MAX_RESUME_TEXT_CHARS,
  EMPTY_RESULT,
  CAREER_LEVELS,
};
