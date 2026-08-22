// ═══════════════════════════════════════════════════════════════════════════
// services/resume-preview-validator.js — MedhaIQ Career Intelligence Preview
//
// Gate: is the uploaded document actually resume/CV-shaped content? Runs
// BEFORE scoreResume() in the orchestrator. Deterministic, zero AI calls,
// same architectural pattern as resume-preview-taxonomy.js (regex-based
// structural signals, reused splitIntoLines() so line-parsing logic isn't
// duplicated).
//
// Deliberately requires a COMBINATION of independent signal categories —
// no single category (not even "found a section header") is enough on its
// own to pass. A random document containing the word "experience" once,
// mid-sentence, must not pass; a real resume typically clears several
// categories at once because that's what resumes structurally look like.
// ═══════════════════════════════════════════════════════════════════════════

const { splitIntoLines } = require('./resume-preview-taxonomy');

// Canonical resume section headers — matched as a LIKELY HEADER (a short
// standalone line), not merely "this word appears somewhere in the text".
const SECTION_HEADER_PATTERNS = [
  /^(professional\s+)?summary$/i,
  /^profile$/i,
  /^objective$/i,
  /^(work\s+)?experience$/i,
  /^employment\s+history$/i,
  /^career\s+history$/i,
  /^education$/i,
  /^skills?$/i,
  /^(technical\s+)?skills?\s*(&|and)?\s*(competencies)?$/i,
  /^certifications?$/i,
  /^projects?$/i,
  /^achievements?$/i,
  /^awards?$/i,
  /^references?$/i,
];

const DATE_RANGE_PATTERN = /\b(19|20)\d{2}\s*[-\u2013\u2014to]{1,4}\s*((19|20)\d{2}|present|current)\b/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(\+?\d[\d\s().-]{8,}\d)/;
const LINKEDIN_PATTERN = /linkedin\.com\/in\//i;
const JOB_TITLE_PATTERN = /\b(manager|engineer|director|analyst|consultant|intern|lead|specialist|executive|officer|president|vice president|\bvp\b|associate|coordinator|founder|architect|designer|administrator|supervisor|head of)\b/i;

const MIN_SCORE_TO_PASS = 4;
const MIN_DISTINCT_HEADERS_TO_PASS = 1;

/**
 * Count distinct canonical section headers that appear as their OWN short
 * line (a real header), not embedded inside a longer sentence.
 * @param {string[]} lines
 */
function countSectionHeaders(lines) {
  let count = 0;
  const matched = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 40) continue; // headers are short; skip long lines entirely
    for (const pattern of SECTION_HEADER_PATTERNS) {
      if (pattern.test(trimmed) && !matched.includes(pattern)) {
        matched.push(pattern);
        count++;
        break;
      }
    }
  }
  return count;
}

function countDateRanges(text) {
  const matches = text.match(new RegExp(DATE_RANGE_PATTERN, 'gi'));
  return matches ? matches.length : 0;
}

function hasContactInfo(text) {
  return EMAIL_PATTERN.test(text) || LINKEDIN_PATTERN.test(text) || PHONE_PATTERN.test(text);
}

function hasJobTitleKeyword(text) {
  return JOB_TITLE_PATTERN.test(text);
}

/**
 * Bullet/short-line density: resumes are dominated by short, list-like
 * lines (bullets, single achievements). Guides/articles/manuals are
 * dominated by long paragraph sentences. Ratio, not a raw count.
 * @param {string[]} lines
 */
function shortLineDensity(lines) {
  if (lines.length === 0) return 0;
  const shortLines = lines.filter((l) => l.trim().split(/\s+/).length <= 14).length;
  return shortLines / lines.length;
}

/**
 * A resume's first non-empty line is very often just the candidate's name:
 * short, title-case-ish, no terminal punctuation.
 * @param {string[]} lines
 */
function firstLineLooksLikeAName(lines) {
  const first = (lines[0] || '').trim();
  if (!first) return false;
  const wordCount = first.split(/\s+/).length;
  return wordCount >= 2 && wordCount <= 5 && !/[.!?]$/.test(first) && first.length <= 40;
}

/**
 * Classify whether extracted text is resume/CV-shaped content.
 * @param {string} text
 * @returns {{ valid: boolean, confidence: 'high'|'medium'|'low', reason: string, score: number }}
 */
function validateIsResume(text) {
  const lines = splitIntoLines(text);

  const distinctHeaders = countSectionHeaders(lines);
  const dateRangeCount = countDateRanges(text);
  const contactFound = hasContactInfo(text);
  const jobTitleFound = hasJobTitleKeyword(text);
  const bulletDensity = shortLineDensity(lines);
  const nameLikeFirstLine = firstLineLooksLikeAName(lines);

  let score = 0;
  score += Math.min(distinctHeaders, 2);       // up to 2 points
  score += dateRangeCount >= 1 ? 1 : 0;         // 1 point
  score += dateRangeCount >= 2 ? 1 : 0;         // +1 more (2 points total for dates)
  score += contactFound ? 1 : 0;                // 1 point
  score += jobTitleFound ? 1 : 0;                // 1 point
  score += bulletDensity >= 0.3 ? 1 : 0;         // 1 point
  score += nameLikeFirstLine ? 1 : 0;            // 1 point
  // Max possible: 2 + 2 + 1 + 1 + 1 + 1 = 8

  const valid = score >= MIN_SCORE_TO_PASS && distinctHeaders >= MIN_DISTINCT_HEADERS_TO_PASS;

  let confidence = 'low';
  if (score >= 6) confidence = 'high';
  else if (score >= 4) confidence = 'medium';

  const reason = valid
    ? `Matched ${distinctHeaders} resume section header(s), ${dateRangeCount} date range(s), and ${score} total signal points.`
    : `Only ${score} signal points and ${distinctHeaders} recognizable section header(s) — below the ${MIN_SCORE_TO_PASS}-point / ${MIN_DISTINCT_HEADERS_TO_PASS}-header threshold required to treat this as a resume.`;

  return { valid, confidence, reason, score };
}

module.exports = { validateIsResume };
