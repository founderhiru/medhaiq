// Contact form API — sends messages to support@medhaiq.ai via the same
// Resend infrastructure already used for magic link/verification/report
// emails (services/email.js). Previously used a separate legacy Polsia
// email proxy — replaced so there's one email transport in the product,
// not two.
const express = require('express');
const router = express.Router();
const { sendContactFormEmail } = require('../services/email');

// POST /api/contact — submit contact form
// Request/response contract is unchanged from before this change —
// views/layout.ejs's modal JS needs no updates.
router.post('/', async (req, res) => {
  const { name, email, message } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!email || !email.trim() || !/^[^\n\r@]+@[^\n\r@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!message || !message.trim() || message.trim().length < 10) {
    return res.status(400).json({ error: 'Please enter a message (minimum 10 characters)' });
  }

  try {
    await sendContactFormEmail({
      name: name.trim(),
      email: email.trim(),
      message: message.trim()
    });
    return res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    // Unlike the previous Polsia implementation, a real delivery failure
    // is now reported to the visitor as an error rather than a false
    // "success" — the frontend's existing error path (alert + re-enabled
    // submit button) already handles this shape.
    console.error('[contact] email error:', err);
    return res.status(502).json({ error: 'Message could not be sent. Please try again or email support@medhaiq.ai directly.' });
  }
});

module.exports = router;
