// Entry point — wires middleware, runs migrations, mounts routes.
const express = require('express');
const path = require('path');
const { buildLandingContext } = require('./lib/landing-context');
const { requireAuthPage, requireFounderPage } = require('./middleware/guards');
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

// Capability Engine — resolves visitor/free/pro tier for every request and
// attaches req.capabilities + res.locals.capabilities/megaMenuItems/headerCTA.
// Must run after the cookie parser (needs req.cookies.user_id) and before
// any route that renders a view. Nothing in views/partials/header.ejs reads
// megaMenuItems/headerCTA yet — that wiring is a separate, later change —
// so this is purely additive infrastructure right now.
app.use(require('./middleware/capabilities'));

// EJS view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Health check (no DB — allows Neon auto-suspend)
app.get('/health', (_req, res) => res.json({ status: 'healthy' }));

// Static files
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── API Routes ──────────────────────────────────────────────────────────────;
app.use('/api/contact',    require('./routes/contact'));
app.use('/auth',           require('./routes/auth'));
app.use('/api/interview',  require('./routes/interview'));
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/resume',     require('./routes/resume'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/founder',    require('./routes/founder'));
app.use('/api/settings',   require('./routes/account'));
app.use('/api/public-preview', require('./routes/public-preview'));
app.use('/preview',        require('./routes/preview'));
app.use('/api',            require('./routes/vapi'));
app.use('/api',            require('./routes/vapi-silent-model')); // tts_pipeline custom-llm stub (2026-07-25) — see file header for activation steps
app.use('/api/voice',      require('./routes/voice-tts'));   // PR3: ElevenLabs proxy, requireAuth-gated
app.use('/debug/voice',    require('./routes/debug-voice')); // PR3: internal diagnostic page, requireFounder-gated
app.use('/api/debug/elevenlabs/voices', require('./routes/debug-elevenlabs-voices')); // TEMPORARY -- delete once a working voice is identified

