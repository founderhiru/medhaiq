// ═══════════════════════════════════════════════════════════════════════════
// services/resume-preview.js — MedhaIQ Career Intelligence Preview
// Orchestrator: the only thing the route calls. Keeps routes/public-preview.js
// a thin HTTP layer per the agreed architecture.
//
// Pipeline (zero AI calls anywhere):
//   upload/pastedText -> extractResumeText() (pdf-parse/mammoth, no AI)
//                      -> scoreResume() (evidence extraction + deterministic
//                         scoring + template selection, no AI)
//                      -> stripInternalMetrics() if production
//                      -> response
// ═══════════════════════════════════════════════════════════════════════════

const { extractResumeText } = require('./resume-preview-text-extract');
const { scoreResume, stripInternalMetrics } = require('./resume-preview-scoring');
const CFG = require('../config/resume-preview-config');

const MIN_USABLE_TEXT_CHARS = 120; // below this, don't even bother scoring — clearly not a resume

/**
 * Run the full anonymous preview pipeline.
 * @param {{ file?: object, pastedText?: string }} input
 * @param {{ NODE_ENV?: string }} [env] - injected for testability; defaults to process.env
 * @returns {Promise<{ preview_version: string, status: 'ok'|'insufficient_signal', preview?: object, message?: string }>}
 */
async function generatePreview(input, env = process.env) {
  const { text, source } = await extractResumeText(input);

  if (!text || text.length < MIN_USABLE_TEXT_CHARS) {
    return {
      preview_version: CFG.PREVIEW_VERSION,
      status: 'insufficient_signal',
      message: source === 'none'
        ? 'We couldn\u2019t read that file. Try uploading a PDF or DOCX, or paste your resume text directly.'
        : 'We couldn\u2019t extract enough structured information from this resume. Try pasting the full text instead of uploading, or add more detail on responsibilities and outcomes.',
    };
  }

  const scored = scoreResume(text);

  // Note: a "thin resume" (readable file, but genuinely sparse content) is
  // still a valid "ok" response — the UI's Early Signal / Limited Signal
  // states already handle this gracefully and constructively. Only a
  // genuinely unreadable/empty file (caught above) short-circuits before
  // scoring runs at all.
  return {
    preview_version: CFG.PREVIEW_VERSION,
    status: 'ok',
    preview: env.NODE_ENV === 'production' ? stripInternalMetrics(scored) : scored,
  };
}

module.exports = { generatePreview };
