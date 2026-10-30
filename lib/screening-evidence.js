// lib/screening-evidence.js
//
// The trust layer. A model's output is a CLAIM; this file decides what is
// allowed to be stored. Rules:
//   * A claim of evidence (evidence_found / partial_evidence) needs at least
//     one quote that is verified to exist, contiguously, in the stored resume
//     text (after whitespace / quote-style normalisation). Otherwise the item
//     is downgraded to requires_verification.
//   * `not_found` always gets a fixed, neutral note — the model's wording is
//     discarded, so absence can never be phrased as a lack of skill.
//   * `not_applicable` can only be set by a human.
//   * Rationale text containing hiring-verdict language is replaced.
//   * No API object may contain score / rank / verdict style keys.
// Pure functions; no I/O.

const cfg = require('../config/screening');

const L = cfg.LIMITS;

function normChar(ch) {
  if (/\s/.test(ch)) return ' ';
  if (ch === '‘' || ch === '’' || ch === '‛') return "'";
  if (ch === '“' || ch === '”') return '"';
  if (ch === '–' || ch === '—' || ch === '−') return '-';
  if (ch === ' ') return ' ';
  return ch.toLowerCase();
}

// Normalise text and keep a map from normalised index → original index.
function normalizeWithMap(text) {
  const out = [];
  const map = [];
  let prevSpace = true; // trims leading space
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const c = normChar(s[i]);
    if (c === ' ') {
      if (prevSpace) continue;
      prevSpace = true;
    } else {
      prevSpace = false;
    }
    out.push(c);
    map.push(i);
  }
  while (out.length && out[out.length - 1] === ' ') { out.pop(); map.pop(); }
  return { norm: out.join(''), map };
}

function normalizeQuote(q) {
  return normalizeWithMap(q).norm;
}

