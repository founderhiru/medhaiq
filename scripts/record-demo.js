#!/usr/bin/env node
// scripts/record-demo.js
//
// Records the "See How It Works" 60-second walkthrough by navigating a
// real Chromium instance through the real running MedhaIQ app, using
// Puppeteer's built-in screencast (WebM) — then converts the WebM to
// MP4 with the LOCAL ffmpeg binary. FFmpeg is a local recording
// prerequisite only: it is never added to package.json dependencies
// and is never invoked anywhere in the request-serving app itself.
//
// Usage:
//   npm run demo:record          (records WebM, then converts to MP4)
//   npm run demo:record:webm     (records WebM only)
//   npm run demo:convert         (converts an existing WebM to MP4)
//
// Prerequisites (local machine only):
//   - The app must already be running (npm start / npm run dev),
//     reachable at DEMO_BASE_URL (default http://localhost:3000).
//   - ffmpeg must be installed and on PATH. On a Mac, if missing:
//       brew install ffmpeg

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer');

// Puppeteer's ScreenRecorder pipes frames to an internal ffmpeg child
// process and closes that pipe once told to stop. In practice, once
// ffmpeg has already exited after receiving EOF, a trailing internal
// write can still land on the closed pipe and raise a raw, unlistened
// 'error' event -> an uncaught EPIPE that would otherwise kill the
// whole recording run even though the output file was already written
// successfully. This narrowly swallows ONLY that specific, benign,
// after-the-fact EPIPE; any other uncaught exception still crashes
// loudly as normal.
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') {
    console.warn('[demo:record] Ignoring benign EPIPE from ffmpeg pipe teardown (recording already completed).');
    return;
  }
  console.error('[demo:record] Uncaught exception:', err);
  process.exit(1);
});

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const WEBM_PATH = path.join(OUTPUT_DIR, 'demo-walkthrough.webm');
const MP4_PATH = path.join(OUTPUT_DIR, 'demo-walkthrough.mp4');
const VIEWPORT = { width: 1920, height: 1080 };

// The deterministic sequence and per-step dwell time (2026-08-24
// revision: explain-the-navigation objective, no simulated live
// interview). Sums to exactly 60s: 7+7+8+8+12+9+9.
const SEQUENCE = [
  { url: '/', dwellMs: 7000, label: 'Homepage' },
  {
    url: '/',
    dwellMs: 7000,
    label: 'Platform navigation menu (real header, real click)',
    // Opens the REAL "Platform" mega-menu on the real homepage header
    // by clicking its actual trigger button (#mh-platform-trigger,
    // views/partials/header.ejs) \u2014 not a mock/fake menu. No source
    // file is touched to do this; it's a real user interaction
    // performed by the recording script only.
    action: async (page) => {
      await page.waitForSelector('#mh-platform-trigger', { timeout: 5000 });
      // A direct DOM-level click (rather than Puppeteer's coordinate-
      // based synthetic mouse click) is used here deliberately: it's
      // unaffected by geometry/overlay edge cases and reliably fires
      // the real header's own click handler regardless of layout
      // timing right after navigation.
      await page.evaluate(() => document.getElementById('mh-platform-trigger').click());
      await page.waitForSelector('#mh-platform-wrap.mh-mega-open', { timeout: 5000 });
    },
  },
  { url: '/preview/interview', dwellMs: 8000, label: 'Interview Setup (real /preview route)' },
  { url: '/demo/scene/interview', dwellMs: 8000, label: 'Interview capabilities (static snapshot)' },
  { url: '/demo/scene/report', dwellMs: 12000, label: 'Interview Report (scripted)' },
  { url: '/preview/workspace', dwellMs: 9000, label: 'Career Intelligence (real /preview route)' },
  { url: '/demo/scene/end', dwellMs: 9000, label: 'Final CTA' },
];

function ffmpegAvailable() {
  const result = spawnSync('ffmpeg', ['-version']);
  return result.error === undefined || result.error === null;
}

async function injectRecordingHeartbeat(page) {
  // Chrome's CDP screencast (which Puppeteer's page.screencast() sits on
  // top of) only emits a frame on repaint. A page with zero ongoing
  // animation can legitimately emit just one frame for its entire dwell
  // time, which can stall the recorder's internal frame-pairing logic
  // on stop(). This injects a single, visually imperceptible (0.5px,
  // near-transparent) element that repaints on a fast interval so every
  // page in the sequence keeps producing a steady frame stream. It is
  // injected via page.evaluate() only for the lifetime of the recording
  // page instance \u2014 it never touches any page's actual source file.
  await page.evaluate(() => {
    if (document.getElementById('__demo_recording_heartbeat__')) return;
    var el = document.createElement('div');
    el.id = '__demo_recording_heartbeat__';
    el.style.cssText = 'position:fixed;bottom:0;right:0;width:2px;height:2px;pointer-events:none;z-index:99999;font-size:1px;color:transparent;';
    document.body.appendChild(el);
    var n = 0;
    setInterval(function () {
      el.textContent = String(n++);
    }, 100);
  });
}

