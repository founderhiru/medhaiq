# Evidence Graph — Architecture Document
**Milestone 2A (Behavioral Intelligence → Evidence Graph)**
**Status: log-only, read-only, no downstream consumers**

## What it is

Evidence Graph is a read-only aggregation layer that answers one question none of MedhaIQ's existing systems could answer on their own: **when a competency or behavioral category has multiple pieces of evidence behind it, did that evidence come from one experience or several?**

`EVIDENCE_TIERS`/`runHypothesisEngine` (already live, unchanged, reused directly) already track *how much* evidence exists and *how strong* it is, per competency and per behavioral category independently. What none of that infrastructure tracks is *where* each piece of evidence came from — so "Leadership: Strong Evidence, 3 observations" reads identically whether those 3 observations came from 3 different stories or the same story told 3 times. Evidence Graph exists to make that distinction visible.

## The three entities

```
Experience ──1:N── EvidenceNode ──N:1── (Competency | BehavioralCategory)
```

**Experience** — a distinct story or scenario. Identified by `story:{story_key}` when a résumé story is behind it, or `turn:{turnIndex}` for a no-story turn (hypothetical, JD-scenario, or behavioural type). Carries `id`, `type` (`resume_story` | `no_story_turn`), `origin`, `firstTurnIdx`, `turnIndices[]` (every turn that touched this experience — a primary and its follow-up share one Experience when they share a `story_key`), and `createdAt`.

**EvidenceNode** — one immutable observation: this turn, this competency-or-category, this experience, this evidence tier, whether the answer was STAR-complete. Frozen at creation (`Object.freeze`). If new information changes what's true, a *new* node is added — an existing node is never edited. Confidence changes happen through re-aggregation over the full node set, not mutation of history.

**EvidenceGraph** — the object that owns both collections together (`experiences: Map`, `evidenceNodes: Array`) and exposes query/aggregation methods over them, rather than passing the two collections around separately.

## How it's built

`buildEvidenceGraph(qaPairs, hypothesisMap, behavioralHypothesisMap)` is a pure function, computed fresh every turn — the same rebuild-every-turn philosophy `memoryMap`/`hypothesisMap` already use, so no new persistence is introduced. It reads:
- `qaPairs` — for the raw answer text, `story_key`, `competency`, skip status.
- `hypothesisMap` — Conversation Memory's already-computed structural-competency tiers.
- `behavioralHypothesisMap` — Phase 2B's already-computed behavioral-category tiers.

It calls `computeStarProgress` (STAR Engine) and `detectBehavioralCategories` (Behavioral Evidence Engine) directly — both pure, already-existing functions — to determine STAR-completeness and which categories a given answer touches. **None of the three systems it reads from are modified in any way.**

## Query surface

Three families, matching how consumers naturally think about the graph:

| Family | Methods |
|---|---|
| **Experience** | `getExperience(id)`, `getAllExperiences()`, `getExperiencesByType(type)` |
| **Evidence** | `getAllEvidenceNodes()`, `getEvidenceForExperience(id)`, `getEvidenceForTurn(turnIdx)` |
| **Summary** | `getCoverageSummary(dimension, key)`, `getObservedKeys()`, `getFullSummary()` |

All read-only; all return copies where the underlying collection could otherwise be mutated by a caller (`getAllEvidenceNodes()` returns a new array each call, not the live internal one).

## What it deliberately does not do (this milestone)

- No LLM call anywhere in the build path.
- No database writes — nothing persists across a process restart.
- No consumer — `composePrompt`, `scoreAnswer`, Coverage Engine, and `selectNextCompetency` neither read from nor are influenced by this graph. Verified structurally: `buildInterviewSnapshot`'s return shape is unchanged by Evidence Graph's presence, confirmed by a dedicated test.
- No modification to Conversation Memory, STAR, Behavioral Evidence, Story Consistency, or Resume Intelligence — every one of them is read from, none are changed.

## Known limitation

`qaPairs`, as currently constructed, carries no primary/follow-up type field and no parent-question link. A follow-up to a **no-story** primary therefore can't yet be grouped into the same Experience as its primary — each is currently treated as its own `turn:{turnIndex}` experience. Story-backed turns are unaffected (Story Consistency already forces a shared `story_key` across a primary and its follow-up). Closing this gap means surfacing the already-existing `parent_question_id` database column into the `qaPairs` contract — a small, well-scoped future addition, not built in this pass.

## What this enables later (not built yet)

Once validated against real interviews and explicitly wired in as its own reviewed step (mirroring how Coverage Engine integration was called out as its own checkpoint, not folded into shipping the graph):
- Follow-up decisions that prefer thin, single-experience evidence over evidence already backed by multiple independent experiences.
- A concrete, checkable "evidence saturation" signal.
- Candidate Story Diversity — recognizing when one experience has been sufficiently mined and steering toward a new one. The `Experience` entity and per-key distinct-experience counting already in place are exactly the primitives that capability will need; nothing further has to be built to make it possible later.
