// lib/google-tts-finance.js
//
// Read-only month summary of Google TTS usage for the Finance Dashboard
// (Provider Spend row + AI Provider Status card). Reads ONLY tts_usage_log
// (migration 037) -- it never writes, never calls Google, and is deliberately
// SEPARATE from db/cost-analytics.js, so the existing AI cost / true profit
// numbers are not changed by it. Never throws: on any failure it returns
// { available: false } and the dashboard simply hides the Google blocks.
//
// Numbers are OUR tracked ledger (see lib/tts-usage-recorder.js): "expected
// billed" applies the monthly free allowance to our own running total. Google
// Cloud Billing is the only true actual. Month boundaries are UTC.

const { RATES_PER_CHAR_USD, FREE_ALLOWANCE_CHARS } = require('./tts-usage-recorder');

const TIER_LABEL = { chirp3hd: 'Chirp 3 HD', wavenet: 'WaveNet' };

/**
 * @param {string} [monthValue] 'YYYY-MM' (UTC). Omitted/invalid -> current UTC month.
 */
async function getGoogleTtsMonthSummary(monthValue) {
  try {
    const month = typeof monthValue === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue)
      ? monthValue
      : new Date().toISOString().slice(0, 7);
    const { pool } = require('../db/index'); // lazy, same as the recorder
    const bounds = `created_at >= (($1 || '-01')::date)::timestamp AT TIME ZONE 'UTC'
                    AND created_at < ((($1 || '-01')::date) + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC'`;
    const [tierRes, srcRes] = await Promise.all([
      pool.query(
        `SELECT voice_tier,
                COUNT(*)::int AS calls,
                COALESCE(SUM(characters),0)::bigint AS chars,
                COALESCE(SUM(estimated_list_cost_usd),0)::numeric AS list_usd,
                COALESCE(SUM(expected_billed_cost_usd),0)::numeric AS billed_usd
         FROM tts_usage_log
         WHERE provider = 'google' AND ${bounds}
         GROUP BY voice_tier`, [month]),
      pool.query(
        `SELECT COALESCE(source,'interview') AS source, COALESCE(SUM(characters),0)::bigint AS chars
         FROM tts_usage_log
         WHERE provider = 'google' AND ${bounds}
         GROUP BY 1`, [month]),
    ]);

    const byTier = {};
    tierRes.rows.forEach((r) => { byTier[r.voice_tier] = r; });
    const tiers = Object.keys(RATES_PER_CHAR_USD).map((tier) => {
      const r = byTier[tier] || { calls: 0, chars: 0, list_usd: 0, billed_usd: 0 };
      const chars = Number(r.chars);
      const allowance = FREE_ALLOWANCE_CHARS[tier];
      return {
        tier, label: TIER_LABEL[tier], calls: Number(r.calls), chars,
        allowanceChars: allowance, pctOfAllowance: (chars / allowance) * 100,
        listCostUsd: Number(r.list_usd), expectedBilledUsd: Number(r.billed_usd),
      };
    });
    let interviewChars = 0, testChars = 0;
    srcRes.rows.forEach((r) => {
      if (r.source === 'debug-compare') testChars += Number(r.chars); else interviewChars += Number(r.chars);
    });
    return {
      available: true, month, tiers, interviewChars, testChars,
      totalChars: tiers.reduce((s, t) => s + t.chars, 0),
      totalListCostUsd: tiers.reduce((s, t) => s + t.listCostUsd, 0),
      totalExpectedBilledUsd: tiers.reduce((s, t) => s + t.expectedBilledUsd, 0),
    };
  } catch (err) {
    // 42P01 = table not created yet (migration 037 not run) -- expected, quiet.
    if (!(err && err.code === '42P01')) console.error('[google-tts-finance] failed (dashboard unaffected):', err && err.message);
    return { available: false };
  }
}

module.exports = { getGoogleTtsMonthSummary };
