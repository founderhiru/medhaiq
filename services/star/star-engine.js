// ═══════════════════════════════════════════════════════════════════════════
// Module: STAREngine (Phase 2A — pure extraction, 2026-07-24)
//
// Architecture: MedhaIQ Architecture Specification v1.1 / Migration Blueprint
//
// Owns:
//   - computeStarProgress
//   - STAR_PATTERNS / STAR_ORDER / STAR_TRIVIAL_RE / STAR_MIN_WORDS
//
// Writes:
//   Deterministic STAR completeness result (situation/task/action/result
//   booleans + stepsComplete/missing/status)
//
// Reads:
//   Raw answer text, and an optional aiComponents object (per-letter AI
//   judgment from scoreAnswer's star_components — see "Must NOT" below)
//
// Must NOT (Phase 2A — strictly architectural, per founder direction):
//   - change any regex pattern, threshold, or return shape — this is a pure
//     relocation, not a redesign
//   - perform or influence report scoring (scoreAnswer/generateReport and
//     their prompts stay in services/interview.js, completely untouched —
//     STAR_TRIVIAL_RE is re-exported and required back there for
//     generateReport's existing evidence-census use, exactly as it worked
//     before this extraction, never duplicated or reimplemented)
//   - call any LLM
//   - introduce behavioural-evidence extraction (leadership, ownership,
//     stakeholder management, etc.) — that is explicitly Phase 2B, a new
//     capability, not part of this extraction
//
// ─────────────────────────────────────────────────────────────────────────
// KNOWN DUPLICATION — documented, not fixed, per explicit Phase 2A scope:
//
//   views/interview-session.ejs has its OWN hand-copied version of
//   STAR_PATTERNS/STAR_ORDER, running entirely client-side for the live
//   "STAR Progress (Real-time Detection)" indicator — it does not call
//   this module or any server endpoint. The two copies must be kept
//   byte-identical by hand; the client file carries a matching comment.
//
//   TODO (future phase, NOT Phase 2A/2B): extract a single shared STAR
//   detection library consumable by both server and client (e.g. a small
//   isomorphic module bundled for the browser, or a lightweight endpoint
//   the client calls instead of re-implementing the regex set) so this
//   dual-copy-by-convention risk is closed structurally instead of by
//   discipline. Explicitly out of scope here per Phase 2A being a pure,
//   behavior-preserving relocation.
// ─────────────────────────────────────────────────────────────────────────
//
// Phase 2A extraction note: every line below is moved VERBATIM from
// services/interview.js — no regex, threshold, or return shape was
// changed. See tests/star-engine-characterization.js for the before/after
// verification this extraction was checked against.
// ═══════════════════════════════════════════════════════════════════════════

