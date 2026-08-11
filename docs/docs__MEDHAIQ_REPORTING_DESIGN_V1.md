# MedhaIQ Career Intelligence Reporting — V1 Design Specification

**Status:** Approved architecture. Step 1 (canonical builder) complete and validated. Steps 2–6 not yet started.
**Scope:** Reporting layer only (Web Report, Email Report, PDF Report).
**Document owner:** Founder Dashboard staging branch (`founder-dashboard-staging`).
**Last updated:** 2026-08-11.

---

## Do Not Change

This document is an implementation specification for the reporting layer. **It is not permission to redesign the underlying interview or scoring system.** The following are authoritative and out of scope for every step of this project:

- `services/interview.js` — `scoreAnswer()`, `SCORING_SYSTEM`, `generateReport()`, `REPORT_SYSTEM`, adaptive question selection, question termination logic.
- `services/star/star-engine.js` — STAR detection (`computeStarProgress()`, `STAR_PATTERNS`, `STAR_ORDER`).
- The live interview UI, Vapi/STT/TTS/voice pipeline.
- Authentication, RBAC, `lib/capability-engine.js`'s existing behavior (only additive permission entries are in scope, in Step 5).
- The existing scoring values, weights, and semantics of `star_score`, `technical_depth`, `executive_presence`, `gcc_readiness`, `core_friction`.
- `services/pdf-report.js` internals, beyond what was already independently patched (`fc5f6a7`, `da446b0`).

Any future change to what the raw scoring fields measure, or to their weights, is a separate V2 scoring-model project and must not be mixed into this work.

---

## 1. Reporting Architecture

MedhaIQ has **one** canonical Career Intelligence Report. Web Report, Email Report, and PDF Report are presentation layers that consume the same canonical object — none of them independently calculates scores, summaries, STAR results, strengths, or recommendations.

```
Interview
  ↓
Existing interview/scoring system   (services/interview.js — UNCHANGED)
  ↓
Existing stored interview data      (interview_scores, interview_reports, interview_questions)
  ↓
CareerIntelligenceReport builder    (lib/career-intelligence-report.js — NEW, Step 1, COMPLETE)
  ↓
┌─────────────┬─────────────┬─────────────┐
│ Web Report  │ Email       │ PDF         │
└─────────────┴─────────────┴─────────────┘
```

This directly retires the architecture that caused the confirmed Web/PDF vs Email divergence: Web and PDF previously recalculated the five vectors live from `interview_scores`, while Email read a separately AI-generated `interview_reports.scoreboard` JSON blob with different field names and a `||`-based zero-score bug. After Steps 2–4, all three read from one function call.

---

## 2. Five User-Facing Vectors

The five vector names are identical everywhere — interview terminal, Web Report, Email Report, PDF Report:

1. **Structure**
2. **Domain Expertise**
3. **Strategic Thinking**
4. **Communication**
5. **Leadership & Execution**

### This is a reporting-layer compatibility mapping, not a scoring redesign

The underlying scoring fields, weights, prompts, and scoring semantics in `services/interview.js` are **unchanged**. The mapping below only decides which existing raw number is displayed under which product-facing label:

| Product-facing vector | Raw field (`interview_scores` column) | Status |
|---|---|---|
| Structure | `star_score` | Direct conceptual match |
| Domain Expertise | `technical_depth` | Direct conceptual match |
| Strategic Thinking | `executive_presence` | **Compatibility mapping** — see note below |
| Communication | `core_friction` | Direct conceptual match |
| Leadership & Execution | `gcc_readiness` | **Compatibility mapping** — see note below |

> **Compatibility mapping note:** "Strategic Thinking" and "Leadership & Execution" are current display labels for `executive_presence` (which the scoring rubric defines as *executive presence & leadership vocabulary* — tone, seniority, delivery) and `gcc_readiness` (which the rubric defines as *GCC/enterprise readiness* — matrixed/cross-border/compliance competence). This is **not** a claim that the scorer measures trade-off reasoning, prioritization, business judgment, ownership, stakeholder management, or execution directly. A future V2 scoring-model project may redefine what these raw fields measure so the labels and the rubric agree natively. That project is explicitly out of scope here.

No weight percentages are displayed anywhere in the report. The product's stated model (35/25/20/10/10) does not match the scoring engine's actual weights (25/25/20/15/15); showing either would create a new inconsistency, so V1 shows scores only:

```
Structure                 82
Domain Expertise          74
Strategic Thinking        68
Communication              61
Leadership & Execution    57
```

---

## 3. Canonical Report Object

