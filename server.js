// Entry point — wires middleware, runs migrations, mounts routes.
const express = require('express');
const path = require('path');
const { buildLandingContext } = require('./lib/landing-context');
require('./config/passport');

// Fail fast if DATABASE_URL is missing
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is required');
  process.exit(1);
}

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled rejection]', reason);
});

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const passport = require('passport');
app.use(passport.initialize());

// Minimal cookie parser — no extra dependencies
app.use((req, _res, next) => {
  const cookieHeader = req.headers.cookie || '';
  req.cookies = {};
  cookieHeader.split(';').forEach(part => {
    const [key, ...valParts] = part.trim().split('=');
    if (key) req.cookies[key.trim()] = valParts.join('=');
  });
  next();
});

// EJS view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Health check (no DB — allows Neon auto-suspend)
app.get('/health', (_req, res) => res.json({ status: 'healthy' }));

// Static files
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Founder Dashboard nav visibility — sets res.locals.isFounder so
// workspace-shell-top.ejs can conditionally show/hide the nav link on
// every authenticated page without editing every page's render() call.
// This is UI visibility only — the actual route and API are separately
// protected server-side in routes/founder.js and never trust this flag.
app.use(async (req, res, next) => {
  res.locals.isFounder = false;
  try {
    const userId = req.cookies?.user_id;
    if (userId) {
      const { isFounder } = require('./db/founder-access');
      res.locals.isFounder = await isFounder(userId);
    }
  } catch (err) {
    console.error('[isFounder check]', err.message);
  }
  next();
});

// ── API Routes ──────────────────────────────────────────────────────────────;
app.use('/api/contact',    require('./routes/contact'));
app.use('/auth',           require('./routes/auth'));
app.use('/api/interview',  require('./routes/interview'));
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/resume',     require('./routes/resume'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/founder',    require('./routes/founder'));
app.use('/api',            require('./routes/vapi'));

// ── Page Routes ─────────────────────────────────────────────────────────────
// Landing page — acquisition surface for NEW users only.
   // Existing (authenticated) visitors are redirected straight to the
   // Career Workspace so they never see the signup-oriented marketing page.
   // Uses the same `user_id` cookie + getUserById pattern already used by
   // /dashboard/history, /settings, /resume, etc. — no new auth mechanism.
   app.get('/', async (req, res) => {
     try {
       const userId = req.cookies?.user_id;
       if (userId) {
         const { getUserById } = require('./db/auth');
         const user = await getUserById(userId);
         if (user) return res.redirect('/dashboard/history');
       }
     } catch (err) {
       console.error('[landing] auth check error:', err);
       // Fall through to the public marketing page — never block on this check.
     }
     res.render('layout', buildLandingContext());
   });
app.get('/privacy', (_req, res) => res.redirect('/'));
app.get('/terms',   (_req, res) => res.redirect('/'));
app.get('/architecture', (_req, res) => res.render('architecture'));
app.get('/about',        (_req, res) => res.render('about'));
app.get('/why',     (_req, res) => res.render('why'));
app.get('/experience', (_req, res) => res.render('experience'));
app.get('/professional-horizons', (_req, res) => res.render('professional-horizons'));
app.get('/career-architecture', (_req, res) => res.redirect(301, '/architecture#career-architecture'));
app.get('/technical-blueprint', (_req, res) => res.redirect(301, '/architecture#technical-blueprint'));
app.get('/core-architecture',   (_req, res) => res.redirect(301, '/architecture#core-architecture'));
app.get('/ai-engine',           (_req, res) => res.redirect(301, '/architecture#ai-engine'));
app.get('/vision',              (_req, res) => res.redirect(301, '/about'));
app.get('/comparison',          (_req, res) => res.redirect(301, '/why#why-compare'));
app.get('/career-architecture', (_req, res) => res.redirect(301, '/architecture#journey'));
app.get('/technical-blueprint', (_req, res) => res.redirect(301, '/architecture#technical-blueprint'));
app.get('/core-architecture',   (_req, res) => res.redirect(301, '/architecture#framework'));
app.get('/live-terminal',       (_req, res) => res.redirect(301, '/architecture#proof'));
app.get('/ai-engine',           (_req, res) => res.redirect(301, '/architecture#technical-blueprint'));
app.get('/vision',              (_req, res) => res.redirect(301, '/about'));
app.get('/comparison',          (_req, res) => res.redirect(301, '/why#why-compare'));
app.get('/auth/login',  (_req, res) => res.render('auth-login'));
app.get('/auth/signup', (_req, res) => res.render('auth-signup'));
app.get('/login',       (_req, res) => res.redirect('/auth/login'));

 // Defensive 301s — none of these old paths were ever real routes in this
  // repo (verified: no matching app.get() existed before this addition), so
  // there's nothing currently broken. Adding them anyway only helps if one
  // of these URLs is linked externally somewhere (an old ad, a bookmark, a
  // backlink) that isn't visible from inside the codebase. Zero downside to
  // having them; they simply won't be exercised unless such a link exists.

  app.get('/career-architecture', (_req, res) => res.redirect(301, '/architecture#arch-layer-1'));
  app.get('/technical-blueprint', (_req, res) => res.redirect(301, '/architecture'));
  app.get('/core-architecture',   (_req, res) => res.redirect(301, '/architecture'));
  app.get('/ai-engine',           (_req, res) => res.redirect(301, '/architecture#arch-multimodel'));
  app.get('/vision',              (_req, res) => res.redirect(301, '/about'));
  app.get('/comparison',          (_req, res) => res.redirect(301, '/why#why-compare'));


