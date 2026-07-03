/**
 * CAREER INTELLIGENCE REPORT — generateReport()
 * ─────────────────────────────────────────────────────────────────
 * Module 2 of the Interview OS. Compiles a session's scored answers
 * into an email-ready HTML report: Executive Summary, 5-Vector +
 * Competency Radar, Insights, and a 30/60/90-day Growth Roadmap.
 *
 * This is a self-contained scaffold — it does not touch your DB
 * layer directly. Wire it up in your existing
 * app.get('/interview/report/:id', ...) route (server.js) by calling
 * generateReport(report, scoresData, persona) with the data you
 * already fetch there via getReport() / getSessionScores().
 *
 * FUTURE MODULE PLUG-IN POINT: to add "Resume Intelligence" or
 * "Promotion Readiness" as new report sections, add a function below
 * following the same (report, scoresData) -> htmlString pattern and
 * append its output inside buildReportHTML(). No other file needs
 * to change.
 * ─────────────────────────────────────────────────────────────────
 */

function avg(scoresData, key) {
  if (!scoresData.length) return 0;
  return scoresData.reduce((sum, s) => sum + parseFloat(s[key] || 0), 0) / scoresData.length;
}

function readinessLabel(score) {
  if (score >= 80) return 'High';
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Developing';
  return 'Early Stage';
}

/** Executive Summary — overall score + promotion/leadership readiness */
function buildExecutiveSummary(report, vectors) {
  const overall = Math.round(report.overall_score || 0);
  return `
    <section style="margin-bottom:32px;">
      <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:20px;color:#0f172a;">Executive Summary</h2>
      <p style="font-size:36px;font-weight:800;color:#1d4ed8;margin:8px 0;">${overall}<span style="font-size:16px;color:#64748b;">/100</span></p>
      <table style="width:100%;font-size:13px;color:#334155;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;">Promotion Readiness</td>
          <td style="text-align:right;font-weight:700;">${readinessLabel(vectors.executivePresence)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;">Leadership Potential</td>
          <td style="text-align:right;font-weight:700;">${readinessLabel(vectors.structure)}</td>
        </tr>
      </table>
    </section>`;
}

/** Performance — 5-Vector Intelligence + Competency Radar */
function buildPerformanceSection(vectors) {
  const rows = Object.entries(vectors).map(
    ([label, value]) => `
      <tr>
        <td style="padding:5px 0;font-size:12px;color:#475569;text-transform:capitalize;">${label.replace(/([A-Z])/g, ' $1')}</td>
        <td style="padding:5px 0;width:60%;">
          <div style="background:#e2e8f0;border-radius:4px;height:8px;">
            <div style="background:#1d4ed8;height:8px;border-radius:4px;width:${Math.round(value)}%;"></div>
          </div>
        </td>
        <td style="padding:5px 0 5px 8px;font-size:12px;font-weight:700;text-align:right;">${Math.round(value)}</td>
      </tr>`
  ).join('');
  return `
    <section style="margin-bottom:32px;">
      <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;color:#0f172a;">5-Vector Intelligence</h2>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">${rows}</table>
      <!-- Competency Radar (spider chart) is best rendered client-side or
           pre-rasterized to a PNG/SVG and inlined here for email clients
           that strip <svg>/<canvas>. Plug your chart renderer output in. -->
    </section>`;
}

/** Insights — strongest/weakest answers + AI feedback */
function buildInsightsSection(scoresData) {
  if (!scoresData.length) return '';
  const sorted = [...scoresData].sort((a, b) => (b.star_score || 0) - (a.star_score || 0));
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  return `
    <section style="margin-bottom:32px;">
      <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;color:#0f172a;">Insights</h2>
      <p style="font-size:13px;color:#334155;"><strong>Strongest answer:</strong> ${strongest?.question_text || '—'}</p>
      <p style="font-size:13px;color:#334155;"><strong>Needs work:</strong> ${weakest?.question_text || '—'}</p>
    </section>`;
}

/** Growth — 30/60/90-day roadmap + learning paths */
function buildGrowthRoadmap(vectors) {
  const focus = Object.entries(vectors).sort((a, b) => a[1] - b[1])[0]?.[0] || 'communicationClarity';
  return `
    <section style="margin-bottom:32px;">
      <h2 style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;color:#0f172a;">Growth Roadmap</h2>
      <ul style="font-size:13px;color:#334155;line-height:1.8;">
        <li><strong>0–30 days:</strong> Strengthen ${focus.replace(/([A-Z])/g, ' $1').toLowerCase()} through targeted practice.</li>
        <li><strong>30–60 days:</strong> Apply structured frameworks (STAR) consistently in live settings.</li>
        <li><strong>60–90 days:</strong> Seek stretch opportunities that exercise executive presence.</li>
      </ul>
    </section>`;
}

/**
 * @param {Object} report       row from getReport()
 * @param {Array}  scoresData   rows from getSessionScores()
 * @param {Object} persona      { name, title, org }
 * @returns {string} email-ready HTML report
 */
function generateReport(report, scoresData, persona) {
  const vectors = {
    structure: avg(scoresData, 'star_score'),
    technicalDepth: avg(scoresData, 'technical_depth'),
    executivePresence: avg(scoresData, 'executive_presence'),
    gccReadiness: avg(scoresData, 'gcc_readiness'),
    communicationClarity: avg(scoresData, 'core_friction'),
  };

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Career Intelligence Report</title></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f8fafc;padding:32px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <p style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">MedhaIQ Career Intelligence Report</p>
    ${buildExecutiveSummary(report, vectors)}
    ${buildPerformanceSection(vectors)}
    ${buildInsightsSection(scoresData)}
    ${buildGrowthRoadmap(vectors)}

    <!-- FUTURE MODULE PLUG-IN: Resume Intelligence section goes here -->
    <!-- FUTURE MODULE PLUG-IN: Mock Board / Promotion Readiness section goes here -->
  </div>
</body></html>`;
}

module.exports = { generateReport };
