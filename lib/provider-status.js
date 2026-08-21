// lib/provider-status.js
//
// Server-side "AI Provider Status" panel data — deliberately separate from
// db/cost-analytics.js's usage/revenue ledger. Two distinct concepts, never
// mixed:
//
//   A. Actual MedhaIQ usage      — cost_analytics, already tracked, reused
//      here via getFounderDashboardStats(), never recomputed separately.
//   B. Provider account balance  — the provider's own remaining wallet/
//      credit, fetched live where a legitimate API exists.
//
// A provider recharge is a Concept-B event and must never be written into
// cost_analytics or reported as usage — this module only ever READS
// balance info for display; it never writes to the cost ledger.
//
// AUDIT FINDING (2026-08-21), from each provider's own documentation:
//   Claude/Anthropic — no public balance endpoint exists (confirmed via an
//     open Anthropic GitHub issue explicitly asking for one). The Usage &
//     Cost Admin API covers historical usage/cost only, not remaining
//     balance. Balance is always reported unavailable.
//   Vapi — no documented Billing/Wallet endpoint appears anywhere in
//     Vapi's published API reference (Assistants, Calls, Chats, Sessions,
//     Phone Numbers, Tools, Files, Analytics, Provider Resources — that's
//     the full documented surface). Balance is always reported unavailable.
//   ElevenLabs — GET /v1/user/subscription IS documented and real, and
//     returns character_count (used) + character_limit (quota) for the
//     current billing period. Remaining = character_limit - character_count,
//     in ElevenLabs' own unit (credits/characters), never converted to a
//     dollar guess.
//
// This module makes exactly one external call (ElevenLabs) and never
// exposes VOICE_SERVER_CONFIG.elevenLabsApiKey outside this file's own
// request — same discipline services/voice-tts-proxy.js already follows.
const { VOICE_SERVER_CONFIG } = require('../config/voice-server-config');
const { getFounderDashboardStats } = require('../db/cost-analytics');

const ELEVENLABS_BALANCE_TIMEOUT_MS = 8000;
const STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — avoids calling the provider API on every dashboard render/refresh

let cachedStatus = null;
let cachedAt = 0;

// Configurable low-balance threshold for ElevenLabs (the only provider we
// can actually evaluate this for). Not hardcoded into the UI — read here,
// one place, easy to change without touching rendering code.
const ELEVENLABS_LOW_BALANCE_CREDITS = parseInt(process.env.ELEVENLABS_LOW_BALANCE_THRESHOLD, 10) || 5000;