Implemented in `lib/career-intelligence-report.js`, function `buildCareerIntelligenceReport({ report, scoresData, questions, persona })`. Pure function — no AI call, no database call. Its three inputs are exactly the three calls the Web and PDF routes already make today (`getReport`, `getSessionScores`, `getSessionQuestions`).

| Field | Source | Notes |
|---|---|---|
| `sessionContext` | `report.role_title`, `.experience_level`, `.org_preset`, `.started_at`, `.ended_at`, `persona` param, answered-question count | `durationMinutes` computed from `ended_at - started_at`, unchanged inputs |
| `overallScore` | `report.overall_score` | Unchanged — already consistent across surfaces prior to this project; not a source of the divergence |
| `recommendation` | `report.recommendation` | Unchanged AI-generated field from `generateReport()` |
| `fiveVectors` | Averages of `interview_scores` columns via the locked mapping (§2) | Same `avg()` logic already duplicated in `server.js`'s web and PDF routes, now centralized |
| `starIntelligence` | `computeStarProgress()` re-run over stored answer text, per question | Identical function/regex/order to the existing PDF route; per-question `star_components` were never persisted (pre-existing gap, not introduced here) |
| `executiveSummary` | `report.executive_summary` | Existing AI narrative field, unchanged |
| `strengths` / `developmentPriorities` | Ranked from `fiveVectors` (top-N / bottom-N, non-overlapping) | Numeric ranking only — does **not** read `scoreboard.vector_breakdown` (the retired legacy AI JSON) |
| `questionEvidence` | Per-question rows from `questions` + `scoresData`, relabeled to the five product-facing vectors | Same shape as the existing PDF route's `qaCards` |
| `coachingInsights` | `report.structural_flow`, `.linguistic_nuances`, `.persona_verdict`, `.strongest_response`, `.weakest_response` | Existing narrative fields on the `interview_reports` row itself — **not** re-parsed from `scoreboard` JSON |
| `careerRoadmap` | `report.next_steps_json` | Unchanged |
| `nextPracticeFocus` | Lowest-ranked vector from `fiveVectors` | Derived, not stored |

**Explicit confirmations:**
- No AI call is made by the builder (`grep` for `chatJSON`/`anthropic`/`fetch(` in the file returns zero matches).
- No new scoring is performed — every number is an existing average or an existing derivation already computed elsewhere in the codebase today, just centralized into one function.
- No database migration is required — no schema change, no new column.
- Existing scoring values (`interview_scores`) remain authoritative.
- Existing STAR detection (`computeStarProgress()`) remains authoritative.
- `interview_reports.scoreboard`'s five numeric fields (`career_intelligence`, `leadership_readiness`, `executive_presence`, `gcc_readiness`, `promotion_readiness`) are retired as a source for the canonical object. The column itself is untouched in the database (§11).

---

## 4. Explorer — "See your signal"

Concise report, Web only.

**Includes:**
- Overall Score
- Five vectors
- One Strength
- One Development Priority
- One STAR Insight
- Short explanation
- Clear upgrade CTA

**Excludes:** full question evidence, full STAR analysis, full coaching analysis, full roadmap.

Explorer's single strength/priority/STAR-insight are slices of the *same* ranked `strengths[]` / `developmentPriorities[]` / `starIntelligence` the builder produces for Growth and Leadership — not a separate, smaller calculation. This preserves the "same intelligence, different depth" rule even at the free tier.

---

## 5. Growth — "Understand and improve it"

**Includes:** everything Explorer receives, plus full five-vector interpretation, full STAR analysis, question evidence, all strengths, all development priorities, executive summary, full coaching insights, career roadmap, next practice focus.

**Delivery:** full Web Report + full Email Report.

The Email Report is a concise executive briefing — score, five vectors, strongest signal, priority, STAR signal, CTA — **not** a PDF compressed into an email body.

---

## 6. Leadership — "Own your intelligence"

**Includes:** everything in Growth, plus a premium downloadable PDF (~3 pages), deeper evidence interpretation, and an executive-level presentation intended to be saved, reviewed later, or shared with a mentor/coach — not simply a longer Growth email.

---

## 7. PDF Visual Design

**Must use:** white background throughout; premium executive-document aesthetic; dark charcoal typography; restrained single MedhaIQ brand accent color; light-grey dividers/cards; clean 5-vector visualization (horizontal bars or restrained score cards); strong typography hierarchy; page numbers; MedhaIQ footer.

**Must not use:** dark full-page backgrounds; heavy gradients; rainbow/multi-color vector charts; excessive decorative graphics; dashboard-like styling.

Target: approximately 3 pages, no padding to reach a longer count. Existing report content and structure (executive summary, 5-vector page, STAR/evidence page, roadmap page) is preserved — this is a presentation redesign of existing sections, not a rebuild of the report concept.

