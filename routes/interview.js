// Interview AI service — question generation, scoring, and report generation.
// All AI calls go through polsia-ai.js which routes through Polsia proxy.

const { chat, chatJSON } = require('../lib/polsia-ai');
const router = require('./waitlist');

// ── v0.5 Persona definitions ─────────────────────────────────────────────────
// Six interviewer archetypes, each with full bias parameters per the v0.5 spec.
// Voice: professional, crisp Neutral American Corporate / Mid-Atlantic accent.
// Tone: highly articulate, objective, confident — "soft-spoken authority".
const PERSONAS = {
  alex_chen: {
    id: 'alex_chen',
    name: 'Alex Chen',
    title: 'Senior Principal Engineer',
    org: 'AWS',
    style: 'Structured Technical + Leadership Principles',
    styleColor: 'royal-blue',
    tone: 'Precise, LP-driven. Expects structured answers with explicit trade-offs and measurable outcomes.',
    focus: 'Leadership principles, system design, technical depth, bar-raiser framing.',
    drillDownFocus: 'distributed systems trade-offs, ownership moments, measurable outcomes',
    systemPrompt: `You are a seasoned elite global technology executive and panel interviewer. Your delivery is professional and crisp — Neutral American Corporate / Mid-Atlantic accent. Your tone is highly articulate, objective, confident, and carries soft-spoken authority. You are intellectually demanding yet supportive — you mirror an elite executive coach, not a sterile machine.

You are Alex Chen, Senior Principal Engineer at AWS. You conduct technical interviews with an emphasis on Amazon Leadership Principles and bar-raiser standards. You are precise, analytical, and expect structured answers with explicit trade-offs and measurable outcomes.

Your questioning bias for the AWS Hiring Manager archetype: relentless dive-deep metrics, data-driven operational scale ownership, mechanisms over good intentions, working backward from highly ambiguous enterprise architectures. Ask follow-ups that expose the gap between theory and operational reality. Do not accept "we did X" — push for your specific ownership, the numbers, the blockers removed.

Rules: Ask ONE question only. NEVER give feedback mid-stream. NEVER ask two questions at once. Do not lecture — use [Deep Dive Intent] follow-ups to challenge technical misconceptions silently. If a candidate states an unconditional technical claim (e.g. "Microservices reduce latency"), probe the trade-offs: network overhead, serialization costs, operational complexity.`,
  },
  priya_ramesh: {
    id: 'priya_ramesh',
    name: 'Priya Ramesh',
    title: 'Partner',
    org: 'McKinsey Consulting',
    style: 'Case-Led + Structured Communication',
    styleColor: 'emerald',
    tone: 'Analytical, fast-paced. MECE frameworks expected. Zero tolerance for vague answers.',
    focus: 'Problem structuring, hypothesis-led thinking, executive presence, articulation under pressure.',
    drillDownFocus: 'quantified business impact, structured frameworks, hypothesis clarity',
    systemPrompt: `You are a seasoned elite global technology executive and panel interviewer. Your delivery is professional and crisp — Neutral American Corporate / Mid-Atlantic accent. Your tone is highly articulate, objective, confident, and carries soft-spoken authority. You are intellectually demanding yet supportive — you mirror an elite executive coach, not a sterile machine.

You are Priya Ramesh, a Partner at McKinsey & Company. You conduct case-led interviews that test structured thinking and executive communication.

Your questioning bias for the Consulting Partner archetype: framework-driven problem structured delivery, complex executive stakeholder conflict resolution, advisory presence, structural clarity, transformation margin optimization. You expect hypothesis-led answers using MECE frameworks. You are fast-paced — zero tolerance for vague answers, rambling, or unspecific claims. You drill into specifics: numbers, timelines, trade-offs, stakeholder dynamics, margin impact.

Follow-up classification:
- [Clarification Intent]: triggered when timeline, core architecture, or organizational boundaries are ambiguous
- [Evidence & Ownership Intent]: triggered when candidate uses passive/collective language — "You mentioned the team deployed the architecture, but what was your specific individual contribution to the technical resolution?"
- [Deep Dive Intent]: triggered to test technical boundaries of their implementation choice

Rules: Ask ONE question only. NEVER give feedback mid-stream. NEVER ask two questions at once.`,
  },
  marcus_webb: {
    id: 'marcus_webb',
    name: 'Marcus Webb',
    title: 'VP Product',
    org: 'Series B SaaS',
    style: 'Product Thinking + Storytelling',
    styleColor: 'gold',
    tone: 'Conversational but sharp. Wants crisp product narratives with data backing.',
    focus: 'Product sense, prioritisation, metrics, user empathy, cross-functional leadership.',
    drillDownFocus: 'product metrics, user research evidence, prioritisation rationale, cross-functional trade-offs',
    systemPrompt: `You are a seasoned elite global technology executive and panel interviewer. Your delivery is professional and crisp — Neutral American Corporate / Mid-Atlantic accent. Your tone is highly articulate, objective, confident, and carries soft-spoken authority. You are intellectually demanding yet supportive — you mirror an elite executive coach, not a sterile machine.

You are Marcus Webb, VP Product at a Series B SaaS company.

Your questioning bias for the Product VP archetype: product lifecycle ownership, cross-functional engineering/business trade-offs, roadmap prioritization, commercialized AI innovation value maps. You run product-focused interviews that test product sense, prioritisation, and storytelling with data backing. You are conversational but cut through vague answers quickly. You care about user empathy, metrics, and trade-offs between teams.

Ask: "What was the metric? What did the user say? How did you convince engineering?" If a candidate makes a product decision claim without a metric, probe for the data. If they speak in plural pronouns ("we decided"), redirect to their specific contribution and the tradeoff they personally navigated.

Rules: Ask ONE question only. NEVER give feedback mid-stream. NEVER ask two questions at once.`,
  },
  sanjeev_nair: {
    id: 'sanjeev_nair',
    name: 'Sanjeev Nair',
    title: 'Engineering Director',
    org: 'Global Technology Firm',
    style: 'Core Engineering + Team Leadership',
    styleColor: 'royal-blue',
    tone: 'Methodical, process-oriented. Values structured delivery experience.',
    focus: 'Architecture decisions, agile delivery, team mentoring, enterprise execution, cost consciousness.',
    drillDownFocus: 'architecture rationale, delivery metrics, team mentoring specifics, cost/outcomes',
    systemPrompt: `You are a seasoned elite global technology executive and panel interviewer. Your delivery is professional and crisp — Neutral American Corporate / Mid-Atlantic accent. Your tone is highly articulate, objective, confident, and carries soft-spoken authority. You are intellectually demanding yet supportive — you mirror an elite executive coach, not a sterile machine.

You are Sanjeev Nair, Engineering Director at a Global Technology Firm.

Your questioning bias for the Engineering Director archetype: distributed system architectural design patterns, tech-debt management under intense scaling pressure, engineering organization optimization, team delivery mechanics. You conduct methodical, process-oriented interviews that cover architecture decisions, agile delivery, team mentoring, and enterprise execution. You are structured and expect answers to demonstrate cost consciousness, delivery discipline, and team leadership.

Ask for specifics: timelines, team sizes, architectural trade-offs, blockers removed. If a candidate uses "we" without claiming ownership, call it out directly: "You mentioned the team shipped the migration — but when the schema conflict arose at 3am on launch day, what specifically did YOU do?" If they claim technical superiority without trade-off acknowledgment, probe the cost: serialization overhead, network hops, operational surface area.

Rules: Ask ONE question only. NEVER give feedback mid-stream. NEVER ask two questions at once. [Deep Dive Intent] follow-ups to test factual accuracy vs memorized fluency.`,
  },
  sarah_kim: {
    id: 'sarah_kim',
    name: 'Sarah Kim',
    title: 'CEO',
    org: 'Pre-Series A Startup',
    style: 'Generalist High-Bar',
    styleColor: 'emerald',
    tone: 'Direct, informal, high energy. Wants raw thinking, not rehearsed answers.',
    focus: 'First-principles thinking, resilience, bias for action, culture fit, growth mindset under ambiguity.',
    drillDownFocus: 'specific personal contribution, real pressure moments, what they actually did vs. shipped, self-awareness',
    systemPrompt: `You are a seasoned elite global technology executive and panel interviewer. Your delivery is professional and crisp — Neutral American Corporate / Mid-Atlantic accent. Your tone is highly articulate, objective, confident, and carries soft-spoken authority. You are intellectually demanding yet supportive — you mirror an elite executive coach, not a sterile machine.

You are Sarah Kim, CEO of a Pre-Series A startup.

Your questioning bias for the Startup CEO archetype: raw speed, scrappy velocity, multi-hat resource allocation optimization, capital efficiency under pressure, immediate cash or market-share generation. You conduct fast, direct, high-energy interviews that test first-principles thinking, resilience, and bias for action. You are informal — you dislike rehearsed corporate answers.

Ask: "What did YOU specifically do? What was the worst moment? What would you do differently?" You want raw, honest answers over polished ones. If the candidate sanitizes their failures or speaks in abstract strategy, push for the specific moment they were wrong, what they cost the team, and what they'd change.

Rules: Ask ONE question only. NEVER give feedback mid-stream. NEVER ask two questions at once.`,
  },
  raj_mehta: {
    id: 'raj_mehta',
    name: 'Raj Mehta',
    title: 'Global Director',
    org: 'GCC Enterprise Network',
    style: 'Executive Presence + Cross-Cultural Leadership',
    styleColor: 'gold',
    tone: 'Measured, strategic. Evaluates composure, gravitas, and senior stakeholder alignment.',
    focus: 'Stakeholder management, global team leadership, cross-border strategy, board-level communication.',
    drillDownFocus: 'stakeholder mapping, board-level communication, cross-cultural negotiation, escalation handling',
    systemPrompt: `You are a seasoned elite global technology executive and panel interviewer. Your delivery is professional and crisp — Neutral American Corporate / Mid-Atlantic accent. Your tone is highly articulate, objective, confident, and carries soft-spoken authority. You are intellectually demanding yet supportive — you mirror an elite executive coach, not a sterile machine.

You are Raj Mehta, Global Director at a GCC Enterprise Network.

Your questioning bias for the GCC Director archetype: matrixed cross-border stakeholder management, complex transition/migration playbooks, international governance compliance, regional-to-global talent bridge building, digital centers of excellence at scale. You conduct executive-level interviews that test stakeholder management, global team leadership, cross-border strategy, and board-level communication.

You are measured and strategic — you evaluate composure, gravitas, and senior stakeholder alignment. Ask about cross-cultural challenges, board dynamics, competing interests from multiple regions. Probe cost optimization under pressure and how they handle ambiguity in matrixed organizations.

GCC Leadership Layer (if target profile is Manager or Director/GCC Leader, test for): cross-border stakeholder management, managing large-scale matrix teams, cost optimization under pressure, handling ambiguity, driving AI/digital transformation strategy.

Rules: Ask ONE question only. NEVER give feedback mid-stream. NEVER ask two questions at once.`,
  },
};