async function record() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const segmentsDir = path.join(OUTPUT_DIR, '.segments');
  fs.mkdirSync(segmentsDir, { recursive: true });
  if (fs.existsSync(WEBM_PATH)) fs.unlinkSync(WEBM_PATH);

  console.log(`[demo:record] Launching Chromium at ${VIEWPORT.width}x${VIEWPORT.height}...`);
  let browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  });

  const segmentFiles = [];
  let stepIndex = 0;
  for (const step of SEQUENCE) {
    stepIndex += 1;
    const fullUrl = BASE_URL.replace(/\/$/, '') + step.url;
    const segmentPath = path.join(segmentsDir, `${String(stepIndex).padStart(2, '0')}.webm`);
    console.log(`[demo:record] -> ${step.label}: ${fullUrl} (${step.dwellMs}ms)`);
    // A fresh page (and therefore a fresh CDP session) per segment,
    // rather than reusing one page across multiple screencast
    // start/stop cycles \u2014 starting a new screencast session
    // immediately after a previous one just stopped, on the same CDP
    // session, was a source of an intermittent "Target closed"
    // protocol error during testing. Each segment attempt is also
    // isolated in its own try/catch so a single transient
    // page/browser crash doesn't abort the entire recording run \u2014
    // it retries once with a fresh browser instance instead.
    let recorded = false;
    for (let attempt = 1; attempt <= 2 && !recorded; attempt += 1) {
      try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await injectRecordingHeartbeat(page);
        const recorder = await page.screencast({ path: segmentPath });
        if (step.action) {
          // Show the closed/starting state briefly before performing
          // the action, so the action's effect (e.g. the menu opening)
          // is visible in the recording rather than already-applied
          // from the first frame.
          await new Promise((r) => setTimeout(r, 1500));
          await step.action(page);
          await new Promise((r) => setTimeout(r, Math.max(step.dwellMs - 1500, 0)));
        } else {
          await new Promise((r) => setTimeout(r, step.dwellMs));
        }
        await recorder.stop();
        await page.close();
        recorded = true;
      } catch (err) {
        console.warn(`[demo:record] Segment "${step.label}" attempt ${attempt} failed: ${err.message}`);
        if (attempt === 2) throw err;
        // Relaunch a fresh browser before retrying \u2014 the failure
        // mode observed here is the whole browser connection dying,
        // not just the one page.
        try { await browser.close(); } catch (_) { /* already dead */ }
        browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-dev-shm-usage', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
        });
      }
    }
    segmentFiles.push(segmentPath);
  }

  try { await browser.close(); } catch (_) { /* already dead */ }

  // Concatenate the per-scene segments into the single final WebM.
  const concatListPath = path.join(segmentsDir, 'concat-list.txt');
  fs.writeFileSync(
    concatListPath,
    segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
  );
  console.log('[demo:record] Concatenating scene segments with local ffmpeg...');
  const concatResult = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    WEBM_PATH,
  ], { stdio: 'inherit' });
  if (concatResult.status !== 0) {
    console.error('[demo:record] ffmpeg segment concatenation failed.');
    process.exit(1);
  }

  const totalMs = SEQUENCE.reduce((sum, s) => sum + s.dwellMs, 0);
  console.log(`[demo:record] Done. Captured ~${(totalMs / 1000).toFixed(1)}s of walkthrough to ${WEBM_PATH}`);
  return WEBM_PATH;
}

function convertToMp4() {
  if (!fs.existsSync(WEBM_PATH)) {
    console.error(`[demo:convert] No WebM found at ${WEBM_PATH}. Run npm run demo:record first.`);
    process.exit(1);
  }
  if (!ffmpegAvailable()) {
    console.error(
      '[demo:convert] ffmpeg was not found on PATH. This is a LOCAL recording prerequisite only ' +
      '(never added to the app\u2019s runtime dependencies or to Render).\n' +
      'On a Mac, install it with:\n  brew install ffmpeg'
    );
    process.exit(1);
  }

  console.log(`[demo:convert] Converting ${WEBM_PATH} -> ${MP4_PATH} with local ffmpeg...`);
  const result = spawnSync('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-i', WEBM_PATH,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    MP4_PATH,
  ], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error('[demo:convert] ffmpeg conversion failed.');
    process.exit(1);
  }
  console.log(`[demo:convert] Done. MP4 written to ${MP4_PATH}`);
  return MP4_PATH;
}

async function main() {
  const mode = process.argv[2] || 'all';
  if (mode === 'record') {
    await record();
  } else if (mode === 'convert') {
    convertToMp4();
  } else {
    await record();
    convertToMp4();
  }
}

main().catch((err) => {
  console.error('[demo:record] Failed:', err);
  process.exit(1);
});
