// Entry point — wires middleware and mounts routes only.
// Business logic lives in db/, routes/, services/.
const express = require('express');
const path = require('path');
const { buildLandingContext } = require('./lib/landing-context');
const passport = require('./config/passport');

// Fail fast if DATABASE_URL is missing
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// Google OAuth credentials check
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  console.log('Google OAuth configured');
} else {
  console.log('Google OAuth credentials not configured — sign-in with Google unavailable');
}

// Catch unhandled promise rejections to prevent silent crashes
process.on('unhandledRejection', (reason, _promise) => {
  console.error('[unhandled rejection]', reason);
});

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// EJS view engine. Templates live in ./views/ (entry point: layout.ejs).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Health check endpoint (required for Render)
// Does NOT query database to allow Neon auto-suspend
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy' });
});

// Serve static files from public folder.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/waitlist',      require('./routes/waitlist'));
app.use('/api/contact',       require('./routes/contact'));
app.use('/auth',              require('./routes/auth'));
app.use('/api/interview',     require('./routes/interview'));
app.use('/api/dashboard',     require('./routes/dashboard'));

// ── Page Routes ─────────────────────────────────────────────────────────────

// Landing page
app.get('/', (_req, res) => {
  res.render('layout', buildLandingContext());
});

app.get('/privacy', (_req, res) => res.redirect('/#waitlist'));
app.get('/terms',   (_req, res) => res.redirect('/#waitlist'));

// Auth pages
app.get('/auth/login', (_req, res) => {
  res.render('auth-login');
});
app.get('/auth/signup', (_req, res) => {
  res.render('auth-signup');
});
app.get('/login', (_req, res) => res.redirect('/auth/login'));

// Interview setup
app.get('/interview', (_req, res) => {
  const userId = _req.cookies?.user_id;
  if (!userId) return res.redirect('/auth/login');
  res.render('interview-setup');
});

// Interview session
app.get('/interview/session/:id', async (req, res, next) => {
  try {
    const userId = req.cookies?.user_id;
    if (!userId) return res.redirect('/auth/login');

    const { getSession } = require('./db/interview');
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).send('Session not found');
    if (session.user_id !== userId) return res.status(403).send('Forbidden');

    const { getSessionQuestions } = require('./db/interview');
    const questions = await getSessionQuestions(req.params.id);
    // Get current question (latest unanswered or first)
    const currentQ = questions.find(q => !q.answer_text) || questions[questions.length - 1];
    if (!currentQ) return res.redirect('/interview/report/' + req.params.id);

    // Build persona info for template
    const { PERSONAS } = require('./services/interview');
    const persona = PERSONAS[session.persona_id] || PERSONAS.alex_chen;
    const initials = persona.name.split(' ').map(n => n[0]).join('');

    res.render('interview-session', {
      sessionId: req.params.id,
      questionId: currentQ.id,
      questionType: currentQ.question_type || 'opening',
      questionNumber: questions.filter(q => !q.answer_text).length || 1,
      personaName: persona.name,
      personaTitle: persona.title + ' @ ' + persona.org,
      personaInitials: initials,
      personaStyleColor: persona.styleColor,
    });
  } catch (err) {
    console.error('[interview/session]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Interview report
app.get('/interview/report/:id', async (req, res, next) => {
  try {
    const { getReport, getSession } = require('./db/interview');
    const report = await getReport(req.params.id);
    if (!report) return res.status(404).send('Report not found');

    const session = await getSession(req.params.id);
    const { PERSONAS } = require('./services/interview');
    const persona = PERSONAS[report.persona_id] || PERSONAS.alex_chen;

    // Calculate averages for score bars
    const scores = require('./db/interview');
    const scoresData = await scores.getSessionScores(req.params.id);

    const starAvg = scoresData.length ? scoresData.reduce((s, x) => s + parseFloat(x.star_score), 0) / scoresData.length : 0;
    const technicalAvg = scoresData.length ? scoresData.reduce((s, x) => s + parseFloat(x.technical_depth), 0) / scoresData.length : 0;
    const executiveAvg = scoresData.length ? scoresData.reduce((s, x) => s + parseFloat(x.executive_presence), 0) / scoresData.length : 0;
    const gccAvg = scoresData.length ? scoresData.reduce((s, x) => s + parseFloat(x.gcc_readiness), 0) / scoresData.length : 0;
    const frictionAvg = scoresData.length ? scoresData.reduce((s, x) => s + parseFloat(x.core_friction), 0) / scoresData.length : 0;

    // Score ring calculations
    const maxCircumference = 2 * Math.PI * 60;
    const circumference = maxCircumference;
    const circumferenceOffset = circumference - ((report.overall_score || 0) / 100) * circumference;

    res.render('interview-report', {
      report,
      personaName: persona.name,
      personaTitle: persona.title + ' @ ' + persona.org,
      roleTitle: report.role_title || 'General Professional',
      experienceLevel: report.experience_level || 'Mid-Career',
      formattedDate: new Date(report.created_at || report.started_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      starAvg,
      technicalAvg,
      executiveAvg,
      gccAvg,
      frictionAvg,
      circumference,
      circumferenceOffset,
    });
  } catch (err) {
    console.error('[interview/report]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Dashboard history
app.get('/dashboard/history', async (req, res, next) => {
  try {
    const userId = req.cookies?.user_id;
    if (!userId) return res.redirect('/auth/login');

    const { getUserById } = require('./db/auth');
    const { getUserSessions } = require('./db/interview');
    const user = await getUserById(userId);
    if (!user) return res.redirect('/auth/login');

    const sessions = await getUserSessions(userId, { limit: 20 });
    const history = sessions.map(s => ({
      id: s.id,
      personaId: s.persona_id,
      roleTitle: s.role_title,
      experienceLevel: s.experience_level,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      overallScore: s.overall_score || s.report_score || null,
      status: s.status,
    }));

    // Score trend
    const trend = history
      .filter(s => s.overallScore !== null)
      .slice(0, 10)
      .reverse()
      .map(s => s.overallScore);

    // SVG trend points
    let trendPoints = '';
    let trendPointsFill = '';
    const trendWidth = 600;
    const trendHeight = 80;
    function trendX(i) { return trend.length > 1 ? (i / (trend.length - 1)) * trendWidth : trendWidth / 2; }
    function trendY(score) { return trendHeight - (score / 100) * trendHeight; }

    if (trend.length > 0) {
      const pts = trend.map((score, i) => `${trendX(i)},${trendY(score)}`);
      trendPoints = pts.join(' ');
      const minX = trendX(0);
      const maxX = trendX(trend.length - 1);
      const minY = trendHeight;
      trendPointsFill = pts.join(' ') + ` ${maxX},${trendHeight} ${minX},${trendHeight}`;
    }

    res.render('dashboard-history', {
      history,
      trend,
      trendPoints,
      trendPointsFill,
      trendWidth,
      trendX,
      trendY,
    });
  } catch (err) {
    console.error('[dashboard/history]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Global error handler — catches any remaining synchronous errors and async
// exceptions that propagated past individual route handlers.
app.use((err, req, res, _next) => {
  console.error('[error handler]', err);
  res.status(500).render('error-boundary', { url: req.url });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});