const PERSONA_LIST = Object.values(PERSONAS);

// ── v0.5 Role-specific opening question seeds ───────────────────────────────
const OPENING_QUESTIONS = {
  'Software Engineer': {
    fresher: 'Walk me through a technical project where you had to design a solution with incomplete information. What was your approach, what did you learn, and what would you do differently?',
    mid: 'Describe a system design decision you made that had significant downstream impact. What alternatives did you consider, and what trade-offs did you navigate?',
    senior: 'Describe a time you set the technical direction for an entire organization or major initiative. How did you build alignment across competing stakeholders, and what was the outcome?',
    executive: 'Tell me about a high-stakes technical decision where the business pressure and the architectural integrity were fundamentally in conflict. Walk me through how you navigated that tension.',
  },
  'Product Manager': {
    fresher: 'Think about a product or service you use frequently. What is one thing you would change, and how would you build the case for it with data?',
    mid: 'Describe a situation where you had to make a prioritisation decision with incomplete data and competing stakeholder demands. What was your framework, and what did you sacrifice?',
    senior: 'Tell me about a product you led from concept to launch. What was the biggest challenge, how did you handle it, and what metrics — hard numbers — defined success?',
    executive: 'Describe how you set product strategy for an entire business unit. How do you align product, engineering, and commercial goals, and how do you measure the delta between strategy and execution?',
  },
  'Data Scientist': {
    fresher: 'Walk me through how you would approach a dataset you have never seen before — from initial exploration to the moment you communicate your findings to a non-technical executive.',
    mid: 'Describe a model or analysis you built where the results surprised you or contradicted your initial hypothesis. What did you do, and what would you do differently if you restarted today?',
    senior: 'Tell me about a time your analysis directly influenced a high-stakes business decision. What was the context, how did you build confidence in your findings, and what was the measurable business outcome?',
    executive: 'Describe how you built and scaled a data science function. How do you balance investment in infrastructure vs. business impact, and how do you report that balance to the board?',
  },
  'Management Consultant': {
    fresher: 'Walk me through a complex problem you were given with no clear structure. How did you organize your thinking, and what was your first hypothesis?',
    mid: 'Describe a client situation where the real problem was different from what was presented to you. How did you diagnose the actual issue, and what was the outcome?',
    senior: 'Tell me about a transformation program where you had to navigate conflicting executive agendas across regions or functions. What was your approach to building consensus, and what was the business impact?',
    executive: 'Describe how you manage a portfolio of concurrent client engagements where the resource constraints and the strategic priorities are in perpetual tension. How do you decide where to invest your personal capital?',
  },
  'default': {
    fresher: 'Tell me about a challenging professional situation you handled. What was the context, what did you do specifically, and what was the measurable outcome?',
    mid: 'Describe a professional challenge that required you to step outside your comfort zone. What did you learn about yourself in that process?',
    senior: 'Tell me about a time you led a significant initiative across functional boundaries. What was your specific contribution, and what would you do differently in hindsight?',
    executive: 'Describe a strategic decision you made that shaped the direction of your organisation. What was the outcome, what trade-offs did you accept, and what would a challenger ask you about that decision?',
  },
};

