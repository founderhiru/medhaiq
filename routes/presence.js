// routes/presence.js
//
// POST /api/presence/heartbeat — the only route in this file. Records
// that the authenticated user is here right now, plus a short page/
// activity label. No IP, no location, no fingerprinting, no keystroke/
// mouse tracking — exactly the two fields db/presence.js's table has.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/guards');
const { recordHeartbeat } = require('../db/presence');

router.post('/heartbeat', requireAuth, async (req, res) => {
  const { page, activity } = req.body || {};
  try {
    await recordHeartbeat({ userId: req.user.id, page, activity });
    return res.json({ success: true });
  } catch (err) {
    // Fails silently to the client — a missed heartbeat just means this
    // one ping doesn't count; the next one 30s later self-corrects. Never
    // worth surfacing an error to the user for a background presence ping.
    console.error('[presence] heartbeat error:', err && err.message);
    return res.status(500).json({ success: false });
  }
});

module.exports = router;
