// routes/demo.js
//
// "See How It Works" continuous guided tour. Every route here is:
//   - Public (no requireAuth / requireAuthPage / requireInterviewEntitlement)
//   - Stateless (no DB reads or writes, no session, no req.user)
//   - Disconnected from billing/credits/voice (no imports from
//     capability-engine, stripe, vapi, voice-tts-proxy, or cost-recorder)
//
// Architecture (2026-08-24 rewrite — homepage-native, no separate shell
// page): the entire tour runs as JS-driven DOM manipulation on top of
// the REAL, unmodified homepage (public/js/guided-tour.js, dynamically
// loaded only when "See How It Works" is clicked). The browser's
// top-level document never navigates away from "/" for the whole
// experience — this is what keeps voiceover perceptually continuous
// (the shared <audio> element is never destroyed by a page unload) and
// keeps the presentation seamless (no visible shell page, no duplicate
// header). For steps that need to show a different real or fixture
// page, guided-tour.js dynamically inserts a full-viewport, borderless,
// same-origin <iframe> directly into the live homepage DOM and swaps
// its src as the tour progresses — reaching into the iframe's
// contentDocument (same-origin) to add highlight rings and detect real
// clicks, without ever modifying those pages' own source files.
//
// The routes below are only the iframe SRC targets for the two kinds
// of non-homepage steps: real production pages (/preview/interview,
// /preview/workspace — pre-existing, unmodified, routed by
// routes/preview.js, not duplicated here) and the three safe,
// fixture-driven scenes this file serves. No chapter numbers or
// chapter navigation are ever shown to the visitor — TOUR_STEPS
// (data/demo/walkthrough-fixture.js) is internal sequencing only.

const express = require('express');
const router = express.Router();
const {
  ROLE_TITLE,
  PERSONA_NAME,
  PERSONA_STYLE_LABEL,
  INTERVIEW_TOUR_SCRIPT,
  REPORT_FIXTURE,
  TOUR_STEPS,
} = require('../data/demo/walkthrough-fixture');

// Safety net for any old bookmarks/links to the previous video/chapter
// landing page — the guided tour now starts from the homepage itself.
router.get('/how-it-works', (_req, res) => {
  res.redirect('/');
});

// Tiny JSON config endpoint — fetched by public/js/guided-tour.js at
// startup. Keeps hero.ejs limited to pure click-behavior (no embedded
// data), and keeps TOUR_STEPS defined in exactly one place
// (data/demo/walkthrough-fixture.js) rather than duplicated inline.
router.get('/tour/steps.json', (_req, res) => {
  res.json(TOUR_STEPS);
});

router.get('/tour/scene/interview', (_req, res) => {
  res.render('demo/tour-scenes/interview', {
    roleTitle: ROLE_TITLE,
    personaName: PERSONA_NAME,
    personaStyleLabel: PERSONA_STYLE_LABEL,
    script: INTERVIEW_TOUR_SCRIPT,
  });
});

router.get('/tour/scene/report', (_req, res) => {
  res.render('demo/tour-scenes/report', {
    fixture: REPORT_FIXTURE,
  });
});

router.get('/tour/scene/closing', (_req, res) => {
  res.render('demo/tour-scenes/closing');
});

module.exports = router;
