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
      }
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
