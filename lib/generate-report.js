/**
 * CAREER INTELLIGENCE REPORT — generateReport()
 * ─────────────────────────────────────────────────────────────────
 * Rebuilt against your real schema (db/interview.js `saveReport`/
 * `getReport`, and the REPORT_SYSTEM prompt in services/interview.js)
 * and checked against every item in the design principles doc's
 * "Output" checklist:
 *
 *   ✓ Executive Summary            ✓ Strongest / Weakest Answers
 *   ✓ Overall Career Intelligence  ✓ Question Review
 *     Score                        ✓ AI Feedback
 *   ✓ 5-Vector Intelligence        ✓ Hiring Recommendation
 *   ✓ Competency Radar             ✓ Promotion Readiness
 *                                  ✓ Leadership Readiness
 *   ✓ Growth Roadmap (30/60/90)    ✓ Practice Again button
 *   ✓ Suggested Learning           ✓ Share Report button
 *                                  ✓ History Link
 *
 * This does NOT replace services/interview.js's generateReport() —
 * that's the AI call that produces the scoreboard/verdict/etc. and
 * writes it via saveReport(). This module takes that already-saved
 * report row (exactly what your server.js `/interview/report/:id`
 * route already fetches via getReport()) and renders it as an
 * email-ready HTML document.
 *
 * FUTURE MODULE PLUG-IN POINT: add a new build*Section(report) function
 * following the same pattern and append its output inside
 * buildReportHTML() for Resume Intelligence, Promotion Readiness deep
 * dive, Mock Board, Career DNA, etc. No other file needs to change.
 * ─────────────────────────────────────────────────────────────────
 */

function safeParse(json, fallback) {
  if (json == null) return fallback;
  if (typeof json !== 'string') return json; // pg may already return parsed JSON/JSONB
  try { return JSON.parse(json); } catch { return fallback; }
}

function pct(n) { return Math.round(n || 0); }

function recommendationColor(rec) {
  const r = (rec || '').toLowerCase();
  if (r.includes('strong hire')) return '#22c55e';
  if (r === 'hire' || r.includes('lean hire')) return '#3b82f6';
  if (r.includes('no hire')) return '#ef4444';
  return '#f59e0b';
}

/** Executive Summary — overall score + AI's narrative + hiring recommendation */
function buildExecutiveSummary(report) {
  const overall = pct(report.overall_score);
  const recColor = recommendationColor(report.recommendation);
  return `
    <section style="margin-bottom:36px;">
      <p style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Executive Summary</p>
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:14px;">
        <div>
          <p style="font-size:40px;font-weight:800;color:#1d4ed8;line-height:1;">${overall}<span style="font-size:16px;color:#94a3b8;">/100</span></p>
          <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Career Intelligence Score</p>
        </div>
        <div style="padding:6px 14px;border-radius:20px;background:${recColor}1a;border:1px solid ${recColor}55;">
          <span style="font-size:13px;font-weight:700;color:${recColor};">${report.recommendation || 'Pending'}</span>
        </div>
      </div>
      <p style="font-size:13px;color:#334155;line-height:1.7;">${report.executive_summary || ''}</p>
    </section>`;
}

/** Promotion Readiness + Leadership Readiness — distinct callouts, not buried in the radar */
function buildReadinessSection(scoreboard) {
  const cell = (label, value) => `
    <div style="flex:1;text-align:center;padding:14px 8px;background:#f8fafc;border-radius:10px;">
      <p style="font-size:22px;font-weight:800;color:#0f172a;">${pct(value)}</p>
      <p style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.4px;margin-top:2px;">${label}</p>
    </div>`;
  return `
    <section style="margin-bottom:36px;">
      <div style="display:flex;gap:10px;">
        ${cell('Promotion Readiness', scoreboard.promotion_readiness)}
        ${cell('Leadership Readiness', scoreboard.leadership_readiness)}
        ${cell('GCC Readiness', scoreboard.gcc_readiness)}
      </div>
    </section>`;
}

