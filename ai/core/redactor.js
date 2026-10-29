/**
 * ai/core/redactor.js
 *
 * Pure, dependency-free PII redaction for text that is about to be sent to
 * an AI provider. It replaces identifying values with stable placeholder
 * tokens ([EMAIL_1], [PHONE_1], [NAME_1] ...), keeps the token -> value
 * mapping IN MEMORY ONLY (never sent to the model, never logged), and can
 * restore the real values in the model's response.
 *
 * WHAT IT REMOVES
 *   - emails, phone numbers (+91 and other international, Indian mobiles),
 *     LinkedIn / GitHub / other profile links, Aadhaar, PAN, passport
 *     numbers, labelled PIN codes and "Address:" lines
 *   - personal names: any name passed in `names`, plus (optionally) the
 *     name found in the first lines of a resume (`detectHeaderName`)
 *
 * WHAT IT DELIBERATELY KEEPS
 *   Skills, job titles, achievements, and company / college names. The
 *   interview is built from these.
 *
 * LIMITS (be honest about them)
 *   Pattern matching reduces risk, it does not eliminate it. Names that
 *   appear only inside free text ("my manager Ravi...") are not caught
 *   unless they were passed in `names`. Street addresses without a label
 *   are not caught. This is defence in depth alongside provider
 *   no-training terms, not a replacement for them.
 *
 * SAFETY: redact() never throws. On any internal error it returns the
 * original text unchanged and an empty mapping, so a redactor bug can never
 * take an interview or a resume parse down.
 */

const TYPES = ['NAME', 'EMAIL', 'PHONE', 'URL', 'AADHAAR', 'PAN', 'PASSPORT', 'PIN', 'ADDRESS'];

// Order matters: the most specific patterns run first so that, e.g., a URL
// containing digits is not partially eaten by the phone pattern.
const PATTERNS = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    type: 'URL',
    re: /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:linkedin\.com|github\.com|gitlab\.com|bitbucket\.org|twitter\.com|x\.com|instagram\.com|facebook\.com|medium\.com|behance\.net|dribbble\.com|leetcode\.com|kaggle\.com|stackoverflow\.com\/users)\/[^\s)\]>,;"']+/gi,
  },
  { type: 'PAN', re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { type: 'AADHAAR', re: /(?<![\d-])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d-])/g },
  { type: 'PASSPORT', re: /\b[A-PR-WY][1-9]\d{6}\b/g },
  {
    type: 'PIN',
    re: /\b(?:pin\s?code|pincode|pin|postal\s?code|zip)\s*[:\-]?\s*[1-9]\d{5}\b/gi,
  },
  { type: 'ADDRESS', re: /^[ \t]*(?:address|residence|residential address|permanent address|current address)\s*[:\-][^\n]{3,200}$/gim },
  // International numbers with an explicit +country code, e.g. +91 98765 43210, +1 (415) 555-0100
  { type: 'PHONE', re: /(?<![\w])\+\d{1,3}[\s.-]?\(?\d{1,5}\)?(?:[\s.-]?\d{2,5}){2,4}(?![\d])/g },
  // Indian mobiles without a country code: 98765 43210 / 9876543210 / 98765-43210 / 0 98765 43210
  { type: 'PHONE', re: /(?<![\w.])(?:0|91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\d])/g },
];

// Words that mean a resume's first line is a heading, not a person's name.
const HEADER_STOPWORDS = new Set([
  'resume', 'curriculum', 'vitae', 'cv', 'profile', 'summary', 'objective', 'contact',
  'experience', 'education', 'skills', 'projects', 'page', 'confidential', 'career',
  'professional', 'address', 'email', 'phone', 'mobile', 'linkedin', 'github',
]);

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Looks at the first few non-empty lines of a resume for a person's name:
 * 2-4 alphabetic words, each starting with a capital, no digits/@/URLs,
 * no heading words. Returns the name string or null.
 */
