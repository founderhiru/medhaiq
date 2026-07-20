// ═══════════════════════════════════════════════════════════════════════════
// routes/account.js — Account Settings API
//
// Backs the Profile and Preferences tabs on the /settings page. Both
// endpoints are genuinely new — settings.ejs's own comment noted the
// Profile tab had "no save action... needs a profile-update endpoint
// first," and there was no route anywhere reading or writing the
// preferences table before this either.
// ═══════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const { updateUserName } = require('../db/auth');
const { updatePreferences } = require('../db/preferences');
const { requireAuth } = require('../middleware/guards');

// POST /api/settings/profile — Profile tab's "Save Changes" (name only;
// email is intentionally read-only in this UI, see views/settings.ejs).
router.post('/profile', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    const updated = await updateUserName(req.user.id, name);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: updated });
  } catch (err) {
    console.error('[account] profile update error:', err);
    res.status(400).json({ error: err.message || 'Failed to update profile' });
  }
});

// POST /api/settings/preferences — Preferences tab's two real toggles.
// Theme is intentionally not included here — it's a display-only
// placeholder in this beta (see views/settings.ejs), not wired to a save
// action, since no theme-switching capability exists anywhere in the app
// yet to actually apply it.
router.post('/preferences', requireAuth, async (req, res) => {
  try {
    const { email_notifications, product_updates } = req.body;
    const updated = await updatePreferences(req.user.id, { email_notifications, product_updates });
    res.json({ success: true, preferences: updated });
  } catch (err) {
    console.error('[account] preferences update error:', err);
    res.status(400).json({ error: err.message || 'Failed to update preferences' });
  }
});

module.exports = router;
