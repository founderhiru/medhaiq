// Entry point — wires middleware, runs migrations, mounts routes.
const express = require('express');
const path = require('path');
const { buildLandingContext } = require('./lib/landing-context');

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

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/waitlist',   require('./routes/waitlist'));
app.use('/api/contact',    require('./routes/contact'));
app.use('/auth',           require('./routes/auth'));
app.use('/api/interview',  require('./routes/interview'));
app.use('/api/dashboard',  require('./routes/dashboard'));

// ── Page Routes ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.render('layout', buildLandingContext()));
app.get('/privacy', (_req, res) => res.redirect('/#waitlist'));
app.get('/terms',   (_req, res) => res.redirect('/#waitlist'));

app.get('/auth/login',  (_req, res) => res.render('auth-login'));
app.get('/auth/signup', (_req, res) => res.render('auth-signup'));
app.get('/login',       (_req, res) => res.redirect('/auth/login'));

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

    res.render('interview-session', {
      sessionId: req.params.id,
      questionId: currentQ.id,
      questionText: currentQ.question_text || '',
      questionType: currentQ.question_type || 'opening',
      questionNumber: answeredCount + 1,
      answeredCount,
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

// Dashboard history
app.get('/dashboard/history', async (req, res) => {
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

    const trend = history.filter(s => s.overallScore !== null).slice(0, 10).reverse().map(s => s.overallScore);
    const trendWidth = 600, trendHeight = 80;
    const trendX = (i) => trend.length > 1 ? (i / (trend.length - 1)) * trendWidth : trendWidth / 2;
    const trendY = (score) => trendHeight - (score / 100) * trendHeight;
    let trendPoints = '', trendPointsFill = '';
    if (trend.length > 0) {
      const pts = trend.map((score, i) => `${trendX(i)},${trendY(score)}`);
      trendPoints = pts.join(' ');
      trendPointsFill = pts.join(' ') + ` ${trendX(trend.length - 1)},${trendHeight} ${trendX(0)},${trendHeight}`;
    }

    res.render('dashboard-history', { history, trend, trendPoints, trendPointsFill, trendWidth, trendX, trendY });
  } catch (err) {
    console.error('[dashboard/history]', err);
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
