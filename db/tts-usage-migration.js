// db/tts-usage-migration.js
//
// Migration 037 — tts_usage_log (Google TTS character + cost tracking).
// Additive only: creates one new table, touches NO existing table. Idempotent
// (IF NOT EXISTS). Runs inside the transaction opened by db/migrate.js, same
// shape as db/screening-migration.js.
//
// user_id is stored as TEXT with NO foreign key on purpose: migration
// 032_cost_analytics_id_types_fix documents that users.id types differ
// between environments, so a typed/FK'd column here could fail the whole
// startup migration run. This table is a usage ledger, not a relational
// entity.
//
// Rollback (manual, staging only):
//   DROP TABLE tts_usage_log;
//   DELETE FROM _migrations WHERE name = '037_tts_usage_log';

module.exports = {
  name: '037_tts_usage_log',
  up: async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS tts_usage_log (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        provider VARCHAR(32) NOT NULL,
        voice_tier VARCHAR(32) NOT NULL,
        voice_name VARCHAR(100),
        language_code VARCHAR(16),
        source VARCHAR(32),
        user_id TEXT,
        characters INTEGER NOT NULL,
        latency_ms INTEGER,
        estimated_list_cost_usd NUMERIC(14,6) NOT NULL,
        free_allowance_chars INTEGER NOT NULL,
        billable_chars INTEGER NOT NULL,
        expected_billed_cost_usd NUMERIC(14,6) NOT NULL
      )
    `);
    await c.query(`
      CREATE INDEX IF NOT EXISTS tts_usage_log_provider_tier_month_idx
      ON tts_usage_log (provider, voice_tier, created_at)
    `);
    console.log('[migrate] 037: tts_usage_log created.');
  },
};
