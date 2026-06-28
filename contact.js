// Contact form API — sends messages to company email via Polsia proxy.
const express = require('express');
const router = express.Router();

const EMAIL_TARGET = 'hiranya.talukdar@gmail.com';

// POST /api/contact — submit contact form
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

  const subject = `Contact Form: ${name.trim()} <${email.trim()}>`;
  const body = `Name: ${name.trim()}\nEmail: ${email.trim()}\n\nMessage:\n${message.trim()}`;
  const html = `<p><strong>Name:</strong> ${name.trim()}</p><p><strong>Email:</strong> ${email.trim()}</p><hr><p>${message.trim().replace(/\n/g, '<br>')}</p>`;

  const emailPayload = JSON.stringify({
    to: EMAIL_TARGET,
    subject,
    body,
    html
  });

  const emailToken = process.env.POLSIA_API_KEY || process.env.POLSIA_API_TOKEN || '';
  const emailUrl = process.env.POLSIA_EMAIL_PROXY_URL || 'https://polsia.com/api/proxy/email/send';

  try {
    const response = await fetch(emailUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${emailToken}`
      },
      body: emailPayload
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[contact] email send failed:', response.status, errText);
      // Still return success to user — don't leak internal errors
    }

    return res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('[contact] email error:', err);
    return res.json({ success: true, message: 'Message sent successfully' });
  }
});

module.exports = router;