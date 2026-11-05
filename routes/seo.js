// routes/seo.js
// Dynamic /sitemap.xml built from the same data files that drive the
// Explore pages, so adding company #9, role #7 or framework #7 puts the new
// URL in the sitemap automatically — no manual sitemap edit.
//
// Isolated on purpose: requires only the three public data files, touches no
// protected module, no DB. MUST be mounted BEFORE express.static in server.js,
// otherwise public/sitemap.xml (static) would be served instead of this route.

const express = require('express');
const router = express.Router();

const BASE_URL = 'https://www.medhaiq.ai';

// Public, indexable, always-200 pages. Pricing is intentionally absent: it is
// an on-page anchor (/#pricing) on the homepage, not its own URL.
const STATIC_PAGES = [
  { path: '/',                              changefreq: 'weekly',  priority: '1.0' },
  { path: '/explore',                       changefreq: 'weekly',  priority: '0.8' },
  { path: '/explore/company-library',       changefreq: 'weekly',  priority: '0.8' },
  { path: '/explore/role-library',          changefreq: 'weekly',  priority: '0.8' },
  { path: '/explore/interview-frameworks',  changefreq: 'weekly',  priority: '0.8' },
  { path: '/why',                           changefreq: 'monthly', priority: '0.7' },
  { path: '/faq',                           changefreq: 'monthly', priority: '0.7' },
  { path: '/about',                         changefreq: 'monthly', priority: '0.6' },
  { path: '/sample-report',                 changefreq: 'monthly', priority: '0.7' },
  { path: '/resume-intelligence-preview',   changefreq: 'monthly', priority: '0.7' },
  { path: '/professional-horizons',         changefreq: 'monthly', priority: '0.5' },
  { path: '/architecture',                  changefreq: 'monthly', priority: '0.5' },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEntries() {
  const entries = STATIC_PAGES.map(p => ({ ...p }));

  // Each data file is loaded defensively: one broken/missing file must never
  // take the whole sitemap (or the server) down.
  const add = (loader, prefix, listKey, priority) => {
    try {
      const list = loader()[listKey] || [];
      list.forEach(item => {
        if (item && item.slug) {
          entries.push({ path: `${prefix}/${item.slug}`, changefreq: 'monthly', priority });
        }
      });
    } catch (err) {
      console.error(`[sitemap] could not load ${prefix} data:`, err.message);
    }
  };

  add(() => require('../data/company-library-data'),     '/explore/company-library',     'companyLibrary', '0.7');
  add(() => require('../data/role-library-data'),        '/explore/role-library',        'roleLibrary',    '0.7');
  add(() => require('../data/interview-frameworks-data'), '/explore/interview-frameworks', 'frameworks',    '0.7');

  return entries;
}

router.get('/sitemap.xml', (_req, res) => {
  const body = buildEntries().map(e =>
    `  <url>\n    <loc>${esc(BASE_URL + e.path)}</loc>\n` +
    `    <changefreq>${e.changefreq}</changefreq>\n` +
    `    <priority>${e.priority}</priority>\n  </url>`
  ).join('\n');

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
});

module.exports = router;
