/**
 * Builds the render context passed to `views/layout.ejs`.
 *
 *   slug:             Site slug (from POLSIA_ANALYTICS_SLUG env). Use for
 *                     titles, canonical URLs.
 *   theme:            Theme tokens object. Reserved for future use.
 *   themeCSS:         HTML chunk that loads the site stylesheet(s).
 *                     Currently emits one `<link rel="stylesheet">` per
 *                     file under public/css/. Use in the layout via
 *                     `<%- themeCSS %>` — do not wrap in `<style>`.
 *   analyticsSnippet: HTML chunk with the analytics tracking `<script>`.
 *                     Use via `<%- analyticsSnippet %>` near `</body>` —
 *                     do not wrap in `<script>`.
 *
 * CSS files are read on each request. The directory is tiny (typically one
 * file) and the read is negligible compared to render time. Memoize at boot
 * if it ever becomes a hot path.
 */
const fs = require('fs');
const path = require('path');
const pricing = require('../config/pricing');
const { resolveMarket } = require('./pricing-market');

// Market -> which currency key of config/pricing.js's price{INR,USD}
// object to show by default. Only two markets/currencies exist at
// launch — see config/pricing.js's own header note for what to do if a
// Europe market is ever approved. This map should never need a third
// entry added without config/pricing.js's currencies array also gaining
// the matching entry at the same time.
const MARKET_TO_CURRENCY = {
  india: 'INR',
  international: 'USD',
};

const CSS_DIR = path.join(__dirname, '..', 'public', 'css');

function buildThemeCSS() {
  if (!fs.existsSync(CSS_DIR)) return '';
  const files = fs
    .readdirSync(CSS_DIR)
    .filter((f) => f.endsWith('.css'))
    .sort();
  if (files.length === 0) return '';
  return files.map((f) => `<link rel="stylesheet" href="/css/${f}">`).join('\n');
}

function buildAnalyticsSnippet(slug) {
  if (!slug) return '';
  const slugJson = JSON.stringify(slug);
  return `<!-- Polsia Analytics --><script>(function(){var slug=${slugJson};if(!slug)return;var vid=localStorage.getItem('polsia_vid');if(!vid){vid='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&0x3|0x8)).toString(16);});localStorage.setItem('polsia_vid',vid);}new Image().src='https://polsia.com/api/beacon/pixel?s='+encodeURIComponent(slug)+'&v='+encodeURIComponent(vid);})();</script>`;
}

function buildLandingContext(req) {
  const slug = process.env.POLSIA_ANALYTICS_SLUG || '';

  // req is optional so any existing caller that doesn't pass one (there
  // are none left after this change, but keeping the parameter optional
  // avoids a hard crash if something calls this in a context with no
  // request, e.g. a future script) still gets a working default currency.
  const user = req && req.capabilities && req.capabilities.user;
  const market = req ? resolveMarket(req, user) : 'international';
  const resolvedCurrency = MARKET_TO_CURRENCY[market] || pricing.section.defaultCurrency;

  // Shallow-copy pricing + its section object so this request's resolved
  // currency never leaks into the shared config/pricing.js singleton —
  // that module is required once and cached by Node; mutating it directly
  // would leak one request's market into every other concurrent request.
  const pricingForRequest = {
    ...pricing,
    section: { ...pricing.section, defaultCurrency: resolvedCurrency },
  };

  return {
    slug,
    theme: {},
    themeCSS: buildThemeCSS(),
    analyticsSnippet: buildAnalyticsSnippet(slug),
    pricing: pricingForRequest,
  };
}

module.exports = { buildLandingContext, buildThemeCSS, buildAnalyticsSnippet };