function detectHeaderName(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const line of lines) {
    if (line.length > 60 || /[0-9@:/\\|]/.test(line)) continue;
    const words = line.replace(/[,]+$/, '').split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    const ok = words.every((w) => /^[A-Z][A-Za-z'.\-]{0,24}$/.test(w) || /^[A-Z]\.?$/.test(w));
    if (!ok) continue;
    if (words.some((w) => HEADER_STOPWORDS.has(w.toLowerCase().replace(/[.,]/g, '')))) continue;
    return words.join(' ');
  }
  return null;
}

/** Builds the list of name strings (full name first, then its parts) to search for. */
function expandNames(names) {
  const out = new Set();
  for (const raw of names || []) {
    const n = String(raw || '').trim();
    if (n.length < 2) continue;
    out.add(n);
    for (const part of n.split(/\s+/)) {
      const p = part.replace(/[.,]/g, '');
      if (p.length >= 3) out.add(p); // skip initials / very short fragments to avoid false positives
    }
  }
  // Longest first so "Priya Sharma" is replaced before "Priya".
  return Array.from(out).sort((a, b) => b.length - a.length);
}

/**
 * Creates a redaction session. One session = one AI call. The same value
 * always maps to the same token inside a session, across system + message.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.names]            known personal names to redact
 * @param {boolean}  [opts.detectHeaderName] also look for a name at the top of the text
 */
function createSession(opts = {}) {
  const valueToToken = new Map(); // `${type}|${value}` -> token
  const tokenToValue = new Map(); // token -> original value
  const counters = {};
  const counts = {};
  let names = expandNames(opts.names);
  let headerChecked = false;

  function tokenFor(type, value) {
    const key = `${type}|${value}`;
    if (valueToToken.has(key)) return valueToToken.get(key);
    counters[type] = (counters[type] || 0) + 1;
    const token = `[${type}_${counters[type]}]`;
    valueToToken.set(key, token);
    tokenToValue.set(token, value);
    return token;
  }

  function bump(type) {
    counts[type] = (counts[type] || 0) + 1;
  }

  /** Redacts one string. Never throws. */
  function redact(text) {
    if (typeof text !== 'string' || text.length === 0) return text;
    try {
      let out = text;

      if (opts.detectHeaderName && !headerChecked) {
        headerChecked = true;
        const found = detectHeaderName(out);
        if (found) names = expandNames([...names, found]);
      }

      for (const { type, re } of PATTERNS) {
        out = out.replace(re, (m) => {
          bump(type);
          return tokenFor(type, m);
        });
      }

      for (const name of names) {
        const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(name)}(?![A-Za-z])`, 'gi');
        out = out.replace(re, (m) => {
          bump('NAME');
          // Same person, same token regardless of capitalisation in the source.
          return tokenFor('NAME', name.toLowerCase() === m.toLowerCase() ? name : m);
        });
      }
      return out;
    } catch (err) {
      console.error('[redactor] redact failed, passing text through unchanged:', err.message);
      return text;
    }
  }

  /** Redacts a system prompt given as a string or { static, dynamic }. */
  function redactSystem(system) {
    if (typeof system === 'string') return redact(system);
    if (system && typeof system === 'object' && !Array.isArray(system)) {
      return {
        ...system,
        static: typeof system.static === 'string' ? redact(system.static) : system.static,
        dynamic: typeof system.dynamic === 'string' ? redact(system.dynamic) : system.dynamic,
      };
    }
    return system;
  }

  const TOKEN_RE = new RegExp(`\\[(?:${TYPES.join('|')})_\\d+\\]`, 'g');

  /** Restores real values in a string. Unknown tokens are left untouched. */
  function restoreString(s) {
    if (typeof s !== 'string' || tokenToValue.size === 0) return s;
    return s.replace(TOKEN_RE, (t) => (tokenToValue.has(t) ? tokenToValue.get(t) : t));
  }

  /** Restores real values anywhere inside a string / array / plain object. */
  function restore(value) {
    try {
      if (tokenToValue.size === 0) return value;
      if (typeof value === 'string') return restoreString(value);
      if (Array.isArray(value)) return value.map(restore);
      if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) out[k] = restore(value[k]);
        return out;
      }
      return value;
    } catch (err) {
      console.error('[redactor] restore failed, returning response unchanged:', err.message);
      return value;
    }
  }

  return {
    redact,
    redactSystem,
    restore,
    /** Counts per type, e.g. { EMAIL: 1, PHONE: 2 }. Safe to log: no values. */
    getCounts: () => ({ ...counts }),
    getTotal: () => Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

/** True only when the AI_REDACTION env flag is the literal string 'on'. */
function isEnabled() {
  return process.env.AI_REDACTION === 'on';
}

module.exports = { createSession, detectHeaderName, isEnabled, PATTERNS };
