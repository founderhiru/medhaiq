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
const { getUserById } = require('../db/auth');
const { getCareerProfile, saveResumeIntelligence } = require('../db/career-profile');
const { parseResume } = require('../services/resume-parser');

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

async function requireAuth(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const user = await getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
}

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

    if (!text || text.trim().length < 40) {
      return res.status(400).json({ error: 'Could not read enough text from that resume. Try pasting the text instead.' });
    }

    const parsed = await parseResume(text);

    const saved = await saveResumeIntelligence(req.user.id, {
      rawText: text,
      resumeCompetencies: parsed.resume_competencies,
      resumeContext: parsed.resume_context,
      storyLibrary: parsed.career_story_library,
    });

    return res.json({
      success: true,
      hasResume: true,
      parsedAt: saved.resume_parsed_at,
      competencyCount: parsed.resume_competencies.length,
      storyCount: (parsed.career_story_library || []).length,
      source: parsed.source,
    });
  } catch (err) {
    console.error('[resume/upload]', err);
    return res.status(500).json({ error: err.message || 'Failed to process resume' });
  }
});

module.exports = router;
