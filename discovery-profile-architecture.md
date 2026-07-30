# Discovery Profile — Architecture Review v1.0
**Branch audited:** `founder-dashboard-staging` (commit `9430743`)
**Status:** SHIPPED — Phases 1-3 approved and implemented (config/router, opening + turn 2+ wiring, Discovery Scoring Gate, Career Stage label). Section 7 tracks post-launch backlog only; nothing below that point represents outstanding work.

---

## 1. Architecture Review — where this fits today

Audited files: `views/interview-setup.ejs`, `controllers/sessionController.js`,
`routes/interview.js`, `services/interview.js` (2,379 lines), `db/career-profile.js`,
`services/prompts/resume-intelligence.prompt.js`, `services/star/star-engine.js`.

### Current opening-question path (live code, not assumed)

```
POST /api/interview/sessions
  └─ controllers/sessionController.js :: initializeSession()
       1. validate payload (personaId, roleTitle, experienceLevel, jdText)
       2. getRoleDefaults() + getOrgTraits()
       2b. getCareerProfile(userId) → resumeContext, storyLibrary   (line 69-77)
       3. aiExtractJdCompetencies(jdText)
       4. compileWeightedCompetencyMatrix(...)
       5. createSession({..., experienceLevel, resumeContext, storyLibrary})  (line 93)
       6. generateNextQuestion({ questionCount: 0, ... })            (line 107)  ← OPENING
       7. addQuestion(...) → JSON response
```

### Current turn 2+ path (single source of truth, per its own comment at routes/interview.js:192-198)

```
POST /sessions/:id/answer  (and POST /vapi/next-question, same function)
  └─ pickAndPersistNextQuestion(...)
       - reloads session.resume_context / session.story_library (frozen snapshot)
       - computeStarProgress(lastPrimary.answer_text) → isFollowupTurn decision
       - generateNextQuestion({ questionCount: answeredQuestions.length, ... })
```

`generateNextQuestion()` itself (services/interview.js:1503) branches once on
`questionCount === 0` for the OPENING blueprint type, then proceeds through
Coverage/Competency selection, STAR-aware prompt composition, and Executive
Interview Strategy — all of which is completely untouched by this proposal.

### Where Discovery Profile sits

```
Interview Setup (views/interview-setup.ejs)
        │  data-exp="fresher|mid|senior|executive"  ← unchanged values
        ▼
Career Stage  (label renamed only)
        │
        ▼
Discovery Router          ── NEW, services/discovery/discovery-router.js
        │  reads: experienceLevel, resumeContext, storyLibrary (already in scope
        │  at sessionController.js:93 — no new data fetch)
        ▼
Opening Strategy          ── NEW, services/discovery/discovery-profiles.js
        │  produces: an opening question string + a discoveryObjective
        ▼
Discovery Objective check ── NEW, runs after each discovery-phase answer
        │  (turn 2+, inside routes/interview.js's shared function)
        ▼
================================================================
EXISTING INTERVIEW PIPELINE — UNTOUCHED
================================================================
generateNextQuestion() → Coverage Engine → Behavioral Intelligence →
Evidence Graph → STAR → Scoring → Reports
```

**Key finding:** Discovery Router and Opening Strategy sit entirely *before*
`generateNextQuestion()` is called for the opening turn, and as a *pre-check*
wrapped around the existing call for turns 2+. Nothing inside
`services/interview.js` needs to know Discovery exists — it just receives a
question to ask (from Discovery) or is called exactly as it is today (after handoff).

---

## 2. File Impact Analysis

