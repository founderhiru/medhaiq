'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Dynamic Interviewer Greeting -- greeting library + selection helpers.
//
// Six professional, calm, executive-toned openers, one of which is spoken
// once at the true start of every fresh interview session, before Q1,
// as its own separate TTS request (see views/interview-session.ejs call-start
// handler). {NAME} is substituted with the interviewer persona's FIRST name
// only (e.g. "Sarah", not "Sarah Kim") -- see resolveGreeting() below.
//
// This module is pure/stateless: it does not read cookies, sessions, or
// the DB. server.js owns picking + persisting the "last used index" (via
// a small cookie) and calls into this module only for the templates and
// the plain selection/substitution logic.
// ─────────────────────────────────────────────────────────────────────────

const GREETINGS = [
  "Welcome. I'm {NAME}. We'll have a short conversation about your experience. Let's begin.",
  "Hi, I'm {NAME}. Thanks for joining. Let's get started.",
  "Welcome to MedhaIQ. I'm {NAME}. Let's dive right in.",
  "Hello, I'm {NAME}. Just answer naturally, like a real conversation. Let's begin.",
  "Hi, I'm {NAME}. Let's talk through your experience. Here's the first question.",
  "Welcome. I'm {NAME}, your interviewer today. Let's get started.",
];

/**
 * Picks a greeting index at random, never returning the same index that
 * was used last time (if known) -- avoids two consecutive fresh sessions
 * in the same browser hearing the identical greeting back to back.
 *
 * @param {number|null|undefined} lastIndex - index used last time (0-5),
 *   or null/undefined if unknown (e.g. first-ever session in this browser).
 * @returns {number} the chosen index, 0-5.
 */
function pickGreetingIndex(lastIndex) {
  if (GREETINGS.length <= 1) return 0;
  const last = Number.isInteger(lastIndex) ? lastIndex : null;
  let idx;
  do {
    idx = Math.floor(Math.random() * GREETINGS.length);
  } while (idx === last);
  return idx;
}

/**
 * Resolves a greeting template into final spoken text, substituting the
 * interviewer's first name.
 *
 * @param {number} index - which template to use (from pickGreetingIndex).
 * @param {string} interviewerFullName - persona's full name, e.g. "Sarah Kim".
 *   Only the first token is used, so "Sarah Kim" -> "Sarah". Falls back to
 *   "your interviewer" if no name is available, rather than ever leaving a
 *   literal "{NAME}" in spoken output.
 * @returns {string}
 */
function resolveGreeting(index, interviewerFullName) {
  const template = GREETINGS[index] || GREETINGS[0];
  const firstName = String(interviewerFullName || '').trim().split(/\s+/)[0] || 'your interviewer';
  return template.replace(/\{NAME\}/g, firstName);
}

module.exports = { GREETINGS, pickGreetingIndex, resolveGreeting };
