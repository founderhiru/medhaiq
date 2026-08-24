// ═══════════════════════════════════════════════════════════════════════════
// routes/public-preview.js — MedhaIQ Career Intelligence Preview
//
// Anonymous, unauthenticated, stateless. No DB writes, no session, no
// user_id. Mirrors the multer config already used in routes/resume.js for
// consistency, but this route is otherwise fully independent of it.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { generatePreview } = require('../services/resume-preview');
const CFG = require('../config/resume-preview-config');

const upload = multer({
  storage: multer.memoryStorage(), // never touches disk — nothing to delete after the request
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, matches routes/resume.js
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF or DOCX files are supported'), ok);
  },
});

// NOTE: rate limiting / abuse protection intentionally NOT included here —
// flagged earlier as a separate to-do, since this route has zero AI cost
// per request but file-upload + regex processing still isn't free to spam.
router.post('/', upload.single('resumeFile'), async (req, res) => {
  try {
    const pastedText = req.body.resumeText;

    if (!req.file && !pastedText) {
      return res.status(400).json({ preview_version: CFG.PREVIEW_VERSION, status: 'error', message: 'Upload a resume file or paste resume text.' });
    }

    const result = await generatePreview({ file: req.file, pastedText });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[public-preview] unexpected error:', err.message);
    return res.status(500).json({ preview_version: CFG.PREVIEW_VERSION, status: 'error', message: 'Something went wrong generating your preview. Please try again.' });
  }
});

module.exports = router;
