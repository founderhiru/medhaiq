// lib/screening-criteria.js
//
// Criteria helpers: validation of model output, deterministic heuristic
// fallback (used when no AI is available), and the content hash that ties
// stored evidence to the exact approved criteria.

const crypto = require('crypto');
const cfg = require('../config/screening');
const { criterionTextIsSensitive } = require('./screening-flags');

const L = cfg.LIMITS;

function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

function normForMatch(s) { return squash(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"'); }

function jdQuoteVerified(jdText, quote) {
  const q = normForMatch(quote);
  if (q.length < 8) return false;
  return normForMatch(jdText).includes(q);
}

function criteriaHash(criteria) {
  const payload = (criteria || [])
    .map((c) => [squash(c.text).toLowerCase(), c.importance, squash(c.guidance || '').toLowerCase()])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// Validate/clean one criterion from any origin. Returns null when unusable.
function cleanCriterion(c, jdText, origin) {
  if (!c || typeof c !== 'object') return null;
  const text = squash(c.text).slice(0, L.CRITERION_TEXT_MAX);
  if (text.length < 3) return null;
  if (criterionTextIsSensitive(text)) return null;
  const importance = cfg.IMPORTANCE.includes(c.importance) ? c.importance : 'required';
  const kind = cfg.CRITERION_KINDS.includes(c.kind) ? c.kind : 'other';
  const guidance = squash(c.guidance).slice(0, L.CRITERION_GUIDANCE_MAX) || null;
  let quote = squash(c.jd_quote).slice(0, L.JD_QUOTE_MAX) || null;
  let verified = false;
  if (quote && origin !== 'recruiter') {
    verified = jdQuoteVerified(jdText, quote);
    if (!verified) quote = null; // never show an unverifiable "JD said"
  }
  return { text, importance, kind, guidance, jd_quote: quote, jd_quote_verified: verified, origin };
}

function dedupeCriteria(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const k = normForMatch(c.text);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// Deterministic fallback: bullet lines under recognisable headings.
const REQUIRED_HEAD = /(requirements?|must\s*have|qualifications?|what\s+you('|’)?ll\s+need|skills?\s+required|essential|you\s+have|about\s+you|responsibilit)/i;
const PREFERRED_HEAD = /(preferred|nice\s*to\s*have|good\s*to\s*have|bonus|plus|desirable|optional)/i;
const BULLET = /^\s*(?:[-*•●▪‣]|\d{1,2}[.)])\s+(.+)$/;

function heuristicCriteria(jdText) {
  const lines = String(jdText || '').split('\n');
  let importance = 'required';
  let inSection = false;
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const b = line.match(BULLET);
    if (!b) {
      if (line.length <= 80) {
        if (PREFERRED_HEAD.test(line)) { importance = 'preferred'; inSection = true; }
        else if (REQUIRED_HEAD.test(line)) { importance = 'required'; inSection = true; }
      }
      continue;
    }
    if (!inSection && out.length === 0 && !/\b(experience|years?|degree|proficien|knowledge|skill|ability|familiar)\b/i.test(b[1])) continue;
    const text = squash(b[1]).replace(/[.;]+$/, '');
    if (text.length < 8 || text.length > L.CRITERION_TEXT_MAX) continue;
    const c = cleanCriterion({ text, importance, kind: 'other', jd_quote: text }, jdText, 'heuristic');
    if (c) out.push(c);
    if (out.length >= L.CRITERIA_MAX) break;
  }
  return dedupeCriteria(out);
}

function validateAiCriteria(parsed, jdText) {
  const arr = parsed && Array.isArray(parsed.criteria) ? parsed.criteria : [];
  const cleaned = [];
  for (const c of arr) {
    const x = cleanCriterion(c, jdText, 'ai');
    if (x) cleaned.push(x);
    if (cleaned.length >= L.CRITERIA_MAX) break;
  }
  return dedupeCriteria(cleaned);
}

module.exports = { criteriaHash, cleanCriterion, heuristicCriteria, validateAiCriteria, jdQuoteVerified, squash, dedupeCriteria };
