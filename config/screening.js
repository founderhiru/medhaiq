// config/screening.js
//
// Screening & Assessment Copilot — thresholds, labels and limits ONLY.
// No logic lives here (project convention: no magic numbers inside
// route / db / service code). Deliberately separate from
// config/product-packages.js and config/plans.js: screening access is a
// founder-granted pilot allowlist, not a subscription tier, and must never
// be read by the Capability Engine.

// ── Evidence statuses ───────────────────────────────────────────────────────
// The five transparent statuses from the product spec. `not_applicable` is
// RECRUITER-ONLY: the model may never assign it (see AI_ASSIGNABLE_STATUSES).
const EVIDENCE_STATUSES = Object.freeze({
  evidence_found: 'Evidence Found',
  partial_evidence: 'Partial Evidence',
  not_found: 'Not Found in Resume',
  requires_verification: 'Requires Verification',
  not_applicable: 'Not Applicable',
});

const AI_ASSIGNABLE_STATUSES = Object.freeze([
  'evidence_found',
  'partial_evidence',
  'not_found',
  'requires_verification',
]);

// Statuses that claim the resume SHOWS something → must carry at least one
// quote that is verified to exist in the stored resume text.
const CLAIM_STATUSES = Object.freeze(['evidence_found', 'partial_evidence']);

// Statuses that need a human look until the recruiter has reviewed them.
const ATTENTION_STATUSES = Object.freeze(['partial_evidence', 'not_found', 'requires_verification']);

// Statuses for which targeted verification questions are generated.
const QUESTION_STATUSES = Object.freeze(['partial_evidence', 'not_found', 'requires_verification']);

// Fixed text for `not_found`. The model's own wording is NEVER used for this
// status, so "not found" can never be rewritten into a claim of absence.
const NOT_FOUND_NOTE =
  'No supporting text for this criterion was found in the resume. This does not mean the candidate lacks the skill or experience.';

// ── Recruiter decision labels (recruiter-set only, never AI) ────────────────
const DECISIONS = Object.freeze({
  shortlist: 'Shortlist',
  hold: 'Hold',
  needs_verification: 'Needs Verification',
  not_moving_forward: 'Not Moving Forward',
});

// ── Criteria ────────────────────────────────────────────────────────────────
const IMPORTANCE = Object.freeze(['required', 'preferred']);
const CRITERION_KINDS = Object.freeze(['technical', 'experience', 'qualification', 'domain', 'behavioral', 'other']);
const CRITERION_ORIGINS = Object.freeze(['ai', 'heuristic', 'recruiter']);

const LIMITS = Object.freeze({
  // Documents
  JD_MIN_CHARS: 120,
  JD_MAX_CHARS: 12000,            // matches services/competency-matrix.js MAX_JD_TEXT_CHARS
  RESUME_MIN_CHARS: 120,
  RESUME_MAX_CHARS: 20000,        // matches the pasted-text cap used elsewhere in the app
  FILE_MAX_BYTES: 5 * 1024 * 1024, // 5 MB, matches routes/resume.js
  PDF_MAX_PAGES: 15,
  DOCX_MAX_ENTRIES: 2000,
  DOCX_MAX_UNCOMPRESSED_BYTES: 30 * 1024 * 1024,
  DOCX_MAX_ENTRY_BYTES: 20 * 1024 * 1024,
  EXTRACT_TIMEOUT_MS: 20000,
  EXTRACT_WORKER_MAX_MB: 192,

  // Volume
  JOBS_PER_OWNER: 100,
  CANDIDATES_PER_JOB: 300,
  CRITERIA_MAX: 15,

  // Field lengths (kept in step with db/screening-migration.js column sizes)
  TITLE_MAX: 160,
  CRITERION_TEXT_MAX: 200,
  CRITERION_GUIDANCE_MAX: 400,
  JD_QUOTE_MAX: 400,
  LABEL_MAX: 80,
  NOTE_MAX: 1000,
  RATIONALE_MAX: 280,
  QUESTION_MAX: 300,
  QUESTIONS_PER_CRITERION: 2,

  // Resume quotes
  QUOTES_PER_CRITERION: 3,
  QUOTE_MIN_CHARS: 15,
  QUOTE_MAX_CHARS: 320,
});

// ── AI usage ────────────────────────────────────────────────────────────────
const AI = Object.freeze({
  // undefined → the shared default (ai/config/models.js LEGACY_DEFAULT_MODEL).
  // Set SCREENING_AI_MODEL in Render to try a stronger model for screening
  // only, without touching the interview engine.
  MODEL: process.env.SCREENING_AI_MODEL || undefined,
  DAILY_RUN_CAP: Number(process.env.SCREENING_DAILY_AI_CAP) > 0 ? Number(process.env.SCREENING_DAILY_AI_CAP) : 400,
  CALL_TIMEOUT_MS: 60000,
  MAX_TOKENS: Object.freeze({ criteria: 2000, evidence: 4500, questions: 1500 }),
});

const PROMPT_VERSIONS = Object.freeze({
  criteria: 'crit-1',
  evidence: 'evid-1',
  questions: 'ques-1',
});

// ── Rate limits (per signed-in user) ────────────────────────────────────────
const RATE = Object.freeze({
  WINDOW_MS: 10 * 60 * 1000,
  UPLOADS_PER_WINDOW: 80,   // resume / JD uploads (one request per file)
  AI_PER_WINDOW: 60,        // requests that trigger a model call
});

// ── Output safety ───────────────────────────────────────────────────────────
// No API response may carry a key matching this. Enforced at runtime
// (lib/screening-evidence.js stripVerdictKeys) AND by tests that walk every
// JSON route. The product never ranks, scores or labels candidates.
const FORBIDDEN_KEY_PATTERN = /^(?:score|scores|scored|rank|ranks|ranking|rating|ratings|best|top_?candidate|hire|hired|reject|rejected|recommend|recommended|recommendation|verdict|suitab\w*|fit|fit_?score|overall|percent\w*|probability|likelihood|predict\w*|match_?score|match_?percent\w*)$/i;

// Words that must not appear in model-written rationale text.
const VERDICT_LANGUAGE_PATTERN = /\b(?:reject(?:ed|ion)?|hire[sd]?|hiring\s+decision|not\s+suitable|unsuitable|(?:good|poor|bad|great|weak|strong(?:est)?|best|top|ideal)\s+(?:fit|candidate|match|applicant)|recommend(?:ed|ation)?|shortlist(?:ed)?|disqualif\w+|should\s+not\s+be\s+(?:hired|considered)|lacks?\s+the\s+(?:skills?|experience))\b/i;

module.exports = {
  EVIDENCE_STATUSES,
  AI_ASSIGNABLE_STATUSES,
  CLAIM_STATUSES,
  ATTENTION_STATUSES,
  QUESTION_STATUSES,
  NOT_FOUND_NOTE,
  DECISIONS,
  IMPORTANCE,
  CRITERION_KINDS,
  CRITERION_ORIGINS,
  LIMITS,
  AI,
  PROMPT_VERSIONS,
  RATE,
  FORBIDDEN_KEY_PATTERN,
  VERDICT_LANGUAGE_PATTERN,
};
