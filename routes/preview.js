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
// STATUS: /preview/interview and /preview/workspace are live.
// /preview/report, /preview/resume are intentionally NOT registered yet —
// see lib/navigation-resolver.js for the safe fallback until each ships.
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

// ── /preview/workspace ──────────────────────────────────────────────────
// Sample Account view. Never queries the database and never reads req.user
// — every value below is a fixed literal. Reuses the real
// dashboard-history.ejs template so it visually matches the authenticated
// experience, but action CTAs are disabled inside that template itself
// (guarded by the previewMode flag passed below — see that file's own
// previewMode checks). Already-authenticated visitors are redirected to
// their own real workspace instead of being shown a demo of it.
//
// The derivation logic below (trend points, readiness score, relative-time
// labels) is intentionally a duplicate of the real GET /dashboard/history
// handler in server.js, not an extracted shared function — so nothing
// about this preview route can ever risk the real, production-critical
// dashboard page if that logic changes. Applied to fixed fabricated
// sessions instead of a DB query, so the numbers are genuinely internally
// consistent rather than separately hand-typed per field.
router.get('/workspace', (req, res) => {
  if (req.capabilities && req.capabilities.isAuthenticated) {
    return res.redirect('/dashboard/history');
  }

  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
  const DEMO_SESSIONS_RAW = [
    { id: 'demo-1', persona_id: 'p1', role_title: 'Senior Product Manager', org_preset: 'Series B SaaS', experience_level: 'senior', started_at: daysAgo(2), ended_at: daysAgo(2), overall_score: 82, status: 'completed', abandoned_reason: null },
    { id: 'demo-2', persona_id: 'p1', role_title: 'Senior Product Manager', org_preset: 'Series B SaaS', experience_level: 'senior', started_at: daysAgo(6), ended_at: daysAgo(6), overall_score: 74, status: 'completed', abandoned_reason: null },
    { id: 'demo-3', persona_id: 'p2', role_title: 'Product Manager', org_preset: null, experience_level: 'mid', started_at: daysAgo(11), ended_at: daysAgo(11), overall_score: 69, status: 'completed', abandoned_reason: null },
    { id: 'demo-4', persona_id: 'p2', role_title: 'Product Manager', org_preset: null, experience_level: 'mid', started_at: daysAgo(18), ended_at: daysAgo(18), overall_score: 64, status: 'completed', abandoned_reason: null },
    { id: 'demo-5', persona_id: 'p1', role_title: 'Senior Product Manager', org_preset: 'Series B SaaS', experience_level: 'senior', started_at: daysAgo(25), ended_at: daysAgo(25), overall_score: 58, status: 'completed', abandoned_reason: null },
  ];
  const DEMO_AGGREGATE_SCORES = { starAvg: 78, technicalAvg: 71, executiveAvg: 66, gccAvg: 73, frictionAvg: 69 };
  const DEMO_CAREER_PROFILE = { resume_parse_status: 'SUCCESS', resume_parsed_at: daysAgo(9) };

  const toScoreOrNull = (v) => (v === null || v === undefined || v === '') ? null : Number(v);
  const history = DEMO_SESSIONS_RAW.map(s => ({
    id: s.id, personaId: s.persona_id, roleTitle: s.role_title, orgPreset: s.org_preset,
    experienceLevel: s.experience_level, startedAt: s.started_at, endedAt: s.ended_at,
    overallScore: toScoreOrNull(s.overall_score), status: s.status, abandonedReason: s.abandoned_reason,
  }));

  const trend = history.map(s => s.overallScore).filter(v => typeof v === 'number' && !Number.isNaN(v)).slice(0, 10).reverse();
  const trendWidth = 600, trendHeight = 80;
  const trendX = (i) => trend.length > 1 ? (i / (trend.length - 1)) * trendWidth : trendWidth / 2;
  const trendY = (score) => trendHeight - (score / 100) * trendHeight;
  let trendPoints = '', trendPointsFill = '';
  if (trend.length > 0) {
    const pts = trend.map((score, i) => `${trendX(i)},${trendY(score)}`);
    trendPoints = pts.join(' ');
    trendPointsFill = pts.join(' ') + ` ${trendX(trend.length - 1)},${trendHeight} ${trendX(0)},${trendHeight}`;
  }
  const trendLatest = trend.length ? trend[trend.length - 1] : null;
  const trendAvg = trend.length ? (trend.reduce((a, b) => a + b, 0) / trend.length) : null;

  const completedSessions = history.filter(s => s.status === 'completed');
  const interviewsCompletedCount = completedSessions.length;
  const reportsGeneratedCount = completedSessions.filter(s => s.overallScore !== null).length;
  const totalPracticeMinutes = completedSessions.length * 22; // fixed, since demo sessions share one timestamp rather than a real duration
  const practiceTimeLabel = (() => {
    const total = Math.round(totalPracticeMinutes);
    const h = Math.floor(total / 60), m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();
  const readinessScore = trendAvg !== null ? Math.round(trendAvg) : null;
  const readinessDeltaVsPrevious = (trend.length > 1) ? Math.round(trend[trend.length - 1] - trend[trend.length - 2]) : null;
  const interruptedSession = null; // Sample Account never has an in-progress session

  const relativeDayLabel = (date) => {
    if (!date) return null;
    const diffDays = Math.floor((now - new Date(date).getTime()) / 86400000);
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const lastCompleted = completedSessions[0];
  const lastInterviewLabel = `Last interview ${relativeDayLabel(lastCompleted.startedAt)}`;
  const lastSessionLabel = `Last session ${relativeDayLabel(history[0].startedAt)}`;
  const lastReportLabel = `Last report ${relativeDayLabel(lastCompleted.startedAt)}`;

  const resumeIntelActive = true;
  const resumeIntelSubLabel = `Updated ${relativeDayLabel(DEMO_CAREER_PROFILE.resume_parsed_at)}`;

  const competencyScores = [
    { label: 'Structure', val: DEMO_AGGREGATE_SCORES.starAvg },
    { label: 'Domain Expertise', val: DEMO_AGGREGATE_SCORES.technicalAvg },
    { label: 'Strategic Thinking', val: DEMO_AGGREGATE_SCORES.executiveAvg },
    { label: 'Communication', val: DEMO_AGGREGATE_SCORES.frictionAvg },
    { label: 'Leadership & Execution', val: DEMO_AGGREGATE_SCORES.gccAvg },
  ].sort((a, b) => b.val - a.val);
  const bestCompetencyLabel = competencyScores[0].label;
  const focusNextLabel = competencyScores[competencyScores.length - 1].label;

  res.render('dashboard-history', {
    shellUser: { name: 'Sample Account', email: null },
    history, trend, trendPoints, trendPointsFill, trendWidth, trendX, trendY, trendLatest, trendAvg,
    interviewsCompletedCount, reportsGeneratedCount, practiceTimeLabel,
    readinessScore, readinessDeltaVsPrevious, interruptedSession, aggregateScores: DEMO_AGGREGATE_SCORES,
    lastInterviewLabel, lastSessionLabel, lastReportLabel, preparingForRole: history[0].roleTitle,
    resumeIntelActive, resumeIntelSubLabel,
    bestCompetencyLabel, focusNextLabel,
    market: null,
    previewMode: true,
  });
});

module.exports = router;
