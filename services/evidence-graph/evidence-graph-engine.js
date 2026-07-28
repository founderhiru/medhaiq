// ═══════════════════════════════════════════════════════════════════════════
// Module: EvidenceGraph (Milestone 2A, 2026-07-29)
//
// Architecture: MedhaIQ Architecture Roadmap — Milestone 2 (Evidence
// Graph), first pass (2A). Log-only, read-only — no downstream consumers.
// Built entirely from data already computed by Conversation Memory, STAR,
// and Behavioral Evidence; does not modify any of those systems.
//
// Founder-approved refinements incorporated:
//   1. Experience is a richer first-class entity (id, type, origin,
//      timestamps, turn membership) — not just a bare story key.
//   2. EvidenceNode is an immutable observation (Object.freeze'd on
//      creation). Confidence/tier changes happen through re-aggregation
//      over the full node set, never by mutating an existing node.
//   3. EvidenceGraph is itself a first-class object owning Experiences,
//      EvidenceNodes, and derived summaries — not a bag of loose arrays.
//
// Must NOT (Milestone 2A scope):
//   - call any LLM
//   - write to the database, or persist anything across process restarts
//   - feed composePrompt, scoring, Coverage Engine, selectNextCompetency,
//     or any follow-up/rotation decision — this module's output is
//     log-only in this phase, full stop, mirroring Phase 2B's own
//     first-pass discipline exactly
//   - modify Conversation Memory, STAR, Behavioral Evidence, Story
//     Consistency, or Resume Intelligence in any way — every input below
//     is READ from those systems' existing, unmodified outputs
//
// Known limitation, stated honestly rather than worked around: qaPairs
// (as currently constructed in routes/interview.js) does not carry a
// primary/follow-up type field or a parent-question link. A follow-up to
// a no-story primary therefore cannot currently be grouped into the same
// Experience as its primary without reaching into that data contract,
// which this milestone deliberately does not touch. Every no-story turn
// (whether a primary or a follow-up) is treated as its own Experience for
// now. Story-backed turns are unaffected by this limitation — Story
// Consistency already forces the same story_key across a primary and its
// follow-up, so those group correctly today. Closing this gap for
// no-story turns is a natural, small follow-up (surfacing
// parent_question_id, already present in the database, into qaPairs) —
// explicitly not built in this pass.
// ═══════════════════════════════════════════════════════════════════════════

const { computeStarProgress } = require('../star/star-engine');
const { detectBehavioralCategories } = require('../behavioral/behavioral-evidence-engine');

/**
 * Experience — refinement #1: a richer first-class entity, not a bare key.
 */
class Experience {
  constructor({ id, type, origin, firstTurnIdx }) {
    this.id = id;
    this.type = type; // 'resume_story' | 'no_story_turn'
    this.origin = origin; // story_key for resume_story; null for no_story_turn
    this.firstTurnIdx = firstTurnIdx;
    this.turnIndices = [firstTurnIdx];
    this.createdAt = new Date().toISOString();
  }

  addTurn(turnIdx) {
    if (!this.turnIndices.includes(turnIdx)) this.turnIndices.push(turnIdx);
  }
}

/**
 * EvidenceNode — refinement #2: an immutable observation. Frozen at
 * creation; never edited afterward. If new information changes what's
 * "true" about a dimension/key, a NEW node is added — aggregation
 * (EvidenceGraph.getCoverageSummary) recomputes over the full set, the
 * old node is never rewritten.
 */
function createEvidenceNode({ dimension, key, turnIdx, experienceId, evidenceTier, starComplete }) {
  return Object.freeze({
    dimension,      // 'competency' | 'behavioral'
    key,            // e.g. 'leadership' | 'executive_influence'
    turnIdx,
    experienceId,
    evidenceTier,   // the existing EVIDENCE_TIERS object, unchanged, passed through
    starComplete,   // boolean — from computeStarProgress, this turn's answer
    createdAt: new Date().toISOString(),
  });
}

/**
 * EvidenceGraph — refinement #3: a first-class object owning Experiences,
 * EvidenceNodes, and the relationships/summaries between them, rather than
 * a collection of loose arrays passed around independently.
 */
class EvidenceGraph {
  constructor() {
    this.experiences = new Map(); // id -> Experience
    this.evidenceNodes = [];      // array of frozen EvidenceNode objects
  }

  getOrCreateExperience({ id, type, origin, turnIdx }) {
    let exp = this.experiences.get(id);
    if (!exp) {
      exp = new Experience({ id, type, origin, firstTurnIdx: turnIdx });
      this.experiences.set(id, exp);
    } else {
      exp.addTurn(turnIdx);
    }
    return exp;
  }

  addEvidenceNode(node) {
    this.evidenceNodes.push(node); // append-only; existing nodes are never mutated
  }

  getNodesFor(dimension, key) {
    return this.evidenceNodes.filter((n) => n.dimension === dimension && n.key === key);
  }

