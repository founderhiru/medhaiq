// routes/guides.js
// Public, indexable "Interview Questions" library: /interview-questions and
// /interview-questions/:slug. Renders entirely from data/question-guides-data.js.
// Isolated on purpose: no DB, no auth, no AI calls, and no import of any
// protected module. Mount it in server.js next to the other page routes.

const express = require('express');
const router = express.Router();

router.get('/interview-questions', (_req, res) => {
  const { guides } = require('../data/question-guides-data');
  const list = guides.map(g => ({ slug: g.slug, title: g.title, eyebrow: g.eyebrow, count: g.questions.length }));
  res.render('question-library', { guides: list });
});

router.get('/interview-questions/:slug', (req, res) => {
  const { guides } = require('../data/question-guides-data');
  const guide = guides.find(g => g.slug === req.params.slug);
  if (!guide) return res.status(404).send('Interview guide not found');
  res.render('question-guide', { guide });
});

module.exports = router;