async function fetchElevenLabsBalance() {
  if (!VOICE_SERVER_CONFIG.elevenLabsApiKey) {
    return { balanceAvailable: false, reason: 'ELEVENLABS_API_KEY not configured' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ELEVENLABS_BALANCE_TIMEOUT_MS);
  try {
    const res = await fetch(
      VOICE_SERVER_CONFIG.elevenLabsApiBaseUrl.replace(/\/$/, '') + '/v1/user/subscription',
      { headers: { 'xi-api-key': VOICE_SERVER_CONFIG.elevenLabsApiKey }, signal: controller.signal }
    );
    clearTimeout(timeout);

    if (res.status === 401 || res.status === 403) {
      return { balanceAvailable: false, reason: `API key rejected (HTTP ${res.status})` };
    }
    if (!res.ok) {
      return { balanceAvailable: false, reason: `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (typeof data.character_limit !== 'number' || typeof data.character_count !== 'number') {
      return { balanceAvailable: false, reason: 'malformed response — missing character_limit/character_count' };
    }

    const remaining = data.character_limit - data.character_count;
    return {
      balanceAvailable: true,
      balance: remaining,
      balanceUnit: 'credits',
      lowBalance: remaining < ELEVENLABS_LOW_BALANCE_CREDITS,
    };
  } catch (err) {
    clearTimeout(timeout);
    const reason = err.name === 'AbortError' ? 'request timed out' : `network error: ${err.message}`;
    return { balanceAvailable: false, reason };
  }
}

// "Status" here means "is this provider actively producing recorded usage
// in our own ledger" — not a live uptime probe (no legitimate status API
// exists for any of these three that we could call without inventing one).
// A provider with zero usage this month isn't necessarily broken (could be
// a quiet month), so this stays a neutral, honest label, not a red flag.
function activityStatus(usageThisMonth, balanceCheckFailed) {
  if (balanceCheckFailed) return 'balance check failed';
  if (usageThisMonth > 0) return 'active';
  return 'no usage this month';
}

async function computeProviderStatus() {
  const now = new Date().toISOString();

  // Reuse the SAME dashboard computation already trusted elsewhere — no
  // second cost ledger, no parallel aggregation logic.
  const dashboardStats = await getFounderDashboardStats();

  const elevenlabsBalance = await fetchElevenLabsBalance();

  return {
    claude: {
      balance: null,
      balanceAvailable: false,
      balanceUnavailableReason: 'Anthropic\u2019s API does not expose a remaining-balance endpoint',
      usageThisMonth: dashboardStats.month_claude_cost,
      usageCurrency: 'USD',
      status: activityStatus(dashboardStats.month_claude_cost, false),
      lastUpdated: now,
    },
    vapi: {
      balance: null,
      balanceAvailable: false,
      balanceUnavailableReason: 'Vapi does not publish a billing/wallet API endpoint',
      usageThisMonth: dashboardStats.month_vapi_cost,
      usageCurrency: 'USD',
      status: activityStatus(dashboardStats.month_vapi_cost, false),
      lastUpdated: now,
    },
    elevenlabs: {
      balance: elevenlabsBalance.balanceAvailable ? elevenlabsBalance.balance : null,
      balanceAvailable: elevenlabsBalance.balanceAvailable,
      balanceUnit: elevenlabsBalance.balanceUnit || null,
      balanceUnavailableReason: elevenlabsBalance.balanceAvailable ? null : elevenlabsBalance.reason,
      lowBalance: elevenlabsBalance.balanceAvailable ? elevenlabsBalance.lowBalance : false,
      usageThisMonth: dashboardStats.month_elevenlabs_cost, // null if never captured this month — same semantics as the dashboard's provider table
      usageCurrency: 'USD',
      status: activityStatus(dashboardStats.month_elevenlabs_cost, !elevenlabsBalance.balanceAvailable && elevenlabsBalance.reason && elevenlabsBalance.reason.startsWith('HTTP')),
      lastUpdated: now,
    },
  };
}

/**
 * Cached, safe-by-construction provider status. If the underlying computation
 * throws for any reason (a provider API fully down, a network partition,
 * etc.), this returns the last good cached value if one exists, or a fully
 * "unavailable" shape — it NEVER throws, so a provider-status failure can
 * never break the Founder Dashboard's main financial view.
 */
async function getProviderStatus() {
  const now = Date.now();
  if (cachedStatus && (now - cachedAt) < STATUS_CACHE_TTL_MS) {
    return cachedStatus;
  }
  try {
    const status = await computeProviderStatus();
    cachedStatus = status;
    cachedAt = now;
    return status;
  } catch (err) {
    console.error('[provider-status] computeProviderStatus failed (dashboard unaffected):', err.message);
    if (cachedStatus) return cachedStatus; // serve stale-but-real data rather than nothing
    const now2 = new Date().toISOString();
    const unavailable = (reason) => ({
      balance: null, balanceAvailable: false, balanceUnavailableReason: reason,
      usageThisMonth: null, usageCurrency: 'USD', status: 'unavailable', lastUpdated: now2,
    });
    return {
      claude: unavailable('provider status temporarily unavailable'),
      vapi: unavailable('provider status temporarily unavailable'),
      elevenlabs: unavailable('provider status temporarily unavailable'),
    };
  }
}

module.exports = { getProviderStatus };
