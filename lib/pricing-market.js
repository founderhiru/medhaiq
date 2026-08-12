// lib/pricing-market.js
//
// Resolves which commercial pricing market (india | international) to show
// for a request, per the approved priority order:
//   1. Founder staging override (non-production only)
//   2. Logged-in user's stable users.market
//   3. Approximate IP/geo signal (visitors only, and new users pre-market)
//   4. Safe default (documented below)
//
// This is display-market resolution only — it decides which config/pricing.js
// numbers to show. It has no connection to checkout, because checkout does
// not exist yet (see the pricing-market audit). Do not wire this into any
// payment logic without re-reviewing that decision.

const MARKETS = ['india', 'international'];

// Cookie the Founder override route sets. httpOnly so client JS can't read
// or forge it; the value itself is meaningless to trust on its own — every
// read of it here is also gated on NODE_ENV, so the cookie has zero effect
// in production even if somehow present (e.g. carried over from a staging
// cookie during local testing against a prod-configured build).
const OVERRIDE_COOKIE = 'founder_market_override';

// SAFE DEFAULT, documented: 'international'. Chosen deliberately over
// 'india' — if geo signal is unavailable/unrecognized, showing the higher
// international price is the commercially conservative failure mode
// (undercharging a non-India visitor by showing ₹999 costs more than
// showing a genuine India visitor $19 briefly, and any India visitor who
// signs up gets users.market resolved properly from then on anyway, per
// the geo header check below running on every anonymous pageview, not
// just once). Revisit if real traffic data says otherwise.
const DEFAULT_MARKET = 'international';

/**
 * Best-effort IP/geo signal, header-based only — no external IP-lookup
 * service, no MaxMind/GeoIP database (explicitly out of scope per the
 * approved audit: "do not build elaborate geo-location infrastructure").
 * Checks the common CDN/host geo headers if present; if this app is ever
 * put behind Cloudflare or Vercel, this starts working with zero code
 * changes. Render does not currently set any of these by default, so on
 * today's infrastructure this will normally fall through to null — that's
 * expected, not a bug, and DEFAULT_MARKET covers it.
 */
function geoMarketFromHeaders(req) {
  const cfCountry = req.headers['cf-ipcountry']; // Cloudflare
  const vercelCountry = req.headers['x-vercel-ip-country']; // Vercel
  const genericCountry = req.headers['x-geo-country']; // generic/future CDN
  const country = (cfCountry || vercelCountry || genericCountry || '').toUpperCase();
  if (!country) return null;
  return country === 'IN' ? 'india' : 'international';
}

function readOverrideCookie(req) {
  const raw = req.cookies && req.cookies[OVERRIDE_COOKIE];
  if (!raw) return null;
  const value = String(raw).toUpperCase();
  if (value === 'INDIA') return 'india';
  if (value === 'INTERNATIONAL') return 'international';
  return null; // AUTO or anything unrecognized — fall through to normal resolution
}

/**
 * Resolves the market for this request.
 *
 * @param {import('express').Request} req
 * @param {{market?: string|null}|null} user - req.capabilities?.user / req.user,
 *   whichever the caller already has. Pass null/undefined for a visitor.
 * @returns {'india'|'international'}
 */
function resolveMarket(req, user) {
  // 1. Founder staging override — never respected in production, full stop.
  if (process.env.NODE_ENV !== 'production') {
    const override = readOverrideCookie(req);
    if (override) return override;
  }

  // 2. Logged-in user's stable market — do NOT re-derive from IP once set,
  //    per "do not continuously change the user's market based on IP".
  if (user && user.market && MARKETS.includes(user.market)) {
    return user.market;
  }

  // 3. Approximate geo for visitors / not-yet-established users.
  const geo = geoMarketFromHeaders(req);
  if (geo) return geo;

  // 4. Safe default.
  return DEFAULT_MARKET;
}

module.exports = { resolveMarket, MARKETS, OVERRIDE_COOKIE, DEFAULT_MARKET };
