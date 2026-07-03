// services/email.js
// Sends magic link emails + interview report emails via Resend API
// Replace Polsia proxy with Resend (free tier: 3000 emails/month)

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.EMAIL_FROM    || 'noreply@medhaiq.ai';
const APP_URL        = process.env.APP_URL       || 'https://www.medhaiq.ai';

async function _send({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    // Graceful fallback: log instead of crash so dev mode still works
    console.warn('[email] RESEND_API_KEY not configured — email not sent to', to);
    return;
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[email] Resend ${resp.status}:`, body);
    throw new Error(`Email delivery failed: ${resp.status}`);
  }
}

/* ── Magic link (sign-in) ────────────────────────────────────────────────── */
async function sendMagicLinkEmail(toEmail, magicUrl) {
  const subject = 'Your MedhaIQ sign-in link';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#0A0F1E;font-family:'Inter',system-ui,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#111827;border-radius:16px;overflow:hidden;border:1px solid #1E3A6E;">
    <div style="background:#1E40AF;padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.3px;">MedhaIQ</h1>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#F9FAFB;margin:0 0 16px;font-size:20px;font-weight:600;">Sign in to your account</h2>
      <p style="color:#94A3B8;margin:0 0 32px;font-size:15px;line-height:1.6;">Click the button below to securely sign in. This link expires in 1 hour.</p>
      <a href="${magicUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:-0.2px;">Sign In to MedhaIQ</a>
      <p style="color:#64748B;margin:32px 0 8px;font-size:13px;">Or copy this link into your browser:</p>
      <p style="color:#3B82F6;margin:0;font-size:13px;word-break:break-all;line-height:1.5;">${magicUrl}</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #1F2937;">
      <p style="color:#475569;margin:0;font-size:12px;">If you did not request this link, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`;
  await _send({ to: toEmail, subject, html });
}

/* ── Career Intelligence Report email ───────────────────────────────────── */
async function sendInterviewReportEmail({
  toEmail, userName, reportId,
  personaName, roleTitle,
  overallScore, recommendation,
  executiveSummary, scoreboard,
  topPriorities,
}) {
  const score  = Math.round(overallScore || 0);
  const sb     = scoreboard || {};
  const rec    = recommendation || 'Lean Hire';
  const name   = userName  || 'there';
  const role   = roleTitle || 'Professional';
  const url    = `${APP_URL}/interview/report/${reportId}`;
  const subject = `Your MedhaIQ Career Intelligence Report — ${role} · ${score}/100`;

  const scoreColor = (s) => s >= 75 ? '#22c55e' : s >= 55 ? '#f59e0b' : '#ef4444';
  const scoreRow   = (label, val) => `
    <tr>
      <td style="padding:9px 0;color:#94a3b8;font-size:13px;border-bottom:1px solid #1e2d45;">${label}</td>
      <td style="padding:9px 0;text-align:right;border-bottom:1px solid #1e2d45;">
        <span style="font-size:13px;font-weight:700;color:${scoreColor(val || 0)};">${Math.round(val || 0)}/100</span>
      </td>
    </tr>`;

  const recColor = rec.includes('Strong') ? '#22c55e' : rec.includes('No Hire') ? '#ef4444' : '#f59e0b';

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#070d1a;font-family:'Inter',system-ui,sans-serif;">
<div style="max-width:580px;margin:40px auto;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 50%,#312e81 100%);border-radius:16px 16px 0 0;padding:36px 40px;">
    <div style="margin-bottom:20px;display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;font-weight:800;color:#fff;">Medha<span style="color:#93c5fd;">IQ</span></span>
      <span style="background:rgba(255,255,255,0.12);color:#e0e7ff;font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:0.8px;text-transform:uppercase;">Career Intelligence Report</span>
    </div>
    <div style="font-size:12px;color:#93c5fd;margin-bottom:8px;font-weight:500;">${personaName || 'Expert Interviewer'} &nbsp;·&nbsp; ${role}</div>
    <div style="display:flex;align-items:baseline;gap:10px;">
      <span style="font-size:60px;font-weight:800;color:#fff;line-height:1;letter-spacing:-2px;">${score}</span>
      <div>
        <div style="color:#93c5fd;font-size:16px;font-weight:600;">/100</div>
        <div style="display:inline-block;background:${recColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;margin-top:4px;">${rec}</div>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div style="background:#0f1929;border:1px solid #1e3a6e;border-top:none;padding:36px 40px;">

    <p style="color:#94a3b8;font-size:14px;line-height:1.8;margin:0 0 28px;">
      Hi ${name},<br><br>
      Your MedhaIQ interview session is complete. Here is your personalised Career Intelligence Report.
    </p>

    <!-- Executive Summary -->
    <div style="background:#0b1629;border:1px solid #1e3a6e;border-left:3px solid #3b82f6;border-radius:8px;padding:20px;margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#3b82f6;margin-bottom:10px;">Executive Summary</div>
      <p style="color:#e2e8f0;font-size:13px;line-height:1.75;margin:0;">${executiveSummary || 'Your interview session demonstrated a solid professional baseline with clear development opportunities identified.'}</p>
    </div>

    <!-- Scoreboard -->
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#3b82f6;margin-bottom:14px;">Career Intelligence Scoreboard</div>
      <table style="width:100%;border-collapse:collapse;">
        ${scoreRow('Career Intelligence',    sb.career_intelligence   || score)}
        ${scoreRow('Leadership Readiness',   sb.leadership_readiness  || score)}
        ${scoreRow('Executive Presence',     sb.executive_presence    || score)}
        ${scoreRow('GCC Readiness',          sb.gcc_readiness         || score)}
        ${scoreRow('Promotion Readiness',    sb.promotion_readiness   || score)}
      </table>
    </div>

    <!-- Top 3 Development Priorities -->
    ${topPriorities && topPriorities.length ? `
    <div style="margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#3b82f6;margin-bottom:14px;">Top Development Priorities</div>
      ${topPriorities.slice(0,3).map((p, i) => `
      <div style="display:flex;gap:12px;margin-bottom:14px;align-items:flex-start;">
        <div style="width:24px;height:24px;border-radius:50%;background:#1e40af;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:800;color:#93c5fd;">${i+1}</div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:3px;">${p.issue || p.theme || p.label || ''}</div>
          <div style="font-size:12px;color:#64748b;line-height:1.6;">${p.fix || p.action || ''}</div>
        </div>
      </div>`).join('')}
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;padding:24px 0 8px;">
      <a href="${url}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:15px 44px;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:-0.3px;box-shadow:0 4px 20px rgba(29,78,216,0.4);">View Full Report &rarr;</a>
      <p style="color:#334155;font-size:11px;margin-top:16px;word-break:break-all;">${url}</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#070d1a;border:1px solid #1e3a6e;border-top:none;border-radius:0 0 16px 16px;padding:18px 40px;text-align:center;">
    <p style="color:#1e3a6e;margin:0;font-size:11px;">MedhaIQ &nbsp;·&nbsp; AI-Powered Career Intelligence &nbsp;·&nbsp; <a href="${APP_URL}" style="color:#3b82f6;text-decoration:none;">medhaiq.ai</a></p>
  </div>

</div>
</body></html>`;

  await _send({ to: toEmail, subject, html });
}

module.exports = { sendMagicLinkEmail, sendInterviewReportEmail };
