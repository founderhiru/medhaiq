// lib/tts-usage-recorder.js
//
// Character + cost ledger for Google TTS (staging migration, 2026-11-27).
// Writes ONLY to tts_usage_log (migration 037). Deliberately separate from
// lib/cost-recorder.js / cost_analytics so ElevenLabs' existing dashboard
// numbers are never mixed with Google's.
//
// SAFETY CONTRACT (same as lib/cost-recorder.js): never throws, fire-and-
// forget safe. A recording failure -- including the table not existing yet
// -- is logged and swallowed and can NEVER affect a candidate's audio.
//
// TWO COST FIELDS, kept separate on purpose:
//   estimated_list_cost_usd  = characters x Google's PUBLISHED per-character
//     list price. Always computed, ignores the free allowance. "What this
//     usage would cost with no free tier."
//   expected_billed_cost_usd = list price applied ONLY to the characters
//     beyond the monthly free allowance, using OUR OWN running month-to-date
//     total for that voice tier. "What we expect Google to actually
//     invoice." This is an expectation derived from tracked usage, not
//     Google's invoice: it cannot see usage from other apps on the same
//     billing account, and the month boundary is UTC. Reconcile against the
//     Google Cloud Billing console -- that is the only true "actual".
//
// Characters are tracked for every call, free allowance or not.
//
// Rates/allowances: Google Cloud Text-to-Speech pricing page, verified
// 2026-11-27. Update here (and nowhere else) if Google changes them.

const RATES_PER_CHAR_USD = {
  chirp3hd: 30 / 1e6,
  wavenet: 4 / 1e6,
};
const FREE_ALLOWANCE_CHARS = {
  chirp3hd: 1000000,
  wavenet: 4000000,
};

let poolOverride = null; // tests only
function getPool() {
  if (poolOverride) return poolOverride;
  return require('../db/index').pool; // lazy: never loaded unless a record is actually written
}

/**
 * @param {{ provider?: string, voiceTier: string, voiceName?: string, languageCode?: string,
 *           source?: string, userId?: string|number|null, characters: number, latencyMs?: number }} u
 */
async function recordTtsUsage(u) {
  try {
    const tier = u && u.voiceTier;
    const rate = RATES_PER_CHAR_USD[tier];
    const allowance = FREE_ALLOWANCE_CHARS[tier];
    const characters = Number(u && u.characters);
    if (rate === undefined || !Number.isFinite(characters) || characters <= 0) {
      console.warn('[tts-usage] skipping record: unknown tier or invalid character count');
      return;
    }
    const provider = u.provider || 'google';
    // One statement: reads month-to-date for this provider+tier and inserts
    // the row with its list cost and the over-allowance (billable) portion.
    await getPool().query(
      `WITH mtd AS (
         SELECT COALESCE(SUM(characters), 0)::bigint AS used
         FROM tts_usage_log
         WHERE provider = $1 AND voice_tier = $2
           AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
       )
       INSERT INTO tts_usage_log
         (provider, voice_tier, voice_name, language_code, source, user_id, characters, latency_ms,
          estimated_list_cost_usd, free_allowance_chars, billable_chars, expected_billed_cost_usd)
       SELECT $1, $2, $3, $4, $5, $6, ($7::bigint)::int, $8::int,
              ($7::bigint)::numeric * $9::numeric,
              ($10::bigint)::int,
              (GREATEST(0, mtd.used + $7::bigint - $10::bigint) - GREATEST(0, mtd.used - $10::bigint))::int,
              (GREATEST(0, mtd.used + $7::bigint - $10::bigint) - GREATEST(0, mtd.used - $10::bigint))::numeric * $9::numeric
       FROM mtd`,
      [
        provider, tier, u.voiceName || null, u.languageCode || null, u.source || 'interview',
        u.userId === undefined || u.userId === null ? null : String(u.userId),
        characters, Number.isFinite(u.latencyMs) ? Math.round(u.latencyMs) : null,
        rate, allowance,
      ]
    );
    console.log(`[tts-usage] recorded: provider=${provider} tier=${tier} characters=${characters} listCost=$${(characters * rate).toFixed(6)}`);
  } catch (err) {
    console.error('[tts-usage] recordTtsUsage failed (non-fatal, audio unaffected):', err && err.message);
  }
}

function _setPoolForTests(p) { poolOverride = p; }

module.exports = { recordTtsUsage, RATES_PER_CHAR_USD, FREE_ALLOWANCE_CHARS, _setPoolForTests };
