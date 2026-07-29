// config/product-packages.js
//
// Single source of truth for what each package grants: permissions and
// AI-minute pool. Persona access is deliberately NOT listed here — see
// config/persona-entitlements.js, kept as its own file specifically so
// persona assignment can change without touching this file (Architecture
// v1.5, §6, §12.2).
//
// Real package IDs match the live pricing page (config/pricing.js):
// explorer, growth, leadership. A user's ACTIVE package is decided by
// their most recent unexpired row in the package_acquisitions table
// (db/package-acquisitions.js) — this file only defines what each
// package_id means once resolved, never who currently holds one.

const PRODUCT_PACKAGES = {
  explorer: {
    permissions: [
      'dashboard.view',
      'library.company',
      'library.role',
      'reports.sample',
      'interview.setup.view',
      'interview.start',
      'interview.persona.select',
    ],
    entitlements: {
      // Explorer's 30 minutes is a one-time welcome credit, not a
      // repeatable per-cycle amount — handled at the account-creation
      // step (a package_acquisitions row with source='welcome'), not
      // read from here directly by any entitlement calculation.
      includedMinutes: 30,
    },
  },
  growth: {
    permissions: [
      'dashboard.view',
      'library.company',
      'library.role',
      'reports.sample',
      'interview.setup.view',
      'interview.start',
      'interview.persona.select',
      'resume.intelligence',
      'jd.intelligence',
      'history.view',
    ],
    entitlements: {
      includedMinutes: 120,
    },
  },
  leadership: {
    permissions: [
      'dashboard.view',
      'library.company',
      'library.role',
      'reports.sample',
      'interview.setup.view',
      'interview.start',
      'interview.persona.select',
      'resume.intelligence',
      'jd.intelligence',
      'history.view',
      'reports.executive',
      'leadership.insights',
    ],
    entitlements: {
      includedMinutes: 300,
    },
  },
};

// Fallback used only if a package_acquisitions row somehow references a
// package_id not defined above (should never happen if this file and the
// pricing page stay in sync) — degrades to Explorer rather than throwing,
// consistent with this codebase's existing "fail safe, not fail loud"
// pattern (see middleware/capabilities.js's fails-open error handling).
const DEFAULT_PACKAGE_ID = 'explorer';

module.exports = { PRODUCT_PACKAGES, DEFAULT_PACKAGE_ID };
