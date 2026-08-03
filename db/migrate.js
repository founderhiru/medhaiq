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
