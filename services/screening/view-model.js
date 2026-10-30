// Builds the objects the API, pages and report render. Single source of
// truth so the review screen, inbox and printed report can never disagree.

const screeningDb = require('../../db/screening');
const cfg = require('../../config/screening');
const { effectiveStatus, coverageCounts } = require('../../lib/screening-evidence');

function serializeJob(job, { withJd } = {}) {
  const out = {
    id: job.id,
    title: job.title,
    criteriaState: job.criteria_state,
    criteriaVersion: job.criteria_version,
    approvedAt: job.approved_at,
    createdAt: job.created_at,
    jdFlags: job.jd_flags || [],
  };
  if (withJd) out.jdText = job.jd_text;
  if (job.criteria_count !== undefined) out.criteriaCount = job.criteria_count;
  if (job.candidate_count !== undefined) out.candidateCount = job.candidate_count;
  return out;
}

function serializeCriterion(c) {
  return {
    id: c.id, position: c.position, text: c.text, importance: c.importance, kind: c.kind,
    jdQuote: c.jd_quote, jdQuoteVerified: !!c.jd_quote_verified, guidance: c.guidance, origin: c.origin,
  };
}

function serializeCandidateRow(k) {
  return {
    id: k.id,
    code: screeningDb.candidateCode(k.seq),
    label: k.label,
    sourceType: k.source_type,
    decision: k.decision,
    decisionLabel: k.decision ? cfg.DECISIONS[k.decision] : null,
    analyzed: !!k.analyzed_at,
    injectionFlagCount: Number(k.injection_flag_count || 0),
    createdAt: k.created_at,
  };
}

function statusLabel(s) { return s ? cfg.EVIDENCE_STATUSES[s] : null; }

async function buildCandidateModel(ownerId, candidateId) {
  const cand = await screeningDb.getCandidate(ownerId, candidateId);
  if (!cand) return null;
  const job = await screeningDb.getJob(ownerId, cand.job_id);
  const [criteria, evidence, questions] = await Promise.all([
    screeningDb.listCriteria(ownerId, job.id),
    screeningDb.listEvidence(ownerId, candidateId),
    screeningDb.listQuestions(ownerId, candidateId),
  ]);
  const evByCrit = new Map(evidence.map((e) => [e.criterion_id, e]));
  const qByCrit = new Map();
  for (const q of questions) {
    if (!qByCrit.has(q.criterion_id)) qByCrit.set(q.criterion_id, []);
    qByCrit.get(q.criterion_id).push({ id: q.id, text: q.text, origin: q.origin, state: q.state });
  }
  const rows = criteria.map((c) => {
    const e = evByCrit.get(c.id);
    const eff = e ? effectiveStatus(e) : null;
    return {
      criterion: serializeCriterion(c),
      evidence: e ? {
        aiStatus: e.ai_status, aiStatusLabel: statusLabel(e.ai_status),
        aiRationale: e.ai_rationale,
        quotes: (e.quotes || []).map((q) => ({ start: q.start, end: q.end, line: q.line, page: q.page, text: q.text })),
        downgradeReason: e.downgrade_reason,
        recruiterStatus: e.recruiter_status, recruiterStatusLabel: statusLabel(e.recruiter_status),
        recruiterNote: e.recruiter_note, reviewedAt: e.reviewed_at,
        effectiveStatus: eff, effectiveStatusLabel: statusLabel(eff),
        stale: e.criteria_version !== job.criteria_version,
        needsAttention: !e.reviewed_at && cfg.ATTENTION_STATUSES.includes(e.ai_status),
      } : null,
      questions: qByCrit.get(c.id) || [],
    };
  });
  return {
    job,
    candidate: {
      id: cand.id, code: screeningDb.candidateCode(cand.seq), label: cand.label, sourceType: cand.source_type,
      pageCount: cand.page_count, decision: cand.decision,
      decisionLabel: cand.decision ? cfg.DECISIONS[cand.decision] : null,
      decisionNote: cand.decision_note, decidedAt: cand.decided_at,
      analyzedAt: cand.analyzed_at, redactionSummary: cand.redaction_summary || {},
      injectionFlags: cand.injection_flags || [],
    },
    resumeText: cand.redacted_text,
    pageOffsets: cand.page_offsets || [0],
    rows,
    coverage: coverageCounts(rows.filter((r) => r.evidence).map((r) => ({ ai_status: r.evidence.aiStatus, recruiter_status: r.evidence.recruiterStatus }))),
    criteriaState: job.criteria_state,
    anyStale: rows.some((r) => r.evidence && r.evidence.stale),
  };
}

const GROUPS = Object.freeze([
  { key: 'missing_or_unclear', title: 'Missing or unclear evidence' },
  { key: 'partial', title: 'Partial evidence' },
  { key: 'all_found', title: 'Evidence found for every required criterion' },
  { key: 'not_analyzed', title: 'Not analysed yet' },
]);

async function buildInbox(ownerId, jobId) {
  const job = await screeningDb.getJob(ownerId, jobId);
  if (!job) return null;
  const [criteria, candidates, evidence] = await Promise.all([
    screeningDb.listCriteria(ownerId, jobId),
    screeningDb.listCandidates(ownerId, jobId),
    screeningDb.listJobEvidence(ownerId, jobId),
  ]);
  const required = new Set(criteria.filter((c) => c.importance === 'required').map((c) => c.id));
  const evByCand = new Map();
  for (const e of evidence) {
    if (!evByCand.has(e.candidate_id)) evByCand.set(e.candidate_id, []);
    evByCand.get(e.candidate_id).push(e);
  }
  const groups = GROUPS.map((g) => ({ ...g, candidates: [] }));
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const k of candidates) {
    const rows = evByCand.get(k.id) || [];
    const row = serializeCandidateRow(k);
    row.coverage = coverageCounts(rows);
    row.needsAttention = rows.filter((e) => !e.reviewed_at && cfg.ATTENTION_STATUSES.includes(e.ai_status)).length;
    row.stale = rows.some((e) => e.criteria_version !== job.criteria_version);
    let key;
    if (!k.analyzed_at || rows.length === 0) key = 'not_analyzed';
    else {
      const req = rows.filter((e) => required.has(e.criterion_id)).map(effectiveStatus);
      if (req.some((s) => s === 'not_found' || s === 'requires_verification')) key = 'missing_or_unclear';
      else if (req.some((s) => s === 'partial_evidence')) key = 'partial';
      else key = 'all_found';
    }
    byKey[key].candidates.push(row); // already in upload order (seq) — never sorted by findings
  }
  return { job: serializeJob(job), groups, total: candidates.length };
}

module.exports = { serializeJob, serializeCriterion, serializeCandidateRow, buildCandidateModel, buildInbox, GROUPS };
