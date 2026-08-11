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

/* ── Email verification (password signup → Welcome Offer) ───────────────── */
// Reuses the same token (routes/auth.js's /auth/verify) and the exact
// same styling as the sign-in email above — this is deliberately a
// SIBLING function, not a shared template, so the sign-in email's copy
// (used on every subsequent login) is never touched by this. Only fires
// once, right after password-based signup.
async function sendVerificationEmail(toEmail, verifyUrl) {
  const subject = 'Verify your email — activate your MedhaIQ account';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#0A0F1E;font-family:'Inter',system-ui,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#111827;border-radius:16px;overflow:hidden;border:1px solid #1E3A6E;">
    <div style="background:#1E40AF;padding:32px 40px;">
      <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.3px;">MedhaIQ</h1>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#F9FAFB;margin:0 0 16px;font-size:20px;font-weight:600;">Verify your email to activate your account</h2>
      <p style="color:#94A3B8;margin:0 0 32px;font-size:15px;line-height:1.6;">Click the button below to verify your email and receive your 30 Welcome AI Minutes. This link expires in 24 hours.</p>
      <a href="${verifyUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:-0.2px;">Verify Email &amp; Activate Account</a>
      <p style="color:#64748B;margin:32px 0 8px;font-size:13px;">Or copy this link into your browser:</p>
      <p style="color:#3B82F6;margin:0;font-size:13px;word-break:break-all;line-height:1.5;">${verifyUrl}</p>
    </div>
    <div style="padding:24px 40px;border-top:1px solid #1F2937;">
      <p style="color:#475569;margin:0;font-size:12px;">If you did not create this account, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`;
  await _send({ to: toEmail, subject, html });
}

/* ── Career Intelligence Report email ───────────────────────────────────── */
// STEP 4 (docs/MEDHAIQ_REPORTING_DESIGN_V1.md) — consumes the SAME
// CareerIntelligenceReport object (`cir`) already used by the Web Report
// and PDF routes. No independent vector calculation, no scoreboard read,
// no `|| fallback` on any numeric report score (that pattern was the
// confirmed cause of legitimate 0s becoming a different number — see the
// design doc §D/E). `cir` is the single numeric source for every score
// shown below; only presentation fields (toEmail/userName/reportId/
// personaName/roleTitle) are passed separately, exactly as before.
//
// LOW-EVIDENCE HANDLING: Strongest Signal / Priority use cir.strengths[0] /
// cir.developmentPriorities[0] (ranked from the real five-vector data, per
// the locked Decision 1 — NOT strengths_json/improvements_json, which are
// both the same underlying AI "priorities" array under different labels,
// confirmed in the audit). If even the top-ranked vector doesn't clear 25
// — the SAME low-evidence ceiling generateReport() itself already applies
// to a low-evidence scoreboard (services/interview.js) — ranking one
// near-zero vector above four other near-zero vectors and presenting it
// as a "strength" would be misleading, so an honest insufficient-evidence
// line is shown instead of a fabricated signal. This threshold is reused
// from existing product logic, not a new number invented for email.
async function sendInterviewReportEmail({
  toEmail, userName, reportId,
  personaName, roleTitle,
  cir,
}) {
  const score = Math.round(cir.overallScore);
  const rec   = cir.recommendation || 'Lean Hire';
  const name  = userName || 'there';
  const role  = roleTitle || cir.sessionContext.role || 'Professional';
  const url   = `${APP_URL}/interview/report/${reportId}`;
  const subject = `Your MedhaIQ Career Intelligence Report — ${role} · ${score}/100`;

  const LOW_EVIDENCE_CEILING = 25; // same ceiling generateReport() already applies; not a new number
  const INSUFFICIENT_EVIDENCE_TEXT = 'Insufficient evidence to establish a reliable signal.';

  const topStrength = cir.strengths[0];
  const topPriority = cir.developmentPriorities[0];
  // Single evidence gate for BOTH Strongest Signal and Priority — approved
  // narrow correction, locked: for a low-evidence session (e.g. 226) BOTH
  // fields must show the insufficient-evidence line, never a sentence
  // constructed from a near-zero vector. Gating on the numeric five-vector
  // ranking (not on whether narrative text happens to exist) is what
  // guarantees that — an AI-written strongest_response/improvements_json
  // sentence can exist even in a low-evidence session (it did for 226),
  // so gating on text-presence alone would leak a fabricated-feeling
  // "strength" through. Gating on the same vector ceiling used everywhere
  // else in this file keeps both fields consistent with the 5-Vector
  // Profile shown right above them in the email.
  const hasReliableSignal = topStrength && topStrength.score >= LOW_EVIDENCE_CEILING;

  // Strongest Signal — cir.coachingInsights.strongestResponse, an existing
  // evidence-grounded AI output already present on the canonical object
  // since Step 1 (no CIR extension needed). Deliberately NOT
  // strengths_json (confirmed to be the same underlying array as
  // improvements_json under different field names).
  const strongestSignalText = (() => {
    if (!hasReliableSignal) return INSUFFICIENT_EVIDENCE_TEXT;
    const sr = cir.coachingInsights.strongestResponse;
    if (sr && sr.evidence) return sr.evidence;
    return `${topStrength.label} — ${topStrength.score}/100.`; // defensive fallback only
  })();

  // Priority — developmentPriorities[0].narrative, a pass-through of the
  // existing improvements_json coaching sentence (approved narrow
  // correction; see lib/career-intelligence-report.js for the exact
  // pass-through, not a new calculation).
  const priorityText = (() => {
    if (!hasReliableSignal) return INSUFFICIENT_EVIDENCE_TEXT;
    if (topPriority && topPriority.narrative) return topPriority.narrative;
    return topPriority ? `${topPriority.label} — ${topPriority.score}/100.` : INSUFFICIENT_EVIDENCE_TEXT; // defensive fallback only
  })();

  const scoreColor = (s) => s >= 75 ? '#0F7B4E' : s >= 55 ? '#9A5B14' : '#B91C1C';
  const recColor    = /strong hire|^hire$/i.test(rec) ? '#0F7B4E' : /lean hire/i.test(rec) ? '#9A5B14' : '#B91C1C';
  const recBg        = /strong hire|^hire$/i.test(rec) ? '#EAF7F1' : /lean hire/i.test(rec) ? '#FBF1E4' : '#FEE2E2';

  // Five vectors — cir.fiveVectors is the ONLY numeric source. No `||`
  // fallback: a genuine 0 renders as 0/100, not as the overall score.
  const vectorRow = (label, val) => `
    <tr>
      <td style="padding:9px 0;color:#64748B;font-size:13px;border-bottom:1px solid #E3E6EC;">${label}</td>
      <td style="padding:9px 0 9px 12px;border-bottom:1px solid #E3E6EC;width:120px;">
        <div style="background:#F7F8FA;border-radius:4px;height:6px;width:100%;overflow:hidden;">
          <div style="background:#2554C7;height:100%;width:${Math.max(0, Math.min(100, val))}%;"></div>
        </div>
      </td>
      <td style="padding:9px 0 9px 12px;text-align:right;border-bottom:1px solid #E3E6EC;">
        <span style="font-size:13px;font-weight:700;color:${scoreColor(val)};">${val}</span>
      </td>
    </tr>`;

  // STAR Signal — one honest line, derived from cir.starIntelligence
  // (same STAR engine data used everywhere else). No new STAR calculation.
  const starTotal = cir.starIntelligence.totalAnswered;
  const starLine = starTotal === 0
    ? INSUFFICIENT_EVIDENCE_TEXT
    : `Across ${starTotal} answered question${starTotal === 1 ? '' : 's'}, Situation was identified in ${cir.starIntelligence.situation.pct}%, Task in ${cir.starIntelligence.task.pct}%, Action in ${cir.starIntelligence.action.pct}%, and Result in ${cir.starIntelligence.result.pct}%.`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#E7E9EE;font-family:'Inter',system-ui,sans-serif;">
<div style="max-width:580px;margin:32px auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E3E6EC;">

  <!-- Header — white, restrained accent, no gradient -->
  <div style="padding:32px 40px 24px;border-bottom:1px solid #E3E6EC;">
    <div style="margin-bottom:18px;">
      <span style="font-size:19px;font-weight:800;color:#1B2130;">Medha<span style="color:#2554C7;">IQ</span></span>
      <span style="color:#64748B;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-left:8px;">Career Intelligence Report</span>
    </div>
    <div style="font-size:12px;color:#64748B;margin-bottom:14px;">${personaName || 'Expert Interviewer'} &nbsp;·&nbsp; ${role}</div>
    <div style="display:flex;align-items:baseline;gap:10px;">
      <span style="font-size:44px;font-weight:800;color:#1B2130;line-height:1;">${score}</span>
      <span style="color:#64748B;font-size:14px;font-weight:600;">/100</span>
      <span style="display:inline-block;background:${recBg};color:${recColor};font-size:11px;font-weight:700;padding:4px 11px;border-radius:20px;margin-left:6px;">${rec}</span>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:32px 40px;">

    <p style="color:#3A4150;font-size:14px;line-height:1.7;margin:0 0 26px;">
      Hi ${name}, your MedhaIQ interview session is complete. Here is your Career Intelligence Report.
    </p>

    <!-- 5-Vector Profile — locked terminology, same as the live interview,
         Web Report, and PDF. Values come ONLY from cir.fiveVectors. -->
    <div style="margin-bottom:26px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2554C7;margin-bottom:12px;">5-Vector Profile</div>
      <table style="width:100%;border-collapse:collapse;">
        ${vectorRow('Structure', cir.fiveVectors.structure)}
        ${vectorRow('Domain Expertise', cir.fiveVectors.domainExpertise)}
        ${vectorRow('Strategic Thinking', cir.fiveVectors.strategicThinking)}
        ${vectorRow('Communication', cir.fiveVectors.communication)}
        ${vectorRow('Leadership &amp; Execution', cir.fiveVectors.leadershipExecution)}
      </table>
    </div>

    <!-- Strongest Signal / Priority — ranked from the real five-vector
         data (cir.strengths / cir.developmentPriorities), not the legacy
         strengths_json/improvements_json (confirmed to be the same
         underlying array under two labels). Honest insufficient-evidence
         text when even the top vector is below the low-evidence ceiling. -->
    <div style="margin-bottom:22px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#0F7B4E;margin-bottom:6px;">Strongest Signal</div>
      <p style="color:#3A4150;font-size:13px;line-height:1.6;margin:0;">${strongestSignalText}</p>
    </div>

    <div style="margin-bottom:22px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9A5B14;margin-bottom:6px;">Priority</div>
      <p style="color:#3A4150;font-size:13px;line-height:1.6;margin:0;">${priorityText}</p>
    </div>

    <div style="margin-bottom:26px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2554C7;margin-bottom:6px;">STAR Signal</div>
      <p style="color:#3A4150;font-size:13px;line-height:1.6;margin:0;">${starLine}</p>
    </div>

    <!-- Executive Summary — existing report narrative, unchanged. -->
    <div style="background:#F7F8FA;border:1px solid #E3E6EC;border-left:3px solid #2554C7;border-radius:8px;padding:18px;margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2554C7;margin-bottom:8px;">Executive Summary</div>
      <p style="color:#3A4150;font-size:13px;line-height:1.7;margin:0;">${cir.executiveSummary || 'Your interview session has been evaluated across the five MedhaIQ Career Intelligence vectors.'}</p>
    </div>

    <!-- CTA -->
    <div style="text-align:center;padding:8px 0 4px;">
      <a href="${url}" style="display:inline-block;background:#2554C7;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:14px;font-weight:700;">View Your Full Career Intelligence Report &rarr;</a>
      <p style="color:#9AA3B2;font-size:11px;margin-top:14px;word-break:break-all;">${url}</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="border-top:1px solid #E3E6EC;padding:16px 40px;text-align:center;">
    <p style="color:#9AA3B2;margin:0;font-size:11px;">MedhaIQ &nbsp;·&nbsp; AI-Powered Career Intelligence &nbsp;·&nbsp; <a href="${APP_URL}" style="color:#2554C7;text-decoration:none;">medhaiq.ai</a></p>
  </div>

</div>
</body></html>`;

  await _send({ to: toEmail, subject, html });
}

module.exports = { sendMagicLinkEmail, sendVerificationEmail, sendInterviewReportEmail };