// ── Page Routes ─────────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  try {
    // Previously this called getCapabilities(req) a second time here,
    // pointed at a SEPARATE engine (lib/capabilities.js) from the one
    // middleware/capabilities.js already computed globally for this same
    // request. Now that both are unified (ADR-011), req.capabilities is
    // already the exact same object — reusing it removes a redundant
    // DB round-trip on every homepage visit, safe only because of the
    // reconciliation.
    const homeCapabilities = req.capabilities;
    res.render('layout', { ...buildLandingContext(), homeCapabilities });
  } catch (err) {
    console.error('[homepage] capabilities resolution failed, rendering as visitor:', err.message);
    res.render('layout', buildLandingContext());
  }
});
app.get('/privacy', (_req, res) => res.render('privacy'));
app.get('/terms',   (_req, res) => res.render('terms'));
// TEMPORARY placeholder for the Legal footer column's Responsible AI link —
// swap for a real page/content when built. Not fabricated content, just a
// safe stub so /responsible-ai doesn't 404.
app.get('/responsible-ai', (_req, res) => res.render('responsible-ai'));
app.get('/architecture', (_req, res) => res.render('architecture'));
app.get('/about',        (_req, res) => res.render('about'));
app.get('/why',     (_req, res) => res.render('why'));
app.get('/experience', (_req, res) => res.render('experience'));
// Explore MedhaIQ — UI-shell-only sprint. Placeholder data lives in
// data/explore-data.js; no DB/Supabase yet (see data file header comment)
// Explore MedhaIQ — now a pure navigation gateway (4 cards + Recently
// Added + a thin value strip). Doesn't need data/explore-data.js anymore
// since the old inline company/role/guide preview grids were removed;
// that file is now unused (safe to delete later, not touched here).
app.get('/explore', (_req, res) => res.render('explore'));
// Company Interview Library — Level 2 landing + Level 3 reusable guide
// template. Both render entirely from data/company-library-data.js; adding
// company #6 means adding one object there, never touching these routes
// or their views.
app.get('/explore/company-library', (_req, res) => res.render('company-library', require('./data/company-library-data')));
// Must be registered BEFORE the /:slug route below — Express matches
// routes in file order, and /:slug would otherwise swallow this literal
// path (there's no company with slug "all"). Simple directory view for
// the landing page's "View all companies" link: everyone with a real
// guide today, plus a coming-soon list for what's next.
app.get('/explore/company-library/all', (_req, res) => {
  const { companyLibrary, curatedCompanies, comingSoonCompanies } = require('./data/company-library-data');
  const available = companyLibrary.map(c => ({ slug: c.slug, name: c.name }));
  const curatedNoGuideNames = curatedCompanies.filter(c => !c.hasGuide).map(c => c.name);
  const comingSoon = [...curatedNoGuideNames, ...comingSoonCompanies];
  res.render('company-library-all', { available, comingSoon });
});
app.get('/explore/company-library/:slug', (req, res) => {
  const { companyLibrary } = require('./data/company-library-data');
  const company = companyLibrary.find(c => c.slug === req.params.slug);
  if (!company) return res.status(404).send('Company guide not found');
  res.render('company-guide', { company });
});
// Role Library — flat launch grid, mirrors the Company Library's
// architecture. roleLibrary holds the 6 launch-ready role guides; the
// landing page renders all of them as one grid (no categories, no
// coming-soon placeholders). Adding a 7th role later = adding one object
// to roleLibrary in data/role-library-data.js — no template changes.
app.get('/explore/role-library', (_req, res) => {
  const { roleLibrary } = require('./data/role-library-data');
  const roles = roleLibrary.map(r => ({
    slug: r.slug,
    title: r.title,
    oneLiner: r.oneLiner,
    tags: r.tags,
  }));
  res.render('role-library', { roles });
});
app.get('/explore/role-library/:slug', (req, res) => {
  const { roleLibrary } = require('./data/role-library-data');
  const { companyLibrary } = require('./data/company-library-data');
  const role = roleLibrary.find(r => r.slug === req.params.slug);
  if (!role) return res.status(404).send('Role guide not found');
  const relatedCompanyObjects = (role.relatedCompanies || [])
    .map(slug => companyLibrary.find(c => c.slug === slug))
    .filter(Boolean);
  res.render('role-guide', { role, relatedCompanyObjects });
});
// Company Interview Library — Level 2 landing + Level 3 reusable guide
// template. Both render entirely from data/company-library-data.js; adding
// company #6 means adding one object there, never touching these routes
// or their views.
app.get('/explore/company-library', (_req, res) => res.render('company-library', require('./data/company-library-data')));
app.get('/explore/company-library/:slug', (req, res) => {
  const { companyLibrary } = require('./data/company-library-data');
  const company = companyLibrary.find(c => c.slug === req.params.slug);
  if (!company) return res.status(404).send('Company guide not found');
  res.render('company-guide', { company });
});
// Interview Frameworks — new pillar, mirrors Role Library's flat-grid
// architecture. frameworks holds the 6 launch-ready guides; the landing
// page renders all of them as one grid, no categories. Adding a 7th
// framework later = adding one object to data/interview-frameworks-data.js
// — no template changes.
app.get('/explore/interview-frameworks', (_req, res) => {
  const { frameworks } = require('./data/interview-frameworks-data');
  const list = frameworks.map(f => ({ slug: f.slug, title: f.title, oneLiner: f.oneLiner }));
  res.render('interview-frameworks', { frameworks: list });
});
app.get('/explore/interview-frameworks/:slug', (req, res) => {
  const { frameworks } = require('./data/interview-frameworks-data');
  const fw = frameworks.find(f => f.slug === req.params.slug);
  if (!fw) return res.status(404).send('Framework guide not found');
  res.render('framework-guide', { fw });
});
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
app.get('/interview', requireAuthPage, (req, res) => {
  // packageOrder drives the entitlement-exhausted modal's upgrade-path
  // logic (interview-setup.ejs) — derived from config/product-packages.js's
  // own key order (explorer, growth, leadership), so a future package
  // added there automatically gets correct "Upgrade to X" / "Buy More
  // Minutes" behavior with no template change needed.
  const { PRODUCT_PACKAGES } = require('./config/product-packages');
  res.render('interview-setup', { packageOrder: Object.keys(PRODUCT_PACKAGES) });
});

