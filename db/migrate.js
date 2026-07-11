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
