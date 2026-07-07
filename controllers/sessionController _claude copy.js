// ═══════════════════════════════════════════════════════════════════════════
// controllers/sessionController.js
// Session initialization controller — MedhaIQ Harmonic Alignment Engine v2.0.
//
// Owns the full lifecycle of POST /api/interview/sessions (and its v2 alias
// POST /api/interview/session/initialize):
//
//   validate payload → fetch role baseline + company vector → AI-extract the
//   JD → compileWeightedCompetencyMatrix → persist session state → generate
//   the opening question → respond.
//
// CONTRACT GUARANTEE: the request fields and the JSON response shape are
// byte-compatible with what views/interview-setup.ejs already sends and what
// views/interview-session.ejs already consumes. v2 field aliases (roleId,
// experienceTier, interviewerPersonaId, targetCompany, rawJobDescriptionText)
// are accepted alongside the live field names — nothing breaks.
// ═══════════════════════════════════════════════════════════════════════════

const { generateNextQuestion, PERSONAS } = require('../services/interview');
const { createSession, addQuestion } = require('../db/interview');
const { getRoleDefaults, getOrgTraits, MAX_JD_TEXT_CHARS } = require('../services/competency-matrix');
const {
  aiExtractJdCompetencies,
  compileWeightedCompetencyMatrix,
} = require('../services/harmonicAlignmentEngine');

/**
 * POST /api/interview/sessions  (alias: POST /api/interview/session/initialize)
 * Requires the same requireAuth middleware as before (applied at the route).
 */
async function initializeSession(req, res) {
  try {
    // ── 1. Payload validation (live names first, v2 aliases second) ─────────
    const body = req.body || {};
    const personaId       = body.personaId       || body.interviewerPersonaId || null;
    const roleTitle       = body.roleTitle       || body.roleId               || null;
    const experienceLevel = body.experienceLevel || body.experienceTier       || 'mid';
    const orgPreset       = body.orgPreset       || body.targetCompany        || null;
    const jdRaw           = body.jdText          || body.rawJobDescriptionText || '';

    if (!personaId || !PERSONAS[personaId]) {
      return res.status(400).json({ error: 'Valid persona required' });
    }
    if (!roleTitle || typeof roleTitle !== 'string' || !roleTitle.trim()) {
      return res.status(400).json({ error: 'Role title required' });
    }
    if (jdRaw && typeof jdRaw !== 'string') {
      return res.status(400).json({ error: 'jdText must be a string' });
    }
    const jdText = (typeof jdRaw === 'string') ? jdRaw.slice(0, MAX_JD_TEXT_CHARS) : '';

    // ── 2. Channel inputs: role baseline + company culture vector ───────────
    const roleDefaults  = getRoleDefaults(roleTitle);
    const companyTraits = getOrgTraits(orgPreset);

    // ── 3. AI competency extraction (deterministic fallback inside) ─────────
    const extraction = await aiExtractJdCompetencies(jdText);
    console.log(`[harmonic] JD extraction source=${extraction.source} count=${extraction.competencies.length}`);

    // ── 4. Weighted compile → finalized matrix (≤8 strings, floor 5) ────────
    const { matrix: finalizedMatrix, detailed } =
      compileWeightedCompetencyMatrix(roleDefaults, companyTraits, extraction.competencies);
    console.log('[harmonic] finalized matrix:', JSON.stringify(detailed));

    // ── 5. Persist session document state ───────────────────────────────────
    const session = await createSession({
      userId: req.user.id,
      personaId,
      roleTitle,
      experienceLevel,
      orgPreset: orgPreset || null,
      jdText: jdText || null,
      competencyMatrix: finalizedMatrix,
    });

    // ── 6. Opening question via the enterprise prompt layer ─────────────────
    const openingResult = await generateNextQuestion({
      sessionId: session.id,
      personaId,
      roleTitle,
      experienceLevel,
      orgPreset: orgPreset || null,
      competencyMatrix: finalizedMatrix,
      jdText,
      qaPairs: [],
      questionCount: 0,
    });

    const question = await addQuestion({
      sessionId: session.id,
      questionText: openingResult.text,
      personaId,
      questionType: 'opening',
      questionOrder: 0,
      competency: openingResult.competency,
    });

    // ── 7. Response — byte-compatible with the live frontend ────────────────
    return res.json({
      success: true,
      sessionId: session.id,
      question: {
        id: question.id,
        text: question.question_text,
        type: question.question_type,
        order: question.question_order,
        competency: question.competency || openingResult.competency,
      },
      // Clean, flat fields the frontend can bind to directly — no digging
      // through nested question objects required.
      text: question.question_text,
      audio_url: openingResult.audio_url || null,
      competency_tag: question.competency || openingResult.competency || null,
      // v2.0 unified single-source-of-truth model (see routes/interview.js)
      questionId: 'Q' + question.question_order,
      uiText: question.question_text,
      audioPrompt: question.question_text,
    });
  } catch (err) {
    console.error('[sessionController.initializeSession]', err);
    return res.status(500).json({ error: 'Failed to start session. Please try again.' });
  }
}

module.exports = { initializeSession };