// Interview setup
app.get('/interview', (_req, res) => {
  const userId = _req.cookies?.user_id;
  if (!userId) return res.redirect('/auth/login');
  res.render('interview-setup');
});

// Interview session
app.get('/interview/session/:id', async (req, res) => {
  try {
    const userId = req.cookies?.user_id;
    if (!userId) return res.redirect('/auth/login');

    const { getSession, getSessionQuestions } = require('./db/interview');
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).send('Session not found');
    if (String(session.user_id) !== String(userId)) return res.status(403).send('Forbidden');

    const questions = await getSessionQuestions(req.params.id);
    const currentQ = questions.find(q => q.answer_text === null || q.answer_text === undefined)
      || questions[questions.length - 1];
    if (!currentQ) return res.redirect('/interview/report/' + req.params.id);

    const { PERSONAS } = require('./services/interview');
    const persona = PERSONAS[session.persona_id] || PERSONAS.alex_chen;
    const initials = persona.name.split(' ').map(n => n[0]).join('');
    const answeredCount = questions.filter(q => q.answer_text !== null && q.answer_text !== undefined).length;

    // Candidate-facing "interviewer style" label — never the persona's real
    // name/title (that stays internal for scoring/report generation only).
    // A single calm adjective, matching the Session Context card on the
    // Target2 reference (e.g. "Helpful").
    const STYLE_LABELS = {
      alex_chen:        'Structured',
      priya_ramesh:     'Rigorous',
      marcus_webb:      'Conversational',
      sanjeev_nair:     'Methodical',
      sarah_kim:        'Direct',
      raj_mehta:        'Helpful',
    };
    const personaStyleLabel = STYLE_LABELS[session.persona_id] || 'Helpful';

   res.render('interview-session', {
  sessionId:        req.params.id,
  questionId:       currentQ.id,
  questionText:     currentQ.question_text || '',
  questionType:     currentQ.question_type || 'opening',
  questionNumber:   answeredCount + 1,
  answeredCount,
  personaName:      persona.name,
  personaTitle:     persona.title + ' @ ' + persona.org,
  personaInitials:  initials,
  personaStyleColor:persona.styleColor,
  personaStyleLabel,
  roleTitle:        session.role_title || '',
  experienceLevel:  session.experience_level || '',
  orgPreset:        session.org_preset || '',
  vapiPublicKey:    process.env.VAPI_PUBLIC_KEY   || '',
  vapiAssistantId:  process.env.VAPI_ASSISTANT_ID || '',
});
  } catch (err) {
    console.error('[interview/session]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Interview report
app.get('/interview/report/:id', async (req, res) => {
  try {
    const { getReport, getSession, getSessionScores } = require('./db/interview');
    const report = await getReport(req.params.id);
    if (!report) return res.status(404).send('Report not found');

    const { PERSONAS } = require('./services/interview');
    const persona = PERSONAS[report.persona_id] || PERSONAS.alex_chen;
    const scoresData = await getSessionScores(req.params.id);

    const avg = (key) => scoresData.length
      ? scoresData.reduce((s, x) => s + parseFloat(x[key] || 0), 0) / scoresData.length : 0;

    const circumference = 2 * Math.PI * 60;
    const circumferenceOffset = circumference - ((report.overall_score || 0) / 100) * circumference;

    res.render('interview-report', {
      report,
      personaName: persona.name,
      personaTitle: persona.title + ' @ ' + persona.org,
      roleTitle: report.role_title || 'General Professional',
      experienceLevel: report.experience_level || 'Mid-Career',
      formattedDate: new Date(report.created_at || report.started_at).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }),
      starAvg: avg('star_score'),
      technicalAvg: avg('technical_depth'),
      executiveAvg: avg('executive_presence'),
      gccAvg: avg('gcc_readiness'),
      frictionAvg: avg('core_friction'),
      circumference,
      circumferenceOffset,
    });
  } catch (err) {
    console.error('[interview/report]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Interview report — PDF download
// Reuses the exact same report/persona/score-fetching pattern as the
// on-screen route above. Adds: radar-chart polygon math, per-question
// score joining (for the Q&A pages), and deterministic badge labels —
// all computed from real data already in interview_reports/interview_scores,
// nothing fabricated. See views/interview-report-pdf.ejs for the data
// contract this passes in.
function buildRadarPolygon(scores) {
  // scores order must match the vector bar order: Structure, Technical,
  // Executive, GCC, Communication. cx/cy/maxR match the SVG's own
  // viewBox (300x290, center 150,150) in interview-report-pdf.ejs.
  const cx = 150, cy = 150, maxR = 110;
  const points = scores.map((score, i) => {
    const angleRad = (-90 + 72 * i) * Math.PI / 180;
    const r = maxR * (Math.max(0, Math.min(100, score)) / 100);
    return {
      x: Math.round((cx + r * Math.cos(angleRad)) * 10) / 10,
      y: Math.round((cy + r * Math.sin(angleRad)) * 10) / 10,
    };
  });
  return { polygonPoints: points.map(p => `${p.x},${p.y}`).join(' '), points };
}

function renderView(view, data) {
  return new Promise((resolve, reject) => {
    app.render(view, data, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

app.get('/interview/report/:id/pdf', async (req, res) => {
  try {
    const { getReport, getSessionScores, getSessionQuestions } = require('./db/interview');
    const { PERSONAS, computeStarProgress } = require('./services/interview');
    const { renderReportPdf } = require('./services/pdf-report');

    const report = await getReport(req.params.id);
    if (!report) return res.status(404).send('Report not found');

    const persona = PERSONAS[report.persona_id] || PERSONAS.alex_chen;
    const scoresData = await getSessionScores(req.params.id);
    const questions = await getSessionQuestions(req.params.id);

    const avg = (key) => scoresData.length
      ? scoresData.reduce((s, x) => s + parseFloat(x[key] || 0), 0) / scoresData.length : 0;

    const starAvg = avg('star_score');
    const technicalAvg = avg('technical_depth');
    const executiveAvg = avg('executive_presence');
    const gccAvg = avg('gcc_readiness');
    const frictionAvg = avg('core_friction');

    const radar = buildRadarPolygon([starAvg, technicalAvg, executiveAvg, gccAvg, frictionAvg]);

    const scoreByQuestionId = new Map(scoresData.map(s => [s.question_id, s]));
    const qaCards = questions
      .filter(q => q.answer_text !== null && q.answer_text !== undefined)
      .map((q, i) => ({
        index: i + 1,
        questionText: q.question_text,
        scores: scoreByQuestionId.get(q.id) || null,
      }));

    // Deterministic thresholds, not stored fields — adjust here if you
    // want different cutoffs. Documented in the template too.
    const promotionReadiness  = report.overall_score >= 80 ? 'High' : report.overall_score >= 60 ? 'Medium' : 'Low';
    const leadershipPotential = executiveAvg >= 80 ? 'Strong' : executiveAvg >= 60 ? 'Developing' : 'Emerging';
    const confidenceLevel     = frictionAvg >= 80 ? 'High' : frictionAvg >= 55 ? 'Medium' : 'Low';

    const nextSteps = Array.isArray(report.next_steps_json) ? report.next_steps_json : [];

    // scoreboard may come back already-parsed (JSONB column) or as a raw
    // string (TEXT column) depending on your actual DB schema — this
    // repo's migrations file doesn't show how the scoreboard/executive_
    // summary/etc columns were added (only the original 4-column table is
    // present), so handling both defensively rather than assuming.
    let scoreboard = report.scoreboard || {};
    if (typeof scoreboard === 'string') {
      try { scoreboard = JSON.parse(scoreboard); } catch (e) { scoreboard = {}; }
    }
    const vectorBreakdown = Array.isArray(scoreboard.vector_breakdown) ? scoreboard.vector_breakdown : [];
    const candidateModel = scoreboard.candidate_model || null;
    const evidenceMaturity = scoreboard.evidence_maturity || null;
    const leadershipReadiness = scoreboard.leadership_readiness;

    // ── STAR Assessment — reuses computeStarProgress() EXACTLY as the live
    // interview does (same function, same regex patterns, same order), just
    // called again at report time on the stored answer text. Per-question
    // star_components were never persisted (a pre-existing gap, not a new
    // one), so this recomputes the keyword-detection half of that same
    // function rather than inventing a different STAR representation.
    const answeredQs = questions.filter(q => q.answer_text !== null && q.answer_text !== undefined);
    const starResults = answeredQs.map(q => computeStarProgress(q.answer_text));
    const starCounts = { situation: 0, task: 0, action: 0, result: 0 };
    starResults.forEach(r => { ['situation', 'task', 'action', 'result'].forEach(k => { if (r[k]) starCounts[k]++; }); });
    const starTotal = starResults.length;

    // ── Top 3 Strengths / Development Areas — ranked from the real 5-vector
    // scores + the real vector_breakdown text (no new AI call, no
    // fabrication). NOTE: report.strengths_json and report.improvements_json
    // both derive from the same underlying "priorities" array in
    // generateReport() and would show identical content twice if both were
    // used here — ranking vectorBreakdown by actual score avoids that
    // duplication and ties directly to the 5-Vector scores shown on page 1.
    const vectorScoreMap = { structure: starAvg, technical: technicalAvg, executive: executiveAvg, gcc: gccAvg, communication: frictionAvg };
    const rankedVectors = vectorBreakdown
      .map(vb => ({ ...vb, score: vectorScoreMap[vb.vector] || 0 }))
      .sort((a, b) => b.score - a.score);
    const topStrengths = rankedVectors.slice(0, 3);
    // With only 5 vectors total, a strict "top 3" and "bottom 3" would
    // overlap by exactly one item (3+3=6 > 5) — e.g. the 3rd-highest vector
    // would show up as both a Strength and a Development Area on the same
    // page. Excluding whatever's already a Strength avoids that duplication;
    // this naturally yields 2 distinct development areas, not 3.
    const strengthKeys = topStrengths.map(s => s.vector);
    const topDevelopmentAreas = rankedVectors
      .filter(v => strengthKeys.indexOf(v.vector) === -1)
      .slice()
      .reverse();
    const practiceFocus = topDevelopmentAreas[0] || null;

    const html = await renderView('interview-report-pdf', {
      candidateName: (req.user && req.user.name) || 'Candidate',
      report,
      personaName: persona.name,
      roleTitle: report.role_title || 'General Professional',
      experienceLevel: report.experience_level || 'Mid-Career',
      formattedDate: new Date(report.created_at || report.started_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      }),
      starAvg, technicalAvg, executiveAvg, gccAvg, frictionAvg,
      radarPolygonPoints: radar.polygonPoints,
      radarPoints: radar.points,
      qaCards,
      promotionReadiness, leadershipPotential, confidenceLevel,
      nextSteps,
      vectorBreakdown,
      candidateModel,
      evidenceMaturity,
      leadershipReadiness,
      starCounts,
      starTotal,
      topStrengths,
      topDevelopmentAreas,
      practiceFocus,
    });

    const pdfBuffer = await renderReportPdf(html);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="MedhaIQ-Report-${req.params.id}.pdf"`,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[interview/report/pdf]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Dashboard history (rendered as the Career Workspace / persistent shell's
// Dashboard page — same route, same URL, per founder decision not to
// introduce a new route for this)
app.get('/dashboard/history', async (req, res) => {
  try {
    const userId = req.cookies?.user_id;
    if (!userId) return res.redirect('/auth/login');

    const { getUserById } = require('./db/auth');
    const { getUserSessions, getUserAggregateScores } = require('./db/interview');
    const user = await getUserById(userId);
    if (!user) return res.redirect('/auth/login');

    const sessions = await getUserSessions(userId, { limit: 20 });
    // Two bugs were compounding here:
    // 1) `s.overall_score || s.report_score || null` treats a real score of
    //    0 as falsy, silently discarding it (and `report_score` isn't even
    //    a real column on this query — it was always undefined). Explicit
    //    null/undefined checks fix that.
    // 2) node-postgres returns NUMERIC columns as STRINGS (e.g. "0.00"),
    //    not JS numbers. Left as strings, `trend.reduce((a,b)=>a+b,0)` does
    //    string concatenation instead of addition, and .toFixed() on the
    //    result either throws or prints garbage — that's what was showing
    //    up as "Average: NaN" on the dashboard. Number(...) fixes it.
    const toScoreOrNull = (v) => (v === null || v === undefined || v === '') ? null : Number(v);
    const history = sessions.map(s => ({
      id: s.id,
      personaId: s.persona_id,
      roleTitle: s.role_title,
      experienceLevel: s.experience_level,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      overallScore: toScoreOrNull(s.overall_score),
      status: s.status,
    }));

    const trend = history
      .map(s => s.overallScore)
      .filter(v => typeof v === 'number' && !Number.isNaN(v))
      .slice(0, 10)
      .reverse();
    const trendWidth = 600, trendHeight = 80;
    const trendX = (i) => trend.length > 1 ? (i / (trend.length - 1)) * trendWidth : trendWidth / 2;
    const trendY = (score) => trendHeight - (score / 100) * trendHeight;
    let trendPoints = '', trendPointsFill = '';
    if (trend.length > 0) {
      const pts = trend.map((score, i) => `${trendX(i)},${trendY(score)}`);
      trendPoints = pts.join(' ');
      trendPointsFill = pts.join(' ') + ` ${trendX(trend.length - 1)},${trendHeight} ${trendX(0)},${trendHeight}`;
    }
    // Computed here, once, as real numbers — the template just displays
    // these rather than re-doing reduce()/toFixed() on raw DB values itself.
    const trendLatest = trend.length ? trend[trend.length - 1] : null;
    const trendAvg = trend.length ? (trend.reduce((a, b) => a + b, 0) / trend.length) : null;

    // ---- Added for the Career Workspace layout (Activity Overview,
    // Interview Insights, Recent Activity resume row). All derived from
    // data already fetched above — no new queries except aggregateScores. ----
    const completedSessions = history.filter(s => s.status === 'completed');
    const interviewsCompletedCount = completedSessions.length;
    const reportsGeneratedCount = completedSessions.filter(s => s.overallScore !== null).length;
    const totalPracticeMinutes = completedSessions.reduce((mins, s) => {
      if (!s.startedAt || !s.endedAt) return mins;
      const diffMs = new Date(s.endedAt) - new Date(s.startedAt);
      return mins + (diffMs > 0 ? diffMs / 60000 : 0);
    }, 0);
    const practiceTimeLabel = (() => {
      const total = Math.round(totalPracticeMinutes);
      const h = Math.floor(total / 60), m = total % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    })();
    const readinessScore = trendAvg !== null ? Math.round(trendAvg) : null;
    const readinessDeltaVsFirst = (trend.length > 1) ? Math.round(trend[trend.length - 1] - trend[0]) : null;
    const interruptedSession = history.find(s => s.status === 'in_progress') || null;
    const aggregateScores = await getUserAggregateScores(userId);

    // ---- Relative-time labels for the overview cards ("Last interview
    // yesterday", etc.) — real dates from `history`, just formatted. ----
    const relativeDayLabel = (date) => {
      if (!date) return null;
      const diffDays = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
      if (diffDays <= 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    const lastCompleted = completedSessions[0] || null; // history is already DESC by started_at
    const lastInterviewLabel = lastCompleted ? `Last interview ${relativeDayLabel(lastCompleted.startedAt)}` : 'No interviews yet';
    const lastSessionLabel = history[0] ? `Last session ${relativeDayLabel(history[0].startedAt)}` : 'No sessions yet';
    const lastReportLabel = lastCompleted ? `Last report ${relativeDayLabel(lastCompleted.startedAt)}` : 'No reports yet';

    // "Preparing For" — real data: the in-progress session's role if one
    // exists, otherwise the most recent session's role. Not fabricated;
    // null (and hidden in the view) if there's no session at all yet.
    const preparingForSession = interruptedSession || history[0] || null;
    const preparingForRole = preparingForSession ? (preparingForSession.roleTitle || 'Mock Interview') : null;

    res.render('dashboard-history', {
      shellUser: user,
      history, trend, trendPoints, trendPointsFill, trendWidth, trendX, trendY, trendLatest, trendAvg,
      interviewsCompletedCount, reportsGeneratedCount, practiceTimeLabel,
      readinessScore, readinessDeltaVsFirst, interruptedSession, aggregateScores,
      lastInterviewLabel, lastSessionLabel, lastReportLabel, preparingForRole,
    });
  } catch (err) {
    console.error('[dashboard/history]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Settings — new, minimal (Profile / Account / Preferences). No page
// existed at this route before; same auth pattern as dashboard/history.
app.get('/settings', async (req, res) => {
  try {
    const userId = req.cookies?.user_id;
    if (!userId) return res.redirect('/auth/login');

    const { getUserById } = require('./db/auth');
    const user = await getUserById(userId);
    if (!user) return res.redirect('/auth/login');

    res.render('settings', { shellUser: user });
  } catch (err) {
    console.error('[settings]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Founder Dashboard — same cookie-auth pattern as /settings and /resume,
// plus a founder_access check. Non-founders get a plain 404 (not a
// redirect), so the route's existence isn't revealed either way.
app.get('/founder', async (req, res) => {
  try {
    const userId = req.cookies?.user_id;
    if (!userId) return res.redirect('/auth/login');

    const { getUserById } = require('./db/auth');
    const { isFounder } = require('./db/founder-access');
    const user = await getUserById(userId);
    if (!user) return res.redirect('/auth/login');

    const founder = await isFounder(userId);
    if (!founder) return res.status(404).render('error-boundary', { url: req.url, errorMessage: 'Not found' });

    const { getOverviewStats, getRecentActivity } = require('./db/founder-stats');
    const { listUsers } = require('./db/founder-users');
    const [stats, activity, users] = await Promise.all([
      getOverviewStats(),
      getRecentActivity(10),
      listUsers({ search: '', limit: 25 }),
    ]);

    const footerInfo = {
      version: '1.0 Beta',
      lastRefreshed: new Date(),
      dbConnected: true, // if we got this far, the queries above already succeeded
      environment: process.env.NODE_ENV === 'production' ? 'Production' : (process.env.NODE_ENV || 'Development'),
    };

    res.render('founder-dashboard', { shellUser: user, stats, activity, users, footerInfo });
  } catch (err) {
    console.error('[founder]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Resume Intelligence — same auth pattern as /settings. This page only
// displays status and lets the user upload/replace; parsing itself happens
// entirely inside routes/resume.js, never here.
app.get('/resume', async (req, res) => {
  try {
    const userId = req.cookies?.user_id;
    if (!userId) return res.redirect('/auth/login');

    const { getUserById } = require('./db/auth');
    const user = await getUserById(userId);
    if (!user) return res.redirect('/auth/login');

    res.render('resume', { shellUser: user });
  } catch (err) {
    console.error('[resume]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error handler]', err);
  res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
});

// ── Start server — run migrations first ─────────────────────────────────────
const { runMigrations } = require('./db/migrate');

runMigrations()
  .then(() => {
    app.listen(port, () => {
      console.log(`[server] Running on port ${port}`);
      console.log(`[server] NODE_ENV=${process.env.NODE_ENV || 'development'}`);
      console.log(`[server] ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? 'SET ✓' : 'MISSING ✗'}`);
    });
  })
  .catch(err => {
    console.error('[server] Migration failed — aborting startup:', err.message);
    process.exit(1);
  });
