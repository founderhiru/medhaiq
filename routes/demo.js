// routes/demo.js
//
// "See How It Works" 60-second walkthrough — isolated demo/recording
// layer. Every route here is:
//   - Public (no requireAuth / requireAuthPage / requireInterviewEntitlement)
//   - Stateless (no DB reads or writes, no session, no req.user)
//   - Disconnected from billing/credits/voice (no imports from
//     capability-engine, stripe, vapi, voice-tts-proxy, or cost-recorder)
//
// The real Interview Setup and Career Intelligence steps of the
// walkthrough are NOT duplicated here — the recording script instead
// navigates directly to the already-existing, already-safe
// /preview/interview and /preview/workspace routes (routes/preview.js),
// which render the real production templates with fixed demo data.
// This file only supplies the two steps that don't already have a safe
// public equivalent: the live voice interview visual (scripted, no
// Vapi) and the report (static fixture, no career-intelligence build),
// plus the end frame and the video-landing page the homepage CTA opens.

const express = require('express');
const router = express.Router();
const {
  ROLE_TITLE,
  PERSONA_NAME,
  PERSONA_STYLE_LABEL,
  INTERVIEW_CAPABILITIES_SNAPSHOT,
  REPORT_FIXTURE,
} = require('../data/demo/walkthrough-fixture');

router.get('/how-it-works', (_req, res) => {
  res.render('demo/how-it-works');
});

router.get('/scene/interview', (_req, res) => {
  res.render('demo/scene-interview', {
    roleTitle: ROLE_TITLE,
    personaName: PERSONA_NAME,
    personaStyleLabel: PERSONA_STYLE_LABEL,
    snapshot: INTERVIEW_CAPABILITIES_SNAPSHOT,
  });
});

router.get('/scene/report', (_req, res) => {
  res.render('demo/scene-report', {
    fixture: REPORT_FIXTURE,
  });
});

router.get('/scene/end', (_req, res) => {
  res.render('demo/scene-end');
});

module.exports = router;
