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

// Career workspace trend used only as a visual reference inside the
// end-frame recap strip. The live /preview/workspace route (existing,
// unmodified) is the one actually recorded for the Career Intelligence
// beat of the walkthrough — this is not a duplicate of that route.
const CAREER_TREND = [58, 64, 69, 74, 81];

// Voiceover script for the "explain the navigation" walkthrough
// (2026-08-24 revision). Text only — no audio is generated here; per
// the agreed scope, voiceover is recorded separately (e.g. ElevenLabs)
// and added to the final MP4 in an editor afterward. Timing marks are
// the cumulative seconds each line is read against, matching
// scripts/record-demo.js's SEQUENCE dwell times exactly.
const VOICEOVER_SCRIPT = [
  { atS: 0, endS: 7, line: 'Welcome to MedhaIQ \u2014 your continuous career intelligence platform. From here you can explore the platform, understand how it works, or start your interview journey.' },
  { atS: 7, endS: 14, line: 'The Platform menu is where everything lives \u2014 your adaptive interview, interview insights, career progress, and what to expect from your first session.' },
  { atS: 14, endS: 22, line: 'Start by adding your resume and target role. MedhaIQ uses this context to personalize your interview.' },
  { atS: 22, endS: 30, line: 'MedhaIQ conducts a live AI interview tailored to your resume and target role \u2014 adapting its questions, capturing STAR evidence, and evaluating your performance across five dimensions.' },
  { atS: 30, endS: 42, line: 'After the interview, your report turns that conversation into actionable intelligence \u2014 with scores, evidence, strengths, development areas, and recommendations.' },
  { atS: 42, endS: 51, line: 'Your interview history helps you track progress and build continuous career intelligence over time.' },
  { atS: 51, endS: 60, line: 'That\u2019s MedhaIQ \u2014 Practice. Polish. Place.' },
];

module.exports = {
  CANDIDATE_NAME,
  ROLE_TITLE,
  COMPANY_NAME,
  PERSONA_NAME,
  PERSONA_STYLE_LABEL,
  INTERVIEW_CAPABILITIES_SNAPSHOT,
  REPORT_FIXTURE,
  CAREER_TREND,
  VOICEOVER_SCRIPT,
};
