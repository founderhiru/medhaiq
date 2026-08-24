// data/demo/walkthrough-fixture.js
//
// Static, deterministic content for the "See How It Works" 60-second
// walkthrough recording ONLY. Every value here is a fixed literal —
// nothing is read from the database, from req.user, or from any live
// AI/voice service. This file is the single source of truth so the
// two demo scene routes (routes/demo.js) and the recording script
// (scripts/record-demo.js) all agree on timing and content.
//
// Company: Amazon — chosen because it is already deeply modeled in
// data/company-library-data.js (published Leadership Principles,
// structured STAR-style behavioral questions), which fits a Senior
// Product Manager persona naturally without inventing any
// company-specific claims.

const CANDIDATE_NAME = 'Alex Chen';
const ROLE_TITLE = 'Senior Product Manager';
const COMPANY_NAME = 'Amazon';
const PERSONA_NAME = 'Marcus Webb';
const PERSONA_STYLE_LABEL = 'Rigorous';

// A short (~8s) STATIC snapshot of the interview + evaluation UI, used
// for the "Interview capabilities" beat of the walkthrough. This is
// deliberately NOT a played-out Q&A — the narration explains the
// capability (adaptive voice interview, STAR capture, 5-vector scoring)
// while the screen shows a single, already-populated, representative
// moment. No timeline JS, no typing animation, no follow-up transition.
const INTERVIEW_CAPABILITIES_SNAPSHOT = {
  qEyebrow: 'QUESTION 2 OF 5 \u00b7 FOLLOW-UP',
  questionText: 'What was the measurable outcome once you stepped in?',
  transcriptLine: 'Drop-off recovered within two weeks and stayed down after launch.',
  starProgress: ['situation', 'task', 'action', 'result'],
  vectors: { structure: 82, domain: 74, strategy: 79, communication: 88, leadership: 81 },
  overallScore: 81,
};

// Report scene fixture — shaped to match the exact local variables the
// real views/interview-report.ejs template consumes (candidateName,
// roleTitle, personaName, report.overall_score, the five vector
// averages, executive_summary, etc.) so the demo report reuses the
// real markup/CSS 1:1, just fed static values instead of a DB row.
const REPORT_FIXTURE = {
  candidateName: CANDIDATE_NAME,
  roleTitle: ROLE_TITLE,
  personaName: PERSONA_NAME,
  formattedDate: 'Demo Session',
  hasSubstantiveEvidence: true,
  hasFullReport: true,
  hasPdfAccess: false,
  report: {
    overall_score: 81,
    executive_summary:
      'Alex demonstrates strong ownership instincts and communicates outcomes clearly, with structured, evidence-backed answers throughout the session.',
    persona_verdict:
      'Marcus Webb: "Clear, concrete, and unafraid to act outside the lines of the org chart \u2014 exactly the kind of ownership Amazon looks for."',
  },
  recommendationContext: 'Strong readiness signal for Senior Product Manager-level behavioral rounds.',
  starAvg: 82,
  technicalAvg: 74,
  executiveAvg: 79,
  frictionAvg: 88,
  gccAvg: 81,
  circumference: 377,
  circumferenceOffset: 72,
  responsePattern: { answered: 2, skipped: 0, dontKnow: 0 },
  strengths: [
    'Ownership \u2014 88/100. Takes ownership of problems outside formal scope, backed by a concrete example.',
    'Communication \u2014 88/100. Concise and results-oriented, leads with outcomes.',
  ],
  developmentAreas: [
    'Domain Expertise \u2014 74/100. Could quantify business impact (revenue, retention) more specifically in follow-ups.',
  ],
  recommendations: [
    'Practice one additional story per Leadership Principle to avoid reusing the same example twice.',
  ],
};

// Career workspace trend used in Chapter 05 (Progress) and as a visual
// reference inside the end-frame recap strip.
const CAREER_TREND = [58, 64, 69, 74, 81];

// Discover chapter (01) — what MedhaIQ already understands about the
// candidate: where they are, where they want to go, what the role
// demands. Deliberately informational, not decorative.
const DISCOVER_FIXTURE = {
  currentSnapshot: {
    label: 'Where you are',
    heading: CANDIDATE_NAME,
    detail: '6 years in product management \u00b7 fintech & SaaS background',
  },
  destination: {
    label: 'Where you want to go',
    heading: ROLE_TITLE,
    detail: `Targeting ${COMPANY_NAME}-caliber Senior PM roles`,
  },
  roleDemands: {
    label: 'What the role demands',
    heading: 'Ownership, structure, strategic thinking',
    detail: 'Behavioral depth, measurable outcomes, cross-functional leadership',
  },
};