---

## 8. Email Design

Clean white/light executive style. Approximate structure:

```
Career Intelligence Report
Role / career context
Overall score

Five vectors:
  Structure
  Domain Expertise
  Strategic Thinking
  Communication
  Leadership & Execution

Your strongest signal
Your priority
Your STAR signal

CTA: View Your Full Career Intelligence Report
```

Growth is positioned as the natural next step (deeper analysis/coaching) where the recipient's tier is Explorer.

**Hard requirements:**
- Consumes the same canonical object as Web/PDF — no independent vector calculation.
- No falsy `||` fallback that converts a genuine `0` into a different score. (Confirmed bug in the current `services/email.js`: `sb.career_intelligence || score` — a legitimate `0` is replaced by `overall_score`. Fixed as part of Step 4, not before.)

---

## 9. Consistency Rules (hard requirements)

- Same score = same score everywhere.
- Same five vector names everywhere.
- Same STAR interpretation everywhere.
- A genuine `0` must remain `0`.
- Web, Email, and PDF must not independently recalculate the five vectors.
- No second AI scoring call is introduced anywhere in this project.
- No report surface may invent evidence that does not exist.

---

## 10. Entitlement Matrix

| Capability | Explorer | Growth | Leadership |
|---|:---:|:---:|:---:|
| Overall score | ✓ | ✓ | ✓ |
| Five vectors | ✓ | ✓ | ✓ |
| 1 strength | ✓ | ✓ | ✓ |
| 1 priority | ✓ | ✓ | ✓ |
| 1 STAR insight | ✓ | ✓ | ✓ |
| Full STAR analysis | — | ✓ | ✓ |
| Question evidence | — | ✓ | ✓ |
| Full coaching | — | ✓ | ✓ |
| Development priorities (full list) | — | ✓ | ✓ |
| Career roadmap | — | ✓ | ✓ |
| Email report | —  *(confirmation only)* | ✓ | ✓ |
| PDF | — | — | ✓ |

Exact entitlement implementation (new `reports.full` permission in `config/product-packages.js`, consumed by `lib/capability-engine.js`) is a Step 5 coding task, not decided further here.

---

## 11. Existing Code to Preserve

Explicitly authoritative and unmodified by this project:

- `services/interview.js` — `scoreAnswer()`, `SCORING_SYSTEM`, `generateReport()`, `REPORT_SYSTEM`.
- `services/star/star-engine.js`.
- Adaptive interview/question selection and termination logic.
- Vapi / STT / TTS / voice pipeline.
- Live interview UI.
- `interview_reports.scoreboard` column itself — retained in the database for its narrative-generation role inside `generateReport()`; only its five numeric fields stop being read by the reporting layer.

---

## 12. Implementation Phases

| Step | Description | Status |
|---|---|---|
| 1 | Create and validate canonical builder (`lib/career-intelligence-report.js`) | **COMPLETE** |
| 2 | Wire canonical builder into PDF route — first preserve existing PDF content/structure while switching its data source to the canonical object, then redesign presentation to the approved white executive style | Not started |
| 3 | Wire Web Report to canonical builder | Not started |
| 4 | Wire Email Report to canonical builder (includes fixing the `||`-zero bug as part of the same change) | Not started |
| 5 | Implement Explorer/Growth/Leadership report-depth entitlement | Not started |
| 6 | Final consistency and regression testing across all three surfaces | Not started |

Each step requires validation before the next begins. No step combines with another in the same commit (§14).

---

## 13. Testing Requirements

Every step's validation must cover, where applicable:

- Low-evidence session (e.g. 226).
- Normal successful interview.
- Genuine zero vector.
- Non-zero vector.
- Strong STAR session.
- Weak STAR session.
- Explorer entitlement.
- Growth entitlement.
- Leadership entitlement.
- Web/PDF/Email score consistency (same session → same numbers on all three).
- Five-vector terminology consistency (same labels on all three, and matching the live interview terminal).
- No duplicate AI scoring call introduced.
- No change to interview/scoring behavior for a fixed transcript.

> **Important — fixture vs. live data:** The Step 1 validation of session 226 was reconstructed from the uploaded `MedhaIQ-Report-226.pdf` (this environment has no network path to the live Neon/Supabase database). It is a fixture test, not a live database validation. A future staging validation, before this ships, must re-run the same assertions against actual session data pulled from the running application.

---

## 14. Rollback / Safety Principle

Every implementation phase must be independently reviewable and independently reversible. Reporting-refactor work, interview fixes, scoring changes, PDF-infrastructure fixes, and UI changes are never combined into one commit. Each of Steps 2–6 above ships as its own isolated, revertible change.
