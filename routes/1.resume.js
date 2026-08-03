// ═══════════════════════════════════════════════════════════════════════════
// routes/resume.js — Resume Intelligence API
//
// A single parsing pipeline for BOTH input paths (file upload OR pasted
// text): whatever the input, we resolve it down to plain text, then hand it
// to services/resume-parser.js exactly once. Parsing happens ONLY here, on
// upload/replace — no other route in the app ever calls parseResume().
// ═══════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getCareerProfile, saveResumeIntelligence } = require('../db/career-profile');
const { parseResume } = require('../services/resume-parser');
// requireAuth now lives in middleware/guards.js — see routes/dashboard.js
// for the same swap; identical duplicated implementation removed here.
const { requireAuth } = require('../middleware/guards');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — resumes are small text documents
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF or DOCX files are supported'), ok);
  },
});

/** Resolve any supported input (uploaded file buffer OR pasted text) down to plain text. */
async function extractTextFromInput({ file, pastedText }) {
  if (pastedText && typeof pastedText === 'string' && pastedText.trim()) {
    return pastedText.trim();
  }
  if (!file) return '';

  if (file.mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(file.buffer);
    return (parsed.text || '').trim();
  }
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return (result.value || '').trim();
  }
  return '';
}

// ── GET /api/resume/status — read-only. Interview Setup calls this; it
// NEVER triggers parsing, it only reports what's already on file. ─────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const profile = await getCareerProfile(req.user.id);
    const hasResume = !!(profile && profile.resume_parsed_at);
    return res.json({
      hasResume,
      parsedAt: hasResume ? profile.resume_parsed_at : null,
      competencyCount: hasResume && Array.isArray(profile.resume_competencies) ? profile.resume_competencies.length : 0,
      storyCount: hasResume && Array.isArray(profile.story_library) ? profile.story_library.length : 0,
      parseStatus: profile ? profile.resume_parse_status : null,
      lastParseAttemptAt: profile ? profile.resume_last_parse_attempt_at : null,
    });
  } catch (err) {
    console.error('[resume/status]', err);
    return res.status(500).json({ error: 'Failed to load resume status' });
  }
});

// ── POST /api/resume/upload — the ONLY place parsing ever happens ─────────
router.post('/upload', requireAuth, upload.single('resumeFile'), async (req, res) => {
  try {
    const pastedText = req.body && req.body.resumeText;
    const text = await extractTextFromInput({ file: req.file, pastedText });
    console.log(`[resume/upload] stage=text_extraction userId=${req.user.id} textLength=${(text || '').length}`);

    if (!text || text.trim().length < 40) {
      console.warn(`[resume/upload] stage=text_extraction status=PARSE_FAILED userId=${req.user.id} — could not extract enough text from the input`);
      return res.status(400).json({ error: 'Could not read enough text from that resume. Try pasting the text instead.' });
    }

    const parsed = await parseResume(text);
    const isGenuineSuccess = parsed.parse_status === 'SUCCESS' &&
      ((parsed.resume_competencies && parsed.resume_competencies.length) || (parsed.career_story_library && parsed.career_story_library.length));

    const saved = await saveResumeIntelligence(req.user.id, {
      rawText: text,
      resumeCompetencies: parsed.resume_competencies,
      resumeContext: parsed.resume_context,
      storyLibrary: parsed.career_story_library,
      parseStatus: parsed.parse_status,
    });

    console.log(`[resume/upload] stage=complete userId=${req.user.id} parseStatus=${parsed.parse_status} isGenuineSuccess=${isGenuineSuccess}`);

    if (!isGenuineSuccess) {
      // Parsing technically failed, OR came back completely empty — the
      // save layer already protected any prior good data (see
      // saveResumeIntelligence), so we tell the candidate honestly what
      // happened rather than claiming success with 0 competencies.
      const hadPriorContent = Array.isArray(saved.resume_competencies) && saved.resume_competencies.length > 0;
      return res.status(hadPriorContent ? 200 : 422).json({
        success: false,
        parseStatus: parsed.parse_status,
        hasResume: hadPriorContent,
        preservedPreviousResume: hadPriorContent,
        parsedAt: saved.resume_parsed_at,
        competencyCount: Array.isArray(saved.resume_competencies) ? saved.resume_competencies.length : 0,
        storyCount: Array.isArray(saved.story_library) ? saved.story_library.length : 0,
        error: hadPriorContent
          ? 'This re-parse did not complete successfully — your previous resume data is still in use and was not changed. Try uploading again.'
          : 'We could not extract usable information from that resume. Try pasting the text directly instead of uploading the file.',
      });
    }

    return res.json({
      success: true,
      parseStatus: parsed.parse_status,
      hasResume: true,
      parsedAt: saved.resume_parsed_at,
      competencyCount: parsed.resume_competencies.length,
      storyCount: (parsed.career_story_library || []).length,
      source: parsed.source,
    });
  } catch (err) {
    console.error('[resume/upload] stage=unhandled_exception', err);
    return res.status(500).json({ error: err.message || 'Failed to process resume' });
  }
});

module.exports = router;
