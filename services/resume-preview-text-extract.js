// ═══════════════════════════════════════════════════════════════════════════
// services/resume-preview-text-extract.js — MedhaIQ Career Intelligence Preview
//
// Plain-text extraction ONLY — zero AI calls. Deliberately a standalone file,
// NOT a shared import from routes/resume.js (which has its own near-identical
// extractTextFromInput() helper). That file is the production Resume
// Intelligence upload path feeding the Harmonic Alignment Engine; this
// feature intentionally never imports from or writes to anything on that
// path, so an anonymous, unauthenticated route can never affect it. The ~15
// lines of overlap are an acceptable, deliberate duplication for isolation.
//
// If it's ever preferred to de-duplicate, the safe move is extracting BOTH
// call sites' logic into a shared, auth-agnostic util — not importing one
// route's helper into the other.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_RESUME_TEXT_CHARS = 20000; // matches the pasted-text cap used elsewhere in the app

/**
 * Resolve an uploaded file buffer (PDF or DOCX) OR pasted text down to plain
 * text. No AI involved — pdf-parse and mammoth are both pure text-extraction
 * libraries already used elsewhere in this repo.
 * @param {{ file?: {mimetype: string, buffer: Buffer}, pastedText?: string }} input
 * @returns {Promise<{ text: string, source: 'pasted'|'pdf'|'docx'|'none' }>}
 */
async function extractResumeText({ file, pastedText }) {
  if (pastedText && typeof pastedText === 'string' && pastedText.trim()) {
    return { text: pastedText.trim().slice(0, MAX_RESUME_TEXT_CHARS), source: 'pasted' };
  }
  if (!file) return { text: '', source: 'none' };

  try {
    if (file.mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(file.buffer);
      return { text: (parsed.text || '').trim().slice(0, MAX_RESUME_TEXT_CHARS), source: 'pdf' };
    }
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return { text: (result.value || '').trim().slice(0, MAX_RESUME_TEXT_CHARS), source: 'docx' };
    }
  } catch (err) {
    // Corrupt/unreadable file — never throw into the route; let the caller
    // treat this the same as "no usable text" and hit the thin-extraction
    // gate downstream, rather than a 500 error for an anonymous visitor.
    console.warn('[resume-preview-text-extract] extraction failed:', err.message);
    return { text: '', source: 'none' };
  }

  return { text: '', source: 'none' };
}

module.exports = { extractResumeText, MAX_RESUME_TEXT_CHARS };