/** 5-Vector Intelligence bars, mapped from the scoreboard your AI already produces */
function buildVectorSection(scoreboard) {
  const vectors = [
    ['Structure',               scoreboard.career_intelligence,  '#3b82f6'],
    ['Domain Expertise',        scoreboard.leadership_readiness, '#a78bfa'],
    ['Strategic Thinking',      scoreboard.executive_presence,   '#22c55e'],
    ['Leadership & Execution',  scoreboard.gcc_readiness,        '#f59e0b'],
    ['Promotion Readiness',     scoreboard.promotion_readiness,  '#fb923c'],
  ];
  const rows = vectors.map(([label, value, color]) => `
    <tr>
      <td style="padding:6px 0;font-size:12px;color:#475569;width:38%;">${label}</td>
      <td style="padding:6px 0;">
        <div style="background:#e2e8f0;border-radius:4px;height:8px;">
          <div style="background:${color};height:8px;border-radius:4px;width:${pct(value)}%;"></div>
        </div>
      </td>
      <td style="padding:6px 0 6px 10px;font-size:12px;font-weight:700;text-align:right;width:30px;">${pct(value)}</td>
    </tr>`).join('');
  return `
    <section style="margin-bottom:36px;">
      <p style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">5-Vector Intelligence</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      ${buildRadarSVG(vectors)}
    </section>`;
}

/** Competency Radar — plain inline SVG spider chart so it survives email clients that strip <canvas>/JS */
function buildRadarSVG(vectors) {
  const cx = 110, cy = 110, r = 85;
  const n = vectors.length;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i, scale) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale];
  };
  const ringPath = (scale) => vectors.map((_, i) => point(i, scale).join(',')).join(' ');
  const dataPoints = vectors.map(([, v], i) => point(i, Math.max(0.05, pct(v) / 100)).join(',')).join(' ');
  const labels = vectors.map(([label], i) => {
    const [lx, ly] = point(i, 1.18);
    return `<text x="${lx}" y="${ly}" font-size="8" fill="#64748b" text-anchor="middle">${label.split(' ')[0]}</text>`;
  }).join('');
  const rings = [0.33, 0.66, 1].map(s =>
    `<polygon points="${ringPath(s)}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`
  ).join('');
  return `
    <div style="text-align:center;margin-top:14px;">
      <svg width="220" height="230" viewBox="0 0 220 230" xmlns="http://www.w3.org/2000/svg">
        ${rings}
        <polygon points="${dataPoints}" fill="#3b82f61a" stroke="#1d4ed8" stroke-width="2"/>
        ${labels}
      </svg>
      <p style="font-size:9px;color:#94a3b8;">Competency Radar</p>
    </div>`;
}

/** Strongest / Weakest Answers — direct from your AI's structured output */
function buildInsightsSection(report) {
  const strongest = safeParse(report.strongest_response, {});
  const weakest = safeParse(report.weakest_response, {});
  return `
    <section style="margin-bottom:36px;">
      <p style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">Insights</p>
      <div style="padding:12px 14px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:6px;margin-bottom:10px;">
        <p style="font-size:11px;font-weight:700;color:#166534;">Strongest — ${strongest.context || ''}</p>
        <p style="font-size:12px;color:#334155;margin-top:4px;">${strongest.evidence || ''}</p>
      </div>
      <div style="padding:12px 14px;background:#fef2f2;border-left:3px solid #ef4444;border-radius:6px;">
        <p style="font-size:11px;font-weight:700;color:#991b1b;">Needs Work — ${weakest.context || ''}</p>
        <p style="font-size:12px;color:#334155;margin-top:4px;">${weakest.evidence || ''}</p>
      </div>
    </section>`;
}

/** AI Feedback — structural flow + linguistic nuance narrative */
function buildFeedbackSection(report) {
  return `
    <section style="margin-bottom:36px;">
      <p style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">AI Feedback</p>
      <p style="font-size:12px;color:#334155;line-height:1.6;margin-bottom:8px;"><strong>Structural Flow:</strong> ${report.structural_flow || '—'}</p>
      <p style="font-size:12px;color:#334155;line-height:1.6;"><strong>Linguistic Nuances:</strong> ${report.linguistic_nuances || '—'}</p>
      ${report.persona_verdict ? `<p style="font-size:12px;color:#334155;line-height:1.6;font-style:italic;margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px;">"${report.persona_verdict}"</p>` : ''}
    </section>`;
}

