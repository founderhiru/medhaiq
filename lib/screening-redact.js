// lib/screening-redact.js
//
// Removes personal identifiers from resume text BEFORE it is stored or sent
// to a model. Screening must not use name, photo, gender, age, caste,
// religion, marital status etc. Pure functions, no I/O.
//
// This is best-effort pattern redaction, not a guarantee: free-text name or
// address mentions inside sentences can survive. The UI says so.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const SOCIAL_RE = /\b(?:linkedin\.com|github\.com|gitlab\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|medium\.com)\/[^\s<>"')]+/gi;
// 10+ digits with optional separators / country code (Indian +91 and general).
const PHONE_RE = /(?<![\w.])(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}(?![\w])/g;

// Labelled personal-attribute fields: whole line is removed after the label.
const SENSITIVE_FIELD_RE = /^[ \t]*(?:date\s+of\s+birth|d\.?o\.?b\.?|birth\s*date|age|gender|sex|marital\s+status|religion|caste|community|category|nationality|father'?s?\s+name|mother'?s?\s+name|spouse|passport(?:\s+no\.?)?|aadhaar|aadhar|pan(?:\s+no\.?)?|photo|photograph|height|weight|blood\s+group)\s*[:\-–]\s*.*$/gim;

const NAME_LINE_RE = /^[A-Z][A-Za-z.'’-]{1,24}(?:\s+[A-Z][A-Za-z.'’-]{1,24}){1,3}$/;

function countMatches(str, re) {
  const m = str.match(re);
  return m ? m.length : 0;
}

function looksLikeDigitsPhone(s) {
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

const TITLE_WORDS = /\b(?:engineer|developer|manager|resume|curriculum|vitae|analyst|designer|consultant|intern|scientist|architect|administrator|executive|director|specialist|officer|lead|summary|profile|objective|experience|education|skills|projects)\b/i;

function redactResume(input, opts = {}) {
  const nameLine = opts.nameLine !== false;
  let text = String(input == null ? '' : input);
  const summary = { emails: 0, phones: 0, links: 0, sensitive_fields: 0, name_line: 0 };

  summary.emails = countMatches(text, EMAIL_RE);
  text = text.replace(EMAIL_RE, '[EMAIL]');

  summary.links = countMatches(text, URL_RE) + countMatches(text, SOCIAL_RE);
  text = text.replace(URL_RE, '[LINK]').replace(SOCIAL_RE, '[LINK]');

  let phones = 0;
  text = text.replace(PHONE_RE, (m) => {
    if (!looksLikeDigitsPhone(m)) return m;
    phones += 1;
    return '[PHONE]';
  });
  summary.phones = phones;

  summary.sensitive_fields = countMatches(text, SENSITIVE_FIELD_RE);
  text = text.replace(SENSITIVE_FIELD_RE, '[REMOVED FIELD]');

  // A bare name on one of the first non-empty lines is the normal resume
  // header. Redact only the first such line.
  const lines = text.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length && seen < 3; i += 1) {
    const t = lines[i].trim();
    if (!t) continue;
    seen += 1;
    if (nameLine && t.length <= 50 && NAME_LINE_RE.test(t) && !/\d/.test(t) && !TITLE_WORDS.test(t)) {
      lines[i] = '[NAME]';
      summary.name_line = 1;
      break;
    }
  }
  text = lines.join('\n');

  return { text, summary };
}

module.exports = { redactResume };