function hasEllipsis(q) {
  return /\.{3,}|…|\[\s*\.\.\.\s*\]/.test(q);
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

function pageOf(offsets, index) {
  if (!Array.isArray(offsets) || offsets.length <= 1) return 1;
  let page = 1;
  for (let i = 0; i < offsets.length; i += 1) if (index >= offsets[i]) page = i + 1;
  return page;
}

// Returns { start, end, line, page, text } (original-text coordinates) or null.
function locateQuote(resumeText, quote, offsets, preparedDoc) {
  const q = String(quote == null ? '' : quote).trim();
  if (!q || q.length > L.QUOTE_MAX_CHARS * 2) return null;
  if (hasEllipsis(q)) return null;
  const nq = normalizeQuote(q);
  if (nq.length < L.QUOTE_MIN_CHARS) return null;
  const doc = preparedDoc || normalizeWithMap(resumeText);
  const at = doc.norm.indexOf(nq);
  if (at < 0) return null;
  const start = doc.map[at];
  const end = doc.map[at + nq.length - 1] + 1;
  if (end - start > L.QUOTE_MAX_CHARS) return null;
  return {
    start,
    end,
    line: lineOf(resumeText, start),
    page: pageOf(offsets, start),
    text: String(resumeText).slice(start, end),
  };
}

function cleanRationale(s) {
  let t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (t.length > L.RATIONALE_MAX) t = `${t.slice(0, L.RATIONALE_MAX - 1).trim()}…`;
  return t;
}

function hasVerdictLanguage(s) {
  return cfg.VERDICT_LANGUAGE_PATTERN.test(String(s || ''));
}

// raw: { status, rationale, quotes: [string] } from the model.
// Returns the record to store (no ids).
function applyEvidenceRules(raw, resumeText, offsets, preparedDoc) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let status = typeof r.status === 'string' ? r.status.trim() : '';
  let downgrade = null;

  if (!cfg.AI_ASSIGNABLE_STATUSES.includes(status)) {
    downgrade = status === 'not_applicable' ? 'ai_not_applicable_blocked' : 'invalid_status';
    status = 'requires_verification';
  }

  const quotesIn = Array.isArray(r.quotes) ? r.quotes : [];
  const verified = [];
  const seen = new Set();
  let rejectedQuotes = 0;
  for (const q of quotesIn) {
    if (verified.length >= L.QUOTES_PER_CRITERION) break;
    const text = typeof q === 'string' ? q : q && typeof q.text === 'string' ? q.text : '';
    const loc = locateQuote(resumeText, text, offsets, preparedDoc);
    if (!loc) { rejectedQuotes += 1; continue; }
    const key = `${loc.start}:${loc.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verified.push(loc);
  }

  let rationale = cleanRationale(r.rationale);
  if (rationale && hasVerdictLanguage(rationale)) {
    rationale = '';
    downgrade = downgrade || 'verdict_language_removed';
  }

  if (cfg.CLAIM_STATUSES.includes(status) && verified.length === 0) {
    downgrade = rejectedQuotes > 0 ? 'quote_not_found_in_resume' : 'no_quote_supplied';
    status = 'requires_verification';
    rationale = 'The model reported supporting text, but it could not be matched to the resume. Please check the resume yourself.';
  }

  if (status === 'not_found') {
    rationale = cfg.NOT_FOUND_NOTE;
    verified.length = 0;
  }

  if (status === 'requires_verification' && !rationale) {
    rationale = 'The resume is unclear or incomplete on this criterion. A follow-up question is suggested.';
  }
  if (cfg.CLAIM_STATUSES.includes(status) && !rationale) {
    rationale = status === 'evidence_found'
      ? 'The resume text below supports this criterion.'
      : 'The resume text below partly supports this criterion.';
  }

  return { ai_status: status, ai_rationale: rationale, quotes: verified, downgrade_reason: downgrade };
}

// The status a human sees: recruiter override wins.
function effectiveStatus(row) {
  return (row && (row.recruiter_status || row.ai_status)) || null;
}

// ── Output hygiene ─────────────────────────────────────────────────────────
function findForbiddenKeys(value, path = '$', acc = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findForbiddenKeys(v, `${path}[${i}]`, acc));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const k of Object.keys(value)) {
      if (cfg.FORBIDDEN_KEY_PATTERN.test(k)) acc.push(`${path}.${k}`);
      findForbiddenKeys(value[k], `${path}.${k}`, acc);
    }
  }
  return acc;
}

function stripVerdictKeys(value, onStrip) {
  if (Array.isArray(value)) return value.map((v) => stripVerdictKeys(v, onStrip));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const k of Object.keys(value)) {
      if (cfg.FORBIDDEN_KEY_PATTERN.test(k)) { if (onStrip) onStrip(k); continue; }
      out[k] = stripVerdictKeys(value[k], onStrip);
    }
    return out;
  }
  return value;
}

// Coverage summary used by the inbox. Counts only; never a single number
// that could be read as a score.
function coverageCounts(rows) {
  const c = { evidence_found: 0, partial_evidence: 0, not_found: 0, requires_verification: 0, not_applicable: 0 };
  for (const r of rows || []) {
    const s = effectiveStatus(r);
    if (s && Object.prototype.hasOwnProperty.call(c, s)) c[s] += 1;
  }
  return c;
}

// Highlight segments for safe rendering: array of {t, h}. The client uses
// textContent, so there is no HTML anywhere in the path.
function buildSegments(text, quotes) {
  const s = String(text || '');
  const ranges = (quotes || [])
    .filter((q) => Number.isInteger(q.start) && Number.isInteger(q.end) && q.end > q.start)
    .map((q) => [q.start, q.end])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push({ t: s.slice(pos, a), h: false });
    out.push({ t: s.slice(a, b), h: true });
    pos = b;
  }
  if (pos < s.length) out.push({ t: s.slice(pos), h: false });
  return out;
}

module.exports = {
  normalizeWithMap,
  locateQuote,
  applyEvidenceRules,
  effectiveStatus,
  findForbiddenKeys,
  stripVerdictKeys,
  coverageCounts,
  buildSegments,
  hasVerdictLanguage,
  cleanRationale,
};