// Interview session
app.get('/interview/session/:id', requireAuthPage, async (req, res) => {
  try {
    const userId = req.cookies.user_id;

    const { getSession, getSessionQuestions } = require('./db/interview');
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).send('Session not found');
    if (String(session.user_id) !== String(userId)) return res.status(403).send('Forbidden');

    const questions = await getSessionQuestions(req.params.id);
    const currentQ = questions.find(q => q.answer_text === null || q.answer_text === undefined);
    // ROOT CAUSE FIX (P0 "Question 6 of 5"): the old fallback --
    // `|| questions[questions.length - 1]` -- made currentQ truthy even
    // when every question was already answered (it just grabbed Q5
    // again), which made the `if (!currentQ)` redirect-to-report guard
    // below it unreachable for any completed session. Checking for a
    // genuine unanswered question, and independently checking the
    // session's actual persisted status (already correctly set to
    // 'completed' by completeSession() -- confirmed in routes/interview.js),
    // is what actually distinguishes "still in progress" from "done."
    if (!currentQ || session.status !== 'active') {
      return res.redirect('/interview/report/' + req.params.id);
    }

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

    // Dynamic Interviewer Greeting — only ever selected for the render
    // that starts a fresh session (Q1, nothing answered yet). Any
    // reload of a later question renders greetingText = null, so the
    // greeting can never resurface mid-interview (see the
    // window.MedhaIQ_GREETING bridge in interview-session.ejs, which
    // gates on this being truthy).
    const { pickGreetingIndex, resolveGreeting } = require('./services/interview-greetings');
    let greetingText = null;
    if (answeredCount === 0) {
      const rawLastIdx = parseInt(req.cookies.mh_last_greeting_idx, 10);
      const lastIdx = Number.isInteger(rawLastIdx) ? rawLastIdx : null;
      const greetingIdx = pickGreetingIndex(lastIdx);
      greetingText = resolveGreeting(greetingIdx, persona.name);
      res.cookie('mh_last_greeting_idx', String(greetingIdx), {
        httpOnly: true,
        maxAge: 365 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
      });
    }

    // Interview Policy — read from THIS session's frozen columns
    // (interview_sessions.question_budget / .executive_extension_budget /
    // .session_duration_minutes), NEVER re-resolved from the candidate's
    // current package. A session created before this migration has NULL
    // here; the LEGACY_* constants match exactly what every session used
    // before packages had their own durations — a genuine no-op for
    // anything already in progress when this ships. Mirrors the same
    // fallback constants routes/interview.js uses server-side, so the
    // client-rendered numbers can never disagree with what's actually
    // enforced.
    const LEGACY_QUESTION_BUDGET = 5;
    const LEGACY_SESSION_DURATION_MINUTES = 25;
    const visibleQuestionBudget = session.question_budget || LEGACY_QUESTION_BUDGET;
    const executiveExtensionBudget = session.executive_extension_budget || 0;
    const sessionDurationMinutes = session.session_duration_minutes || LEGACY_SESSION_DURATION_MINUTES;
    // Progress-counter denominator. Questions 1 through the visible budget
    // (5 for every package) show "X of 5" exactly as today — it isn't yet
    // known whether an extension will happen. Once the candidate is
    // actually on a question past the visible budget (only possible for
    // Leadership, and only once routes/interview.js's coverage gate has
    // already decided one more question is warranted — a 6th question
    // was already generated in a prior turn to reach this point), the
    // real total ceiling is shown naturally ("Question 6 of 7"), not
    // hidden behind the original visible number.
    const questionBudget = (answeredCount + 1) > visibleQuestionBudget
      ? (visibleQuestionBudget + executiveExtensionBudget)
      : visibleQuestionBudget;
    const sessionStartedAtMs = session.started_at ? new Date(session.started_at).getTime() : Date.now();

   res.render('interview-session', {
  sessionId:        req.params.id,
  questionId:       currentQ.id,
  questionText:     currentQ.question_text || '',
  questionType:     currentQ.question_type || 'opening',
  questionNumber:   answeredCount + 1,
  answeredCount,
  questionBudget,
  sessionDurationMinutes,
  sessionStartedAtMs,
  personaName:      persona.name,
  personaTitle:     persona.title + ' @ ' + persona.org,
  personaInitials:  initials,
  personaStyleColor:persona.styleColor,
  personaStyleLabel,
  greetingText,
  roleTitle:        session.role_title || '',
  experienceLevel:  session.experience_level || '',
  orgPreset:        session.org_preset || '',
  vapiPublicKey:    process.env.VAPI_PUBLIC_KEY   || '',
  vapiAssistantId:  process.env.VAPI_ASSISTANT_ID || '',
  voicePlaybackProvider: process.env.VOICE_PLAYBACK_PROVIDER || 'legacy_vapi', // PR3 feature flag, see PR3 Integration Plan §4
  isProdEnv:        process.env.NODE_ENV === 'production', // gates staging-only console.debug voice-override logging (2026-07-25 reconnect fix)
});
  } catch (err) {
    console.error('[interview/session]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// ── Report access control ────────────────────────────────────────────────
// Three layers, matched to the two routes below:
//   1. Authentication  — requireAuthPage middleware (redirects if not logged in)
//   2. Ownership        — report.user_id must match the logged-in user...
//   3. Founder override — ...unless the requester is a Founder (founder_access
//      table, same isFounder() check routes/founder.js already uses — never
//      a client-supplied flag, always re-verified against the DB)
//
// Centralized here so the HTML route and the PDF route can never drift —
// one function decides "can this user see this report," both routes just
// call it and either get a report object or null.
//
// Returns 404, not 403, on a failed ownership check — deliberately, so
// someone probing sequential report IDs can't distinguish "doesn't exist"
// from "exists, but isn't yours."
async function loadAuthorizedReport(reportId, user) {
  const { getReport } = require('./db/interview');
  const { isFounder } = require('./db/founder-access');

  const report = await getReport(reportId);
  if (!report) return null;

  if (await isFounder(user.id)) return report;
  if (String(report.user_id) !== String(user.id)) return null;

  return report;
}

// Interview report
app.get('/interview/report/:id', requireAuthPage, async (req, res) => {
  try {
    const report = await loadAuthorizedReport(req.params.id, req.user);
    if (!report) return res.status(404).send('Report not found');

    const { getSessionScores } = require('./db/interview');

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

app.get('/interview/report/:id/pdf', requireAuthPage, async (req, res) => {
  try {
    const { getSessionScores, getSessionQuestions } = require('./db/interview');
    const { PERSONAS, computeStarProgress } = require('./services/interview');
    const { renderReportPdf } = require('./services/pdf-report');

    const report = await loadAuthorizedReport(req.params.id, req.user);
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
// Founder Dashboard (Super Admin) — page route. Gated by requireFounderPage,
// NOT requireAuthPage: any logged-in user can pass requireAuthPage, but only
// founder_access rows should ever see this page. Deliberately NOT linked
// from any public navigation (see views/partials/header.ejs) — reachable
// only by knowing the URL, same as routes/founder.js's API endpoints this
// page's own client-side JS calls.
// TODO(founder-dashboard-aggregation): once MedhaIQ has real user traffic,
// consider moving this to a single backend aggregation function/service
// instead of 7 independent calls. The Promise.all already gets most of the
// latency win (wall-clock time ~ the slowest single query, not the sum of
// all 7), so this isn't about speed — it's about (1) fewer connections
// grabbed from the pool per dashboard view once founders and real users
// are both competing for it, (2) a natural place to cache the KPI/beta
// numbers for 30-60s instead of re-querying on every view (the template
// already has a `lastRefreshed` timestamp, implying periodic-refresh was
// the original intent, not live-per-request data), and (3) per-section
// graceful degradation instead of one failed query 500ing the whole page
// via error-boundary.ejs. Not blocking launch on this — noted per founder
// decision, not urgent.
app.get('/founder', requireFounderPage, async (req, res) => {
  try {
    const { getOverviewStats, getRecentActivity, getBetaAndSubscriptionOverview, getFounderAlerts } = require('./db/founder-stats');
    const { getFeedbackSummary, getRecentFeedback } = require('./db/founder-feedback');
    const { listUsers } = require('./db/founder-users');
    const { PRODUCT_PACKAGES } = require('./config/product-packages');

    // All six sections' data depend only on shared, already-committed
    // database state, not on each other's results — fetched in parallel.
    const [stats, activity, betaOverview, alerts, feedbackSummary, recentFeedback, users] = await Promise.all([
      getOverviewStats(),
      getRecentActivity(),
      getBetaAndSubscriptionOverview(),
      getFounderAlerts(),
      getFeedbackSummary(),
      getRecentFeedback(),
      listUsers(),
    ]);

    res.render('founder-dashboard', {
      stats,
      activity,
      betaOverview,
      alerts,
      feedbackSummary,
      recentFeedback,
      users,
      // "Manage Package" dropdown source — Object.keys() preserves
      // config/product-packages.js's own definition order (explorer,
      // growth, leadership), so adding a future package there is the
      // ONLY change needed for it to appear here too. Never hardcoded.
      packageOptions: Object.keys(PRODUCT_PACKAGES),
      footerInfo: {
        lastRefreshed: new Date().toISOString(),
        environment: process.env.NODE_ENV === 'production' ? 'Production' : 'Staging',
      },
      shellUser: req.user,
    });
  } catch (err) {
    console.error('[founder] dashboard render error:', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Thin alias so "Go to Workspace" can link to /dashboard (a clean, memorable
// path) without duplicating any of the real page's logic — the actual
// Career Workspace page lives at /dashboard/history and is unchanged.
app.get('/dashboard', requireAuthPage, (_req, res) => res.redirect('/dashboard/history'));

app.get('/dashboard/history', requireAuthPage, async (req, res) => {
  try {
    const userId = req.cookies.user_id;

  const { getUserSessions, getUserAggregateScores } = require('./db/interview');
    // req.user AND req.capabilities.careerProfile were already fetched by
    // requireAuthPage (via getCapabilities()) — no need to query either
    // again here. Only sessions/aggregateScores are still fetched fresh,
    // since neither is part of the Capability Engine's shape.
    const [sessions, aggregateScores] = await Promise.all([
      getUserSessions(userId, { limit: 20 }),
      getUserAggregateScores(userId),
      
    ]);
    const careerProfile = req.capabilities.careerProfile;
    const user = req.user;
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
      orgPreset: s.org_preset,
      experienceLevel: s.experience_level,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      overallScore: toScoreOrNull(s.overall_score),
      status: s.status,
      // Founder Dashboard diagnostics (bug fix, 2026-07-24): distinguishes
      // WHY a session in 'abandoned' status ended — NULL for a voluntary
      // "End Session" click, 'browser_closed' for an explicit tab-close
      // signal, 'heartbeat_timeout' for the generic silent-timeout
      // recovery path (see middleware/guards.js, db/interview.js). Not
      // yet surfaced in the history template itself — this makes the data
      // available; the visual treatment is a follow-up decision.
      abandonedReason: s.abandoned_reason || null,
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
    const readinessDeltaVsPrevious = (trend.length > 1) ? Math.round(trend[trend.length - 1] - trend[trend.length - 2]) : null;
    const interruptedSession = history.find(s => s.status === 'in_progress') || null;

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

    // Resume Intelligence KPI — real status from career_profiles.
    // "Active" means the most recent parse attempt was a genuine success
    // (same SUCCESS check already used in db/career-profile.js and
    // routes/resume.js); anything else (no resume yet, or a failed parse)
    // shows as "Inactive" rather than implying a capability that isn't there.
    const resumeIntelActive = !!(careerProfile && careerProfile.resume_parse_status === 'SUCCESS');
    const resumeIntelSubLabel = resumeIntelActive
      ? `Updated ${relativeDayLabel(careerProfile.resume_parsed_at)}`
      : null;

    // Best Competency / Focus Next — reuses the exact same 5 metrics/labels
    // already shown in Interview Insights (Structure, Domain Expertise,
    // Strategic Thinking, Communication, Leadership & Execution), just
    // picking the highest and lowest instead of listing all five. No new
    // query, no fabricated data — null/placeholder until scores exist.
    let bestCompetencyLabel = null, focusNextLabel = null;
    if (aggregateScores && aggregateScores.starAvg !== null) {
      const competencyScores = [
        { label: 'Structure', val: aggregateScores.starAvg },
        { label: 'Domain Expertise', val: aggregateScores.technicalAvg },
        { label: 'Strategic Thinking', val: aggregateScores.executiveAvg },
        { label: 'Communication', val: aggregateScores.frictionAvg },
        { label: 'Leadership & Execution', val: aggregateScores.gccAvg },
      ].filter(c => typeof c.val === 'number' && !Number.isNaN(c.val));
      if (competencyScores.length > 0) {
        const sorted = [...competencyScores].sort((a, b) => b.val - a.val);
        bestCompetencyLabel = sorted[0].label;
        focusNextLabel = sorted[sorted.length - 1].label;
      }
    }

    // "Preparing For" — real data: the in-progress session's role if one
    // exists, otherwise the most recent session's role. Not fabricated;
    // null (and hidden in the view) if there's no session at all yet.
    const preparingForSession = interruptedSession || history[0] || null;
    const preparingForRole = preparingForSession ? (preparingForSession.roleTitle || 'Mock Interview') : null;

    res.render('dashboard-history', {
      shellUser: user,
      history, trend, trendPoints, trendPointsFill, trendWidth, trendX, trendY, trendLatest, trendAvg,
      interviewsCompletedCount, reportsGeneratedCount, practiceTimeLabel,
      readinessScore, readinessDeltaVsPrevious, interruptedSession, aggregateScores,
      lastInterviewLabel, lastSessionLabel, lastReportLabel, preparingForRole,
      resumeIntelActive, resumeIntelSubLabel,
      bestCompetencyLabel, focusNextLabel,
    });
  } catch (err) {
    console.error('[dashboard/history]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Resume Intelligence page — same auth pattern as /settings. The page
// itself fetches its own status/upload data client-side from
// /api/resume/status and /api/resume/upload (see views/resume.ejs), so
// this route only needs to supply shellUser for the workspace shell.
app.get('/resume', requireAuthPage, (req, res) => {
  try {
    res.render('resume', { shellUser: req.user });
  } catch (err) {
    console.error('[resume]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// Settings — new, minimal (Profile / Account / Preferences). No page
// existed at this route before; same auth pattern as dashboard/history.
app.get('/settings', requireAuthPage, async (req, res) => {
  try {
    const { hasPasswordSet } = require('./db/auth');
    const { getPreferences } = require('./db/preferences');
    const [hasPassword, preferences] = await Promise.all([
      hasPasswordSet(req.user.id),
      getPreferences(req.user.id),
    ]);
    res.render('settings', {
      shellUser: req.user,
      hasPassword,
      preferences,
      interviewEntitlement: req.capabilities.interviewEntitlement,
      activeTab: req.query.tab,
    });
  } catch (err) {
    console.error('[settings]', err);
    res.status(500).render('error-boundary', { url: req.url, errorMessage: err.message });
  }
});

// /account is kept only as a redirect alias to /settings (preserving
// ?tab=, so /account?tab=subscription still lands on the right tab) —
// /settings is the real, primary route per product decision.
app.get('/account', (req, res) => res.redirect('/settings' + (req.query.tab ? '?tab=' + encodeURIComponent(req.query.tab) : '')));

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