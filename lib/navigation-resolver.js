// ═══════════════════════════════════════════════════════════════════════════
// lib/navigation-resolver.js — Platform Mega Menu routing
//
// Capability Engine → Navigation Resolver → Preview Route → Production Layout
// The mega menu partial never decides routing itself — it just loops over
// whatever this returns. NOTE: nothing wires this into header.ejs yet, by
// design — that's a deliberately separate, later change (see chat).
//
// STATUS: only Adaptive Interview has a real preview route (/preview/interview).
// The other three are NOT built yet, so previewImplemented:false items fall
// back to /explore (existing, safe) rather than a 404. Flip the flag and set
// the real previewHref once each one ships.
// ═══════════════════════════════════════════════════════════════════════════

const { TIER } = require('./capability-engine');

const FALLBACK_HREF = '/explore';

const MENU_DEFINITIONS = [
  {
    key: 'interview',
    icon: '🎤',
    title: 'Adaptive Interview',
    desc: 'Practice realistic AI interviews tailored to your target role.',
    authHref: '/interview',
    previewHref: '/preview/interview',
    previewImplemented: true,
  },
  {
    key: 'insights',
    icon: '⭐',
    title: 'Interview Insights',
    desc: 'Explore executive-level interview reports and AI feedback.',
    authHref: '/dashboard/history?focus=insights',
    previewHref: '/preview/report',
    previewImplemented: false,
  },
  {
    key: 'progress',
    icon: '📈',
    title: 'Career Progress',
    desc: 'View your AI-powered career dashboard and readiness insights.',
    authHref: '/dashboard/history',
    previewHref: '/preview/workspace',
    previewImplemented: false,
  },
  {
    key: 'resume',
    icon: '📄',
    title: 'Resume Intelligence',
    desc: 'Discover how AI analyzes and strengthens your resume.',
    authHref: '/resume',
    previewHref: '/preview/resume',
    previewImplemented: false,
  },
];

const EXPLORE_ITEM = {
  key: 'explore',
  icon: '🧭',
  title: 'Explore MedhaIQ',
  desc: 'Tour the platform end-to-end before you sign up.',
  href: '/explore',
};

function resolveMegaMenu(capabilities) {
  const isPreview = !!(capabilities && capabilities.previewMode);

  const items = MENU_DEFINITIONS.map((def) => {
    let href = def.authHref;
    if (isPreview) {
      href = def.previewImplemented ? def.previewHref : FALLBACK_HREF;
    }
    return { key: def.key, icon: def.icon, title: def.title, desc: def.desc, href };
  });

  items.push({ ...EXPLORE_ITEM });

  return items;
}

module.exports = { resolveMegaMenu, TIER };
