// services/pdf-report.js
//
// Converts a rendered HTML string (see views/interview-report-pdf.ejs) into
// a PDF buffer using Puppeteer. This module owns ONLY the HTML-to-PDF
// conversion — it doesn't know about sessions, scores, or reports. All of
// that data assembly happens in the route (server.js), which renders the
// EJS template to an HTML string and passes it in here.
//
// Deliberately reuses ONE browser instance across requests instead of
// launching a fresh Chromium process per PDF. Launching Chromium is slow
// (roughly 1-2s) and memory-heavy; for a low-traffic app this keeps things
// fast and avoids piling up processes under load.

const puppeteer = require('puppeteer');

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Chromium uses /dev/shm for shared memory by default. Most
        // containerized hosts (Render, Docker, etc.) allocate a very small
        // /dev/shm (often 64MB) — Chromium then crashes on launch or mid-
        // render with no useful error, which surfaces to the browser as a
        // dead connection ("Site wasn't available") rather than a normal
        // error page. This flag makes Chromium use /tmp instead, which is
        // not memory-constrained the same way. This is the single most
        // common fix for exactly this symptom on Render/Heroku/Docker.
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    browserPromise.then(browser => {
      browser.on('disconnected', () => { browserPromise = null; });
    }).catch(err => {
      // BUGFIX: if launch() itself fails (e.g. out of memory), the old code
      // left the REJECTED promise cached forever — every future request
      // would immediately fail with the same stale error until the server
      // was manually restarted, since there was no browser object to ever
      // emit 'disconnected'. Resetting here lets the next request retry.
      console.error('[pdf-report] Chromium launch failed:', err.message);
      browserPromise = null;
    });
  }
  return browserPromise;
}

/**
 * Renders an HTML string to a PDF buffer, US Letter size, matching the
 * @page rules already baked into interview-report-pdf.ejs.
 * @param {string} html - fully rendered HTML (e.g. from app.render()).
 * @returns {Promise<Buffer>}
 */
async function renderReportPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // networkidle0 waits for the Google Fonts request to finish loading
    // before the snapshot is taken, so text doesn't render in a fallback
    // font on the first paint.
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdfBuffer = await page.pdf({
      width: '8.5in',
      height: '11in',
      printBackground: true,     // required — otherwise the dark cover page prints white
      preferCSSPageSize: true,
    });
    return pdfBuffer;
  } finally {
    await page.close();
  }
}

module.exports = { renderReportPdf };