| File | New/Modified | Why | Downstream effect |
|---|---|---|---|
| `views/interview-setup.ejs` | Modified — 1 line | `step-label` text "Select Experience Level" → "Select Career Stage" (line 558). No card markup, no `data-exp` values, no JS touched. | None — payload to `/api/interview/sessions` is byte-identical. |
| `services/discovery/discovery-profiles.js` | **New** | Config object: `DISCOVERY_PROFILES = { EARLY_CAMPUS, EARLY_PROFESSIONAL, PROFESSIONAL, LEADERSHIP, EXECUTIVE }`, each owning `openingGoal`, `openingQuestion`, `followupPrompt`, `discoveryObjective`, `maxDiscoveryTurns`. Pure data, no imports from `services/interview.js`. | None. Config only. |
| `services/discovery/discovery-router.js` | **New** | `selectDiscoveryProfile({ experienceLevel, resumeContext })` — deterministic, no AI call, no DB write. Reads `resumeContext.companies`, `resumeContext.career_level`, `resumeContext.summary` (fields already returned by `getCareerProfile()`, confirmed in `services/prompts/resume-intelligence.prompt.js:327-345`). | None — pure function, exported for use by `sessionController.js` and `routes/interview.js` only. |
| `services/discovery/discovery-objective.js` | **New** | `isDiscoveryComplete({ profile, turnsUsed, lastAnswer })` — checks `turnsUsed >= profile.maxDiscoveryTurns` OR a lightweight independent word/content check written fresh in this file. **Does not call `computeStarProgress()`** or any STAR/Evidence/Coverage export, to keep zero coupling with those engines (see Risk Assessment §4, option A vs B). | None — self-contained. |
| `controllers/sessionController.js` | Modified — additive block only | After step 5 (`createSession`, line 93) and before step 6 (`generateNextQuestion`, line 107): call `selectDiscoveryProfile()`; if the profile requires a Discovery opening, use its `openingQuestion` instead of calling `generateNextQuestion()` for turn 0; else (PROFESSIONAL/EXECUTIVE today's-default) call `generateNextQuestion()` exactly as now — **zero behavior change for existing tiers by default config.** | Existing Professional/Leadership/Executive interviews unaffected unless AIROCK opts them into a Discovery-authored opening (LEADERSHIP/EXECUTIVE per the spec do get one — flagged for sign-off in §5). |
| `routes/interview.js` | Modified — additive guard only, ~line 250 | Before the existing `generateNextQuestion()` call: if session is still in Discovery (re-derived, not stored — see §3), return the profile's next discovery question or handoff instead of calling the pipeline. Once handoff fires, this guard is bypassed forever for that session and the file behaves exactly as it does today. | Existing follow-up/primary logic (`isFollowupTurn`, `computeStarProgress`, Coverage/Scoring calls) is reached unchanged once Discovery hands off. |
| `db/interview.js`, migrations | **No change (proposed default)** | See §3 — Discovery Profile and Discovery-complete are recomputed each turn from data already on the `session` row (`experience_level`, `resume_context`, `story_library`) plus a turn counter already available (`answeredQuestions.length`). No new columns. | None. |

**Files explicitly NOT touched:** `services/interview.js` internals (Coverage
selection, `buildCalibrationState`, `composePrompt`, Executive Interview
Strategy, scoring/report functions), `services/star/star-engine.js`,
`services/harmonicAlignmentEngine.js`, any Evidence Graph or Behavioral
Intelligence module, `db/interview.js` schema.

---

## 3. Runtime Flow — full execution path

```
1. Candidate selects Career Stage card → POST /api/interview/sessions
     { experienceLevel: "fresher", ... }

2. sessionController.initializeSession()
     - getCareerProfile(userId) → resumeContext { companies: [], career_level: null, ... }
     - createSession(...) persists experience_level, resume_context, story_library
       (exactly as today — no new columns)

3. selectDiscoveryProfile({ experienceLevel: "fresher", resumeContext })
     - resumeContext.companies.length === 0  → EARLY_CAMPUS
     - resumeContext.companies.length >= 1   → EARLY_PROFESSIONAL
     - experienceLevel === "mid"             → PROFESSIONAL (discovery = pass-through,
                                                 opening generated by existing pipeline,
                                                 exactly today's behavior)
     - experienceLevel === "senior"          → LEADERSHIP
     - experienceLevel === "executive"       → EXECUTIVE

4. If profile.usesDiscoveryOpening:
     opening question = profile.openingQuestion (static, from config)
     addQuestion({ questionType: 'opening', ... })  ← same DB call as today
   Else:
     generateNextQuestion({ questionCount: 0, ... })  ← existing pipeline, unchanged

5. Candidate answers → POST /sessions/:id/answer
   routes/interview.js shared handler:
     turnsInDiscovery = count of answered questions with questionType in
                        ('opening','discovery_followup')   ← derived from existing rows,
                                                              no new column
     stillInDiscovery = turnsInDiscovery < profile.maxDiscoveryTurns
                         AND NOT isDiscoveryComplete(...)

     If stillInDiscovery:
        ask profile's next discovery question (config-driven)
     Else (first turn this becomes false = HANDOFF):
        generateNextQuestion({ questionCount, ... })  ← existing pipeline resumes,
                                                          exactly as implemented today,
                                                          forever, for the rest of the session

6. All subsequent turns: routine `stillInDiscovery` check short-circuits to false
   immediately (turnsInDiscovery already exceeds maxDiscoveryTurns), so cost of
   the check after handoff is one integer comparison per turn — no re-entry possible.
```

**No new persistent state**, per the spec's own preference: `discoveryProfile`
and `discoveryComplete` are both re-derived every turn from `experience_level`,
`resume_context`, and the existing `interview_questions` rows — the same
"compute fresh, never persist" pattern your Capability Engine already uses
(`lib/capability-engine.js`).

---

## 4. Risk Assessment

Confirmed by direct code inspection (not inference):

- **Coverage Engine** — lives inside `services/interview.js`'s competency
  selection logic (`selectNextCompetency` and friends). Never imported by any
  proposed new file. **Untouched.**
- **Behavioral Intelligence / Psychological Interviewer Model** — lines
  291-340 of `services/interview.js`. Not referenced by Discovery.
  **Untouched.**
- **Evidence Graph** — separate module per `evidence-graph-architecture.md`.
  Not imported. **Untouched.**
- **STAR Engine** — extracted to `services/star/star-engine.js`
  (`computeStarProgress` re-exported at `services/interview.js:11`). One
  design decision needs your sign-off here:
  - **Option A (recommended, zero coupling):** Discovery Objective completion
    uses its own lightweight, independently-written check inside
    `discovery-objective.js` — never calls into the STAR module.
  - **Option B:** reuse `computeStarProgress()` (already imported by
    `routes/interview.js` for the unrelated follow-up-eligibility check) as a
    read-only signal for "has the candidate given a structured-enough
    answer yet." This is a read of STAR's public output, not a modification —
    but it does create a dependency where none existed. I'd default to
    Option A unless you'd rather reuse the existing signal.
- **Scoring** — `scoreAnswer()`/`generateReport()` in `services/interview.js`.
  Not called by anything Discovery adds. **Untouched.**
- **Reports** — same file, same reasoning. **Untouched.**
- **Existing Professional/Senior/Executive interview behavior** — by default
  config, PROFESSIONAL maps to a pass-through (Discovery selects a profile but
  `usesDiscoveryOpening: false`, so `generateNextQuestion()` fires immediately
  exactly as it does today, zero output change). LEADERSHIP and EXECUTIVE *do*
  get a Discovery-authored opening per the original spec — **this is a
  behavior change for Senior/Executive tiers and needs explicit sign-off**;
  if you'd rather those two tiers also pass through unchanged (matching
  today's `OPENING_QUESTIONS['default'].senior/.executive` seeds exactly),
  say so and I'll set `usesDiscoveryOpening: false` for both.

**Overall regression risk: low**, contingent on the one open question above.
The pattern also has precedent in this exact file — the Executive Interview
Strategy layer and the Psychological Interviewer Model were both added
additively without touching Coverage/Scoring, and both are still working
today.

---

## 5. Open Decisions Needing Your Sign-Off Before Any Code

1. **LEADERSHIP/EXECUTIVE opening behavior** — Discovery-authored opening
   (per original spec) vs. pass-through/unchanged (matches today exactly)?
2. **Discovery Objective completion check** — Option A (independent, zero
   coupling) or Option B (reads `computeStarProgress()`)?
3. **EARLY_CAMPUS vs EARLY_PROFESSIONAL router heuristic** — I'm proposing
   `resumeContext.companies.length === 0` as the campus/professional split,
   since `resume_context` has no explicit "internship" flag (confirmed against
   `services/prompts/resume-intelligence.prompt.js`'s actual schema — it has
   `summary`, `career_level`, `industries`, `companies`, `customers`, no
   internship boolean). Good enough, or do you want a keyword scan of
   `summary`/`story_library` titles for "intern" as a secondary signal?

---

## 6. Implementation Plan (phased, each milestone independently testable)

**Phase 1 — Config + Router (no wiring, no behavior change)**
- Create `services/discovery/discovery-profiles.js` and `discovery-router.js`
- Unit tests: `selectDiscoveryProfile()` against fixed resume/experienceLevel
  inputs, asserting correct profile every time
- Nothing calls these yet. Deployable, zero risk.

**Phase 2 — Opening wiring (sessionController.js only)**
- Wire `selectDiscoveryProfile()` into `initializeSession()`
- Gate: if `usesDiscoveryOpening` is false for all profiles (config default),
  this phase is provably a no-op — confirm via a characterization test
  diffing opening-question output before/after for all 4 existing tiers
- Ship with LEADERSHIP/EXECUTIVE `usesDiscoveryOpening: false` until §5.1 is
  answered; flip only after sign-off

**Phase 3 — Discovery Objective + turn 2+ guard (routes/interview.js)**
- Add `discovery-objective.js`, wire the `stillInDiscovery` guard
- Test: EARLY_CAMPUS session runs 1-2 discovery turns then hands off cleanly;
  verify `generateNextQuestion()` receives the exact same shape of arguments
  post-handoff as it does in a same-tier session today

**Phase 4 — UI label rename**
- One-line change, `views/interview-setup.ejs:558`
- Cosmetic only, ships independently of 1-3

Each phase leaves staging deployable. No phase touches more than one of
{config, sessionController, routes/interview, view} at a time.

---

---

## 7. Post-Launch Backlog — Deferred Enhancements

### 7.1 Discovery-Captured Anchor Story (deferred at launch)

**Status:** Proposed, reviewed, explicitly deferred until after launch. **Not implemented — no code exists for this.** Current shipped behavior for the resume-missing fresher path is unchanged:
- Resume available → Resume Story (existing `selectStoryForCompetency()` path, untouched)
- No resume → JD/competency scenario (existing fallback, untouched)

**Rationale for deferral:** the shipped implementation (Phases 1-3) has now demonstrated stable behavior across Executive, Mid-Career, Fresher-with-resume, and Fresher-no-resume paths. This enhancement's own mechanism — minting a `story_library`-shaped entry from a Discovery answer and feeding it into the existing Interview Engine — changes an *input* to `generateNextQuestion()`/`selectStoryForCompetency()` for the no-resume fresher path specifically. That's new regression surface introduced right as the surrounding architecture has stabilized, and is correctly sequenced as a post-launch improvement rather than a pre-launch addition.

**The idea, for when it's revisited:**
```
IF Career Stage = Fresher AND Resume Missing
  → Discovery Objective: collect ONE anchor project
  → Pass that anchor into the Interview Engine
```

**Constraints agreed for when this is picked back up** (binding on the future implementation, not just this discussion):
1. **Deterministic only — no additional AI call.** The anchor's content is the candidate's own Discovery answer text (trimmed/capped), not an AI-extracted or AI-compressed summary. No new AI dependency, no new failure/fallback path.
2. **Scoped to the current interview session only.** Not written back into `career_profiles` (the candidate has no resume on file — writing there would misrepresent that). Lives on the session row itself, read only for that one interview.
3. **Must not modify the Story Selection algorithm.** `selectStoryForCompetency()` stays untouched; the anchor is contributed as one additional same-shaped entry in the `storyLibrary` array passed into the existing, unmodified function — the algorithm can't tell it apart from a resume-derived story, and doesn't need to.

**Open questions to resolve when this is picked back up** (raised during review, not yet decided):
- Exact "Resume Missing" trigger: strict (`resumeContext === null`, no upload at all) vs. broad (also includes capstone-only `EARLY_CAMPUS` resumes with zero employers). Leaning strict at proposal time — worth revisiting with real launch data on how "generic" the no-resume JD/competency path actually feels in practice.
- Whether launch usage data even shows this path needs the enhancement, or whether the JD/competency fallback performs well enough on its own to deprioritize further.

