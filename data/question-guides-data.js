// data/question-guides-data.js
// Interview Questions library — one object per guide. Adding a 6th guide =
// adding one object here; routes/guides.js, views/question-guide.ejs and the
// sitemap (routes/seo.js) all read from this file, so no other change is needed.
//
// Content is original MedhaIQ practice material. It is NOT an official list
// from any company, and makes no claim about any company's actual process
// beyond what the company itself publishes.

const guides = [
  {
    slug: 'amazon-leadership-principles',
    title: 'Amazon Leadership Principles Interview Questions',
    eyebrow: 'Company interview prep',
    seo: {
      title: 'Amazon Leadership Principles Interview Questions | MedhaIQ',
      description: 'Practice Amazon Leadership Principles interview questions: what each tests, how to structure STAR answers, and the mistakes to avoid.',
    },
    intro: 'Amazon publishes its Leadership Principles, and its interviewers commonly build behavioral questions around them. Every answer should be a specific story from your own work, told with the STAR method: Situation, Task, Action and Result. Below are ten practice questions, what each one is really testing, and how to approach your answer. These are practice questions written by MedhaIQ, not an official Amazon list, and MedhaIQ is not affiliated with or endorsed by Amazon.',
    focus: ['Customer Obsession', 'Ownership', 'Bias for Action', 'Dive Deep', 'Deliver Results', 'Earn Trust', 'Have Backbone; Disagree and Commit', 'Invent and Simplify'],
    questions: [
      { q: 'Tell me about a time you went above and beyond for a customer.', tests: 'Customer Obsession: whether you start from the customer need and build long-term trust, not just close the ticket.', tip: 'Pick a story where you changed a decision because of what the customer needed. Name the specific problem and the measurable change in their outcome.' },
      { q: 'Describe a time you took ownership of something outside your job description.', tests: 'Ownership: acting for the whole organization, not only your own scope.', tip: 'Show why nobody else was handling it, what you chose to do, and how you kept your core work on track. Avoid blaming other teams.' },
      { q: 'Tell me about a time you made a decision with incomplete data.', tests: 'Bias for Action: speed combined with sound judgment, especially on decisions that can be reversed.', tip: 'Explain how you judged the risk, what you assumed, how you would have caught a wrong call early, and what happened.' },
      { q: 'Give an example of when you dug into the details to solve a problem.', tests: 'Dive Deep: staying close to the data instead of relying on summaries.', tip: 'Describe the metric or anomaly that looked wrong, how you traced it to the root cause, and what you changed as a result.' },
      { q: 'Tell me about a time you disagreed with your manager or team.', tests: 'Have Backbone; Disagree and Commit: challenging respectfully, then committing fully to the final call.', tip: 'Show that you argued with evidence, respected the decision, and then committed. Say what you did after the decision was made.' },
      { q: 'Describe a time you simplified a process or invented something new.', tests: 'Invent and Simplify: finding better ways to work and questioning "how it has always been done".', tip: 'Quantify the before and after: time saved, errors reduced, steps removed. Explain why the old way had persisted.' },
      { q: 'Tell me about a time you failed or missed a deadline.', tests: 'Ownership and Learn and Be Curious: honesty about failure and what you changed afterward.', tip: 'Own the miss in your first sentence. Spend most of the answer on what you changed so it would not happen again.' },
      { q: 'Tell me about a time you delivered results under tight constraints.', tests: 'Deliver Results: focusing on the outcome despite limits on time, people or budget.', tip: 'Name the constraint, what you cut or re-sequenced, and the measurable result you still delivered.' },
      { q: 'Describe how you earned the trust of a skeptical stakeholder.', tests: 'Earn Trust: listening, speaking candidly and following through.', tip: 'Show specific behaviors: admitting a mistake, sharing bad news early, delivering on small promises before big ones.' },
      { q: 'Tell me about a time you raised the bar for your team.', tests: 'Insist on the Highest Standards and Hire and Develop the Best.', tip: 'Describe the standard you set, how you got others to meet it, and what improved afterward.' },
    ],
    mistakes: [
      'Using "we" throughout, so the interviewer cannot tell what you personally did.',
      'Telling a story with no measurable result.',
      'Reusing the same story for every principle.',
      'Skipping the failure and the lesson when asked about a mistake.',
      'Stopping short when the interviewer follows up. Follow-ups usually probe for detail, so prepare for them.',
    ],
    related: [
      { label: 'Amazon interview guide', href: '/explore/company-library/amazon' },
      { label: 'The STAR method', href: '/explore/interview-frameworks/star-method' },
      { label: 'Leadership stories framework', href: '/explore/interview-frameworks/leadership-stories' },
      { label: 'Behavioral interview questions', href: '/interview-questions/behavioral-interview-questions' },
    ],
    ctaCopy: 'Practice these questions with a live AI interviewer that follows up on your answers and scores your STAR structure.',
  },

  {
    slug: 'behavioral-interview-questions',
    title: 'Behavioral Interview Questions and How to Answer Them',
    eyebrow: 'Interview fundamentals',
    seo: {
      title: 'Behavioral Interview Questions & How to Answer | MedhaIQ',
      description: 'Common behavioral interview questions, what interviewers want to hear, and how to answer each one with the STAR method. Practice with AI feedback.',
    },
    intro: 'Behavioral questions ask for real examples from your past, because past behavior is the best evidence an interviewer has. The standard way to answer is the STAR method: Situation, Task, Action, Result. Keep the situation short, spend most of the answer on what you personally did, and finish with a measurable result. Below are twelve of the most common questions and how to approach each one.',
    focus: ['Teamwork', 'Conflict', 'Leadership', 'Failure and learning', 'Prioritization', 'Initiative', 'Communication', 'Adaptability'],
    questions: [
      { q: 'Tell me about a time you worked with a difficult teammate.', tests: 'Collaboration and emotional maturity.', tip: 'Describe the behavior, not the person. Show what you did to understand their view and reach a working agreement.' },
      { q: 'Describe a time you failed.', tests: 'Self-awareness and the ability to learn.', tip: 'Choose a real failure with real consequences. Take ownership, then show the specific change you made afterward.' },
      { q: 'Tell me about a time you led without formal authority.', tests: 'Influence without a title.', tip: 'Explain how you built agreement through data, relationships or clear ownership, and what the group achieved.' },
      { q: 'How do you prioritize when everything is urgent?', tests: 'Judgment under pressure.', tip: 'Give a real example: the criteria you used (impact, deadline, dependency), who you aligned with, and what you deliberately dropped.' },
      { q: 'Describe a time you handled a conflict with a stakeholder.', tests: 'Communication under pressure.', tip: 'Show that you listened first, found the underlying need, and reached an outcome both sides could accept.' },
      { q: 'Tell me about a time you took initiative.', tests: 'Ownership and proactivity.', tip: 'Pick something nobody asked you to do. Explain how you spotted the need and what changed because of it.' },
      { q: 'Give an example of a time you had to learn something quickly.', tests: 'Adaptability and learning speed.', tip: 'Describe your learning method, how fast you applied it and the result. Avoid stories that make learning look effortless.' },
      { q: 'Tell me about a time you received critical feedback.', tests: 'Coachability.', tip: 'State the feedback honestly, say what you did with it, and show how later work improved.' },
      { q: 'Describe a time you made a mistake that affected others.', tests: 'Accountability.', tip: 'Say what you told the affected people and when. Show the fix and the safeguard you added.' },
      { q: 'Tell me about a time you had to persuade someone.', tests: 'Influence and communication.', tip: 'Show that you adapted your argument to their priorities, used evidence, and ended with a concrete decision.' },
      { q: 'Describe the project you are most proud of.', tests: 'What you value and the level of impact you have had.', tip: 'Choose a project where your contribution was clear. Explain the problem, your decisions and the measurable results.' },
      { q: 'Tell me about a time you worked under pressure.', tests: 'Composure and organization.', tip: 'Explain how you stayed organized, communicated early, and protected quality while meeting the deadline.' },
    ],
    mistakes: [
      'Spending most of the answer on the situation and rushing the result.',
      'Saying "we" so often that your own contribution is unclear.',
      'Choosing a story with no outcome you can measure or describe.',
      'Giving a "weakness" that is really a disguised strength.',
      'Memorizing a script, which sounds rehearsed when the follow-up question changes direction.',
    ],
    related: [
      { label: 'The STAR method', href: '/explore/interview-frameworks/star-method' },
      { label: 'Behavioural interviews framework', href: '/explore/interview-frameworks/behavioural-interviews' },
      { label: 'Tell me about yourself', href: '/explore/interview-frameworks/tell-me-about-yourself' },
      { label: 'Amazon Leadership Principles questions', href: '/interview-questions/amazon-leadership-principles' },
    ],
    ctaCopy: 'Run a live mock interview that adapts to your answers, checks each one for STAR, and shows exactly where to improve.',
  },

  {
    slug: 'product-manager-interview-questions',
    title: 'Product Manager Interview Questions and Answers',
    eyebrow: 'Role interview prep',
    seo: {
      title: 'Product Manager Interview Questions & Answers | MedhaIQ',
      description: 'Practice product manager interview questions on product sense, metrics, prioritization and strategy, with guidance on how to structure each answer.',
    },
    intro: 'Product manager interviews usually mix product sense, analytical thinking, execution and behavioral questions. Interviewers care less about a clever idea than about how you structure your thinking: who the user is, what problem matters most, how you would decide, and how you would measure success. Below are ten practice questions with what each is testing and how to approach it.',
    focus: ['Product sense', 'Metrics and analytics', 'Prioritization', 'Execution', 'Strategy', 'Stakeholder management'],
    questions: [
      { q: 'How would you improve a product you use every day?', tests: 'Product sense: user empathy and problem selection.', tip: 'Define the user and their goal first, pick one painful problem, propose a solution and say how you would measure success.' },
      { q: 'Design a product for a specific user group.', tests: 'Structured product design.', tip: 'Clarify the user, the need and the constraints. List a few ideas, choose one with a clear rationale, and define the minimum version and success metrics.' },
      { q: 'How would you decide what to build next?', tests: 'Prioritization.', tip: 'Name a method you actually use, such as impact versus effort, and show how you handle conflicting stakeholder requests.' },
      { q: 'A key metric dropped 10% this week. What do you do?', tests: 'Analytical thinking and diagnosis.', tip: 'Confirm the data is correct, segment by platform, user type and time, check recent releases and external events, then propose a fix and a follow-up check.' },
      { q: 'How would you measure the success of a new feature?', tests: 'Metrics design.', tip: 'Tie the feature to a user goal and a business goal, choose one primary metric plus guardrail metrics, and say what result would make you scale it or stop.' },
      { q: 'Tell me about a product you launched.', tests: 'End-to-end execution.', tip: 'Cover the problem, how you scoped it, how you aligned engineering and design, the launch and the results, including what you would change.' },
      { q: 'How do you work with engineers when timelines slip?', tests: 'Collaboration and trade-offs.', tip: 'Show that you diagnose the cause, re-scope with the team, and communicate trade-offs to stakeholders early instead of absorbing the slip silently.' },
      { q: 'Describe a time you said no to a stakeholder.', tests: 'Judgment and influence.', tip: 'Show the data and customer reasoning behind the decision, and the alternative you offered.' },
      { q: 'How would you enter a new market?', tests: 'Strategy.', tip: 'Segment the market, pick a first group of users, identify competitors and your advantage, then define a small test with clear success criteria.' },
      { q: 'What is your biggest product failure?', tests: 'Learning and accountability.', tip: 'Choose one where your decision contributed. Explain what the data told you, what you changed in your process and how that helped a later launch.' },
    ],
    mistakes: [
      'Jumping to solutions before clarifying who the user is and what problem matters.',
      'Listing many ideas without choosing one and defending it.',
      'Naming vague success metrics, such as "engagement", without defining them.',
      'Ignoring trade-offs, risks and what you would not build.',
      'Answering with no visible structure, which makes your thinking hard to follow.',
    ],
    related: [
      { label: 'Product Manager role guide', href: '/explore/role-library/product-manager' },
      { label: 'Product sense framework', href: '/explore/interview-frameworks/product-sense' },
      { label: 'The STAR method', href: '/explore/interview-frameworks/star-method' },
      { label: 'Behavioral interview questions', href: '/interview-questions/behavioral-interview-questions' },
    ],
    ctaCopy: 'Practice a product manager interview built from your resume and the job description, with follow-ups and a scored report.',
  },

  {
    slug: 'solutions-architect-interview-questions',
    title: 'Solutions Architect Interview Questions and Answers',
    eyebrow: 'Role interview prep',
    seo: {
      title: 'Solutions Architect Interview Questions & Answers | MedhaIQ',
      description: 'Solutions architect interview questions on system design, migration, security and customer communication, with tips on how to answer each.',
    },
    intro: 'Solutions architect interviews test two things at once: technical depth and the ability to work with customers. Expect questions on designing for reliability and scale, trade-offs between cost, performance and security, and how you explain complex ideas to non-technical people. Below are ten practice questions, what each is testing, and how to approach your answer.',
    focus: ['System design', 'Reliability and scale', 'Security', 'Cloud migration', 'Customer discovery', 'Executive communication'],
    questions: [
      { q: 'Walk me through an architecture you designed end to end.', tests: 'Technical depth and ownership.', tip: 'State the requirements first, then the components, data flow and the trade-offs you made. Explain how you validated the design in production.' },
      { q: 'How do you gather requirements from a customer who is not sure what they need?', tests: 'Discovery skills.', tip: 'Describe asking about business outcomes, constraints, existing systems and success criteria before you propose any technology.' },
      { q: 'How would you design a highly available web application?', tests: 'Reliability fundamentals.', tip: 'Cover redundancy across zones, load balancing, stateless services, data replication, health checks and failover. Say how you would test failure.' },
      { q: 'How do you choose between a SQL and a NoSQL database?', tests: 'Judgment on data design.', tip: 'Start from access patterns, consistency needs, scale and team skills rather than preference. Give an example of each choice.' },
      { q: 'How would you approach migrating a legacy system to the cloud?', tests: 'Migration strategy.', tip: 'Discuss assessment, dependency mapping, choosing a strategy per workload, a phased cutover and a rollback plan.' },
      { q: 'How do you balance cost, performance and security?', tests: 'Trade-off thinking.', tip: 'Explain how you rank the three for the specific workload, and give an example where you accepted a trade-off and documented it.' },
      { q: 'Describe a time you convinced a customer to change their technical approach.', tests: 'Influence without authority.', tip: 'Show that you listened, used evidence such as a proof of concept or cost model, and respected the customer constraints.' },
      { q: 'How do you secure a multi-tenant application?', tests: 'Security thinking.', tip: 'Cover tenant isolation, least-privilege access, encryption in transit and at rest, auditing, and how you would test isolation.' },
      { q: 'How do you explain a complex architecture to a non-technical executive?', tests: 'Communication.', tip: 'Lead with the business outcome and risk, use one simple diagram, and keep technical detail ready for follow-up questions.' },
      { q: 'Tell me about a design that failed in production.', tests: 'Accountability and learning.', tip: 'Describe the root cause, how you detected and fixed it, and the design or process change that prevented a repeat.' },
    ],
    mistakes: [
      'Naming technologies before understanding the requirements.',
      'Designing for scale or availability the customer never asked for.',
      'Treating security as something added at the end.',
      'Skipping trade-offs. Interviewers want to hear why you rejected the alternatives.',
      'Using jargon with a non-technical audience.',
    ],
    related: [
      { label: 'Solutions Architect role guide', href: '/explore/role-library/solutions-architect' },
      { label: 'System design framework', href: '/explore/interview-frameworks/system-design' },
      { label: 'The STAR method', href: '/explore/interview-frameworks/star-method' },
      { label: 'Behavioral interview questions', href: '/interview-questions/behavioral-interview-questions' },
    ],
    ctaCopy: 'Practice a solutions architect interview with a live AI interviewer and get a scored report with a 30/60/90-day plan.',
  },

  {
    slug: 'engineering-manager-interview-questions',
    title: 'Engineering Manager Interview Questions and Answers',
    eyebrow: 'Role interview prep',
    seo: {
      title: 'Engineering Manager Interview Questions & Answers | MedhaIQ',
      description: 'Engineering manager interview questions on people management, delivery, technical debt and hiring, with guidance on how to answer each one.',
    },
    intro: 'Engineering manager interviews look for evidence that you can lead people and deliver outcomes while keeping technical credibility. Expect questions on one-on-ones, performance problems, conflict, hiring, and balancing delivery with technical debt. Below are ten practice questions, what each is testing, and how to approach your answer.',
    focus: ['People management', 'Delivery and execution', 'Technical judgment', 'Hiring and growth', 'Cross-functional work', 'Change leadership'],
    questions: [
      { q: 'How do you run effective one-on-ones?', tests: 'People management basics.', tip: 'Describe a consistent cadence, a mix of career, feedback and blockers, and how you track follow-ups.' },
      { q: 'Tell me about a time you managed an underperforming engineer.', tests: 'Coaching and fairness.', tip: 'Show early and specific feedback, a clear improvement plan with support, and an honest outcome.' },
      { q: 'How do you balance delivery speed with technical debt?', tests: 'Judgment.', tip: 'Explain how you make debt visible, reserve capacity, and tie refactoring to business risk, with a real example.' },
      { q: 'How do you handle conflict between two senior engineers?', tests: 'Mediation.', tip: 'Listen to each person separately, frame the shared goal, settle the technical question with evidence, and follow up afterward.' },
      { q: 'Describe how you hire and grow engineers.', tests: 'Talent development.', tip: 'Cover the signals you hire for, how you structure interviews, and how you build growth plans.' },
      { q: 'How do you manage a project that is falling behind?', tests: 'Execution.', tip: 'Show how you find the root cause, re-scope with the team, tell stakeholders early, and protect the team from burnout.' },
      { q: 'How do you partner with product and design?', tests: 'Cross-functional skills.', tip: 'Give a concrete example of agreeing on trade-offs and shared goals rather than passing requirements back and forth.' },
      { q: 'Tell me about a time you led your team through a reorganization or major change.', tests: 'Change leadership.', tip: 'Explain how you communicated honestly, kept the team focused and handled concerns.' },
      { q: 'How do you stay technical as a manager?', tests: 'Credibility.', tip: 'Describe how you stay involved in design reviews and incidents without becoming a bottleneck or overriding the team.' },
      { q: 'How do you measure your team performance?', tests: 'Outcome orientation.', tip: 'Mention a few outcome and quality measures, such as delivery predictability, reliability and team health, and warn about gaming any single metric.' },
    ],
    mistakes: [
      'Describing your team achievements without explaining your own role as a leader.',
      'Having no clear example of giving difficult feedback.',
      'Treating technical debt as either unimportant or always urgent.',
      'Speaking only about process and never about people.',
      'Claiming credit for outcomes the team delivered.',
    ],
    related: [
      { label: 'Engineering Manager role guide', href: '/explore/role-library/engineering-manager' },
      { label: 'Leadership stories framework', href: '/explore/interview-frameworks/leadership-stories' },
      { label: 'The STAR method', href: '/explore/interview-frameworks/star-method' },
      { label: 'Behavioral interview questions', href: '/interview-questions/behavioral-interview-questions' },
    ],
    ctaCopy: 'Practice an engineering manager interview with a live AI interviewer that probes your leadership examples and scores your answers.',
  },
];

module.exports = { guides };
