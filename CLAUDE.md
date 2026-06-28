# MedhaIQ.ai — AI Interview Coach

## What this app does
Landing page for MedhaIQ.ai — an AI-powered interview coaching platform targeting a global audience: students, professionals, doctors, teachers, engineers, and anyone preparing for career conversations anywhere in the world.

## Stack
Express.js + EJS + PostgreSQL (Neon) + Tailwind-style custom CSS. Hosted on Render.

## Directory map
- `server.js` — Express entry point, wires middleware and routes
- `db/` — Database access layer (pool in db/index.js, named functions per entity)
- `routes/` — Express routers, one per endpoint group
- `migrations/` — Database migrations, run on every deploy via `npm run migrate`
- `views/` — EJS templates and partials
- `public/css/` — Stylesheets
- `lib/` — Shared template utilities

## Database
- `auth_users` — Magic-link user accounts (email, name, verified)
- `auth_tokens` — One-time tokens for magic link authentication
- `interview_sessions` — Active interview sessions (role, persona, status, score)
- `interview_questions` — Questions in each session (type: opening/followup/drill_down)
- `interview_answers` — User answers per question
- `interview_scores` — 5-vector scores per answer (STAR, Technical, Executive, GCC, Friction)
- `interview_reports` — Generated exit report per session (strengths, improvements, verdict, next steps)
- `waitlist` — Landing page waitlist signups (pre-interview feature)

## External integrations
- **AI**: Anthropic via `POLSIA_API_KEY` + `POLSIA_API_URL` (Polsia proxy) — question generation, scoring, report generation
- **Email**: Polsia email proxy for magic link delivery
- **Stripe**: Reserved for future billing (not built at launch)
- **R2**: Reserved for future assets (not built at launch)

## Recent changes
- 2026-06-26: Interview Engine v0.5 upgrade — enhanced persona system prompts (AWS Hiring Manager, Consulting Partner, Product VP, Engineering Director, Startup CEO, GCC Director), conversational cadence matrix (2.5–3s silence detection, 12s thinking window, 15s idle prompt), explicit follow-up classification ([Clarification], [Evidence & Ownership], [Deep Dive Intent]), technical accuracy validation layer, GCC leadership layer, v0.5 scoreboard report format with recommendation badge, structural/linguistic diagnostics. Full spec in `services/interview.js`.
- 2026-06-26: Interview engine built — Phase 1 (role/persona setup), Phase 2 (live session UI), Phase 3 (5-vector silent scoring), Phase 4 (exit report). Magic link auth (no passwords). 6 interviewer personas with adaptive drill-down logic. Routes: /interview, /interview/session/:id, /interview/report/:id, /dashboard/history. AI via `lib/polsia-ai.js` → Polsia Anthropic proxy. Dark navy premium UI, Plus Jakarta Sans + Inter typography.
- 2026-06-25: Executive global landing page redesign — new design system, 10 sections, IntersectionObserver scroll reveals