// ── STAR Progress detector ──────────────────────────────────────────────────
// Lightweight, deterministic keyword/structure heuristic (no extra AI call —
// this runs instantly so the Live Terminal can light up S/T/A/R the moment
// an answer is submitted). It is intentionally conservative: each letter only
// lights up when the answer contains a real signal for that STAR component,
// not just because *some* text was typed.
// NOTE: kept IDENTICAL to STAR_PATTERNS in views/interview-session.ejs so the
// live client view and this server verdict always agree. Edit both together.
// Executive vocabulary expansion (2026-07-25) — the ORIGINAL patterns
// below were built around how a mid-level individual contributor
// describes a project (verb + metric for Result, first-person ownership
// phrases for Task). Tested directly against real executive/senior-level
// phrasing and found: Result matched 0 of 7 real examples, Task 2 of 5,
// Situation 1 of 3. This version is organized around executive
// communication patterns specifically (organizational transformation,
// mandate/charter language, outcome noun-phrases like "a $758M pipeline"
// or "customer adoption increased" that don't use the verb+metric shape
// the old Result pattern required) — verified against the same real
// examples plus adversarial false-positive controls (sentences that
// should NOT trigger a category) before landing here. See
// tests/star-vocabulary-executive.js for the full before/after suite.
//
// This stays a fast, deterministic, zero-cost regex — no LLM call, same
// architecture as before. A genuinely broader vocabulary matched more
// forgivingly is the intended fix here, not a redesign of the detection
// approach. (Planned, not yet built: Phase 2 will pass scoreAnswer's own
// AI-judged star_components into this function's existing aiComponents
// parameter after an answer is submitted, to confirm/upgrade the live
// verdict post-hoc — see computeStarProgress below, which already
// accepts that parameter and already merges it in when present.)
const STAR_PATTERNS = {
  situation: /\b(when i|at my (previous|last|current)|in my role|while (working|leading)|the (context|situation|background) was|we (were|had) facing|a few (months|years|weeks) ago|during|last (year|quarter|month|week)|in (19|20)\s?\d{2}|i was working (on|at|with)|we were (building|working|running|struggling)|at (a|an|the|our) (company|startup|client|firm)|(our|the|a) (customer|client)s? (wanted|needed|was (asking|looking)|had a)|we had a (customer|client)|organi[sz]ational (transformation|change|restructur\w*)|(business|digital) transformation|merger|acquisition|restructur(e|ed|ing)|regulatory change|market shift|customer escalation|executive directive|the organi[sz]ation was (going through|facing|undergoing)|operating model|before we started|inherited a (team|situation|org)|walked into|(business|customer|market) environment|landscape)\b/i,
  task: /\b(my (task|responsibility|goal|objective|job|mandate|charter)([^.]{0,25})? was|i was (responsible|asked|tasked|expected|accountable)|(we|i) need(ed)? to|had to (deliver|fix|solve|build|reduce|improve|decide|align|navigate)|the (goal|objective|target|challenge|problem|ask|mandate|charter) was|asked me to|i had to|(we|i) (had to|needed to) assess|leadership expected|(the )?business objective|board expectation|accountable for|trade-?off|decision required|governance|i owned|had ownership of)\b/i,
  action: /\b(i (led|built|designed|redesigned|rebuilt|reimplemented|rearchitected|re-?architected|recreated|implemented|created|drove|decided|initiated|coordinated|proposed|negotiated|restructured|launched|rolled out|owned|developed|managed|organi[sz]ed|automated|migrated|deployed|fixed|resolved|refactored|presented|convinced|persuaded|established|introduced|analy[sz]ed|started|began|took|worked|aligned|influenced|prioriti[sz]ed|challenged|orchestrated|simplified|escalated|coached|collaborated|ended up (redesigning|rebuilding|building|designing|creating))|i (was|am|'m)[\s,]*(uh|um|like)?[\s,]*(leading|building|designing|managing|driving|running|developing|creating|working on|coordinating|organi[sz]ing|aligning|influencing|negotiating|orchestrating)|we (implemented|built|created|designed|redesigned|rebuilt|launched|migrated|deployed|developed|automated|redesigned|rolled out|restructured|aligned|negotiated|collaborated|simplified|orchestrated|prioriti[sz]ed)|my approach was|so i\b|then i\b|secured? (buy-?in|alignment|support)|drove adoption)/i,
  result: /\b(as a result|resulted in|which (led to|resulted)|(reduced|increased|improved|grew|cut|saved|boosted)[^.]{0,40}(\d+%|\$|percent)|the (outcome|impact) was|(we|i) (achieved|delivered|secured)|ended up|in the end|leading to|\d+\s?%|that'?s how (we|i) decided|\$\s?\d|\d+(\.\d+)?\s?(million|billion|thousand|[mbk]\b)|(customer|user) (adoption|retention|satisfaction)|follow-?on (business|contract|work|engagement)|(the )?(engagement|contract|deal|scope) expanded|standardi[sz]ed (on|the|across)|(revenue|arr|pipeline|bookings|roi)\b|cost avoidance|time-to-market|productivity (gain|improvement|increase)|executive approval|business value|transformation (succeeded|success)|stakeholder alignment|renewal|expansion|promotion|recognition|measurable (impact|outcome|result)|reduced (delivery|cycle|turnaround) time|faster delivery|increased (quality|efficiency)|became a[^.]{0,20}(pipeline|opportunity|deal))\b/i,
};

const STAR_ORDER = ['situation', 'task', 'action', 'result'];

// Conversational fillers that must NEVER earn a STAR component, regardless of
// what any pattern or AI says. Mirrors the trivial-answer floor in scoreAnswer.
const STAR_TRIVIAL_RE = /^(hi|hello|hey|yo|test|testing|idk|i\s*don'?t\s*know|n\/a|none|na|ok|okay|sure|yes|no|cool|nice|thanks|thank you|hmm+|umm+)[\s.!?,]*$/i;
// Lowered from 10 to 7 (2026-07-25, founder-approved): 10 words was
// conservative for an executive who might open with a substantive,
// compact sentence ("I had to align three groups on strategy" is 9
// words). Independent of the vocabulary expansion above — this only
// changes when the substance gate applies at all, not what counts as a
// match once past it.
const STAR_MIN_WORDS = 7;

// aiComponents (optional): per-letter booleans returned by the AI scorer
// (scoreAnswer → star_components). When provided, a letter counts as present
// if EITHER the keyword pass OR the AI judged it present — the AI catches
// phrasings the keywords miss, the keywords guarantee a deterministic floor.
// Fully backward compatible: existing calls with one argument behave as before.
//
// SUBSTANCE GATE (deterministic, runs BEFORE any pattern or AI opinion):
// if the answer is under STAR_MIN_WORDS words, or is a conversational filler
// ("hi", "cool", "yes"...), every component is false and status is
// 'not_addressed'. This is enforced in code so a generous AI can never
// certify STAR structure from an empty or low-effort input.
function computeStarProgress(answerText, aiComponents) {
  const raw = (answerText || '').trim();
  const wordCount = raw.split(/\s+/).filter(Boolean).length;
  if (wordCount < STAR_MIN_WORDS || STAR_TRIVIAL_RE.test(raw)) {
    return {
      situation: false, task: false, action: false, result: false,
      stepsComplete: 0, totalSteps: 4,
      missing: [...STAR_ORDER],
      status: 'not_addressed',
    };
  }
  const text = raw.toLowerCase();
  const progress = {};
  STAR_ORDER.forEach((key) => {
    progress[key] = STAR_PATTERNS[key].test(text) || !!(aiComponents && aiComponents[key] === true);
  });
  const stepsComplete = Object.values(progress).filter(Boolean).length;
  const missing = STAR_ORDER.filter((key) => !progress[key]); // additive — safe for existing consumers
  return { ...progress, stepsComplete, totalSteps: 4, missing, status: 'evaluated' };
}

module.exports = {
  computeStarProgress,
  STAR_PATTERNS,
  STAR_ORDER,
  STAR_TRIVIAL_RE,
  STAR_MIN_WORDS,
};