  /**
   * Derived, computed-not-stored summary. Called with (dimension, key) it
   * returns one summary object, exactly as before Milestone 2B. Called
   * with NO arguments, it returns the full summary array across every
   * (dimension, key) pair actually observed in the graph — the shape
   * requested for Milestone 2B's query API. Backward compatible: every
   * existing call site with two arguments behaves identically to before.
   */
  getCoverageSummary(dimension, key) {
    if (dimension === undefined && key === undefined) {
      return this.getObservedKeys().map(({ dimension: d, key: k }) => this.getCoverageSummary(d, k));
    }
    const nodes = this.getNodesFor(dimension, key);
    const distinctExperienceIds = new Set(nodes.map((n) => n.experienceId));
    const starCompleteCount = nodes.filter((n) => n.starComplete).length;
    return {
      dimension,
      key,
      totalObservations: nodes.length,
      distinctExperienceCount: distinctExperienceIds.size,
      starCompleteCount,
      // Highest tier level observed across all nodes for this key — the
      // graph doesn't invent a new tier scale, it surfaces the best of
      // what EVIDENCE_TIERS already computed per node.
      bestTierLabel: nodes.length
        ? nodes.reduce((best, n) => (n.evidenceTier.level > best.level ? n.evidenceTier : best), nodes[0].evidenceTier).label
        : 'No Evidence',
    };
  }

  // ── Milestone 2B query API (2026-07-29) ──────────────────────────────
  // All read-only. No method below mutates experiences, evidenceNodes, or
  // any EvidenceNode's contents. This is the "clean query layer" the
  // milestone asks for — every method is a view over data already built
  // by buildEvidenceGraph, computed on demand, never stored.

  /** A single Experience by id, or undefined if it doesn't exist. */
  getExperience(id) {
    return this.experiences.get(id);
  }

  /** Every Experience currently in the graph, as a plain array — a copy;
   * mutating the returned array never affects the graph's internal Map. */
  getExperiences() {
    return Array.from(this.experiences.values());
  }

  /** All Experiences of a given type ('resume_story' | 'no_story_turn'). */
  getExperiencesByType(type) {
    return this.getExperiences().filter((exp) => exp.type === type);
  }

  /** All EvidenceNodes recorded for a structural competency. */
  getEvidenceForCompetency(key) {
    return this.getNodesFor('competency', key);
  }

  /** All EvidenceNodes recorded for a behavioral category. */
  getEvidenceForBehavior(key) {
    return this.getNodesFor('behavioral', key);
  }

  /** A shallow copy of every EvidenceNode in the graph, in insertion
   * order. A copy, not the live internal array. */
  getAllEvidenceNodes() {
    return this.evidenceNodes.slice();
  }

  /** All EvidenceNodes tied to one specific Experience, across every
   * dimension/key it touched. */
  getEvidenceForExperience(experienceId) {
    return this.evidenceNodes.filter((n) => n.experienceId === experienceId);
  }

  /** All EvidenceNodes recorded at a specific turn index. */
  getEvidenceForTurn(turnIdx) {
    return this.evidenceNodes.filter((n) => n.turnIdx === turnIdx);
  }

  /** Every distinct (dimension, key) pair currently present in the graph. */
  getObservedKeys() {
    const seen = new Set();
    const result = [];
    this.evidenceNodes.forEach((n) => {
      const id = `${n.dimension}:${n.key}`;
      if (!seen.has(id)) {
        seen.add(id);
        result.push({ dimension: n.dimension, key: n.key });
      }
    });
    return result;
  }

  /**
   * Per-EXPERIENCE view — the inverse of getCoverageSummary(): for each
   * experience, which (dimension, key) pairs did it contribute evidence
   * to. This is what the enhanced [EVIDENCE-GRAPH] log's "Experiences:"
   * section is built from (see services/interview.js).
   */
  getExperienceCoverage() {
    return this.getExperiences().map((exp) => {
      const nodes = this.getEvidenceForExperience(exp.id);
      const keysCovered = [];
      const seen = new Set();
      nodes.forEach((n) => {
        const id = `${n.dimension}:${n.key}`;
        if (!seen.has(id)) { seen.add(id); keysCovered.push({ dimension: n.dimension, key: n.key }); }
      });
      return { experienceId: exp.id, type: exp.type, turnIndices: exp.turnIndices.slice(), keysCovered };
    });
  }

  /** getCoverageSummary() filtered to structural competencies only. */
  getCompetencyCoverage() {
    return this.getCoverageSummary().filter((s) => s.dimension === 'competency');
  }

  /** getCoverageSummary() filtered to behavioral categories only — the
   * natural symmetric counterpart to getCompetencyCoverage(), not
   * explicitly requested but added for a consistent, complete API. */
  getBehavioralCoverage() {
    return this.getCoverageSummary().filter((s) => s.dimension === 'behavioral');
  }

