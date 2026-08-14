// Self-contained migration runner — called from server.js at startup.
// Idempotent: safe to run on every boot. All statements use IF NOT EXISTS.
const { Pool } = require('pg');

async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log('[migrate] Running startup migrations...');

    // Migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Core users table (idempotent)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        password_hash VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        stripe_subscription_id VARCHAR(255),
        subscription_status VARCHAR(50),
        subscription_plan VARCHAR(255),
        subscription_expires_at TIMESTAMPTZ,
        subscription_updated_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email))
    `);

    // Check which migrations already ran
    const applied = await client.query('SELECT name FROM _migrations');
    const done = new Set(applied.rows.map(r => r.name));

    const migrations = [
      {
        name: '001_interview_tables',
        up: async (c) => {
          await c.query(`CREATE TABLE IF NOT EXISTS auth_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
          await c.query(`CREATE INDEX IF NOT EXISTS auth_tokens_token_idx ON auth_tokens (token)`);

          await c.query(`CREATE TABLE IF NOT EXISTS interview_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            persona_id VARCHAR(50) NOT NULL,
            role_title VARCHAR(255),
            experience_level VARCHAR(50),
            org_preset VARCHAR(255),
            status VARCHAR(50) DEFAULT 'active',
            overall_score NUMERIC(5,2),
            started_at TIMESTAMPTZ DEFAULT NOW(),
            ended_at TIMESTAMPTZ
          )`);
          await c.query(`CREATE INDEX IF NOT EXISTS interview_sessions_user_idx ON interview_sessions (user_id)`);

          // ── Competency pipeline (JD-aware sessions) — idempotent, safe on
          //    every deploy. Stores the raw pasted JD and the merged top-8
          //    competency matrix computed at session creation. ──
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS jd_text TEXT`);
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS competency_matrix JSONB`);

          await c.query(`CREATE TABLE IF NOT EXISTS interview_questions (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
            persona_id VARCHAR(50),
            question_text TEXT NOT NULL,
            question_type VARCHAR(50) DEFAULT 'behavioral',
            question_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);

          await c.query(`CREATE TABLE IF NOT EXISTS interview_answers (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
            answer_text TEXT,
            submitted_at TIMESTAMPTZ DEFAULT NOW()
          )`);

          await c.query(`CREATE TABLE IF NOT EXISTS interview_scores (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
            star_score NUMERIC(5,2) DEFAULT 0,
            technical_depth NUMERIC(5,2) DEFAULT 0,
            executive_presence NUMERIC(5,2) DEFAULT 0,
            gcc_readiness NUMERIC(5,2) DEFAULT 0,
            core_friction NUMERIC(5,2) DEFAULT 0,
            weighted_overall NUMERIC(5,2) DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);

          await c.query(`CREATE TABLE IF NOT EXISTS interview_reports (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL UNIQUE REFERENCES interview_sessions(id) ON DELETE CASCADE,
            overall_score NUMERIC(5,2) DEFAULT 0,
            strengths_json JSONB DEFAULT '[]',
            improvements_json JSONB DEFAULT '[]',
            persona_verdict TEXT,
            next_steps_json JSONB DEFAULT '[]',
            report_markdown TEXT,
            executive_summary TEXT,
            recommendation VARCHAR(50),
            strongest_response JSONB,
            weakest_response JSONB,
            structural_flow TEXT,
            linguistic_nuances TEXT,
            scoreboard JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
        }
      },
      {
        name: '002_answer_uniqueness',
        up: async (c) => {
          // Fixes the "session ran to 6/5, 7/5..." bug: with no constraint,
          // a double-click on Skip/Submit during a slow AI call could fire
          // two overlapping requests that both read "not yet answered" and
          // both went on to create a brand new question, silently pushing
          // the session past its 5-question limit. First, collapse any
          // duplicate answers already sitting in the table from that bug
          // (keep only the latest one per question)...
          await c.query(`
            DELETE FROM interview_answers a
            USING interview_answers b
            WHERE a.id < b.id AND a.question_id = b.question_id
          `);
          // ...then make it structurally impossible to insert a second
          // answer for the same question ever again.
          await c.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS interview_answers_question_id_unique_idx
            ON interview_answers (question_id)
          `);
        }
      },
      {
        name: '003_competency_pipeline',
        up: async (c) => {
          // JD-aware sessions: stores the raw pasted job description and the
          // merged top-8 competency matrix computed at session creation.
          // NOTE: these ALTERs also exist inside 001 for brand-new installs,
          // but 001 is already marked applied on production — this dedicated
          // migration is what actually adds the columns to the live DB.
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS jd_text TEXT`);
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS competency_matrix JSONB`);
        }
      },
      {
        name: '004_cost_analytics',
        up: async (c) => {
          // Founder cost dashboard ledger — one row per interview, upserted as
          // Vapi call cost and/or the async Claude report cost land.
          await c.query(`CREATE TABLE IF NOT EXISTS cost_analytics (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            interview_id INTEGER REFERENCES interview_sessions(id) ON DELETE SET NULL,
            duration_minutes NUMERIC(10,2) DEFAULT 0,
            vapi_cost NUMERIC(10,4) DEFAULT 0,
            claude_cost NUMERIC(10,4) DEFAULT 0,
            user_plan VARCHAR(50),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )`);
          // One ledger row per interview — enables upsert on interview_id.
          await c.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS cost_analytics_interview_id_unique_idx
            ON cost_analytics (interview_id)
          `);
          // Today's-cost queries filter/sort on created_at.
          await c.query(`
            CREATE INDEX IF NOT EXISTS cost_analytics_created_at_idx
            ON cost_analytics (created_at)
          `);
          await c.query(`
            CREATE INDEX IF NOT EXISTS cost_analytics_user_id_idx
            ON cost_analytics (user_id)
          `);
        }
      },
      {
        name: '005_invitations',
        up: async (c) => {
          await c.query(`CREATE TABLE IF NOT EXISTS invitations (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            invite_token VARCHAR(255) UNIQUE,
            invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            accepted_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ
          )`);
          await c.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS invitations_email_unique_idx
            ON invitations (LOWER(email))
          `);
        }
      },
      {
        name: '005b_invitations_fix_columns',
        up: async (c) => {
          await c.query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invite_token VARCHAR(255) UNIQUE`);
          await c.query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
          await c.query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
          await c.query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`);
          await c.query(`ALTER TABLE invitations ALTER COLUMN status SET DEFAULT 'pending'`);
        }
      },
      {
        name: '006_profile_bootstrap',
        up: async (c) => {
          await c.query(`CREATE TABLE IF NOT EXISTS profiles (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
          await c.query(`CREATE TABLE IF NOT EXISTS preferences (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            theme VARCHAR(20) DEFAULT 'dark',
            email_notifications BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
          await c.query(`CREATE TABLE IF NOT EXISTS workspaces (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(255) DEFAULT 'My Workspace',
            is_default BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
          await c.query(`CREATE TABLE IF NOT EXISTS career_profiles (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            current_role_title VARCHAR(255),
            target_role VARCHAR(255),
            experience_level VARCHAR(50),
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
        }
      },
      {

        name: '007_activity_logs',
        up: async (c) => {
          await c.query(`CREATE TABLE IF NOT EXISTS user_activity_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            session_id VARCHAR(255),
            action VARCHAR(100),
            page VARCHAR(255),
            feature VARCHAR(100),
            target_id VARCHAR(255),
            metadata JSONB DEFAULT '{}',
            ip_address VARCHAR(64),
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS session_id VARCHAR(255)`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS action VARCHAR(100)`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS page VARCHAR(255)`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS feature VARCHAR(100)`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS target_id VARCHAR(255)`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64)`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS user_agent TEXT`);
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
          await c.query(`CREATE INDEX IF NOT EXISTS user_activity_logs_user_id_idx ON user_activity_logs (user_id)`);
          await c.query(`CREATE INDEX IF NOT EXISTS user_activity_logs_created_at_idx ON user_activity_logs (created_at)`);
         await c.query(`CREATE INDEX IF NOT EXISTS user_activity_logs_action_idx ON user_activity_logs (action)`);
        }
      },
      {
        name: '007c_activity_logs_new_user_id_column',
        up: async (c) => {
          // The pre-existing "user_id" column on this table is UUID (left over
          // from earlier work), but this app's real users.id is an integer.
          // Rather than alter/drop a column something else might depend on,
          // give our activity logging its own correctly-typed column.
          await c.query(`ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS app_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
          await c.query(`CREATE INDEX IF NOT EXISTS user_activity_logs_app_user_id_idx ON user_activity_logs (app_user_id)`);
        }
      },
      {
        name: '007d_activity_logs_relax_action_type',
        up: async (c) => {
          // Legacy column from earlier work: NOT NULL with no default, and
          // our activity logger never populates it (we write to the newer
          // "action" column instead). Relaxing this is additive/safe — it
          // only permits more inserts, it can't break anything that already
          // depends on this column being required.
          await c.query(`ALTER TABLE user_activity_logs ALTER COLUMN action_type DROP NOT NULL`);
        }
      },
      {
        name: '008_resume_intelligence',
        up: async (c) => {
          // Persistent store — one resume per user, lives on the existing
          // career_profiles row (already unique on user_id, already
          // bootstrapped for every user via db/profile-bootstrap.js).
          // Parsed ONCE on upload/replace — never re-parsed by interview
          // setup or session creation.
          await c.query(`ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS resume_raw_text TEXT`);
          await c.query(`ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS resume_competencies JSONB`);
          await c.query(`ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS resume_context JSONB`);
          await c.query(`ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS resume_parsed_at TIMESTAMPTZ`);

          // Per-session immutable snapshot — same precedent as this table's
          // existing jd_text / competency_matrix columns: copied in once at
          // session creation so a later resume update never rewrites the
          // history of a past interview/report.
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS resume_competencies JSONB`);
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS resume_context JSONB`);
        }
      },
      {
        name: '009_question_competency_tracking',
        up: async (c) => {
          // interview_questions never persisted WHICH competency a question
          // targeted, WHICH resume story it used, or whether it was a
          // follow-up to another question — all needed now so the
          // primary/follow-up conversation flow is deterministic across
          // stateless HTTP requests, instead of hoping the model infers
          // continuity from prose. Purely additive, nullable — does not
          // touch scoring, the Harmonic Alignment Engine, or any existing
          // column. question_type (existing column) gains new values
          // 'primary' / 'follow_up' alongside the existing 'opening' /
          // 'drill_down' — old in-progress sessions with 'drill_down' rows
          // keep working via a backward-compatible check in code.
          //
          // story_key (NOT story_anchor / free text): a stable, machine-
          // friendly identifier like "AWS_PROSERV_25M", assigned once by
          // Resume Intelligence at parse time. Using a stable key rather
          // than persisting rendered display text means a later wording
          // change in Resume Intelligence (e.g. "AWS Professional Services"
          // -> "AWS ProServe") never silently breaks analytics that already
          // joined on the old text.
          await c.query(`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS competency VARCHAR(120)`);
          await c.query(`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS story_key VARCHAR(80)`);
          await c.query(`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS parent_question_id INTEGER REFERENCES interview_questions(id) ON DELETE SET NULL`);

          // Career Story Library — the Resume Intelligence output that
          // assigns each story its stable story_key. Persistent store
          // (career_profiles, one per user) + per-session immutable
          // snapshot (interview_sessions), same precedent as the existing
          // resume_competencies/resume_context columns from migration 008.
          await c.query(`ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS story_library JSONB`);
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS story_library JSONB`);
        }
      },
      {
        name: '010_question_blueprint_audit_trail',
        up: async (c) => {
          // The Question Blueprint (competency, jd_objective, story_key,
          // difficulty, question_type) is built deterministically before
          // every AI question-generation call, but was never persisted —
          // only competency/story_key/parent_question_id from migration 009
          // were. Storing the FULL blueprint as one JSONB snapshot gives an
          // exact audit trail of what was decided for that question at the
          // time it was generated, immune to any future change in how
          // jd_objective/difficulty get derived. Purely additive, nullable.
          await c.query(`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS question_blueprint JSONB`);
        }
      },
      {
        name: '011_resume_parse_status_tracking',
        up: async (c) => {
          // Resume Intelligence had no way to distinguish "parsing genuinely
          // found nothing" from "parsing technically failed" — both looked
          // identical (0 competencies, real-looking parsed_at timestamp),
          // because a failed parse silently saved EMPTY_RESULT over
          // whatever was there before. Two new columns fix this:
          //
          // resume_parse_status: one of SUCCESS | PARSE_FAILED |
          //   MODEL_TRUNCATED | INVALID_JSON | EXTRACTION_FAILED — always
          //   set on every parse attempt, success or failure.
          // resume_last_parse_attempt_at: updates on EVERY attempt
          //   (success or failure). resume_parsed_at (existing column)
          //   updates ONLY on genuine success, so it always reflects the
          //   last time real content was actually saved — never a failed
          //   attempt's timestamp.
          await c.query(`ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS resume_parse_status VARCHAR(30)`);
          await c.query(`ALTER TABLE career_profiles ADD COLUMN IF NOT EXISTS resume_last_parse_attempt_at TIMESTAMPTZ`);
        }
      },
      {
        name: '012_founder_access',
        up: async (c) => {
          // db/founder-access.js queries/inserts into this table but no
          // migration anywhere creates it — CREATE TABLE IF NOT EXISTS
          // makes this safe to run regardless of whether it already exists
          // on any given environment (e.g. if it was created manually on
          // staging out-of-band). user_id is UNIQUE because
          // grantFounderAccess() relies on ON CONFLICT (user_id).
          await c.query(`
            CREATE TABLE IF NOT EXISTS founder_access (
              id SERIAL PRIMARY KEY,
              user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
              role VARCHAR(50) NOT NULL DEFAULT 'founder',
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
        }
      },
      {
        name: '013_executive_strategy_position',
        up: async (c) => {
          // The Executive Interview Strategy layer labels which of the 5
          // fixed primary positions a question occupies (question_position)
          // and its deliberate source/purpose (strategy_source,
          // strategy_purpose) — purely additive analytics fields. Does not
          // touch competency/story_key/parent_question_id from earlier
          // migrations, and does not change how competency or story
          // selection work at all.
          await c.query(`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS question_position SMALLINT`);
          await c.query(`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS strategy_source VARCHAR(30)`);
          await c.query(`ALTER TABLE interview_questions ADD COLUMN IF NOT EXISTS strategy_purpose TEXT`);
        }
      },
      {
        name: '014_preferences_product_updates',
        up: async (c) => {
          // Account Settings > Preferences needs a third toggle beyond the
          // two (theme, email_notifications) the preferences table already
          // had. Purely additive — one column on an existing table, not a
          // new table. Defaults to true so existing rows (created via
          // db/profile-bootstrap.js's ensureUserBootstrap) get a sensible
          // value without needing a backfill.
          await c.query(`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS product_updates BOOLEAN DEFAULT true`);
        }
      },
      {
        name: '015_session_lifecycle_management',
        up: async (c) => {
          // Server-owned session lifecycle management (bug fix, 2026-07-24).
          // Previously a stale ACTIVE session (candidate closed the tab,
          // crashed, lost connectivity — never called DELETE
          // /sessions/:id) could only be cleared by the frontend detecting
          // a 409 and deleting it itself, one at a time. Confirmed via
          // live logs that this breaks down entirely once more than one
          // stale session has accumulated for a user (cleanup cleared
          // id=87, retried, hit a DIFFERENT stale id=86, gave up).
          //
          // last_activity_at: refreshed by the new heartbeat endpoint
          // (routes/interview.js) and by ordinary in-interview activity
          // (submitting an answer). Lets the server distinguish a
          // genuinely-recent active session (real conflict — a second tab,
          // most likely) from one that's gone silent (stale — safe to
          // auto-abandon and let the new session through), entirely
          // server-side, with zero frontend cleanup logic required.
          // Defaults to started_at for any session that predates this
          // migration, so existing rows get a sane initial value rather
          // than NULL.
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW()`);
          await c.query(`UPDATE interview_sessions SET last_activity_at = started_at WHERE last_activity_at IS NULL`);

          // abandoned_reason: diagnostics for the Founder Dashboard —
          // distinguishes "candidate closed the tab" (an explicit signal,
          // sent via navigator.sendBeacon on beforeunload) from "we never
          // heard from them again" (heartbeat_timeout, the honest default
          // when auto-abandoning a stale session with no explicit signal).
          // NULL for sessions that completed normally or were ended via
          // the candidate's own "End Session" button (status distinguishes
          // that case already; this column is specifically about the
          // *involuntary* abandonment path).
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS abandoned_reason VARCHAR(30)`);
        }
      },
      {
        name: '016_package_acquisitions_and_credit_ledger',
        up: async (c) => {
          // Package Acquisitions — the single record that bundles
          // permissions, entitlements, persona access, and AI credits
          // together, all governed by ONE expiry (Architecture v1.5, §9.2,
          // ADR-013). This is the new source of truth for a user's
          // effective package — going forward, nothing should read
          // users.subscription_plan/subscription_status to decide access.
          await c.query(`
            CREATE TABLE IF NOT EXISTS package_acquisitions (
              id SERIAL PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              package_id VARCHAR(50) NOT NULL,
              acquired_at TIMESTAMPTZ DEFAULT NOW(),
              expires_at TIMESTAMPTZ,
              source VARCHAR(30) NOT NULL DEFAULT 'purchase',
              granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
              purchase_reference VARCHAR(100),
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
          await c.query(`CREATE INDEX IF NOT EXISTS package_acquisitions_user_idx ON package_acquisitions (user_id)`);
          await c.query(`CREATE INDEX IF NOT EXISTS package_acquisitions_active_idx ON package_acquisitions (user_id, expires_at)`);

          // Credit transactions, scoped to the acquisition they belong to
          // — a grant never carries its own independent expiry, so credits
          // and permissions can never drift apart from each other.
          await c.query(`
            CREATE TABLE IF NOT EXISTS credit_ledger (
              id SERIAL PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              package_acquisition_id INTEGER NOT NULL REFERENCES package_acquisitions(id) ON DELETE CASCADE,
              minutes NUMERIC(10,2) NOT NULL,
              reason VARCHAR(30) NOT NULL,
              granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
          await c.query(`CREATE INDEX IF NOT EXISTS credit_ledger_acquisition_idx ON credit_ledger (package_acquisition_id)`);

          // Safety backfill: any existing user who currently resolves as
          // "pro" under today's logic (subscription_status='active' AND
          // subscription_plan in ('professional','leadership')) gets a
          // matching, never-expiring package_acquisition + a starting
          // credit grant. This guarantees that switching permission
          // resolution over to package_acquisitions (a later step) cannot
          // silently take away access anyone currently has. The
          // NOT EXISTS check means this can never insert a duplicate row
          // for the same user, even if this migration somehow ran twice.
          const backfillResult = await c.query(`
            INSERT INTO package_acquisitions (user_id, package_id, expires_at, source)
            SELECT id,
                   CASE WHEN LOWER(subscription_plan) = 'leadership' THEN 'leadership' ELSE 'growth' END,
                   NULL,
                   'migration_backfill'
            FROM users
            WHERE LOWER(subscription_status) = 'active'
              AND LOWER(subscription_plan) IN ('professional', 'leadership')
              AND NOT EXISTS (
                SELECT 1 FROM package_acquisitions pa WHERE pa.user_id = users.id
              )
            RETURNING id, user_id, package_id
          `);

          // Starting credit grant matching that package's included
          // minutes (config/product-packages.js), so a backfilled user's
          // entitlement isn't zero the moment this ships. This is a
          // one-time snapshot at migration time — it does not need to
          // stay in sync if the config value changes later.
          for (const row of backfillResult.rows) {
            const minutes = row.package_id === 'leadership' ? 300 : 120;
            await c.query(
              `INSERT INTO credit_ledger (user_id, package_acquisition_id, minutes, reason)
               VALUES ($1, $2, $3, 'migration_backfill')`,
              [row.user_id, row.id, minutes]
            );
          }

          console.log(`[migrate] 016: backfilled ${backfillResult.rows.length} existing pro-tier user(s) into package_acquisitions`);
        }
      },
      {
        name: '017_interview_policy_snapshot',
        up: async (c) => {
          // Interview settings frozen onto a session at creation time (see
          // controllers/sessionController.js) and never recomputed
          // afterward. Two simple additive integer columns, not a JSONB
          // blob — simpler SQL, easier debugging/reporting/Founder
          // Dashboard analytics, matching this table's existing scalar
          // columns (overall_score, etc.) rather than its JSON ones,
          // since this policy is exactly two flat numbers today, not a
          // nested structure. Can evolve to JSON later if the policy
          // becomes materially richer — not a decision to make now.
          //
          // NULL for every session that existed before this migration —
          // routes/interview.js falls back to the pre-existing hardcoded
          // defaults (5 questions / INTERVIEW_MAX_SESSION_MINUTES) for
          // any session with NULL values, so nothing in progress when
          // this ships changes behavior.
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS question_budget INTEGER`);
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS session_duration_minutes INTEGER`);
          // Leadership-only: how many additional adaptive questions may be
          // asked beyond question_budget, IF coverage is insufficient at
          // that point (see services/interview.js's hasSufficientCoverage
          // and routes/interview.js's GUARD 2). NULL/0 for every other
          // package and every pre-existing session — a genuine no-op.
        await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS executive_extension_budget INTEGER`);
        },
      },
      {
        name: '018_idle_timeout',
        up: async (c) => {
          // Idle-timeout feature (minimal version, 2026-08-05). A new
          // column, not a reuse of last_activity_at: that one is already
          // refreshed unconditionally every 60s by the existing
          // heartbeat regardless of real engagement, so reusing it here
          // would mean idle time could never actually accumulate while
          // the tab stayed open. This column only updates on genuine
          // candidate actions (see touchUserActivity, db/interview.js).
          // Defaults to started_at for any session that predates this
          // migration, same backfill pattern as migration 015.
          await c.query(`ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS last_user_activity_at TIMESTAMPTZ DEFAULT NOW()`);
          await c.query(`UPDATE interview_sessions SET last_user_activity_at = started_at WHERE last_user_activity_at IS NULL`);
        },
      },
      {
        name: '019_founder_created_users',
        up: async (c) => {
          // Founder Dashboard "Create User" (real or demo accounts).
          // Purely additive — nothing else in the app reads these columns
          // yet, so this cannot change behavior for any existing user or
          // any existing signup/login flow.
          //
          // is_demo: marks an account as a demo/test account, set at
          // creation only by db/founder-users.js::createUserAsFounder.
          //
          // email_verified: defaults TRUE for every existing row — this
          // app never tracked a real "unverified" state before now (magic
          // link + password signup both had no separate verification
          // step), so defaulting true avoids retroactively branding real
          // existing users as unverified for a concept they never had.
          // New founder-created accounts pass this explicitly based on
          // the "Skip Email Verification" checkbox.
          //
          // created_by: audit trail of which founder created the account,
          // same precedent as package_acquisitions.granted_by and
          // invitations.invited_by. Nullable — irrelevant for every
          // account that isn't founder-created.
          await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false`);
          await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT true`);
          await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
        },
      },
      {
        name: '020_prompt_cache_metrics',
        up: async (c) => {
          // Phase 2F-A — prompt caching instrumentation. Purely additive:
          // nothing in the interview engine reads this table, it only
          // records what db/prompt-cache-metrics.js writes (fire-and-forget
          // from services/interview.js::generateNextQuestion). One row per
          // AI call opted into tracking — turn-by-turn, not pre-aggregated,
          // so the founder can see Q1..Qn evidence, not just an average.
          await c.query(`
            CREATE TABLE IF NOT EXISTS prompt_cache_metrics (
              id SERIAL PRIMARY KEY,
              session_id INTEGER REFERENCES interview_sessions(id) ON DELETE CASCADE,
              turn_label VARCHAR(50),
              capability VARCHAR(100),
              input_tokens INTEGER DEFAULT 0,
              cache_creation_input_tokens INTEGER DEFAULT 0,
              cache_read_input_tokens INTEGER DEFAULT 0,
              output_tokens INTEGER DEFAULT 0,
              latency_ms INTEGER,
              estimated_cost_usd DOUBLE PRECISION,
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
          await c.query(`
            CREATE INDEX IF NOT EXISTS prompt_cache_metrics_session_idx
              ON prompt_cache_metrics (session_id)
          `);
       await c.query(`
            CREATE INDEX IF NOT EXISTS prompt_cache_metrics_created_at_idx
              ON prompt_cache_metrics (created_at)
          `);
        },
      },
      {
        name: '021_free_offer_guardrail',
        up: async (c) => {
          // Anti-Abuse & Free-Offer Guardrail. Two purely additive pieces:
          //
          // 1. A partial UNIQUE index on the EXISTING package_acquisitions
          //    table — no new credit/entitlement system, just a database-
          //    level guarantee that a user can never hold two source='welcome'
          //    rows, even under a race (two concurrent /auth/verify hits).
          //    This is the real idempotency guarantee; the application-level
          //    check in services/free-offer-guardrail.js is just the fast
          //    path that avoids hitting this in normal operation.
          await c.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_package_acquisitions_one_welcome_per_user
              ON package_acquisitions (user_id)
              WHERE source = 'welcome'
          `);

          // 2. free_offer_claims — the one genuinely new table this feature
          //    adds. An append-only abuse-signal log (device/IP hashes only,
          //    never raw values), consumed by db/free-offer-claims.js for
          //    risk assessment and by Founder Dashboard visibility. This is
          //    NOT the source of truth for credits — that remains
          //    package_acquisitions + credit_ledger, untouched.
          await c.query(`
            CREATE TABLE IF NOT EXISTS free_offer_claims (
              id SERIAL PRIMARY KEY,
              user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
              device_hash VARCHAR(64),
              ip_hash VARCHAR(64),
              status VARCHAR(20) NOT NULL,
              risk_reason VARCHAR(50),
              claimed_at TIMESTAMPTZ DEFAULT NOW(),
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
          await c.query(`
            CREATE INDEX IF NOT EXISTS free_offer_claims_device_hash_idx
              ON free_offer_claims (device_hash)
          `);
          await c.query(`
            CREATE INDEX IF NOT EXISTS free_offer_claims_ip_hash_idx
              ON free_offer_claims (ip_hash)
          `);
          await c.query(`
            CREATE INDEX IF NOT EXISTS free_offer_claims_status_idx
              ON free_offer_claims (status)
          `);

          // Safety backfill — same precedent as migration 016's pro-tier
          // backfill above, but SCOPED more tightly than a plain "no
          // acquisition row" check. Under the current model (ADR-013),
          // no-acquisition already means Explorer by definition — but to
          // remove any ambiguity: this explicitly re-checks each user's
          // legacy subscription_status/subscription_plan columns (the
          // same fields migration 016 already reads) before treating
          // them as Explorer, so a Growth/Leadership user can NEVER
          // receive a source='welcome' acquisition just because they
          // happen to be missing a package_acquisitions row for some
          // other reason (e.g. a plan-name migration 016 didn't map).
          //
          // Step A: catch any such straggler — legacy-paid, but still
          // missing an acquisition row for any reason — into their REAL
          // paid tier, using migration 016's exact mapping. This must
          // run before Step B, and Step B explicitly excludes anyone
          // this step touches.
          const stragglerBackfill = await c.query(`
            INSERT INTO package_acquisitions (user_id, package_id, expires_at, source)
            SELECT id,
                   CASE WHEN LOWER(subscription_plan) = 'leadership' THEN 'leadership' ELSE 'growth' END,
                   NULL,
                   'migration_backfill'
            FROM users
            WHERE LOWER(subscription_status) = 'active'
              AND subscription_plan IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM package_acquisitions pa WHERE pa.user_id = users.id
              )
            RETURNING id, user_id, package_id
          `);
          for (const row of stragglerBackfill.rows) {
            const minutes = row.package_id === 'leadership' ? 300 : 120;
            await c.query(
              `INSERT INTO credit_ledger (user_id, package_acquisition_id, minutes, reason)
               VALUES ($1, $2, $3, 'migration_backfill')`,
              [row.user_id, row.id, minutes]
            );
          }
          if (stragglerBackfill.rows.length) {
            console.log(`[migrate] 021: caught ${stragglerBackfill.rows.length} legacy-paid straggler(s) into their real paid tier (not Explorer)`);
          }

          // Step B: Explorer welcome backfill — everyone STILL left with
          // no acquisition row after Step A above is, by definition,
          // Explorer under the current model (lib/capability-engine.js
          // reads package_acquisitions exclusively; there is no other
          // path to a paid tier). The subscription_status/subscription_plan
          // re-check here is technically redundant with Step A's NOT
          // EXISTS scoping (Step A already removed every legacy-paid row
          // from contention) — kept anyway as an explicit, self-
          // documenting guarantee rather than relying on ordering alone.
          //
          // acquired_at is deliberately backdated to the user's own
          // created_at, NOT NOW() — capability-engine.js scopes credit
          // consumption to sessions started at/after an acquisition's
          // acquired_at, so a NOW() timestamp would wrongly reset a
          // partway-through user's minutesUsed to 0 and hand them a full
          // fresh 30. Backdating to created_at means every session they
          // already had counts against the pool exactly as it always did
          // — this backfill preserves current state, it doesn't reset it.
          const explorerBackfill = await c.query(`
            INSERT INTO package_acquisitions (user_id, package_id, expires_at, source, acquired_at)
            SELECT id, 'explorer', NULL, 'welcome', created_at
            FROM users u
            WHERE NOT EXISTS (
              SELECT 1 FROM package_acquisitions pa WHERE pa.user_id = u.id
            )
            AND NOT (LOWER(u.subscription_status) = 'active' AND u.subscription_plan IS NOT NULL)
            RETURNING id, user_id
          `);
          for (const row of explorerBackfill.rows) {
            await c.query(
              `INSERT INTO credit_ledger (user_id, package_acquisition_id, minutes, reason)
               VALUES ($1, $2, 30, 'migration_backfill')`,
              [row.user_id, row.id]
            );
          }
          console.log(`[migrate] 021: backfilled ${explorerBackfill.rows.length} existing Explorer user(s) with a welcome acquisition (no behavior change for them)`);
        },
      },
      {
        name: '022_leadership_narrative_fields',
        up: async (c) => {
          // Leadership-tier narrative fields — additive only. Produced by
          // the SAME generateReport() AI call that already produces
          // executive_summary/persona_verdict/etc (services/interview.js,
          // REPORT_SYSTEM items 11-13). No second AI call, no scoring
          // change, no interview-flow change.
          //
          // NULL for every report row that existed before this migration —
          // no backfill is possible (there is no transcript-free way to
          // generate these retroactively without a second AI call, which is
          // explicitly out of scope for this migration). Consuming code
          // (lib/career-intelligence-report.js) must treat NULL as "not
          // available for this report", never invent a substitute value.
          await c.query(`
            ALTER TABLE interview_reports
              ADD COLUMN IF NOT EXISTS executive_interpretation TEXT,
              ADD COLUMN IF NOT EXISTS role_readiness TEXT,
              ADD COLUMN IF NOT EXISTS next_level_direction TEXT
          `);
        },
      },
      {
        name: '023_users_market',
        up: async (c) => {
          // Pricing-market resolution (india vs. international commercial
          // pricing — see config/pricing.js). Nullable by design: existing
          // users are not backfilled to a guessed market. lib/pricing-market.js
          // treats NULL exactly like an unauthenticated visitor — it falls
          // through to IP/geo resolution — so no user is ever broken by
          // this migration; they just don't have a "sticky" market yet
          // until it's set (on next login-context resolution, or manually).
          // Deliberately a two-value market string, not a full country
          // column — see Phase [pricing-market] audit: the immediate
          // business requirement is India vs. International pricing, not
          // country-level data for any other purpose.
          await c.query(`
            ALTER TABLE users
              ADD COLUMN IF NOT EXISTS market VARCHAR(20)
          `);
        },
      },
      {
        name: '024_stripe_purchase_idempotency',
        up: async (c) => {
          // Stripe Sandbox checkout (routes/stripe.js) — staging only.
          // Purely additive: a partial UNIQUE index on the EXISTING
          // package_acquisitions.purchase_reference column (already
          // present since migration 016, previously unused by any
          // caller). No new table, no parallel credit system — this is
          // the exact same idempotency pattern migration 021 already
          // established for the welcome offer (one partial unique index
          // = the real guarantee; the webhook's own duplicate check,
          // routes/stripe.js, is just the fast path).
          //
          // The Stripe Checkout Session ID (e.g. "cs_test_...") is
          // stored as purchase_reference — Stripe guarantees this is
          // unique per session, so a retried/duplicated webhook delivery
          // for the same session can never grant the Growth package
          // twice, even under a race between two near-simultaneous
          // deliveries.
          await c.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_package_acquisitions_purchase_reference_unique
              ON package_acquisitions (purchase_reference)
              WHERE purchase_reference IS NOT NULL
          `);
        },
      },
      {
        name: '025_response_intent',
        up: async (c) => {
          // Formalizes response intent classification (approved 2026-08-13):
          // ANSWER / SKIP / DONT_KNOW / SPARSE. Purely additive, nullable,
          // no default.
          //
          // NULL means "this row predates this migration" — it is NOT
          // treated as an implicit ANSWER anywhere downstream. Every
          // consumer (routes/interview.js's qaPairs construction,
          // lib/career-intelligence-report.js's response-pattern counts)
          // must check for NULL explicitly and fall back to the
          // pre-existing text-based behavior for those rows, so historical
          // reports render exactly as they did before this migration.
          // Retroactively inferring SKIP/DONT_KNOW from historical blank
          // answer_text values is deliberately NOT done here — the founder
          // explicitly ruled that out; blank legacy rows keep today's
          // existing (pre-migration) report behavior, unchanged.
          //
          // New rows, going forward, always get an explicit value —
          // 'ANSWER', 'SKIP', 'DONT_KNOW', or 'SPARSE' — written by
          // routes/interview.js's processInterviewAnswer(). SPARSE never
          // actually reaches a persisted row today (the sparse-answer
          // guardrail blocks the DB write and reprompts instead, unchanged
          // by this migration) — the value is included in the CHECK
          // constraint below for completeness/future-proofing, not because
          // a SPARSE row is expected to exist.
          await c.query(`
            ALTER TABLE interview_answers
              ADD COLUMN IF NOT EXISTS response_intent VARCHAR(20)
          `);
          await c.query(`
            ALTER TABLE interview_answers
              DROP CONSTRAINT IF EXISTS interview_answers_response_intent_check
          `);
          await c.query(`
            ALTER TABLE interview_answers
              ADD CONSTRAINT interview_answers_response_intent_check
              CHECK (response_intent IS NULL OR response_intent IN ('ANSWER', 'SKIP', 'DONT_KNOW', 'SPARSE'))
          `);
        },
      },
    ];

    for (const m of migrations) {
      if (done.has(m.name)) {
        console.log(`[migrate] already applied: ${m.name}`);
        continue;
      }
      console.log(`[migrate] applying: ${m.name}`);
      await client.query('BEGIN');
      try {
        await m.up(client);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [m.name]);
        await client.query('COMMIT');
        console.log(`[migrate] done: ${m.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.name} failed: ${err.message}`);
      }
    }

    console.log('[migrate] All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { runMigrations };
