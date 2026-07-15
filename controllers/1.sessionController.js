// ═══════════════════════════════════════════════════════════════════════════
// controllers/sessionController.js
// Session initialization & Turn orchestration controller — MedhaIQ Engine v2.1
// ═══════════════════════════════════════════════════════════════════════════

const { generateNextQuestion, PERSONAS } = require('../services/interview');
const { createSession, addQuestion, getSessionById, saveConversationTurn } = require('../db/interview'); // Ensure your DB helpers match
const { getRoleDefaults, getOrgTraits, MAX_JD_TEXT_CHARS } = require('../services/competency-matrix');
const {
  aiExtractJdCompetencies,
  compileWeightedCompetencyMatrix,
} = require('../services/harmonicAlignmentEngine');
// Resume Intelligence: READ-ONLY here. This controller never parses a resume —
// it only reads whatever is already on file (see routes/resume.js, the sole
// place parsing happens). Absent/undefined is the normal, fully-supported
// case for a candidate with no resume on file.
const { getCareerProfile } = require('../db/career-profile');

/**
 * POST /api/interview/sessions  (alias: POST /api/interview/session/initialize)
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

    // ── 2b. Resume Intelligence — READ existing career_profiles row only.
    // Parsing already happened (or didn't) at upload time via routes/resume.js.
    // Absent resume is the normal case and produces empty channels below —
    // zero behavior change for any candidate who hasn't uploaded one.
    const careerProfile = await getCareerProfile(req.user.id).catch((e) => {
      console.warn('[resume] getCareerProfile failed (non-fatal, treated as no resume):', e.message);
      return null;
    });
    const resumeCompetencies = (careerProfile && Array.isArray(careerProfile.resume_competencies))
      ? careerProfile.resume_competencies
      : [];
    const resumeContext = (careerProfile && careerProfile.resume_context) ? careerProfile.resume_context : null;

    // ── 3. AI competency extraction (deterministic fallback inside) ─────────
    const extraction = await aiExtractJdCompetencies(jdText);
    console.log(`[harmonic] JD extraction source=${extraction.source} count=${extraction.competencies.length}`);

    // ── 4. Weighted merge → finalized matrix (≤8 strings, floor 5) ────────
    // 4th arg (resumeCompetencies) is additive and optional — existing
    // 3-arg behavior is unchanged when it's an empty array.
    const { matrix: finalizedMatrix, detailed } =
      compileWeightedCompetencyMatrix(roleDefaults, companyTraits, extraction.competencies, resumeCompetencies);
    console.log('[harmonic] finalized matrix:', JSON.stringify(detailed));

    // ── 5. Persist session document state (Resume Intelligence snapshotted
    // here, same precedent as jd_text/competency_matrix — frozen at creation,
    // immune to a later resume replace) ──────────────────────────────────────
    const session = await createSession({
      userId: req.user.id,
      personaId,
      roleTitle,
      experienceLevel,
      orgPreset: orgPreset || null,
      jdText: jdText || null,
      competencyMatrix: finalizedMatrix,
      resumeCompetencies,
      resumeContext,
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
      resumeContext,
    });

    const question = await addQuestion({
      sessionId: session.id,
      questionText: openingResult.text,
      personaId,
      questionType: 'opening',
      questionOrder: 0,
      competency: openingResult.competency,
    });

    // ── 7. Response Shape ───────────────────────────────────────────────────
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
      text: question.question_text,
      audio_url: openingResult.audio_url || null,
      competency_tag: question.competency || openingResult.competency || null,
      questionId: 'Q' + question.question_order,
      uiText: question.question_text,
      audioPrompt: question.question_text,
    });
  } catch (err) {
    console.error('[sessionController.initializeSession]', err);
    return res.status(500).json({ error: 'Failed to start session. Please try again.' });
  }
}

/**
 * ── Line-by-Line Fix for Bug 2: Response Quality Validation Gateway ──
 * POST /api/interview/session/submit-answer
 * Validates candidate input metrics before allowing the progress bar to advance.
 */
async function submitUserAnswer(req, res) {
  try {
    const { sessionId, transcriptPayload, currentQuestionText } = req.body;

    if (!sessionId || typeof transcriptPayload !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid response structural payload.' });
    }

    const cleanInput = transcriptPayload.trim().replace(/\s+/g, ' ');
    const wordCount = cleanInput.split(' ').filter(Boolean).length;
    
    // Catch single words or short lazy confirmations (e.g., "yes", "no", "yep", "ok")
    const dynamicBlacklist = new Set(["yes", "no", "ok", "sure", "yep", "nope", "yeah", "yes.", "no."]);
    const isSparseInput = wordCount < 5 || dynamicBlacklist.has(cleanInput.toLowerCase());

    // ── SPARSE REJECTION LOOP GATEWAY ──
    if (isSparseInput) {
      console.log(`[guardrail] Sparse answer detected ("${cleanInput}"). Blocking progress bar advancement.`);
      
      // Keep them on the same question tracker, do not advance step index, generate a contextual nudge
      const retryFollowUpText = `I see. Could you expand on that with a specific example or walk me through your personal experience regarding that scenario?`;

      return res.json({
        success: true,
        advanceProgressBar: false, // UI catches this and keeps progress marker at 1/5
        uiText: retryFollowUpText,  // Update UI text cleanly
        audioPrompt: retryFollowUpText, // Direct AI to speak this text word-for-word
        telemetryLog: "Sparse input intercepted. Repeating loop validation track."
      });
    }

    // ── STANDARD PROGRESS TRACK (Valid response length met) ──
    // This allows your regular generation engine logic to execute forward smoothly
    return res.json({
      success: true,
      advanceProgressBar: true, // Tells UI it is safe to transition to 2/5 now
      uiText: "Great fallback tracking prompt. Loading next matrix block...",
      advanceStep: true
    });

  } catch (err) {
    console.error('[sessionController.submitUserAnswer]', err);
    return res.status(500).json({ success: false, error: 'Internal orchestration processing exception.' });
  }
}

module.exports = { 
  initializeSession,
  submitUserAnswer // Exported safely to be mapped to your router endpoint
};