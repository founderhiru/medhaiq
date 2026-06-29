module.exports = {
  name: '001_interview_tables',
  up: async (client) => {
    // Auth tokens for magic links
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS auth_tokens_token_idx ON auth_tokens (token)
    `);

    // Interview sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_sessions (
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
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS interview_sessions_user_id_idx ON interview_sessions (user_id)
    `);

    // Interview questions
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_questions (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
        persona_id VARCHAR(50),
        question_text TEXT NOT NULL,
        question_type VARCHAR(50) DEFAULT 'behavioral',
        question_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Interview answers
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_answers (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
        answer_text TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Interview scores
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_scores (
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
      )
    `);

    // Interview reports
    await client.query(`
      CREATE TABLE IF NOT EXISTS interview_reports (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL UNIQUE REFERENCES interview_sessions(id) ON DELETE CASCADE,
        overall_score NUMERIC(5,2) DEFAULT 0,
        strengths_json JSONB DEFAULT '[]',
        improvements_json JSONB DEFAULT '[]',
        persona_verdict TEXT,
        next_steps_json JSONB DEFAULT '[]',
        report_markdown TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }
};
