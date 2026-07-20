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
// access rather than 500ing the page.
// ═══════════════════════════════════════════════════════════════════════════

const { resolveCapabilities } = require('../lib/capability-engine');
const { resolveMegaMenu } = require('../lib/navigation-resolver');
const { resolveHeaderCTA } = require('../lib/cta-resolver');

module.exports = async function attachCapabilities(req, res, next) {
  try {
    const capabilities = await resolveCapabilities(req);
    req.capabilities = capabilities;
    res.locals.capabilities = capabilities;
    res.locals.megaMenuItems = resolveMegaMenu(capabilities);
    res.locals.headerCTA = resolveHeaderCTA(capabilities);
  } catch (err) {
    console.error('[capabilities] resolution failed, falling back to visitor:', err.message);
    res.locals.capabilities = { tier: 'visitor', isAuthenticated: false, previewMode: true };
    res.locals.megaMenuItems = resolveMegaMenu(res.locals.capabilities);
    res.locals.headerCTA = resolveHeaderCTA(res.locals.capabilities);
    req.capabilities = res.locals.capabilities;
  }
  next();
};