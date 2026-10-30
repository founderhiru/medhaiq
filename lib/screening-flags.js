// lib/screening-flags.js
//
// Two detectors, both pure:
//  1. prompt-injection phrases in untrusted documents (resume / JD)
//  2. protected-attribute language in a job description
// Flags are shown to the recruiter. Injection text is also neutralised by the
// prompt layer (nonce-delimited data), so a miss here is not a bypass.

const INJECTION_PATTERNS = [
  { code: 'ignore_instructions', re: /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|these)\b[^.\n]{0,30}\b(?:instructions?|prompts?|rules?|guidelines?)\b/i },
  { code: 'role_override', re: /\b(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s+are)|new\s+instructions?|system\s*(?:prompt|message))\b/i },
  { code: 'force_outcome', re: /\b(?:mark|rate|score|rank|classify|output|return|set)\b[^.\n]{0,40}\b(?:all|every|each)\b[^.\n]{0,30}\b(?:criteri(?:a|on)|requirements?|evidence)\b/i },
  { code: 'force_status', re: /\b(?:evidence_found|partial_evidence|requires_verification|not_found)\b/i },
  { code: 'hire_request', re: /\b(?:hire\s+(?:this|me|the)\s+candidate|shortlist\s+(?:this|me)|recommend\s+(?:this|me)|best\s+candidate)\b/i },
  { code: 'delimiter_spoof', re: /(?:<\/?\s*(?:system|assistant|untrusted|data|resume|jd)[^>]{0,40}>|-----\s*(?:begin|end)\b)/i },
  { code: 'hidden_text_hint', re: /\b(?:white\s+text|hidden\s+text|invisible\s+text|do\s+not\s+reveal)\b/i },
];

function detectInjection(text) {
  const t = String(text || '');
  const out = [];
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(t)) out.push(p.code);
  }
  return out;
}

// Protected-attribute language in job descriptions. Flagged for the
// recruiter, NEVER converted into screening criteria.
const SENSITIVE_JD_PATTERNS = [
  { code: 'age', re: /\b(?:young|youthful|fresh\s+graduates?\s+only|(?:age|aged)\s*(?:between|under|below|above|of)?\s*\d{2}|\d{2}\s*(?:-|to)\s*\d{2}\s*years?\s*(?:old|of\s+age)|digital\s+native)\b/i },
  { code: 'gender', re: /\b(?:male\s+only|female\s+only|men\s+only|women\s+only|only\s+(?:male|female)|(?:male|female)\s+candidates?|gender\s*[:\-]|salesman|saleswoman|manpower|chairman)\b/i },
  { code: 'marital_status', re: /\b(?:unmarried|married|marital\s+status|pregnan\w*|single\s+(?:only|candidates?))\b/i },
  { code: 'religion_caste', re: /\b(?:religion|caste|community\s+preferred|hindu|muslim|christian|sikh|brahmin|obc|sc\/st)\b/i },
  { code: 'appearance', re: /\b(?:good\s*looking|attractive|pleasing\s+personality|photograph\s+required|height\s*[:\-]|weight\s*[:\-]|fair\s+complexion)\b/i },
  { code: 'nationality_origin', re: /\b(?:native\s+(?:speaker|of)|local\s+candidates?\s+only|locals?\s+only|from\s+(?:a\s+)?particular\s+region|mother\s+tongue)\b/i },
];

function detectSensitiveJd(text) {
  const t = String(text || '');
  const out = [];
  for (const p of SENSITIVE_JD_PATTERNS) {
    if (p.re.test(t)) out.push(p.code);
  }
  return out;
}

// A criterion built from these must be dropped, even if the model proposed it.
function criterionTextIsSensitive(text) {
  return detectSensitiveJd(text).length > 0;
}

// Interview-style questions are held to a stricter list: anything probing
// family, age, health, origin or beliefs is dropped even when a JD might
// legitimately use the same word.
const QUESTION_SENSITIVE_RE = /\b(?:married|marital|spouse|husband|wife|pregnan\w*|children|kids|family\s+plans?|how\s+old|your\s+age|date\s+of\s+birth|religio\w*|caste|community|nationality|where\s+are\s+you\s+from|disabilit\w*|health\s+(?:condition|issue)s?|medical|ethnic\w*|race|gender|sexual\w*|political)\b/i;

function questionIsSensitive(text) {
  const t = String(text || '');
  return QUESTION_SENSITIVE_RE.test(t) || detectSensitiveJd(t).length > 0;
}

module.exports = { detectInjection, detectSensitiveJd, criterionTextIsSensitive, questionIsSensitive };
