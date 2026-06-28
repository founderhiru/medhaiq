// Email service — magic link emails via Polsia email proxy.
const EMAIL_API_URL = process.env.POLSIA_EMAIL_PROXY_URL || 'https://polsia.com/api/proxy/email/send';

async function sendMagicLinkEmail(toEmail, magicUrl) {
  const companyName = 'MedhaIQ';
  const subject = `Your ${companyName} sign-in link`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#0A0F1E;font-family:'Inter',system-ui,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#111827;border-radius:16px;overflow:hidden;border:1px solid #1E3A6E;">
    <div style="background:#1E40AF;padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.3px;">MedhaIQ</h1>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#F9FAFB;margin:0 0 16px;font-size:20px;font-weight:600;">Sign in to your account</h2>
      <p style="color:#94A3B8;margin:0 0 32px;font-size:15px;line-height:1.6;">Click the button below to securely sign in to your MedhaIQ account. This link expires in 1 hour.</p>
      <a href="${magicUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:-0.2px;">Sign In to MedhaIQ</a>
      <p style="color:#64748B;margin:32px 0 8px;font-size:13px;">Or copy this link into your browser:</p>
      <p style="color:#3B82F6;margin:0;font-size:13px;word-break:break-all;line-height:1.5;">${magicUrl}</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #1F2937;">
      <p style="color:#475569;margin:0;font-size:12px;">If you did not request this link, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const response = await fetch(EMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.POLSIA_API_KEY || process.env.POLSIA_API_TOKEN || ''}`,
      },
      body: JSON.stringify({
        to: toEmail,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[email] send error: status=${response.status} url=${EMAIL_API_URL} body=${err}`);
      throw new Error(`email send failed: ${response.status}`);
    }
  } catch (err) {
    console.error('[email] send failed:', err.message);
    throw err;
  }
}

module.exports = { sendMagicLinkEmail };