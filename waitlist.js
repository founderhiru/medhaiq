// Waitlist API — submit signup and admin export.
const express = require('express');
const { createWaitlistEntry, getWaitlistCount, getWaitlistCSV } = require('../db/waitlist');
const router = express.Router();

// POST /api/waitlist — public signup
router.post('/', async (req, res) => {
  const { name, email, phone, city, user_type: userType, plan_interest: planInterest } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!email || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  const VALID_TYPES = ['student', 'professional', 'hr_manager', 'recruiter', 'founder', 'doctor', 'teacher', 'engineer', 'other'];
  if (!userType || !VALID_TYPES.includes(userType)) {
    return res.status(400).json({ error: 'Valid user type is required' });
  }

  try {
    const entry = await createWaitlistEntry({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || null,
      city: city?.trim() || null,
      userType,
      planInterest: planInterest || null,
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent']
    });

    const count = await getWaitlistCount();
    return res.json({
      success: true,
      message: "You're on the list! We'll notify you at launch.",
      position: count
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.json({
        success: true,
        message: "You're already on the list! We'll notify you at launch.",
        alreadyRegistered: true
      });
    }
    console.error('[waitlist] insert error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// GET /api/waitlist/export — admin CSV export
// Protected by ADMIN_SECRET env var
router.get('/export', async (req, res) => {
  if (process.env.ADMIN_SECRET && req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const entries = await getWaitlistCSV();
    const header = 'Name,Email,Phone,City,User Type,Plan Interest,Signup Date\n';
    const rows = entries.map(e =>
      `"${e.name}","${e.email}","${e.phone || ''}","${e.city || ''}","${e.user_type}","${e.plan_interest || ''}","${e.created_at}"`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="medhaiq-waitlist.csv"');
    return res.send(header + rows);
  } catch (err) {
    console.error('[waitlist] export error:', err);
    return res.status(500).json({ error: 'Export failed' });
  }
});

// GET /api/waitlist/count — public count
router.get('/count', async (_req, res) => {
  try {
    const count = await getWaitlistCount();
    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get count' });
  }
});

module.exports = router;