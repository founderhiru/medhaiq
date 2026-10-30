// services/screening/ai.js
//
// The ONLY place the Screening Copilot calls a model. It reuses the existing
// AI path (lib/polsia-ai → chatJSON); no second orchestration layer. Adds:
// per-owner daily cap, a hard timeout, usage logging, and error mapping.

const cfg = require('../../config/screening');
const screeningDb = require('../../db/screening');
const { ScreeningError } = require('../../lib/screening-errors');

function polsia() { return require('../../lib/polsia-ai'); }

function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

async function runJson(ownerId, kind, { system, message }) {
  const used = await screeningDb.countAiRunsToday(ownerId);
  if (used >= cfg.AI.DAILY_RUN_CAP) {
    throw new ScreeningError('ai_daily_cap', 429, 'The daily AI limit for screening has been reached. It resets within 24 hours.');
  }
  let usage = null;
  try {
    const out = await withTimeout(
      polsia().chatJSON(message, {
        model: cfg.AI.MODEL,
        system,
        maxTokens: cfg.AI.MAX_TOKENS[kind],
        capability: `screening_${kind}`,
        onUsage: (u) => { usage = u; },
      }),
      cfg.AI.CALL_TIMEOUT_MS
    );
    await screeningDb.recordAiRun(ownerId, {
      kind, model: cfg.AI.MODEL, inputTokens: usage && usage.input_tokens, outputTokens: usage && usage.output_tokens, ok: true,
    });
    return out;
  } catch (err) {
    const timedOut = err && err.code === 'ETIMEOUT';
    const badJson = err && /json/i.test(String(err.message || ''));
    const code = timedOut ? 'ai_timeout' : badJson ? 'ai_bad_output' : 'ai_unavailable';
    await screeningDb.recordAiRun(ownerId, { kind, model: cfg.AI.MODEL, ok: false, errorCode: code });
    console.error(`[screening] AI ${kind} failed: ${code}`);
    throw new ScreeningError(
      code,
      badJson ? 502 : 503,
      code === 'ai_timeout' ? 'The AI took too long. Please try again.'
        : code === 'ai_bad_output' ? 'The AI returned an unreadable answer. Please try again.'
          : 'The AI service is unavailable right now. Please try again shortly.'
    );
  }
}

module.exports = { runJson };
