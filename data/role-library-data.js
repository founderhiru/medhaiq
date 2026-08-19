// Role Library — structured data (mirrors company-library-data.js).
// roleLibrary holds the 6 launch-ready role guides. The landing page
// renders all of them as one flat, curated grid — no categories, no
// coming-soon placeholders. Adding a 7th role later = adding one more
// object to this array — no template changes required.

const roleLibrary = [
  // ─────────────────────────────────────────────────────────────
  // PRODUCT MANAGER
  // ─────────────────────────────────────────────────────────────
  {
    id: 1,
    slug: 'product-manager',
    title: 'Product Manager',
    category: 'Product',
    tags: ['Product Strategy', 'Execution', 'Stakeholder Management'],
    oneLiner: 'Drive product strategy, execution, and customer outcomes.',
    resources: [
      { name: 'Silicon Valley Product Group (SVPG)', url: 'https://www.svpg.com/articles/' },
      { name: 'Product School', url: 'https://productschool.com/blog' },
    ],
    seo: {
      title: 'Product Manager Interview Guide | MedhaIQ',
      description: 'What hiring managers evaluate for Product Manager interviews — competencies, interview flow, representative questions, and preparation tips.',
    },
    hero: { subheadline: 'Product · Strategy · Leadership' },
    atAGlance: {
      roleFocus: 'Product Strategy',
      interviewStyle: 'Behavioral + Product Thinking',
      typicalExperience: '3–8 years',
      difficulty: 4,
    },
    competencies: [
      { name: 'Customer Thinking', desc: 'Grounding product decisions in real customer problems, not internal assumptions.' },
      { name: 'Execution', desc: 'Shipping a product from ambiguous idea to measurable outcome.' },
      { name: 'Prioritization', desc: 'Choosing what not to build, and defending that choice with evidence.' },
      { name: 'Communication', desc: 'Aligning engineering, design, and business stakeholders around one narrative.' },
      { name: 'Influence Without Authority', desc: 'Driving a roadmap forward without formal control over the people building it.' },
    ],
    interviewFlow: ['Recruiter', 'Hiring Manager', 'Product Exercise', 'Panel', 'Leadership'],
    questions: [
      'Tell me about a product you launched, from idea to shipped.',
      'How do you prioritize competing features with limited engineering capacity?',
      'Describe a failed product decision and what you learned.',
      'How do you influence a team without having authority over them?',
      'How do you measure whether a product decision actually succeeded?',
      'Walk me through how you\'d improve a product you use regularly.',
    ],
    tips: [
      'Use structured frameworks (e.g. RICE, north-star metrics) to show rigor.',
      'Quantify outcomes — engagement, revenue, retention — not just features shipped.',
      'Explain trade-offs explicitly; PM interviews reward judgment, not just answers.',
      'Show customer thinking in every story, not just the ones about customers.',
      'Demonstrate leadership through influence, not through job title.',
    ],
    relatedCompanies: ['amazon', 'microsoft', 'google', 'salesforce'],
    practiceHelps: [
      'Resume-aware interview calibrated to product management specifically',
      'Role-specific questioning across strategy, execution, and stakeholder scenarios',
      'Adaptive follow-up probing on trade-offs and prioritization',
      'AI evaluation scored against product management competencies',
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // SOFTWARE ENGINEER
  // ─────────────────────────────────────────────────────────────
  {
    id: 2,
    slug: 'software-engineer',
    title: 'Software Engineer',
    category: 'Engineering',
    tags: ['Coding', 'System Design', 'Debugging'],
    oneLiner: 'Solve technical problems and design systems that scale.',
    resources: [
      { name: 'Microsoft Learn', url: 'https://learn.microsoft.com/' },
      { name: 'Google Engineering Blog', url: 'https://developers.googleblog.com/' },
    ],
    seo: {
      title: 'Software Engineer Interview Guide | MedhaIQ',
      description: 'What hiring managers evaluate for Software Engineer interviews — competencies, interview flow, representative questions, and preparation tips.',
    },
    hero: { subheadline: 'Engineering · Technical · Problem Solving' },
    atAGlance: {
      roleFocus: 'Technical Problem Solving',
      interviewStyle: 'Coding + System Design',
      typicalExperience: '2–6 years',
      difficulty: 4,
    },
    competencies: [
      { name: 'Problem Decomposition', desc: 'Breaking an ambiguous problem into a solvable structure before writing code.' },
      { name: 'Coding Fluency', desc: 'Translating a plan into correct, readable, reasonably efficient code.' },
      { name: 'System Design', desc: 'Reasoning about trade-offs at scale — latency, consistency, cost.' },
      { name: 'Debugging Mindset', desc: 'Diagnosing failure systematically rather than guessing at fixes.' },
      { name: 'Communication', desc: 'Narrating your reasoning clearly enough for an interviewer to follow it.' },
    ],
    interviewFlow: ['Recruiter', 'Online Assessment', 'Coding Rounds', 'System Design', 'Behavioral'],
    questions: [
      'Walk me through how you\'d approach a coding problem you\'ve never seen before.',
      'Design a system that needs to scale to millions of users.',
      'Tell me about the hardest bug you\'ve debugged. How did you find it?',
      'Describe a time you had to make a technical trade-off under a deadline.',
      'How do you decide between a simple solution and a more scalable one?',
      'Tell me about a time you disagreed with a technical decision on your team.',
    ],
    tips: [
      'Think out loud — interviewers weight your reasoning as heavily as the final answer.',
      'Clarify requirements and constraints before writing any code.',
      'Discuss trade-offs explicitly in system design, don\'t just describe one solution.',
      'Test your own code out loud with an example before declaring it done.',
      'Prepare 2–3 strong behavioral stories, not just technical ones.',
    ],
    relatedCompanies: ['amazon', 'microsoft', 'google'],
    practiceHelps: [
      'Resume-aware interview calibrated to your tech stack and experience level',
      'Role-specific coding and system design questioning',
      'Adaptive follow-up probing on trade-offs and edge cases',
      'AI evaluation scored against engineering competencies',
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // SOLUTIONS ARCHITECT
  // ─────────────────────────────────────────────────────────────
  {
    id: 3,
    slug: 'solutions-architect',
    title: 'Solutions Architect',
    category: 'Architecture',
    tags: ['System Design', 'Client Communication', 'Technical Strategy'],
    oneLiner: 'Design technical solutions that satisfy client and business constraints.',
    resources: [
      { name: 'AWS Architecture Center', url: 'https://aws.amazon.com/architecture/' },
      { name: 'Microsoft Learn', url: 'https://learn.microsoft.com/' },
      { name: 'Google Cloud Architecture Center', url: 'https://cloud.google.com/architecture' },
    ],
    seo: {
      title: 'Solutions Architect Interview Guide | MedhaIQ',
      description: 'What hiring managers evaluate for Solutions Architect interviews — competencies, interview flow, representative questions, and preparation tips.',
    },
    hero: { subheadline: 'Architecture · Technical Strategy · Client-Facing' },
    atAGlance: {
      roleFocus: 'Technical Strategy',
      interviewStyle: 'System Design + Client Scenarios',
      typicalExperience: '5–10 years',
      difficulty: 4,
    },
    competencies: [
      { name: 'System Design', desc: 'Designing solutions that satisfy real technical and business constraints simultaneously.' },
      { name: 'Client Communication', desc: 'Explaining architecture decisions to both engineers and business stakeholders.' },
      { name: 'Technical Breadth', desc: 'Reasoning credibly across infrastructure, security, and integration concerns.' },
      { name: 'Trade-off Judgment', desc: 'Choosing the right solution for the client\'s actual constraints, not the most elegant one.' },
      { name: 'Consultative Selling', desc: 'Building client trust in a recommendation without overselling it.' },
    ],
    interviewFlow: ['Recruiter', 'Technical Screen', 'Architecture Case', 'Client Scenario', 'Leadership'],
    questions: [
      'Walk me through how you\'d architect a solution for a client with legacy infrastructure.',
      'Tell me about a time a client pushed back on your recommended architecture.',
      'How do you balance a technically ideal solution against a client\'s budget or timeline?',
      'Describe a project where you had to influence stakeholders who weren\'t technical.',
      'How do you evaluate build-vs-buy decisions for a client?',
    ],
    tips: [
      'Structure architecture answers around constraints first, solution second.',
      'Practice explaining technical trade-offs to a non-technical audience.',
      'Prepare a story where you changed your recommendation based on client pushback.',
      'Show judgment about when a simple solution beats an elegant one.',
      'Be ready to discuss security and integration, not just the happy path.',
    ],
    relatedCompanies: ['amazon', 'microsoft', 'salesforce'],
    practiceHelps: [
      'Resume-aware interview calibrated to solutions architecture specifically',
      'Client-scenario questioning alongside technical system design',
      'Adaptive follow-up probing on trade-offs and stakeholder pushback',
      'AI evaluation scored against architecture and communication competencies',
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // TECHNICAL PROGRAM MANAGER
  // ─────────────────────────────────────────────────────────────
  {
    id: 4,
    slug: 'technical-program-manager',
    title: 'Technical Program Manager',
    category: 'Program & Delivery',
    tags: ['Cross-Team Delivery', 'Risk Management', 'Technical Fluency'],
    oneLiner: 'Coordinate cross-team delivery and manage program risk.',
    resources: [
      { name: 'Project Management Institute (PMI)', url: 'https://www.pmi.org/learning' },
      { name: 'Atlassian Agile Coach', url: 'https://www.atlassian.com/agile' },
    ],
    seo: {
      title: 'Technical Program Manager Interview Guide | MedhaIQ',
      description: 'What hiring managers evaluate for Technical Program Manager interviews — competencies, interview flow, representative questions, and preparation tips.',
    },
    hero: { subheadline: 'Program Management · Cross-Team Delivery · Technical' },
    atAGlance: {
      roleFocus: 'Cross-Team Delivery',
      interviewStyle: 'Behavioral + Program Case',
      typicalExperience: '4–9 years',
      difficulty: 3,
    },
    competencies: [
      { name: 'Cross-Team Coordination', desc: 'Keeping multiple engineering teams aligned toward one delivery date.' },
      { name: 'Risk Management', desc: 'Surfacing and mitigating delivery risk before it becomes a missed deadline.' },
      { name: 'Technical Fluency', desc: 'Understanding engineering trade-offs well enough to plan around them.' },
      { name: 'Prioritization', desc: 'Sequencing dependent workstreams realistically, not optimistically.' },
      { name: 'Communication', desc: 'Giving leadership an honest, clear status — including bad news early.' },
    ],
    interviewFlow: ['Recruiter', 'Hiring Manager', 'Program Case', 'Cross-Functional Panel', 'Leadership'],
    questions: [
      'Tell me about a program you delivered that involved multiple dependent teams.',
      'Describe a time you identified a risk before it became a real problem.',
      'How do you handle a team that consistently misses its committed dates?',
      'Tell me about a time you had to deliver bad news to leadership.',
      'How do you decide what to escalate versus resolve yourself?',
      'Describe how you\'ve managed a program with unclear technical requirements.',
    ],
    tips: [
      'Lead with the outcome, then walk through how you got there.',
      'Be specific about your personal role versus what the team did.',
      'Show how you surfaced risk early, not just how you reacted to it.',
      'Demonstrate technical fluency without pretending to be the engineer.',
      'Practice explaining a program\'s status honestly, including what went wrong.',
    ],
    relatedCompanies: ['amazon', 'microsoft', 'google'],
    practiceHelps: [
      'Resume-aware interview calibrated to program management specifically',
      'Role-specific questioning across delivery, risk, and cross-team scenarios',
      'Adaptive follow-up probing on prioritization and escalation judgment',
      'AI evaluation scored against program management competencies',
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // MANAGEMENT CONSULTANT
  // ─────────────────────────────────────────────────────────────
  {
    id: 5,
    slug: 'management-consultant',
    title: 'Management Consultant',
    category: 'Consulting',
    tags: ['Case Interviews', 'Client Impact', 'Executive Presence'],
    oneLiner: 'Structure ambiguous business problems into clear client recommendations.',
    resources: [
      { name: 'Case Interview Prep (CaseInterview.com)', url: 'https://www.caseinterview.com/' },
      { name: 'Harvard Business Review', url: 'https://hbr.org/' },
    ],
    seo: {
      title: 'Management Consultant Interview Guide | MedhaIQ',
      description: 'What hiring managers evaluate for Management Consultant interviews — competencies, interview flow, representative questions, and preparation tips.',
    },
    hero: { subheadline: 'Consulting · Case Interviews · Client Impact' },
    atAGlance: {
      roleFocus: 'Structured Problem Solving',
      interviewStyle: 'Case Interviews',
      typicalExperience: '0–6 years',
      difficulty: 5,
    },
    competencies: [
      { name: 'Analytical Structure', desc: 'Framing an ambiguous business problem logically, out loud, under time pressure.' },
      { name: 'Client Impact', desc: 'Recommending what actually helps the client, not just what\'s analytically interesting.' },
      { name: 'Executive Presence', desc: 'Communicating with the composure and clarity expected in front of senior stakeholders.' },
      { name: 'Quantitative Reasoning', desc: 'Handling numbers confidently and sanity-checking your own math.' },
      { name: 'Teamwork', desc: 'Collaborating effectively on engagement teams assembled quickly around a new case.' },
    ],
    interviewFlow: ['Recruiter', 'Case Interview', 'Case Interview', 'Fit Interview', 'Partner Round'],
    questions: [
      'Walk me through how you\'d help a client whose revenue is declining despite market growth.',
      'Tell me about a time you led a project without formal authority.',
      'Describe how you\'d structure your approach to a problem with very little data.',
      'Tell me about a time you had to deliver a difficult recommendation to a client.',
      'How do you sanity-check a quantitative estimate under time pressure?',
      'Tell me about a time you disagreed with your team\'s direction on a project.',
    ],
    tips: [
      'Practice structuring case problems out loud before your interview, not during it.',
      'Lead with your conclusion, then walk through supporting logic — answer-first.',
      'Treat the interviewer like a client — ask clarifying questions, check your framing.',
      'Round numbers deliberately and state your assumptions clearly.',
      'Prepare fit stories that show leadership without formal authority.',
    ],
    relatedCompanies: ['deloitte'],
    practiceHelps: [
      'Resume-aware interview calibrated to consulting case interview style',
      'Structured case-style questioning with adaptive follow-ups',
      'Answer-first communication feedback, a consulting-specific skill',
      'AI evaluation scored against structured reasoning and executive presence',
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // ENGINEERING MANAGER
  // ─────────────────────────────────────────────────────────────
  {
    id: 6,
    slug: 'engineering-manager',
    title: 'Engineering Manager',
    category: 'Engineering',
    tags: ['People Leadership', 'Technical Judgment', 'Delivery'],
    oneLiner: 'Lead engineering teams while staying accountable for delivery.',
    resources: [
      { name: "The Manager's Path (O'Reilly)", url: 'https://www.oreilly.com/library/view/the-managers-path/9781491973882/' },
      { name: 'Google Engineering Blog', url: 'https://developers.googleblog.com/' },
    ],
    seo: {
      title: 'Engineering Manager Interview Guide | MedhaIQ',
      description: 'What hiring managers evaluate for Engineering Manager interviews — competencies, interview flow, representative questions, and preparation tips.',
    },
    hero: { subheadline: 'Engineering · People Leadership · Delivery' },
    atAGlance: {
      roleFocus: 'People Leadership',
      interviewStyle: 'Behavioral + Technical Judgment',
      typicalExperience: '6–12 years',
      difficulty: 4,
    },
    competencies: [
      { name: 'People Leadership', desc: 'Growing individual engineers while holding the team accountable to outcomes.' },
      { name: 'Technical Judgment', desc: 'Staying technical enough to earn credibility without doing the team\'s job for them.' },
      { name: 'Delivery Ownership', desc: 'Being accountable for what the team ships, not just how it\'s built.' },
      { name: 'Conflict Resolution', desc: 'Resolving disagreements between engineers or teams without avoiding the hard conversation.' },
      { name: 'Communication', desc: 'Translating technical reality into a clear narrative for non-technical stakeholders.' },
    ],
    interviewFlow: ['Recruiter', 'Hiring Manager', 'Technical Judgment', 'People Management Panel', 'Leadership'],
    questions: [
      'Tell me about a time you had a difficult performance conversation with a direct report.',
      'Describe how you\'ve balanced technical debt against feature delivery pressure.',
      'Tell me about a conflict between two engineers on your team. How did you resolve it?',
      'How do you stay technically credible without micromanaging your team\'s code?',
      'Describe a time you had to deliver a project despite losing a key team member.',
      'Tell me about a time you disagreed with a decision from your own manager.',
    ],
    tips: [
      'Lead people stories with the specific action you took, not just the outcome.',
      'Show technical judgment through questions you asked, not code you wrote.',
      'Be honest about conflicts — a too-clean story reads as untested.',
      'Demonstrate accountability for team delivery, even when it went wrong.',
      'Practice explaining technical trade-offs to a non-technical stakeholder.',
    ],
    relatedCompanies: ['amazon', 'microsoft', 'google'],
    practiceHelps: [
      'Resume-aware interview calibrated to engineering leadership specifically',
      'Role-specific questioning across people leadership and technical judgment',
      'Adaptive follow-up probing on conflict and accountability scenarios',
      'AI evaluation scored against engineering management competencies',
    ],
  },
];

module.exports = { roleLibrary };