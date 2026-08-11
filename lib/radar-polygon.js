// lib/radar-polygon.js
//
// Extracted from server.js (originally inline in the PDF/Web report
// routes) so routes/interview.js's Leadership PDF email-attachment flow
// can reuse the exact same geometry instead of duplicating it — same
// reasoning as the canonical CareerIntelligenceReport builder: one
// calculation, multiple consumers, not a copy that can drift.
//
// Pure function, no side effects, no I/O — safe to require from anywhere.

/**
 * @param {number[]} scores - [Structure, Technical, Executive, GCC, Communication]
 *   order must match the vector bar order the SVG expects. cx/cy/maxR match
 *   the SVG's own viewBox (300x290, center 150,150) in
 *   views/interview-report-pdf.ejs.
 */
function buildRadarPolygon(scores) {
  const cx = 150, cy = 150, maxR = 110;
  const points = scores.map((score, i) => {
    const angleRad = (-90 + 72 * i) * Math.PI / 180;
    const r = maxR * (Math.max(0, Math.min(100, score)) / 100);
    return {
      x: Math.round((cx + r * Math.cos(angleRad)) * 10) / 10,
      y: Math.round((cy + r * Math.sin(angleRad)) * 10) / 10,
    };
  });
  return { polygonPoints: points.map(p => `${p.x},${p.y}`).join(' '), points };
}

module.exports = { buildRadarPolygon };
