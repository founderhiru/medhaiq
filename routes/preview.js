// ═══════════════════════════════════════════════════════════════════════════
// routes/preview.js — Visitor Preview Architecture
//
// Anonymous, indexable, shareable (verified: no robots.txt, no noindex meta
// blocking it). Reuses production EJS templates with previewMode + demoData
// locals instead of duplicating templates. No DB writes, no session.
//
// Already-authenticated visitors who land on a /preview/* URL are sent to
// the real page instead — no reason to show a logged-in user a demo of
// something they already have real access to.
//
// STATUS: /preview/interview only. /preview/report, /preview/workspace,
// /preview/resume are intentionally NOT registered yet — see
// lib/navigation-resolver.js for the safe fallback until each ships.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const DEMO_INTERVIEW = {
  resumeStatusHtml:
    '✓ Resume on file (12 competencies detected) — will personalize this interview automatically. <a href="/auth/signup" style="color:var(--blue-hi);">Manage</a>',
};

router.get('/interview', (req, res) => {
  if (req.capabilities && req.capabilities.isAuthenticated) {
    return res.redirect('/interview');
  }
  res.render('interview-setup', {
    previewMode: true,
    demoData: DEMO_INTERVIEW,
  });
});

module.exports = router;