// Prepare chapter (02) — the Resume + Target Role + Job Description ->
// Alignment differentiator. Not a form-filling tutorial: three source
// inputs visually converging into one alignment result.
const PREPARE_FIXTURE = {
  sources: [
    { icon: '\ud83d\udcc4', label: 'Resume', detail: '6 years product management \u00b7 fintech & SaaS' },
    { icon: '\ud83c\udfaf', label: 'Target Role', detail: ROLE_TITLE },
    { icon: '\ud83d\udcbc', label: 'Job Description', detail: `${COMPANY_NAME} \u00b7 Ownership & Leadership Principles` },
  ],
  alignment: {
    heading: 'Alignment',
    detail: 'MedhaIQ connects your evidence to what this specific role requires \u2014 before the interview even starts.',
    matchPoints: [
      'Ownership examples map directly to Leadership Principles',
      'Fintech background aligns with target domain expertise',
      'Gaps flagged: quantified business impact metrics',
    ],
  },
};

// Progress chapter (05) — Session -> Insight -> Improvement -> Progress.
const PROGRESS_FIXTURE = {
  sessions: CAREER_TREND.map((score, i) => ({ session: i + 1, score })),
  headline: 'Every session adds another signal',
  detail: 'Track how your capabilities evolve, refine your story, and build stronger career readiness over time.',
};

// Chapter metadata for the 5-chapter interactive walkthrough
// (2026-08-24 revision — replaces the old single linear MP4 script).
// Each chapter is self-contained: its own voiceover line (for
// captions/future TTS) and its own audio asset path. audioSrc files do
// NOT exist yet by design (see public/js/demo-chapters.js) — the demo
// must work perfectly as a silent visual walkthrough until real
// voiceover files are dropped into public/audio/demo/ with these exact
// names. fallbackDurationMs is the autoplay dwell time used whenever a
// chapter's audio is missing or fails to load.
const CHAPTERS = [
  {
    id: 'discover',
    number: '01',
    navLabel: 'Discover',
    voiceoverLine: 'It starts by understanding where you are, where you want to go, and what your target role demands.',
    audioSrc: '/audio/demo/01-discover.mp3',
    fallbackDurationMs: 11000,
  },
  {
    id: 'prepare',
    number: '02',
    navLabel: 'Prepare',
    voiceoverLine: 'Bring together your experience, your target role, and the opportunity in front of you. MedhaIQ connects the evidence to what the role requires.',
    audioSrc: '/audio/demo/02-prepare.mp3',
    fallbackDurationMs: 11000,
  },
  {
    id: 'interview',
    number: '03',
    navLabel: 'Interview',
    voiceoverLine: 'Then, practice through an adaptive AI interview. Your answers shape what comes next \u2014 making every conversation more relevant, not just another scripted questionnaire.',
    audioSrc: '/audio/demo/03-interview.mp3',
    fallbackDurationMs: 13000,
  },
  {
    id: 'intelligence',
    number: '04',
    navLabel: 'Intelligence',
    voiceoverLine: 'Behind every answer, MedhaIQ identifies evidence, STAR signals, and capability patterns \u2014 turning conversation into measurable career intelligence. You don\u2019t just receive a score. You understand why.',
    audioSrc: '/audio/demo/04-intelligence.mp3',
    fallbackDurationMs: 13000,
  },
  {
    id: 'progress',
    number: '05',
    navLabel: 'Progress',
    voiceoverLine: 'And every session adds another signal. Track how your capabilities evolve, refine your story, and build stronger career readiness over time.',
    audioSrc: '/audio/demo/05-progress.mp3',
    fallbackDurationMs: 9000,
  },
];

// Closing beat — plays automatically after chapter 05, not part of the
// clickable chapter nav (matches the brief: 5 numbered chapters, then a
// separate closing/CTA beat).
const CLOSING = {
  voiceoverLine: 'Practice. Polish. Place. That\u2019s MedhaIQ.',
  audioSrc: '/audio/demo/06-closing.mp3',
  fallbackDurationMs: 9000,
};

module.exports = {
  CANDIDATE_NAME,
  ROLE_TITLE,
  COMPANY_NAME,
  PERSONA_NAME,
  PERSONA_STYLE_LABEL,
  INTERVIEW_CAPABILITIES_SNAPSHOT,
  REPORT_FIXTURE,
  CAREER_TREND,
  DISCOVER_FIXTURE,
  PREPARE_FIXTURE,
  PROGRESS_FIXTURE,
  CHAPTERS,
  CLOSING,
};