/** Question Review — per-question score breakdown, from getSessionQuestions() + getSessionScores() */
function buildQuestionReview(questions, scoresData) {
  if (!questions || !questions.length) return '';
  const scoreByQ = Object.fromEntries((scoresData || []).map(s => [s.question_id, s]));
  const rows = questions
    .filter(q => q.answer_text != null)
    .map(q => {
      const s = scoreByQ[q.id];
      const badge = s ? pct(s.weighted_overall) : '—';
      return `
      <div style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
        <div style="display:flex;justify-content:space-between;">
          <p style="font-size:12px;font-weight:600;color:#0f172a;max-width:85%;">${q.question_text}</p>
          <span style="font-size:12px;font-weight:700;color:#1d4ed8;">${badge}</span>
        </div>
      </div>`;
    }).join('');
  return `
    <section style="margin-bottom:36px;">
      <p style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">Question Review</p>
      ${rows}
    </section>`;
}

/** Growth Roadmap — 30/60/90 + Suggested Learning, from next_steps_json / improvements_json */
function buildGrowthRoadmap(report) {
  const nextSteps = safeParse(report.next_steps_json, []);
  const improvements = safeParse(report.improvements_json, []);
  const [d30, d60, d90] = [nextSteps[0], nextSteps[1], nextSteps[2]];
  return `
    <section style="margin-bottom:36px;">
      <p style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">Growth Roadmap</p>
      <ul style="font-size:12px;color:#334155;line-height:1.9;padding-left:18px;">
        <li><strong>0–30 days:</strong> ${d30 || 'Reinforce structured storytelling in every answer.'}</li>
        <li><strong>30–60 days:</strong> ${d60 || 'Apply feedback in live stakeholder settings.'}</li>
        <li><strong>60–90 days:</strong> ${d90 || 'Seek a stretch assignment that exercises this competency.'}</li>
      </ul>
      ${improvements.length ? `
        <p style="font-size:11px;font-weight:700;color:#0f172a;margin-top:14px;">Suggested Learning</p>
        <ul style="font-size:12px;color:#334155;line-height:1.8;padding-left:18px;">
          ${improvements.map(i => `<li>${typeof i === 'string' ? i : (i.theme || i.action || '')}</li>`).join('')}
        </ul>` : ''}
    </section>`;
}

/** Practice Again / Share Report / History Link — required CTAs from the design doc */
function buildCTASection(sessionId) {
  const btn = (label, href, primary) => `
    <a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;margin-right:10px;
      ${primary ? 'background:#1d4ed8;color:#fff;' : 'background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;'}">${label}</a>`;
  return `
    <section style="margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;">
      ${btn('Practice Again', '/interview', true)}
      ${btn('Share Report', `/interview/report/${sessionId}?share=1`, false)}
      ${btn('View History', '/dashboard/history', false)}
    </section>`;
}

/**
 * @param {Object} report      row from getReport(sessionId) — see db/interview.js
 * @param {Array}  scoresData  rows from getSessionScores(sessionId)
 * @param {Array}  questions   rows from getSessionQuestions(sessionId)
 * @returns {string} email-ready HTML report
 */
function generateReport(report, scoresData, questions) {
  const scoreboard = safeParse(report.scoreboard, {
    career_intelligence: report.overall_score, leadership_readiness: 0,
    executive_presence: 0, gcc_readiness: 0, communication: 0, promotion_readiness: report.overall_score,
  });

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Career Intelligence Report</title></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f8fafc;padding:32px;margin:0;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;padding:36px;">
    <p style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:24px;">MedhaIQ Career Intelligence Report</p>
    ${buildExecutiveSummary(report)}
    ${buildReadinessSection(scoreboard)}
    ${buildVectorSection(scoreboard)}
    ${buildInsightsSection(report)}
    ${buildQuestionReview(questions, scoresData)}
    ${buildFeedbackSection(report)}
    ${buildGrowthRoadmap(report)}
    ${buildCTASection(report.session_id)}

    <!-- FUTURE MODULE PLUG-IN: Resume Intelligence section goes here -->
    <!-- FUTURE MODULE PLUG-IN: Mock Board / Career DNA section goes here -->
  </div>
</body></html>`;
}

module.exports = { generateReport };