  /**
   * dumpGraph() — a full, human-readable text dump of the entire graph
   * (Milestone 2B, 2026-07-29). Distinct from the per-turn [EVIDENCE-
   * GRAPH] log in services/interview.js — that log is for glancing at
   * one turn as the interview progresses; this is the "show me
   * everything, all at once" artifact for validating a completed session
   * against the actual transcript, and the reference format for future
   * milestones that consume the graph. Built entirely on the existing
   * query API (getExperiences/getExperienceCoverage/getCoverageSummary)
   * — no new data access, purely a formatting layer over what's already
   * queryable.
   * @returns {string}
   */
  dumpGraph() {
    function humanizeKey(key) {
      return String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    function typeLabel(type) {
      return type === 'resume_story' ? 'Resume Story' : 'Hypothetical';
    }

    const lines = ['EvidenceGraph', '', 'Experiences', '-----------'];
    const experienceCoverage = this.getExperienceCoverage();
    if (!experienceCoverage.length) {
      lines.push('(none yet)');
    } else {
      experienceCoverage.forEach((exp, idx) => {
        lines.push(`EXP-${idx + 1} (${typeLabel(exp.type)})`);
        lines.push(`  Turns: ${exp.turnIndices.map((t) => t + 1).join(',')}`);
        const competencyKeys = exp.keysCovered.filter((k) => k.dimension === 'competency');
        const behavioralKeys = exp.keysCovered.filter((k) => k.dimension === 'behavioral');
        if (competencyKeys.length) {
          lines.push('  Competencies:');
          competencyKeys.forEach((k) => lines.push(`    ${humanizeKey(k.key)}`));
        }
        if (behavioralKeys.length) {
          lines.push('  Behavioral Signals:');
          behavioralKeys.forEach((k) => lines.push(`    ${humanizeKey(k.key)}`));
        }
        lines.push('');
      });
    }

    lines.push('Evidence', '');
    const summary = this.getCoverageSummary();
    if (!summary.length) {
      lines.push('(no evidence recorded yet)');
    } else {
      summary.forEach((s) => {
        lines.push(humanizeKey(s.key));
        lines.push(`  Observations: ${s.totalObservations}`);
        lines.push(`  Experiences: ${s.distinctExperienceCount}`);
        lines.push(`  STAR-complete: ${s.starCompleteCount}`);
        lines.push(`  ${s.bestTierLabel}`);
        lines.push('');
      });
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  }
}

/**
 * buildEvidenceGraph — pure function, computed fresh each turn (same
 * rebuild-every-turn philosophy as buildInterviewSnapshot's memoryMap/
 * hypothesisMap; no new persistence introduced). Reads qaPairs,
 * hypothesisMap (structural competencies), and behavioralHypothesisMap
 * (Phase 2B categories) — all already computed elsewhere, none modified.
 *
 * @param {Array} qaPairs - as constructed in routes/interview.js (question, answer, score, wasSkipped, storyKey, competency)
 * @param {Object} hypothesisMap - from buildInterviewSnapshot, keyed by structural competency
 * @param {Object} behavioralHypothesisMap - from buildBehavioralEvidenceSnapshot, keyed by behavioral category
 * @returns {EvidenceGraph}
 */
function buildEvidenceGraph(qaPairs, hypothesisMap, behavioralHypothesisMap) {
  const graph = new EvidenceGraph();
  const pairs = Array.isArray(qaPairs) ? qaPairs : [];

  pairs.forEach((qa, turnIdx) => {
    if (!qa || qa.wasSkipped) return; // no evidence to record for a skipped turn

    // Experience identity — see the module-level "Known limitation" note
    // above for why no-story turns can't yet be grouped with their
    // follow-up without touching qaPairs' data contract.
    const experienceId = qa.storyKey ? `story:${qa.storyKey}` : `turn:${turnIdx}`;
    const experience = graph.getOrCreateExperience({
      id: experienceId,
      type: qa.storyKey ? 'resume_story' : 'no_story_turn',
      origin: qa.storyKey || null,
      turnIdx,
    });

    const starProgress = qa.answer ? computeStarProgress(qa.answer) : null;
    const starComplete = !!(starProgress && starProgress.status === 'evaluated' && starProgress.stepsComplete === starProgress.totalSteps);

    // Structural competency evidence (Conversation Memory's hypothesisMap)
    if (qa.competency && hypothesisMap && hypothesisMap[qa.competency]) {
      graph.addEvidenceNode(createEvidenceNode({
        dimension: 'competency',
        key: qa.competency,
        turnIdx,
        experienceId: experience.id,
        evidenceTier: hypothesisMap[qa.competency].evidenceTier,
        starComplete,
      }));
    }

    // Behavioral category evidence (Phase 2B's behavioralHypothesisMap) —
    // only recorded for categories this specific answer actually touched,
    // via the same detection already computed in buildBehavioralEvidenceSnapshot.
    if (behavioralHypothesisMap) {
      const detected = detectBehavioralCategories(qa.answer);
      Object.keys(behavioralHypothesisMap).forEach((category) => {
        if (detected[category]) {
          graph.addEvidenceNode(createEvidenceNode({
            dimension: 'behavioral',
            key: category,
            turnIdx,
            experienceId: experience.id,
            evidenceTier: behavioralHypothesisMap[category].evidenceTier,
            starComplete,
          }));
        }
      });
    }
  });

  return graph;
}

module.exports = {
  Experience,
  createEvidenceNode,
  EvidenceGraph,
  buildEvidenceGraph,
};
