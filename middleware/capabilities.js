// ═══════════════════════════════════════════════════════════════════════════
// middleware/capabilities.js
//
// Runs once per request, right after the cookie parser. Attaches:
//   req.capabilities         — from lib/capability-engine
//   res.locals.capabilities  — same object, available to every res.render()
//   res.locals.megaMenuItems — resolved Platform mega menu (unused by views so far)
//   res.locals.headerCTA     — resolved header CTA (unused by views so far)
//
// Fails open: any error resolving capabilities falls back to visitor-level
// access rather than 500ing the page. As of Step 2 (Architecture v1.5),
// this fallback includes the full shape (package/permissions/entitlements/
// personas), not just the pre-existing tier/isAuthenticated/previewMode
// fields — so a resolution failure degrades safely to a complete,
// consistent object rather than a partial one missing the new fields.
// ═══════════════════════════════════════════════════════════════════════════

const { resolveCapabilities } = require('../lib/capability-engine');
const { resolveMegaMenu } = require('../lib/navigation-resolver');
const { resolveHeaderCTA } = require('../lib/cta-resolver');
const { PRODUCT_PACKAGES, DEFAULT_PACKAGE_ID } = require('../config/product-packages');
const { PERSONA_ENTITLEMENTS } = require('../config/persona-entitlements');

function fallbackCapabilities() {
  const packageId = DEFAULT_PACKAGE_ID;
  return {
    package: { id: packageId, ...PRODUCT_PACKAGES[packageId] },
    permissions: PRODUCT_PACKAGES[packageId].permissions,
    entitlements: { creditsGranted: 0 },
    personas: PERSONA_ENTITLEMENTS[packageId] || [],
    isAuthenticated: false,
    user: null,
    tier: 'visitor',
    previewMode: true,
    hasHitUsageLimit: false,
  };
}

module.exports = async function attachCapabilities(req, res, next) {
  try {
    const capabilities = await resolveCapabilities(req);
    req.capabilities = capabilities;
    res.locals.capabilities = capabilities;
    res.locals.megaMenuItems = resolveMegaMenu(capabilities);
    res.locals.headerCTA = resolveHeaderCTA(capabilities);
  } catch (err) {
    console.error('[capabilities] resolution failed, falling back to visitor:', err.message);
    const fallback = fallbackCapabilities();
    res.locals.capabilities = fallback;
    res.locals.megaMenuItems = resolveMegaMenu(fallback);
    res.locals.headerCTA = resolveHeaderCTA(fallback);
    req.capabilities = fallback;
  }
  next();
};