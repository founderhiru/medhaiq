// Founder-only: grant / revoke Screening Copilot access (pilot allowlist).
const express = require('express');
const router = express.Router();
const { requireFounderApi, sameOriginOnly } = require('../middleware/screening-guards');
const { getUserByEmail } = require('../db/auth');
const screeningDb = require('../db/screening');

router.use(requireFounderApi, sameOriginOnly);

router.get('/access', async (_req, res) => {
  try { res.json({ access: await screeningDb.listAccess() }); }
  catch (e) { console.error('[screening-admin]', e.message); res.status(500).json({ error: 'Something went wrong.' }); }
});

router.post('/access', async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email || email.length > 254) return res.status(400).json({ error: 'A valid email is required.' });
    const user = await getUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'No MedhaIQ account exists for that email. Ask them to sign up first.' });
    const row = await screeningDb.grantAccess({ userId: user.id, grantedBy: req.user.id, note: req.body.note });
    res.json({ access: { userId: row.user_id, status: row.status, note: row.note } });
  } catch (e) { console.error('[screening-admin]', e.message); res.status(500).json({ error: 'Something went wrong.' }); }
});

router.delete('/access/:userId', async (req, res) => {
  try {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user.' });
    const row = await screeningDb.revokeAccess(id);
    if (!row) return res.status(404).json({ error: 'No access record for that user.' });
    res.json({ access: { userId: row.user_id, status: row.status } });
  } catch (e) { console.error('[screening-admin]', e.message); res.status(500).json({ error: 'Something went wrong.' }); }
});

module.exports = router;
