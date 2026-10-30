// db/screening-migration.js
//
// Migration 035 — Screening & Assessment Copilot.
// Additive only: creates new tables, touches no existing table.
// Idempotent (IF NOT EXISTS). Runs inside the transaction opened by
// db/migrate.js. Candidates are RECORDS, not users: there is no link to the
// `users` table other than the owning recruiter and the founder grant.
//
// Rollback (manual, staging only):
//   DROP TABLE screening_ai_runs, screening_questions, screening_evidence,
//              screening_candidates, screening_criteria, screening_jobs,
//              screening_access CASCADE;
//   DELETE FROM _migrations WHERE name = '035_screening_copilot';

module.exports = {
  name: '035_screening_copilot',
  up: async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_access (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note VARCHAR(300),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT screening_access_status_chk CHECK (status IN ('active','revoked'))
      )
    `);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS screening_access_user_idx ON screening_access (user_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_jobs (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(160) NOT NULL,
        jd_text TEXT NOT NULL,
        jd_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
        criteria_state VARCHAR(12) NOT NULL DEFAULT 'none',
        criteria_hash VARCHAR(64),
        criteria_version INTEGER NOT NULL DEFAULT 0,
        approved_at TIMESTAMPTZ,
        candidate_seq INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT screening_jobs_state_chk CHECK (criteria_state IN ('none','draft','approved'))
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS screening_jobs_owner_idx ON screening_jobs (owner_id, created_at DESC)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_criteria (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES screening_jobs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        text VARCHAR(200) NOT NULL,
        importance VARCHAR(10) NOT NULL DEFAULT 'required',
        kind VARCHAR(16) NOT NULL DEFAULT 'other',
        jd_quote VARCHAR(400),
        jd_quote_verified BOOLEAN NOT NULL DEFAULT FALSE,
        guidance VARCHAR(400),
        origin VARCHAR(10) NOT NULL DEFAULT 'recruiter',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT screening_criteria_imp_chk CHECK (importance IN ('required','preferred'))
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS screening_criteria_job_idx ON screening_criteria (job_id, position)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_candidates (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES screening_jobs(id) ON DELETE CASCADE,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        label VARCHAR(80),
        source_type VARCHAR(8) NOT NULL DEFAULT 'text',
        file_hash VARCHAR(64) NOT NULL,
        redacted_text TEXT NOT NULL,
        page_offsets JSONB NOT NULL DEFAULT '[]'::jsonb,
        page_count INTEGER NOT NULL DEFAULT 1,
        redaction_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        injection_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
        decision VARCHAR(20),
        decision_note VARCHAR(1000),
        decided_at TIMESTAMPTZ,
        analyzed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT screening_cand_decision_chk CHECK (decision IS NULL OR decision IN ('shortlist','hold','needs_verification','not_moving_forward'))
      )
    `);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS screening_cand_job_seq_idx ON screening_candidates (job_id, seq)`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS screening_cand_job_hash_idx ON screening_candidates (job_id, file_hash)`);
    await c.query(`CREATE INDEX IF NOT EXISTS screening_cand_owner_idx ON screening_candidates (owner_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_evidence (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES screening_candidates(id) ON DELETE CASCADE,
        criterion_id INTEGER NOT NULL REFERENCES screening_criteria(id) ON DELETE CASCADE,
        ai_status VARCHAR(24) NOT NULL,
        ai_rationale VARCHAR(400),
        quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
        downgrade_reason VARCHAR(120),
        recruiter_status VARCHAR(24),
        recruiter_note VARCHAR(1000),
        reviewed_at TIMESTAMPTZ,
        criteria_version INTEGER NOT NULL DEFAULT 0,
        model VARCHAR(80),
        prompt_version VARCHAR(16),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT screening_ev_ai_chk CHECK (ai_status IN ('evidence_found','partial_evidence','not_found','requires_verification')),
        CONSTRAINT screening_ev_rec_chk CHECK (recruiter_status IS NULL OR recruiter_status IN ('evidence_found','partial_evidence','not_found','requires_verification','not_applicable'))
      )
    `);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS screening_ev_cand_crit_idx ON screening_evidence (candidate_id, criterion_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_questions (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES screening_candidates(id) ON DELETE CASCADE,
        criterion_id INTEGER NOT NULL REFERENCES screening_criteria(id) ON DELETE CASCADE,
        text VARCHAR(300) NOT NULL,
        origin VARCHAR(10) NOT NULL DEFAULT 'ai',
        state VARCHAR(10) NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT screening_q_state_chk CHECK (state IN ('draft','approved','dismissed')),
        CONSTRAINT screening_q_origin_chk CHECK (origin IN ('ai','recruiter'))
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS screening_q_cand_idx ON screening_questions (candidate_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_ai_runs (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind VARCHAR(16) NOT NULL,
        model VARCHAR(80),
        input_tokens INTEGER,
        output_tokens INTEGER,
        ok BOOLEAN NOT NULL DEFAULT TRUE,
        error_code VARCHAR(40),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS screening_ai_runs_owner_idx ON screening_ai_runs (owner_id, created_at DESC)`);

    console.log('[migrate] 035: screening copilot tables created.');
  },
};
