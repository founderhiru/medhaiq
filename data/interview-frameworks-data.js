// Interview Frameworks — structured data, mirrors role-library-data.js.
// frameworks holds the 6 launch-ready guides. The landing page renders
// all of them as one flat, curated grid — no categories, no featured/
// popular sorting. Adding a 7th framework later = adding one more object
// to this array — no template changes required.
//
// Each framework defines its OWN breakdown sequence (breakdown[]) rather
// than a forced universal template — STAR's 4 steps look nothing like
// System Design's 6 steps, and that's intentional (per Final V1 spec).

const frameworks = [
  // ─────────────────────────────────────────────────────────────
  // STAR METHOD
  // ─────────────────────────────────────────────────────────────
  {
    id: 1,
    slug: 'star-method',
    title: 'STAR Method',
    oneLiner: 'Structure behavioural answers with clear evidence and measurable impact.',
    ctaCopy: 'Apply the STAR Method in a realistic interview and receive personalized AI feedback.',
    seo: {
      title: 'STAR Method Interview Framework | MedhaIQ',
      description: 'Learn the STAR method for behavioural interviews — structure, worked example, common mistakes, and preparation checklist.',
    },
    hero: { subheadline: 'Behavioural · Structure · Evidence' },
    overview: 'STAR (Situation, Task, Action, Result) is a structure for answering behavioural questions with a clear beginning, a specific action you took, and a measurable outcome. It matters because interviewers aren\'t just listening for what happened — they\'re evaluating whether you can communicate your own role and impact clearly under pressure.',
    whenToUse: [
      'Behavioural interviews',
      'Leadership questions',
      'Conflict resolution questions',
      'Ownership questions',
      'Achievement stories',
    ],
    breakdown: [
      { stage: 'Situation', desc: 'Set the scene briefly — enough context to understand the stakes, not a full backstory.' },
      { stage: 'Task', desc: 'State what you specifically were responsible for, not what the team was responsible for.' },
      { stage: 'Action', desc: 'Describe the concrete steps you took — this is the longest, most detailed part of the answer.' },
      { stage: 'Result', desc: 'Close with a measurable outcome and, ideally, what you learned or would do differently.' },
    ],
    workedExample: 'Situation: "Our checkout page had a 40% drop-off rate and leadership wanted it fixed before Q4." Task: "As the lead engineer, I owned diagnosing the cause and shipping a fix within three weeks." Action: "I instrumented the funnel to isolate where users dropped off, found a slow third-party script blocking render, and led a two-person team to lazy-load it and cache the response." Result: "Drop-off fell to 22% within a week of shipping, and the pattern we built became the standard for two other pages."',
    commonMistakes: [
      'Too much background — spending most of the answer on Situation instead of Action',
      'Missing measurable results — ending on what happened instead of the impact',
      'Weak ownership — describing what "we" did instead of what you specifically did',
      'Generic storytelling — an answer so smoothed-over it reveals no real judgment or trade-off',
    ],
    checklist: [
      'Prepare three STAR stories covering different competencies',
      'Include measurable outcomes in every story',
      'Keep each answer under two minutes',
      'Practise saying it aloud, not just writing it down',
    ],
    resources: [
      { name: 'Harvard Career Services — Interviewing', url: 'https://careerservices.fas.harvard.edu/resources/interviewing/' },
      { name: 'MIT Career Advising — Interview Prep', url: 'https://capd.mit.edu/interviewing/' },
      { name: 'Toastmasters International', url: 'https://www.toastmasters.org/' },
    ],
    relatedRoles: ['product-manager', 'engineering-manager', 'management-consultant'],
  },

  // ─────────────────────────────────────────────────────────────
  // TELL ME ABOUT YOURSELF
  // ─────────────────────────────────────────────────────────────
  {
    id: 2,
    slug: 'tell-me-about-yourself',
    title: 'Tell Me About Yourself',
    oneLiner: 'Open every interview with a concise, confident narrative.',
    ctaCopy: 'Practice your opening narrative in a realistic interview and receive personalized AI feedback.',
    seo: {
      title: 'Tell Me About Yourself Framework | MedhaIQ',
      description: 'A structure for answering "tell me about yourself" — present, transition, and connect to the role, with a worked example and common mistakes.',
    },
    hero: { subheadline: 'Opening · Narrative · First Impression' },
    overview: 'This is almost always the first question in an interview, and it sets the tone for everything after it. It isn\'t a request for your full resume — it\'s a request for a short, deliberate narrative that gives the interviewer a reason to keep listening.',
    whenToUse: [
      'The opening of nearly every interview',
      'Recruiter screens',
      'Panel interview introductions',
      'Networking conversations that turn into pitches',
    ],
    breakdown: [
      { stage: 'Present', desc: 'Start with where you are now — your current role and what you\'re known for doing well.' },
      { stage: 'Transition', desc: 'Briefly connect the path that got you here — one or two moves, not a full career history.' },
      { stage: 'Why This Role', desc: 'End by connecting your trajectory directly to why this specific role is the logical next step.' },
    ],
    workedExample: '"Right now I lead a team of six engineers building the payments platform at my company, where we\'ve cut transaction failures by half over the last year. Before that, I spent four years as an individual contributor working on distributed systems, which is where I first got interested in the reliability problems payments teams deal with every day. I\'m looking at this role because it\'s squarely at the intersection of scale and reliability, and it\'s a step up in scope from what I\'m doing now."',
    commonMistakes: [
      'Reciting your resume chronologically from your first job onward',
      'Rambling without a clear throughline connecting the pieces',
      'Never connecting the answer back to why you want this specific role',
      'Oversharing personal details unrelated to your professional narrative',
    ],
    checklist: [
      'Prepare a 60–90 second answer, timed',
      'Tie your background directly to the role you\'re interviewing for',
      'Practise the transition so it doesn\'t sound like a list',
      'End with a clear, specific "why this role" statement',
    ],
    resources: [
      { name: 'Harvard Career Services — Interviewing', url: 'https://careerservices.fas.harvard.edu/resources/interviewing/' },
      { name: 'Stanford Career Education', url: 'https://careereducation.stanford.edu/' },
      { name: 'Toastmasters International', url: 'https://www.toastmasters.org/' },
    ],
    relatedRoles: ['product-manager', 'software-engineer', 'solutions-architect'],
  },

  // ─────────────────────────────────────────────────────────────
  // BEHAVIOURAL INTERVIEWS
  // ─────────────────────────────────────────────────────────────
  {
    id: 3,
    slug: 'behavioural-interviews',
    title: 'Behavioural Interviews',
    oneLiner: 'Answer any behavioural question with structure, evidence, and reflection.',
    ctaCopy: 'Apply this approach in a realistic behavioural interview and receive personalized AI feedback.',
    seo: {
      title: 'Behavioural Interview Framework | MedhaIQ',
      description: 'A general-purpose approach to behavioural interview questions — listening, structuring, evidencing, and reflecting.',
    },
    hero: { subheadline: 'Behavioural · Listening · Reflection' },
    overview: 'Behavioural questions ask you to prove a competency through a real past example, not a hypothetical. The skill being tested is often less about the story itself and more about whether you can listen precisely to what\'s being asked, structure your answer under pressure, and reflect honestly on the outcome.',
    whenToUse: [
      'General behavioural interview rounds',
      'Culture-fit interviews',
      'Competency-based interviews',
      'Any question starting with "Tell me about a time..."',
    ],
    breakdown: [
      { stage: 'Listen Carefully', desc: 'Identify exactly which competency is being probed before you start answering.' },
      { stage: 'Structure the Response', desc: 'Use a clear structure (like STAR) rather than answering in a free-associative way.' },
      { stage: 'Support with Evidence', desc: 'Back up claims with specifics — numbers, timelines, direct quotes from feedback.' },
      { stage: 'Reflect on Learning', desc: 'Close by naming what you learned or would do differently — this is what separates a strong answer from a merely complete one.' },
    ],
    workedExample: '"When you asked about a time I handled conflict, I picked a disagreement with a peer engineer over an API design. Rather than trying to convince them in the meeting, I asked them to write up their reasoning and I did the same, then we compared trade-offs with our manager as a tiebreaker. Their approach won on two of three criteria, and we shipped it — six months later, it turned out to be the right call when we needed to extend the API to a third client. I learned that separating the disagreement from the relationship matters more than being right in the room."',
    commonMistakes: [
      'Answering before fully understanding which competency is being tested',
      'Rambling without a structure the interviewer can follow',
      'Making claims with no supporting evidence or specifics',
      'Skipping the reflection — ending on the outcome with no learning stated',
    ],
    checklist: [
      'Map your stories to common competencies (conflict, ownership, failure, influence)',
      'Practise pausing for two seconds before answering to organize your structure',
      'Add one concrete number or detail to every story',
      'Always end with a stated reflection or learning',
    ],
    resources: [
      { name: 'Harvard Career Services — Interviewing', url: 'https://careerservices.fas.harvard.edu/resources/interviewing/' },
      { name: 'University of Michigan Career Center', url: 'https://careercenter.umich.edu/' },
      { name: 'Toastmasters International', url: 'https://www.toastmasters.org/' },
    ],
    relatedRoles: ['engineering-manager', 'product-manager', 'management-consultant'],
  },

  // ─────────────────────────────────────────────────────────────
  // SYSTEM DESIGN
  // ─────────────────────────────────────────────────────────────
  {
    id: 4,
    slug: 'system-design',
    title: 'System Design',
    oneLiner: 'Build structured, scalable technical solutions with confidence.',
    ctaCopy: 'Apply this framework in a realistic system design interview and receive personalized AI feedback.',
    seo: {
      title: 'System Design Interview Framework | MedhaIQ',
      description: 'A structure for system design interviews — clarifying requirements, constraints, high-level design, deep dives, and trade-offs.',
    },
    hero: { subheadline: 'Technical · Architecture · Trade-offs' },
    overview: 'System design interviews evaluate how you reason about ambiguous, large-scale technical problems — not whether you land on one "correct" architecture. The strongest candidates work through the problem in a visible, structured order rather than jumping straight to a diagram.',
    whenToUse: [
      'Senior and staff engineering interviews',
      'Architecture and infrastructure rounds',
      'Solutions architect client-scenario interviews',
      'Any open-ended "design a system that..." prompt',
    ],
    breakdown: [
      { stage: 'Clarify Requirements', desc: 'Ask what the system actually needs to do and for whom, before proposing anything.' },
      { stage: 'Define Constraints', desc: 'Establish scale, latency, consistency, and cost constraints explicitly.' },
      { stage: 'High-Level Design', desc: 'Sketch the major components and how data flows between them at a coarse level.' },
      { stage: 'Deep Dive', desc: 'Go deep on the one or two components the interviewer cares most about.' },
      { stage: 'Trade-offs', desc: 'Name the alternatives you didn\'t choose and why, showing you understand the cost of your decision.' },
      { stage: 'Scale & Optimize', desc: 'Discuss how the design evolves under 10x or 100x load, and where it would break first.' },
    ],
    workedExample: '"For a URL shortener at scale, I\'d first clarify: how many writes per second, do we need analytics, how long do links live? Given 10,000 writes/second and a read-heavy pattern, I\'d propose a base62-encoded counter for ID generation behind a write-through cache, with reads served from a CDN-fronted key-value store. The deep dive would be on avoiding ID collisions across multiple writer nodes — I\'d use a distributed counter service rather than random generation to avoid collision-retry overhead. The trade-off is added write latency for that lookup, which I\'d accept because reads outnumber writes roughly 100 to 1 here."',
    commonMistakes: [
      'Jumping straight to a solution before clarifying requirements',
      'Ignoring explicit scale numbers and designing for an unstated assumption',
      'Presenting one design with no discussion of alternatives or trade-offs',
      'Over-engineering the initial design instead of starting simple and scaling deliberately',
    ],
    checklist: [
      'Always start by asking 3–5 clarifying questions',
      'State your assumptions about scale out loud before designing',
      'Practise narrating trade-offs, not just the final design',
      'Time-box the deep dive so you don\'t run out of time on trade-offs',
    ],
    resources: [
      { name: 'AWS Architecture Center', url: 'https://aws.amazon.com/architecture/' },
      { name: 'Google Cloud Architecture Center', url: 'https://cloud.google.com/architecture' },
      { name: "Martin Fowler's Blog", url: 'https://martinfowler.com/' },
    ],
    relatedRoles: ['software-engineer', 'solutions-architect'],
  },

  // ─────────────────────────────────────────────────────────────
  // PRODUCT SENSE
  // ─────────────────────────────────────────────────────────────
  {
    id: 5,
    slug: 'product-sense',
    title: 'Product Sense',
    oneLiner: 'Learn how product companies evaluate customer thinking and prioritization.',
    ctaCopy: 'Apply this approach in a realistic product sense interview and receive personalized AI feedback.',
    seo: {
      title: 'Product Sense Interview Framework | MedhaIQ',
      description: 'A structure for product sense interviews — understanding the user, defining the problem, generating solutions, and prioritizing.',
    },
    hero: { subheadline: 'Product · Customer Thinking · Prioritization' },
    overview: 'Product sense questions ask you to design or improve a product on the spot. Interviewers are evaluating whether your thinking starts from a real customer problem, not whether you land on a clever feature — a well-reasoned, ordinary idea beats a clever idea with no grounding.',
    whenToUse: [
      'Product manager interviews',
      'Product design rounds',
      'Customer-obsession or "improve this product" questions',
      'Case-style product questions in general management interviews',
    ],
    breakdown: [
      { stage: 'Understand the User', desc: 'Pick a specific user segment and describe their context before discussing any problem.' },
      { stage: 'Define the Problem', desc: 'State the actual problem in one sentence — not a feature, a problem.' },
      { stage: 'Generate Solutions', desc: 'Propose two or three directions rather than committing to the first idea.' },
      { stage: 'Prioritize', desc: 'Pick one direction and justify the choice against the others using explicit criteria.' },
      { stage: 'Measure Success', desc: 'Name the metric that would tell you the solution actually worked.' },
    ],
    workedExample: '"Asked to improve a food delivery app: I\'d focus on a specific user — someone ordering for a group at work — because their problem (splitting an order across many individual preferences) is distinct from a solo diner\'s. The actual problem is coordination overhead, not menu discovery. I\'d consider a shared group-cart link versus a pre-set office-order template, and prioritize the shared cart because it solves the coordination problem directly with less new UI. Success would be measured by group orders per week and time-to-checkout for group carts versus solo ones."',
    commonMistakes: [
      'Jumping to a feature idea before understanding any specific user',
      'Solving a made-up problem instead of stating the real one clearly',
      'Presenting only one idea with no comparison or prioritization logic',
      'Ending without naming a metric that would prove the solution worked',
    ],
    checklist: [
      'Practise picking a specific user segment before brainstorming solutions',
      'Force yourself to state the problem in one sentence before solving it',
      'Always generate at least two solution directions',
      'End every practice answer with a named success metric',
    ],
    resources: [
      { name: 'Silicon Valley Product Group (SVPG)', url: 'https://www.svpg.com/articles/' },
      { name: "Lenny's Newsletter", url: 'https://www.lennysnewsletter.com/' },
      { name: 'Product School', url: 'https://productschool.com/blog' },
    ],
    relatedRoles: ['product-manager'],
  },

  // ─────────────────────────────────────────────────────────────
  // LEADERSHIP STORIES
  // ─────────────────────────────────────────────────────────────
  {
    id: 6,
    slug: 'leadership-stories',
    title: 'Leadership Stories',
    oneLiner: 'Tell leadership stories that demonstrate real ownership and impact.',
    ctaCopy: 'Apply this storytelling approach in a realistic interview and receive personalized AI feedback.',
    seo: {
      title: 'Leadership Stories Interview Framework | MedhaIQ',
      description: 'A structure for leadership and management interview stories — context, challenge, decision, outcome, and reflection.',
    },
    hero: { subheadline: 'Leadership · Ownership · Judgment' },
    overview: 'Leadership stories are evaluated on judgment, not job title. Interviewers want to see a real decision made under real constraints — including the parts that didn\'t go perfectly — because that\'s what reveals how you\'ll actually lead when it matters.',
    whenToUse: [
      'Leadership-principle interviews',
      'People management interview rounds',
      'Executive and director-level interviews',
      'Questions about difficult decisions or accountability',
    ],
    breakdown: [
      { stage: 'Context', desc: 'Set up the team, stakes, and constraints you were operating under.' },
      { stage: 'Challenge', desc: 'State the specific difficulty or tension you had to resolve.' },
      { stage: 'Decision', desc: 'Explain the decision you made and, critically, why you made it over the alternatives.' },
      { stage: 'Outcome', desc: 'Share what happened, including any part that didn\'t go as planned.' },
      { stage: 'Reflection', desc: 'Name what you\'d do differently or what it taught you about leading people.' },
    ],
    workedExample: '"My team was six weeks from a launch when I learned one engineer\'s work had a fundamental design flaw that would need a full rewrite. The challenge was: rewrite and likely miss the date, or ship with a workaround and take on technical debt. I chose to delay two weeks and rewrite, because the workaround would have made the next two quarters of roadmap much harder to build on. We missed the original date, which was a difficult conversation with leadership, but the rewrite let us ship three subsequent features faster than planned. Looking back, I\'d have surfaced the risk to leadership a week earlier instead of trying to solve it quietly first."',
    commonMistakes: [
      'Choosing a story with no real challenge or tension in it',
      'Describing the decision without explaining why it beat the alternatives',
      'Only sharing outcomes that went well, with nothing that didn\'t',
      'Skipping the reflection, so the story shows an event but not growth',
    ],
    checklist: [
      'Choose stories with a genuine trade-off, not an easy call',
      'Practise explaining why, not just what, you decided',
      'Include at least one story where the outcome was imperfect',
      'End every story with a specific, honest reflection',
    ],
    resources: [
      { name: "Will Larson's Irrational Exuberance", url: 'https://lethain.com/' },
      { name: "The Manager's Path (O'Reilly)", url: 'https://www.oreilly.com/library/view/the-managers-path/9781491973882/' },
      { name: 'Harvard Business Review', url: 'https://hbr.org/' },
    ],
    relatedRoles: ['engineering-manager', 'technical-program-manager'],
  },
];

module.exports = { frameworks };
