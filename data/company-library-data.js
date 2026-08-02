// Company Interview Library — structured data.
// This is the ONLY place company content lives. views/company-library.ejs
// (the landing page) and views/company-guide.ejs (the reusable per-company
// template) both render entirely from this file — adding company #6 means
// adding one object here, not touching either template.
//
// Content policy (per spec): competencies and interview-process shape are
// drawn from each company's own publicly published values/careers content
// (e.g. Amazon's published Leadership Principles, Google's publicly
// documented "four core attributes" hiring framework, Salesforce's stated
// core values). Interview questions are REPRESENTATIVE of well-documented,
// publicly-discussed interview style — not claimed as official or leaked
// questions. No specific claims (round counts, pass rates, timelines) are
// made without a public source behind them.

const companyLibrary = [
  // ─────────────────────────────────────────────────────────────────
  // AMAZON
  // ─────────────────────────────────────────────────────────────────
  {
    id: 1,
    slug: 'amazon',
    name: 'Amazon',
    logo: 'A',
    category: 'Big Tech · E-commerce & Cloud',
    tagline: 'Behavioral excellence powered by Leadership Principles.',
    seo: {
      title: 'Amazon Interview Preparation Guide | MedhaIQ',
      description: 'Prepare for Amazon interviews with a guide to the Leadership Principles, interview process, common questions, and preparation strategy — plus AI-powered mock interviews.',
    },
    hero: {
      headline: 'Amazon Interview Preparation',
      description: 'Master Amazon interviews through competency-based AI interview practice and personalized feedback.',
    },
    snapshot: {
      industry: 'E-commerce, Cloud Computing (AWS), Logistics',
      headquarters: 'Seattle, Washington, USA',
      globalPresence: 'Operations in 20+ countries',
      popularFunctions: ['Software Engineering', 'Product Management', 'Operations', 'Cloud & Infrastructure'],
    },
    overview: [
      "Amazon builds its hiring process around 16 published Leadership Principles — Customer Obsession, Ownership, and Deliver Results among them. These are the actual evaluation rubric interviewers use. Nearly every question, even technical ones, asks you to demonstrate a principle through a real story — interviewers keep probing \"what did you personally do\" until they get a concrete answer.",
      "Amazon also uses a 'Bar Raiser' — an interviewer from outside the hiring team, trained to protect hiring quality. Expect structured storytelling over whiteboard theatrics, even in technical rounds.",
    ],
    interviewProcess: [
      { stage: 'Application', desc: 'Reviewed against the specific role\'s requirements; referrals help surface an application but don\'t skip the review.' },
      { stage: 'Recruiter Screen', desc: 'A call to confirm background and motivation — your first chance to signal Leadership Principle alignment.' },
      { stage: 'Technical / Functional', desc: 'Coding and system design for technical roles; case-style problem solving for business roles.' },
      { stage: 'Behavioral', desc: 'The core of Amazon\'s process — multiple interviewers, each mapped to specific principles, asking STAR-style questions in depth.' },
      { stage: 'Hiring Manager', desc: 'A conversation on role fit, team context, and your longer-term trajectory at Amazon.' },
      { stage: 'Offer', desc: 'The Bar Raiser and hiring committee review the full loop\'s feedback before extending an offer.' },
    ],
    competencies: [
      { name: 'Customer Obsession', desc: 'Starting from the customer and working backward, rather than starting from internal constraints.' },
      { name: 'Ownership', desc: 'Acting on behalf of the entire company, not just your immediate team, and thinking long-term.' },
      { name: 'Deliver Results', desc: 'Focusing on the key inputs and delivering them with the right quality, on time, despite setbacks.' },
      { name: 'Think Big', desc: 'Creating and communicating a bold direction that inspires results, rather than defaulting to the safe option.' },
      { name: 'Bias for Action', desc: 'Valuing calculated risk-taking and speed — most decisions are reversible and don\'t need exhaustive study.' },
    ],
    questions: [
      "Tell me about a time you went above and beyond for a customer, even when it wasn't the easy path.",
      "Describe a situation where you owned a problem that wasn't technically your responsibility.",
      "Tell me about a time you disagreed with a decision but committed to it anyway.",
      "Describe a project that failed. What did you learn, and what did you do differently afterward?",
      "Tell me about a time you had to resolve a conflict between two stakeholders with different priorities.",
      "Describe the most innovative idea you've implemented. What made it necessary?",
      "Describe a time you had to deliver results under a tight deadline with limited resources.",
    ],
    tips: [
      { title: 'Preparation', desc: 'Prepare one strong story per Leadership Principle — reusing the same story across principles is a common mistake.' },
      { title: 'Behavior', desc: 'Answers should be about what YOU did, specifically. Interviewers follow up until they get personal detail.' },
      { title: 'Communication', desc: 'Be concise — a tight, well-structured answer beats a rambling one.' },
      { title: 'STAR', desc: 'Structure answers as Situation, Task, Action, Result — don\'t skip the Result.' },
      { title: 'Mistakes', desc: 'Avoid hypothetical answers ("I would probably..."). Amazon wants real situations.' },
    ],
    howMedhaiqHelps: [
      'Practice behavioral rounds calibrated to Amazon\'s Leadership Principles, not generic questions.',
      'Get real-time STAR structure feedback so weak answers get caught before the real interview.',
      'Receive a report scoring your readiness across the principles most relevant to your role.',
    ],
    relatedRoles: ['Software Engineer', 'Product Manager', 'Program Manager', 'Business Analyst'],
    // Verified real, current URLs (checked via web search, not memory) —
    // official company pages only, max 3, per the Official Resources spec.
    officialResources: [
      { title: 'Amazon Careers', url: 'https://www.amazon.jobs/' },
      { title: 'Amazon Leadership Principles', url: 'https://www.amazon.jobs/en/principles' },
      { title: 'Amazon Culture', url: 'https://www.aboutamazon.com/amazons-workplace-culture' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // MICROSOFT
  // ─────────────────────────────────────────────────────────────────
  {
    id: 2,
    slug: 'microsoft',
    name: 'Microsoft',
    logo: 'M',
    category: 'Big Tech · Enterprise Software',
    tagline: 'Engineering excellence, collaboration, and growth mindset.',
    seo: {
      title: 'Microsoft Interview Preparation Guide | MedhaIQ',
      description: 'Prepare for Microsoft interviews with a guide to their growth-mindset culture, interview process, common questions, and preparation strategy — plus AI-powered mock interviews.',
    },
    hero: {
      headline: 'Microsoft Interview Preparation',
      description: 'Master Microsoft interviews through competency-based AI interview practice and personalized feedback.',
    },
    snapshot: {
      industry: 'Enterprise Software, Cloud Computing (Azure), Productivity Tools',
      headquarters: 'Redmond, Washington, USA',
      globalPresence: 'Offices in 190+ countries',
      popularFunctions: ['Software Engineering', 'Program Management', 'Cloud & Infrastructure', 'Data & AI'],
    },
    overview: [
      "Microsoft's interview culture is tied to the 'growth mindset' philosophy CEO Satya Nadella has championed since 2014 — the idea that ability develops through effort and learning, not fixed talent. Candidates are evaluated as much on how they approach an unfamiliar problem as on whether they reach the 'right' answer, with a strong emphasis on collaborative problem-solving: interviewers want to see you think out loud, ask clarifying questions, and build on feedback in real time.",
      "Expect a mix of technical depth (especially for engineering roles) and genuinely open-ended discussion questions with no single correct answer, designed to surface how you reason under ambiguity.",
    ],
    interviewProcess: [
      { stage: 'Application', desc: 'Matched to specific teams and roles — Microsoft hires into named teams more often than generic pools.' },
      { stage: 'Recruiter Screen', desc: 'An initial call covering background, motivation, and role fit.' },
      { stage: 'Technical / Functional', desc: 'Coding, system design, or role-specific problem-solving, with real-time collaboration expected.' },
      { stage: 'Behavioral', desc: "Growth-mindset and collaboration questions — how you've learned from setbacks and worked through disagreement." },
      { stage: 'Hiring Manager', desc: 'A conversation with the actual team lead about role scope and mutual fit.' },
      { stage: 'Offer', desc: 'Feedback from the full loop is reviewed together before a decision is made.' },
    ],
    competencies: [
      { name: 'Growth Mindset', desc: 'Treating challenges as opportunities to learn rather than threats to your competence.' },
      { name: 'Collaboration', desc: 'Building on others\' ideas and communicating clearly across disciplines and teams.' },
      { name: 'Customer Focus', desc: 'Grounding technical or product decisions in real customer impact, not just internal elegance.' },
      { name: 'Problem Solving', desc: 'Breaking down ambiguous or unfamiliar problems into a structured approach.' },
      { name: 'Leadership', desc: 'Influencing outcomes and people even without formal authority over them.' },
    ],
    questions: [
      "Tell me about a time you had to learn something completely new to solve a problem.",
      "Describe a situation where you worked with a team member who saw a problem very differently than you did.",
      "Tell me about a time your initial approach to a problem was wrong. How did you course-correct?",
      "Describe how you've handled a highly ambiguous project with no clear requirements.",
      "Tell me about a time you gave or received difficult feedback. How did it change the outcome?",
      "Describe a technical decision you made that balanced customer needs against engineering constraints.",
      "Tell me about a time you influenced a decision without having formal authority.",
      "Describe a project where collaboration across teams was essential to success.",
    ],
    tips: [
      { title: 'Preparation', desc: 'Research the specific team you\'re interviewing with — questions are often tailored to that group\'s current focus.' },
      { title: 'Behavior', desc: 'Show your reasoning process, not just conclusions. Microsoft evaluates how you think, especially under ambiguity.' },
      { title: 'Communication', desc: 'Ask clarifying questions before diving into an answer — jumping straight to a solution can read as not listening.' },
      { title: 'STAR', desc: 'Use STAR structure, but lean into the "what I learned" element — growth-mindset framing genuinely matters here.' },
      { title: 'Mistakes', desc: 'A well-told story about a real mistake often lands better than a polished success story.' },
    ],
    howMedhaiqHelps: [
      'Practice ambiguous, open-ended discussion questions with adaptive follow-ups, not just scripted Q&A.',
      'Get feedback on how well you demonstrate growth-mindset framing versus reciting outcomes.',
      'Receive a report scoring collaboration and communication alongside technical depth.',
    ],
    relatedRoles: ['Software Engineer', 'Program Manager', 'Cloud Engineer', 'Data Scientist'],
    officialResources: [
      { title: 'Microsoft Careers', url: 'https://careers.microsoft.com/' },
      { title: 'Microsoft Culture', url: 'https://careers.microsoft.com/v2/global/en/culture' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // GOOGLE
  // ─────────────────────────────────────────────────────────────────
  {
    id: 3,
    slug: 'google',
    name: 'Google',
    logo: 'G',
    category: 'Big Tech · Technology',
    tagline: 'Problem solving, product thinking, and technical depth.',
    seo: {
      title: 'Google Interview Preparation Guide | MedhaIQ',
      description: 'Prepare for Google interviews with a guide to their four core hiring attributes, interview process, common questions, and preparation strategy — plus AI-powered mock interviews.',
    },
    hero: {
      headline: 'Google Interview Preparation',
      description: 'Master Google interviews through competency-based AI interview practice and personalized feedback.',
    },
    snapshot: {
      industry: 'Internet Services, Cloud Computing, Consumer Technology',
      headquarters: 'Mountain View, California, USA',
      globalPresence: 'Offices in 60+ countries',
      popularFunctions: ['Software Engineering', 'Product Management', 'Data Science', 'UX & Design'],
    },
    overview: [
      "Google evaluates candidates against four core attributes: general cognitive ability, role-related knowledge, leadership, and 'Googleyness' — its own term for cultural and collaborative fit. In practice, this means significant weight on how you approach a problem you've never seen before, not whether you already know the answer. Interviewers focus more on your reasoning process and how you handle being stuck than on reaching a 'correct' answer quickly.",
      "Expect structured, often multi-part problems in technical rounds, and open, collaborative discussion in behavioral rounds — Google's style rewards curiosity and intellectual honesty over confident-sounding guesses.",
    ],
    interviewProcess: [
      { stage: 'Application', desc: 'Reviewed against the specific role — Google\'s process is known for being thorough rather than fast.' },
      { stage: 'Recruiter Screen', desc: 'An introductory call to align on role, team, and process expectations.' },
      { stage: 'Technical / Functional', desc: 'Structured problem-solving — coding and systems thinking for technical roles, case reasoning for others.' },
      { stage: 'Behavioral', desc: 'Questions probing collaboration, leadership without authority, and how you\'ve handled ambiguity or failure.' },
      { stage: 'Hiring Manager', desc: 'A conversation focused on team fit and how your strengths map to the role\'s needs.' },
      { stage: 'Offer', desc: 'Feedback across the loop is reviewed by a hiring committee, a step separate from the interviewers themselves.' },
    ],
    competencies: [
      { name: 'Problem Solving', desc: 'Breaking down unfamiliar problems methodically rather than pattern-matching to memorized solutions.' },
      { name: 'Googleyness & Collaboration', desc: 'Working well with ambiguity, respecting differing viewpoints, and contributing to a healthy team culture.' },
      { name: 'Role-Related Knowledge', desc: 'The specific technical or domain depth the role actually requires — genuinely necessary, not just impressive.' },
      { name: 'Leadership', desc: 'Stepping up to influence outcomes in the moment, regardless of formal title.' },
      { name: 'Communication', desc: 'Explaining reasoning clearly enough that someone outside your immediate specialty could follow it.' },
    ],
    questions: [
      "Walk me through how you'd approach a problem you've never encountered before.",
      "Tell me about a time you had to make a decision without all the information you wanted.",
      "Describe a situation where you disagreed with a teammate's approach. How did you handle it?",
      "Tell me about a time you took initiative on something outside your formal responsibilities.",
      "Describe how you'd explain a complex technical concept to someone non-technical.",
      "Tell me about a project that didn't go as planned. What would you do differently?",
      "Describe a time you had to balance competing priorities with limited time.",
      "Tell me about a time you received critical feedback. How did you respond?",
    ],
    tips: [
      { title: 'Preparation', desc: 'Practice thinking out loud — Google weighs your reasoning process as heavily as your final answer.' },
      { title: 'Behavior', desc: 'Ask clarifying questions rather than assuming — jumping to an answer too fast can read as overconfidence.' },
      { title: 'Communication', desc: 'Structure complex answers clearly; Google values the ability to make a hard problem sound simple.' },
      { title: 'STAR', desc: 'Use STAR for behavioral answers, but be ready for genuine follow-up probing into the "why" behind decisions.' },
      { title: 'Mistakes', desc: 'Don\'t treat "I don\'t know" as failure — showing how you\'d find out is often more valuable than a confident wrong answer.' },
    ],
    howMedhaiqHelps: [
      'Practice structured, multi-part problem-solving with adaptive follow-ups that mirror Google\'s reasoning-focused style.',
      'Get feedback specifically on clarity of explanation, not just correctness.',
      'Receive a report scoring problem-solving process alongside communication and role-related depth.',
    ],
    relatedRoles: ['Software Engineer', 'Product Manager', 'Data Scientist', 'UX Designer'],
    officialResources: [
      { title: 'Google Careers', url: 'https://www.google.com/about/careers/applications/' },
      { title: 'How Google Hires', url: 'https://www.google.com/about/careers/applications/how-we-hire' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // SALESFORCE
  // ─────────────────────────────────────────────────────────────────
  {
    id: 4,
    slug: 'salesforce',
    name: 'Salesforce',
    logo: 'S',
    category: 'Enterprise SaaS',
    tagline: 'Enterprise SaaS, customer success, and innovation.',
    seo: {
      title: 'Salesforce Interview Preparation Guide | MedhaIQ',
      description: 'Prepare for Salesforce interviews with a guide to their core values, interview process, common questions, and preparation strategy — plus AI-powered mock interviews.',
    },
    hero: {
      headline: 'Salesforce Interview Preparation',
      description: 'Master Salesforce interviews through competency-based AI interview practice and personalized feedback.',
    },
    snapshot: {
      industry: 'Enterprise SaaS, Customer Relationship Management (CRM)',
      headquarters: 'San Francisco, California, USA',
      globalPresence: 'Offices across North America, Europe, and Asia-Pacific',
      popularFunctions: ['Sales Engineering', 'Software Engineering', 'Customer Success', 'Product Management'],
    },
    overview: [
      "Salesforce has built its culture around four stated core values: Trust, Customer Success, Innovation, and Equality. As the company that popularized the enterprise SaaS model, its interviews weight customer-centric thinking more heavily than pure technical depth — even for engineering roles. 'Customer success' runs through nearly every question, technical or behavioral; interviewers listen for whether you naturally frame decisions in terms of customer outcomes.",
      "Candidates should expect a genuinely values-driven conversation — interviewers probe not just what you did, but whether your approach reflects trust and integrity in how you worked with others to get there.",
    ],
    interviewProcess: [
      { stage: 'Application', desc: 'Reviewed against the specific business unit — Salesforce\'s org spans many distinct product clouds.' },
      { stage: 'Recruiter Screen', desc: 'An introductory call covering background and alignment with Salesforce\'s stated values.' },
      { stage: 'Technical / Functional', desc: 'Technical rounds for engineering; solution-design exercises for sales engineering and consulting roles.' },
      { stage: 'Behavioral', desc: 'Values-driven questions probing trust, customer focus, and how you\'ve handled conflict.' },
      { stage: 'Hiring Manager', desc: 'A conversation focused on team fit and how your experience maps to the product area.' },
      { stage: 'Offer', desc: 'Feedback from the loop is consolidated, with customer-success framing often a deciding factor.' },
    ],
    competencies: [
      { name: 'Customer Success Focus', desc: 'Framing decisions around customer outcomes, not just internal metrics or convenience.' },
      { name: 'Trust & Integrity', desc: 'Being transparent about tradeoffs and constraints rather than overpromising.' },
      { name: 'Innovation', desc: 'Proposing genuinely new approaches, not just incremental improvements to existing processes.' },
      { name: 'Collaboration', desc: 'Working effectively across sales, product, and engineering, which are unusually interconnected at Salesforce.' },
      { name: 'Adaptability', desc: 'Adjusting quickly as priorities shift — common in a fast-moving enterprise SaaS environment.' },
    ],
    questions: [
      "Tell me about a time you prioritized a customer's long-term success over a short-term win.",
      "Describe a situation where you had to rebuild trust after a mistake or missed commitment.",
      "Tell me about the most innovative solution you've proposed to a recurring problem.",
      "Describe a time you had to collaborate across teams with very different priorities.",
      "Tell me about a time priorities shifted suddenly. How did you adapt?",
      "Describe how you've handled a customer or stakeholder who was unhappy with an outcome.",
      "Tell me about a time you had to say no to a request in order to do the right thing.",
      "Describe a project where you had to balance innovation against reliability.",
    ],
    tips: [
      { title: 'Preparation', desc: 'Know Salesforce\'s four core values and be ready to connect your stories to them explicitly.' },
      { title: 'Behavior', desc: 'Frame decisions in terms of customer impact wherever genuinely true — a consistent thread interviewers listen for.' },
      { title: 'Communication', desc: 'Be direct about tradeoffs rather than glossing over them; transparency matters more than polish here.' },
      { title: 'STAR', desc: 'Use STAR, and make sure the "Result" ties back to a customer or business outcome, not just task completion.' },
      { title: 'Mistakes', desc: 'Avoid answers that focus purely on internal process with no visible customer connection.' },
    ],
    howMedhaiqHelps: [
      'Practice values-driven behavioral questions calibrated to Salesforce\'s specific culture, not generic prompts.',
      'Get feedback on whether your answers connect to customer outcomes, a pattern interviewers specifically listen for.',
      'Receive a report scoring customer focus and collaboration alongside role-specific competence.',
    ],
    relatedRoles: ['Sales Engineer', 'Software Engineer', 'Product Manager', 'Customer Success Manager'],
    officialResources: [
      { title: 'Salesforce Careers', url: 'https://careers.salesforce.com/en/' },
      { title: 'Salesforce Core Values', url: 'https://trailhead.salesforce.com/content/learn/modules/salesforce-culture-and-values/explore-salesforce-culture-and-values' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────
  // DELOITTE
  // ─────────────────────────────────────────────────────────────────
  {
    id: 5,
    slug: 'deloitte',
    name: 'Deloitte',
    logo: 'D',
    category: 'Professional Services · Consulting',
    tagline: 'Consulting, leadership, and business impact.',
    seo: {
      title: 'Deloitte Interview Preparation Guide | MedhaIQ',
      description: 'Prepare for Deloitte interviews with a guide to their consulting-style case interviews, common questions, and preparation strategy — plus AI-powered mock interviews.',
    },
    hero: {
      headline: 'Deloitte Interview Preparation',
      description: 'Master Deloitte interviews through competency-based AI interview practice and personalized feedback.',
    },
    snapshot: {
      industry: 'Professional Services — Consulting, Audit, Tax, Advisory',
      headquarters: 'London, UK (global network); New York, USA (US member firm)',
      globalPresence: 'Member firms operating in 150+ countries',
      popularFunctions: ['Strategy Consulting', 'Technology Consulting', 'Audit & Assurance', 'Risk Advisory'],
    },
    overview: [
      "As one of the 'Big Four' professional services networks, Deloitte's interview process shares the case-interview tradition common across major consulting firms — structured business problems used to evaluate analytical reasoning in real time. What distinguishes Deloitte is an equal emphasis on client-facing communication: because consultants represent the firm in front of clients early in their careers, interviewers evaluate executive presence and clarity of thought as much as the correctness of an analysis.",
      "Expect a mix of case-based problem-solving and behavioral questions on leadership and teamwork — process varies somewhat by practice area (Strategy, Technology, Audit), so confirm which track you're interviewing for.",
    ],
    interviewProcess: [
      { stage: 'Application', desc: 'Reviewed by practice area — Strategy, Technology, Audit, and Risk each have distinct hiring tracks.' },
      { stage: 'Recruiter Screen', desc: 'An introductory call confirming background and practice-area interest.' },
      { stage: 'Technical / Functional', desc: 'Case interviews — structured business problems requiring you to reason through ambiguity out loud.' },
      { stage: 'Behavioral', desc: 'Questions on leadership, teamwork, and how you\'ve handled client or stakeholder pressure.' },
      { stage: 'Hiring Manager', desc: 'A conversation with a partner or senior manager focused on practice fit and trajectory.' },
      { stage: 'Offer', desc: 'Feedback from case and behavioral rounds is reviewed together, with case performance weighted most heavily.' },
    ],
    competencies: [
      { name: 'Analytical Problem Solving', desc: 'Structuring ambiguous business problems logically, out loud, under time pressure.' },
      { name: 'Client Focus', desc: 'Framing recommendations in terms of practical client impact, not just theoretical correctness.' },
      { name: 'Leadership Potential', desc: 'Showing the early signs of someone who can eventually lead a client engagement, not just contribute to one.' },
      { name: 'Executive Presence', desc: 'Communicating with the clarity and composure expected in front of senior client stakeholders.' },
      { name: 'Teamwork', desc: 'Collaborating effectively on engagement teams that often assemble quickly around a new project.' },
    ],
    questions: [
      "Walk me through how you'd approach a client whose revenue is declining despite growing market share.",
      "Tell me about a time you had to lead a project without formal authority over the team.",
      "Describe a situation where you had to deliver difficult news to a client or stakeholder.",
      "Tell me about a time you had to quickly get up to speed in an unfamiliar domain.",
      "Describe how you'd structure your approach to a problem with very little available data.",
      "Tell me about a time you disagreed with a team's direction. How did you handle it?",
      "Tell me about a time you had to present a complex recommendation to a senior audience.",
    ],
    tips: [
      { title: 'Preparation', desc: 'Practice structuring case problems out loud — structure matters as much as the final answer.' },
      { title: 'Behavior', desc: 'Treat the interviewer like a client in the case portion — ask clarifying questions and check your framing.' },
      { title: 'Communication', desc: 'Lead with your conclusion, then walk through supporting logic — consulting favors "answer-first" communication.' },
      { title: 'STAR', desc: 'For behavioral questions, use STAR and keep results quantified and business-outcome focused.' },
      { title: 'Mistakes', desc: 'Avoid diving into calculations before structuring the problem — framing is weighted heavily here.' },
    ],
    howMedhaiqHelps: [
      'Practice case-style structured problem-solving with adaptive follow-ups, not just fixed scripts.',
      'Get feedback on answer-first communication clarity, a consulting-specific skill most candidates haven\'t practiced.',
      'Receive a report scoring structured reasoning and executive presence alongside behavioral competence.',
    ],
    relatedRoles: ['Strategy Consultant', 'Technology Consultant', 'Business Analyst', 'Risk Advisory Associate'],
    officialResources: [
      { title: 'Deloitte Careers', url: 'https://www.deloitte.com/us/en/careers/careers.html' },
      { title: 'Life at Deloitte', url: 'https://www.deloitte.com/us/en/careers/life-at-deloitte.html' },
    ],
  },
];

// "Coming Soon" strip on the Company Library landing page — signals the
// library is actively expanding. Names only; no per-company pages exist
// for these yet, so this array intentionally has no slugs/links.
const comingSoonCompanies = ['Accenture', 'NVIDIA', 'Oracle', 'ServiceNow', 'TCS', 'Infosys'];

// Curated Companies — drives the simplified /explore/company-library
// landing page grid (recognition + selection only: name + one short
// interview identifier, no descriptions). Deliberately decoupled from
// companyLibrary above: adding a new company to this landing grid means
// adding one object here, whether or not its full guide exists yet.
// `hasGuide: false` renders the card in a muted, non-clickable "Guide
// coming soon" state instead of linking to a page that doesn't exist —
// this is how Meta, Apple, and Stripe are handled today. Once a full
// guide is written for one of them (added to companyLibrary above with
// a matching slug), flip its hasGuide to true and it becomes clickable.
// The logo tile is rendered as the first two letters of `name` in the
// view — no per-entry logo field needed, so adding NVIDIA or Netflix
// later really is just one object, per the architecture goal.
const curatedCompanies = [
  { slug: 'amazon',    name: 'Amazon',    identifier: 'Leadership Principles', hasGuide: true },
  { slug: 'microsoft', name: 'Microsoft', identifier: 'Growth Mindset',        hasGuide: true },
  { slug: 'google',    name: 'Google',    identifier: 'Googleyness',          hasGuide: true },
  { slug: 'salesforce',name: 'Salesforce',identifier: 'Ohana Culture',        hasGuide: true },
  { slug: 'deloitte',  name: 'Deloitte',  identifier: 'Case + Behavioral',    hasGuide: true },
  // Disabled "Coming Soon" cards per this round's direction — no guides
  // written yet, kept visible so the library reads as actively growing.
  // Identifiers picked to avoid reusing Amazon's own branded principle
  // names (e.g. "Ownership", "Customer Obsession") verbatim on an
  // unrelated company's card.
  { slug: 'meta',      name: 'Meta',      identifier: 'Move Fast',            hasGuide: false },
  { slug: 'apple',     name: 'Apple',     identifier: 'Craftsmanship',        hasGuide: false },
  { slug: 'stripe',    name: 'Stripe',    identifier: 'High Standards',       hasGuide: false },
];

module.exports = { companyLibrary, comingSoonCompanies, curatedCompanies };