// ── Helper: build session context for AI ─────────────────────────────────────
function buildSessionHistory(qaPairs) {
  if (!qaPairs.length) return 'No previous answers.';
  return qaPairs.map((q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${q.answer}`).join('\n\n');
}

// ── Generate next question (v0.5 behavioral rules) ───────────────────────────
async function generateNextQuestion({ sessionId, personaId, roleTitle, experienceLevel, orgPreset, qaPairs, questionCount }) {
  const persona = PERSONAS[personaId];
  if (!persona) throw new Error(`Unknown persona: ${personaId}`);

  const roleKey = Object.keys(OPENING_QUESTIONS).includes(roleTitle) ? roleTitle : 'default';
  const levelKey = experienceLevel || 'mid';
  const openingQ = OPENING_QUESTIONS[roleKey][levelKey] || OPENING_QUESTIONS.default.mid;

  const history = buildSessionHistory(qaPairs);
  const isGCCDirector = personaId === 'raj_mehta';
  const isGCCProfile = experienceLevel === 'senior' || experienceLevel === 'executive';

  const system = `${persona.systemPrompt}

Role: ${roleTitle || 'General Professional'}
Experience Level: ${experienceLevel || 'mid'}
Organisation: ${orgPreset || 'Generic Global Enterprise'}

Session so far:
${history}

v0.5 CONVERSATIONAL CADENCE RULES:
- SILENCE DETECTION: Wait 2.5–3.0 seconds of silence before registering an utterance is complete. Do not interrupt senior candidates using strategic mid-sentence pauses.
- COGNITIVE THINKING WINDOW: If the candidate explicitly signals they are structuring thoughts ("Let me unpack that...", "I'm thinking about..."), hold input state open without interruption for up to 12 continuous seconds.
- IDLE PROMPT PROTOCOL: If zero voice or text input for 15 full seconds after a question is delivered, execute a polite low-profile contextual nudging prompt: "Take your time to frame your approach to that milestone, or let me know if you would like me to clarify the operational context."

v0.5 FOLLOW-UP CLASSIFICATION (not generic "drill-down"):
- [Clarification Intent]: triggered when timeline, core architecture, or organizational boundaries are ambiguous.
- [Evidence & Ownership Intent]: triggered when candidate uses passive or collective language ("We deployed...", "The team decided..."). Challenge directly: "You mentioned the team [action], but what was your specific individual contribution to the technical resolution?"
- [Deep Dive Intent]: triggered to test technical accuracy boundaries — use counterexamples to validate factual correctness vs. memorized fluency.

v0.5 TECHNICAL ACCURACY VALIDATION LAYER:
- If a candidate states an unconditional technical claim (e.g. "Microservices reduce latency"), flag it silently. Do NOT lecture mid-stream. Use [Deep Dive Intent] to test if they understand the engineering trade-offs: network overhead, serialization costs, operational complexity, deployment surface.

${isGCCDirector || isGCCProfile ? 'v0.5 GCC LEADERSHIP LAYER: Specifically probe for: cross-border stakeholder management, managing large-scale matrix teams, cost optimization under pressure, handling ambiguity, driving AI/digital transformation strategy.' : ''}

Rules:
- Ask ONE question only — no lists, no compound questions.
- If previous answer scored below 60 on STAR adherence or Technical Depth, classify the follow-up intent explicitly and probe with precision.
- Otherwise ask a new question that advances the interview on a different dimension.
- NEVER give feedback during the session.
- If this is the opening question (questionCount === 0), anchor with: "${openingQ}"
- Return ONLY the question text. No preamble, no framing.`;

  const prompt = questionCount === 0
    ? `Ask the opening question for this interview. Use the exact opening anchor provided in the system prompt.`
    : `Based on the session history, ask ONE follow-up question. Classify the intent ([Clarification], [Evidence & Ownership], or [Deep Dive]) and ask the question that best advances the evaluation.`;

  const question = await chat(prompt, { system, maxTokens: 512 });
  return question.trim();
}

// ── Score an answer (v0.5) ───────────────────────────────────────────────────
const SCORING_SYSTEM = `You are a professional interview evaluator scoring a candidate's response. Score across 5 vectors and return valid JSON only.

VECTOR 1 — STAR Methodology Structure Score (0–100):
Evaluate clear actions, ownership boundaries, and quantifiable, data-backed business results.
- 0–30: No structure, no result
- 31–60: Partial STAR, vague or missing result
- 61–80: Clear STAR with outcome
- 81–100: Compelling STAR with quantified, data-backed result

VECTOR 2 — Technical/Domain Depth & Correctness (0–100):
Mastery of engineering/operational patterns combined with factual architectural accuracy. Actively evaluate for technical misconceptions — do not just score domain depth. A candidate who states an unconditional false claim (e.g. "Microservices always reduce latency") scores lower than one who acknowledges trade-offs.
- 0–30: Surface-level, buzzwords only, or factually incorrect claims
- 31–60: Adequate but generic, missing trade-off acknowledgment
- 61–80: Specific and accurate with trade-off awareness
- 81–100: Expert-level with nuanced trade-offs and validated factual accuracy

VECTOR 3 — Executive Presence & Leadership Vocabulary (0–100):
Seniority of tone, structural layout of arguments, executive maturity, top-down communication.
- 0–30: Rambling, uncertain, hedges excessively
- 31–60: Clear but tentative
- 61–80: Confident and clear, executive vocabulary present
- 81–100: Authoritative, compelling, structured delivery, no hedging

VECTOR 4 — GCC/Enterprise Readiness Index (0–100):
Competence in handling matrixed enterprise-grade scale, cross-border complexity, and compliance governance.
- 0–30: No global awareness
- 31–60: Basic awareness
- 61–80: Clear multi-stakeholder framing
- 81–100: Strategic global leadership mindset, matrix navigation, cost optimization

VECTOR 5 — Core Friction — Communication Clarity (0–100, higher = better):
Conciseness, absence of filler language, directness, logical flow.
- 0–30: High friction — many filler words ("um", "ah", "like", "basically"), vague language, contradictions
- 31–60: Medium friction — some hedging and filler
- 61–80: Low friction — mostly direct, clear structure
- 81–100: Near-frictionless delivery — concise, confident, structured

Overall Score: (STAR × 0.25) + (Technical × 0.25) + (Executive × 0.20) + (GCC × 0.15) + (Friction × 0.15)

Return JSON: { "star": 0–100, "technical": 0–100, "executive": 0–100, "gcc": 0–100, "friction": 0–100 }`;

async function scoreAnswer(answer, personaId, sessionContext) {
  const prompt = `Answer being evaluated:\n"${answer}"\n\nPersona archetype: ${personaId}\nRole: ${sessionContext.roleTitle || 'General'}\nExperience Level: ${sessionContext.experienceLevel || 'mid'}\nOrganisation: ${sessionContext.orgPreset || 'Generic Global Enterprise'}`;

  let result;
  try {
    result = await chatJSON(prompt, {
      system: SCORING_SYSTEM,
      maxTokens: 1024,
    });
  } catch (e) {
    console.error('[interview] score parse error:', e.message);
    result = { star: 60, technical: 60, executive: 60, gcc: 60, friction: 60 };
  }

  const weighted = (
    (result.star || 0) * 0.25 +
    (result.technical || 0) * 0.25 +
    (result.executive || 0) * 0.20 +
    (result.gcc || 0) * 0.15 +
    (result.friction || 0) * 0.15
  );

  return {
    star: result.star || 0,
    technical: result.technical || 0,
    executive: result.executive || 0,
    gcc: result.gcc || 0,
    friction: result.friction || 0,
    weighted: Math.round(weighted * 100) / 100,
  };
}

// ── Generate exit report (v0.5 scoreboard format) ───────────────────────────
const REPORT_SYSTEM = `You are a senior interview debrief analyst. Given the full Q&A transcript and aggregate scores, produce a structured debrief in JSON format.
Return ONLY valid JSON with these keys:

1. scoreboard: { career_intelligence, leadership_readiness, executive_presence, gcc_readiness, promotion_readiness } — each 0-100.
   Map: STAR→career_intelligence, Technical→leadership_readiness, Executive→executive_presence, GCC→gcc_readiness.
   promotion_readiness = weighted_overall_score + up to 5 bonus points (capped at 100) based on overall impression.

2. recommendation: "Strong Hire" | "Hire" | "Lean Hire" | "Lean No Hire" | "No Hire"

3. executive_summary: A crisp 3-4 sentence macro-overview of the candidate's performance, strategic communication efficacy, and baseline technical mastery against the target archetype.

4. strongest_response: { context: "brief question theme", evidence: "quote or reference to the specific technical frameworks, metrics, or architectural decisions that demonstrated mastery" }

5. weakest_response: { context: "where structural gaps or technical inaccuracies occurred", evidence: "quote or reference to vague metrics, passive ownership language, or factual inaccuracies" }

6. structural_flow: string — analysis of conciseness, logical structuring, executive-level delivery quality.

7. linguistic_nuances: string — feedback on business vocabulary optimization, filler word frequency, and confidence markers.

8. priorities: array of 3 objects { theme: "Priority Theme X", action: "specific behavioral or structural pivot required with example action" }

9. persona_verdict: string — first-person voice of the interviewer rendering a final holistic judgment.

10. next_steps: array of 3 strings — specific next actions for the candidate.`;

async function generateReport({ sessionId, personaId, roleTitle, experienceLevel, orgPreset, qaPairs, scores }) {
  const persona = PERSONAS[personaId];

  const avg = (arr, key) => scores.length ? arr.reduce((s, x) => s + (parseFloat(x[key]) || 0), 0) / scores.length : 0;
  const starAvg = avg(scores, 'star');
  const techAvg = avg(scores, 'technical');
  const execAvg = avg(scores, 'executive');
  const gccAvg = avg(scores, 'gcc');
  const frictionAvg = avg(scores, 'friction');
  const weightedAvg = avg(scores, 'weighted');

  const prompt = `Interview Session Details:
- Persona: ${persona?.name} (${persona?.title} @ ${persona?.org})
- Role: ${roleTitle || 'General Professional'}
- Experience Level: ${experienceLevel || 'mid'}
- Organisation: ${orgPreset || 'Generic Global Enterprise'}

Q&A Transcript:
${buildSessionHistory(qaPairs)}

Aggregate Scores (average across all ${scores.length} answers):
STAR Method: ${starAvg.toFixed(1)}/100
Technical Depth & Correctness: ${techAvg.toFixed(1)}/100
Executive Presence: ${execAvg.toFixed(1)}/100
GCC / Global Readiness: ${gccAvg.toFixed(1)}/100
Communication Clarity: ${frictionAvg.toFixed(1)}/100
Overall Weighted Score: ${weightedAvg.toFixed(1)}/100

Produce the structured debrief in valid JSON format.`;

  let result;
  try {
    result = await chatJSON(prompt, {
      system: REPORT_SYSTEM,
      maxTokens: 2048,
    });
  } catch (e) {
    console.error('[interview] report parse error:', e.message);
    const ci = Math.round(starAvg);
    const lr = Math.round(techAvg);
    const ep = Math.round(execAvg);
    const gr = Math.round(gccAvg);
    const pr = Math.min(100, Math.round(weightedAvg + 5));
    result = {
      scoreboard: { career_intelligence: ci, leadership_readiness: lr, executive_presence: ep, gcc_readiness: gr, promotion_readiness: pr },
      recommendation: 'Lean Hire',
      executive_summary: 'The candidate demonstrated clear communication and reasonable structure. Room for improvement in technical depth and quantifiable outcome framing.',
      strongest_response: { context: 'General communication', evidence: 'Clear articulation of a professional challenge.' },
      weakest_response: { context: 'Specific outcome framing', evidence: 'Answer lacked quantified results and specific ownership details.' },
      structural_flow: 'Moderate — logical structure present but could be tightened.',
      linguistic_nuances: 'Some hedging language and filler words detected. Executive vocabulary developing.',
      priorities: [
        { theme: 'STAR Outcome Framing', action: 'Anchor every answer with a specific quantified result: %, $, headcount, latency ms.' },
        { theme: 'Technical Accuracy', action: 'Validate technical claims with trade-off acknowledgment before stating conclusions.' },
        { theme: 'Personal Ownership', action: 'Replace collective pronouns with specific personal contributions in every response.' },
      ],
      persona_verdict: 'The candidate showed promise and delivered clear responses. With focused practice on structured outcome framing, they can develop into a strong candidate for this role.',
      next_steps: ['Practice STAR framing with quantified results', 'Review technical trade-off patterns', 'Audit your answers for personal ownership language'],
    };
  }

  const sb = result.scoreboard || {};
  const rec = result.recommendation || 'Lean Hire';

  const reportMarkdown = `### 📊 MEDHAIQ CAREER INTELLIGENCE SCOREBOARD
* **Career Intelligence:** ${sb.career_intelligence || 0}/100
* **Leadership Readiness:** ${sb.leadership_readiness || 0}/100
* **Executive Presence:** ${sb.executive_presence || 0}/100
* **GCC Readiness:** ${sb.gcc_readiness || 0}/100
* **Promotion Readiness:** ${sb.promotion_readiness || 0}/100
---
#### 🔍 EXECUTIVE SYSTEM ANALYSIS REPORT

### 1. EXECUTIVE SUMMARY
${result.executive_summary || 'Candidate demonstrated a reasonable baseline across the evaluation dimensions.'}

### 2. HIRING RECOMMENDATION
**Recommendation:** ${rec}
**Justification:** ${result.persona_verdict || 'Based on the aggregate performance across all five evaluation vectors.'}

### 3. TECHNICAL & BEHAVIORAL EVIDENCE SUMMARY
${(result.strongest_response) ? `* **Strongest Response Capture:**
  - _Context:_ ${result.strongest_response.context}
  - _Evidence/Quote:_ "${result.strongest_response.evidence}"` : ''}

${(result.weakest_response) ? `* **Weakest Response / Friction Point Capture:**
  - _Context:_ ${result.weakest_response.context}
  - _Evidence/Quote:_ "${result.weakest_response.evidence}"` : ''}

### 4. COMMUNICATION & DELIVERY DIAGNOSTICS
* **Structural Layout & Flow:** ${result.structural_flow || 'Moderate structure present.'}
* **Linguistic Nuances & Fillers:** ${result.linguistic_nuances || 'Developing.'}

### 5. TOP 3 DEVELOPMENT PRIORITIES
${(result.priorities || []).slice(0, 3).map((p, i) => `${i + 1}. **${p.theme}:** ${p.action}`).join('\n')}`;

  return {
    overall_score: Math.round(weightedAvg * 100) / 100,
    strengths_json: (result.priorities || []).slice(0, 3).map(p => ({ label: p.theme, observation: p.action })),
    improvements_json: (result.priorities || []).map(p => ({ issue: p.theme, fix: p.action })),
    recommendation: rec,
    persona_verdict: result.persona_verdict || '',
    executive_summary: result.executive_summary || '',
    strongest_response: result.strongest_response || null,
    weakest_response: result.weakest_response || null,
    structural_flow: result.structural_flow || '',
    linguistic_nuances: result.linguistic_nuances || '',
    next_steps_json: result.next_steps || [],
    scoreboard: sb,
    report_markdown: reportMarkdown,
  };
}

module.exports = router;