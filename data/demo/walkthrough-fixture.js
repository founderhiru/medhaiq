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

// Animated interview scene fixture — the visual climax of the guided
// tour (2026-08-24 revision, decision #3: animation explicitly
// approved). A short scripted timeline: question -> response/transcript
// -> STAR signals -> adaptive follow-up -> 5-Vector scoring. All values
// are fixed literals driving public/js/guided-tour.js's timeline
// renderer — no Vapi, no live scoring, no network calls.
const INTERVIEW_TOUR_SCRIPT = {
  totalDurationMs: 14000,
  turns: [
    {
      atMs: 0,
      qEyebrow: 'QUESTION 1 OF 5 \u00b7 BEHAVIORAL',
      questionText: 'Tell me about a time you owned a problem that wasn\u2019t technically your responsibility.',
    },
    {
      atMs: 2500,
      transcriptLine: 'When our onboarding drop-off spiked, I pulled the funnel data myself and brought engineering in.',
    },
    {
      atMs: 6000,
      starProgress: ['situation', 'task', 'action'],
    },
    {
      atMs: 8000,
      qEyebrow: 'QUESTION 2 OF 5 \u00b7 FOLLOW-UP',
      isFollowUp: true,
      questionText: 'What was the measurable outcome once you stepped in?',
      starProgress: ['situation', 'task', 'action', 'result'],
    },
    {
      atMs: 10500,
      transcriptLine: 'Drop-off recovered within two weeks and stayed down after launch.',
    },
    {
      atMs: 12000,
      vectors: { structure: 82, domain: 74, strategy: 79, communication: 88, leadership: 81 },
      overallScore: 81,
    },
  ],
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

// Guided-tour step sequence (2026-08-24 rewrite). This replaces the
// earlier 5-chapter-with-visible-nav architecture entirely: there is no
// chapter numbering or chapter nav bar anywhere in the UI. This array
// is internal sequencing only, consumed by public/js/guided-tour.js to
// know which real/fixture page each step lives on, how long to dwell,
// and which continuous-narration voiceover line plays under it. Timing
// matches the approved final storyboard exactly (0-8, 8-17, 17-27,
// 27-35, 35-49, 49-59, 59-66, 66-70, 70+).
const TOUR_STEPS = [
  {
    id: 'homepage',
    mode: 'live-homepage',
    startS: 0,
    endS: 8,
    audioSrc: '/audio/tour/01-homepage.mp3',
    voiceoverLine: 'Meet MedhaIQ \u2014 Continuous Career Intelligence for the way your career actually moves.',
  },
  {
    id: 'platform-menu',
    mode: 'live-homepage',
    startS: 8,
    endS: 17,
    audioSrc: '/audio/tour/02-platform-menu.mp3',
    voiceoverLine: 'It starts by understanding where you are, where you want to go, and what your target role demands.',
  },
  {
    id: 'interview-setup',
    mode: 'iframe-real',
    src: '/preview/interview',
    startS: 17,
    endS: 27,
    audioSrc: '/audio/tour/03-interview-setup.mp3',
    voiceoverLine: 'Bring together your experience, the role you\u2019re targeting, and the opportunity in front of you.',
  },
  {
    id: 'persona',
    mode: 'iframe-real',
    src: '/preview/interview',
    startS: 27,
    endS: 35,
    audioSrc: '/audio/tour/04-persona.mp3',
    voiceoverLine: 'MedhaIQ connects your evidence to what the role requires.',
  },
  {
    id: 'interview-live',
    mode: 'iframe-scene',
    src: '/demo/tour/scene/interview',
    startS: 35,
    endS: 49,
    audioSrc: '/audio/tour/05-interview-live.mp3',
    voiceoverLine: 'Then, practice through an adaptive AI interview. Your answers shape what comes next \u2014 making every conversation more relevant, more focused, and more like the interview you\u2019re preparing for.',
  },
  {
    id: 'report',
    mode: 'iframe-scene',
    src: '/demo/tour/scene/report',
    startS: 49,
    endS: 59,
    audioSrc: '/audio/tour/06-report.mp3',
    voiceoverLine: 'Behind every answer, MedhaIQ identifies evidence, STAR signals, and capability patterns \u2014 turning conversation into measurable career intelligence.',
  },
  {
    id: 'career-workspace',
    mode: 'iframe-real',
    src: '/preview/workspace',
    startS: 59,
    endS: 66,
    audioSrc: '/audio/tour/07-career-workspace.mp3',
    voiceoverLine: 'And every session adds another signal. See how your capabilities evolve, refine your story, and build stronger career readiness over time.',
  },
  {
    id: 'closing',
    mode: 'iframe-scene',
    src: '/demo/tour/scene/closing',
    startS: 66,
    endS: 74,
    audioSrc: '/audio/tour/08-closing.mp3',
    voiceoverLine: 'Practice. Polish. Place. That\u2019s MedhaIQ.',
  },
];

module.exports = {
  CANDIDATE_NAME,
  ROLE_TITLE,
  COMPANY_NAME,
  PERSONA_NAME,
  PERSONA_STYLE_LABEL,
  INTERVIEW_TOUR_SCRIPT,
  REPORT_FIXTURE,
  TOUR_STEPS,
};
