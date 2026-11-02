// db/screening-audit-migration.js
//
// Migration 036 — Screening decision history.
// Additive only: one new table, nothing existing is altered.
// Idempotent (IF NOT EXISTS); runs inside the transaction opened by db/migrate.js.
//
// screening_events is an append-only log of what the recruiter (and the
// analysis run) did. It stores CODES ONLY in `detail` (statuses, decision
// labels, counts) — never resume text, quotes, notes or personal data — so the
// history can be shown and exported without carrying candidate content.
// Deleting a candidate or role deletes its events with it.
//
// Rollback (manual, staging only):
//   DROP TABLE screening_events;
//   DELETE FROM _migrations WHERE name = '036_screening_audit';

module.exports = {
  name: '036_screening_audit',
  up: async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS screening_events (
        id BIGSERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES screening_jobs(id) ON DELETE CASCADE,
        candidate_id INTEGER REFERENCES screening_candidates(id) ON DELETE CASCADE,
        criterion_id INTEGER REFERENCES screening_criteria(id) ON DELETE SET NULL,
        kind VARCHAR(32) NOT NULL,
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS screening_events_cand_idx ON screening_events (candidate_id, id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS screening_events_job_idx ON screening_events (job_id, id)`);
    console.log('[migrate] 036: screening events table created.');
  },
};
