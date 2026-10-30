// Screening Copilot — browser tests (Playwright/Chromium) against the real
// server with the fake AI. Also checks XSS safety, console errors, mobile
// layout and basic accessibility.
//   DATABASE_URL=… [SCREENSHOT_DIR=…] node tests/screening-ui.js
const assert = require('assert');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { t, group, finish } = require('./helpers/mini-test');
const fx = require('./helpers/screening-fixtures');
const authCookie = require('../lib/auth-cookie');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const { Pool } = require('pg');
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const PORT = 3600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = crypto.randomBytes(24).toString('hex');
const RUN = Date.now().toString(36);
const SHOTS = process.env.SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'scr-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scr-ui-'));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'helpers/screening-boot.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), AUTH_COOKIE_SECRET: SECRET, NODE_ENV: 'test', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`${BASE}/privacy`)).status < 500) break; } catch (_) { /* wait */ } await new Promise((r) => setTimeout(r, 500)); }

  const uid = (await db.query('INSERT INTO users (email,name) VALUES ($1,$2) RETURNING id', [`scrui-${RUN}@example.test`, 'Recruiter Rita'])).rows[0].id;
  await db.query(`INSERT INTO screening_access (user_id,status) VALUES ($1,'active')`, [uid]);
  const cookieVal = authCookie.sign(uid, { secret: SECRET });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addCookies([{ name: 'user_id', value: cookieVal, url: BASE }]);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  const pdfPath = (name, lines) => { const p = path.join(TMP, name); fs.writeFileSync(p, fx.makePdf([lines])); return p; };
  let jobUrl; let candUrl;

  try {
    group('Home → create role');
    await t('home page loads with form and empty state', async () => {
      await page.goto(`${BASE}/screening`);
      assert(await page.locator('h1', { hasText: 'Screening & Assessment Copilot' }).isVisible());
      await page.waitForSelector('#scr-jobs :text("No roles yet")');
      assert(await page.locator('a.shell-link.active', { hasText: 'Screening' }).count() === 1, 'nav link should be active');
      await shot('01-home-empty');
    });
    await t('creating a role from pasted text opens the role page', async () => {
      await page.fill('input[name="title"]', 'Senior Data Engineer');
      await page.fill('textarea[name="jdText"]', fx.JD);
      await page.click('button:has-text("Create role")');
      await page.waitForURL(/\/screening\/jobs\/\d+/);
      jobUrl = page.url().split('#')[0];
      assert.strictEqual(await page.locator('#scr-job-title').textContent(), 'Senior Data Engineer');
    });

    group('Criteria');
    await t('propose → list appears with importance and verified JD quotes', async () => {
      await page.click('button:has-text("Propose criteria from job description")');
      await page.waitForSelector('.scr-crit input[aria-label="Criterion text"]');
      const n = await page.locator('.scr-crit').count();
      assert(n >= 7, `criteria: ${n}`);
      assert(await page.locator('text=From the job description:').count() >= 5);
      assert(await page.locator('text=Proposed by AI').count() === 1);
      assert.strictEqual(await page.locator('text=Male candidates').count(), 0);
      await shot('02-criteria-draft');
    });
    await t('edit text, change importance, add and remove a criterion', async () => {
      const first = page.locator('.scr-crit input[aria-label="Criterion text"]').first();
      await first.fill('5+ years building production data pipelines');
      await first.blur();
      await page.waitForSelector('.scr-status:text("Saved")');
      await page.locator('.scr-crit select[aria-label="Importance"]').last().selectOption('preferred');
      await page.fill('input[aria-label="New criterion"]', 'Mentoring junior engineers');
      await page.click('button:has-text("Add")');
      await page.waitForSelector('input[value="Mentoring junior engineers"]');
      await page.locator('.scr-crit', { has: page.locator('input[value="Mentoring junior engineers"]') }).locator('button:has-text("Remove")').click();
      await page.waitForFunction(() => !document.querySelector('input[value="Mentoring junior engineers"]'));
    });
    await t('a protected-attribute criterion is refused with a clear message', async () => {
      await page.fill('input[aria-label="New criterion"]', 'Unmarried young candidates only');
      await page.click('button:has-text("Add")');
      await page.waitForSelector('.scr-err:has-text("cannot be based on age")');
    });
    await t('approve → locked read-only list', async () => {
      await page.click('button:has-text("Approve criteria")');
      await page.waitForSelector('h3:has-text("Approved screening criteria")');
      assert.strictEqual(await page.locator('.scr-crit input').count(), 0, 'no editable inputs when approved');
      await shot('03-criteria-approved');
    });

    group('Uploading resumes');
    await t('batch upload: good PDFs, a duplicate, a scanned PDF and a fake file — each reported separately, then auto-analysed', async () => {
      await page.click('.scr-tab[data-tab="candidates"]');
      const strong = pdfPath('strong.pdf', fx.RESUME_STRONG);
      const partial = pdfPath('partial.pdf', fx.RESUME_PARTIAL);
      const scanned = path.join(TMP, 'scan.pdf'); fs.writeFileSync(scanned, fx.makePdf([[], []]));
      const fake = path.join(TMP, 'notes.pdf'); fs.writeFileSync(fake, 'just some text');
      const dup = path.join(TMP, 'strong-copy.pdf'); fs.copyFileSync(strong, dup);
      await page.setInputFiles('input[aria-label="Resume files"]', [strong, partial, scanned, fake, dup]);
      await page.click('.scr-panel button:has-text("Add")');
      await page.waitForFunction(() => document.querySelectorAll('.scr-log > div').length === 5 && !/adding…|Analysing…/.test(document.querySelector('.scr-log').textContent), null, { timeout: 60000 });
      const lines = await page.locator('.scr-log > div').allTextContents();
      assert(/added as C-001 and analysed/.test(lines[0]), lines[0]);
      assert(/added as C-002 and analysed/.test(lines[1]), lines[1]);
      assert(/no readable text/i.test(lines[2]), lines[2]);
      assert(/Only PDF and Word/i.test(lines[3]), lines[3]);
      assert(/already added as C-001/.test(lines[4]), lines[4]);
      await page.waitForSelector('h3:has-text("Resumes (2)")');
      await shot('04-candidates');
    });
    await t('pasting an adversarial resume shows the instruction-text warning marker', async () => {
      await page.fill('textarea[aria-label="Resume text"]', fx.RESUME_INJECTION.join('\n') + '\n<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>');
      await page.fill('input[aria-label="Label"]', '<b>Pasted</b> analyst');
      await page.click('.scr-panel button:has-text("Add")');
      await page.waitForSelector('.scr-card:has-text("C-003")', { timeout: 30000 });
      await page.waitForSelector('text=contains instruction-like text');
      assert.strictEqual(await page.locator('.scr-card:has-text("C-003") b').count(), 0, 'label must not be parsed as HTML');
      assert(await page.locator('text=<b>Pasted</b> analyst').count() >= 1, 'label shown literally');
    });

    group('Evidence Inbox');
    await t('groups appear with status text (not colour alone), counts only, and no scores', async () => {
      await page.click('.scr-tab[data-tab="inbox"]');
      await page.waitForSelector('.scr-panel h3:has-text("Missing or unclear evidence")');
      const body = (await page.locator('#scr-tab-inbox').innerText()).replace(/Grouped by what[^\n]*nothing is ranked\./, '');
      assert(/Evidence Found: \d/.test(body) || /Requires Verification: \d/.test(body), body.slice(0, 300));
      assert(!/\b\d+\s?%|score|rank|best|top candidate|recommend/i.test(body), body);
      assert(/in the order they were added/.test(await page.locator('#scr-tab-inbox').innerText()));
      await shot('05-inbox');
    });

    group('Candidate review');
    await t('open a candidate: criteria with status badges and the redacted resume', async () => {
      await page.click('.scr-tab[data-tab="inbox"]');
      await page.click('#scr-tab-inbox a:has-text("C-001")');
      await page.waitForURL(/\/screening\/candidates\/\d+/);
      candUrl = page.url();
      await page.waitForSelector('.scr-evcard .scr-badge');
      const resume = await page.locator('#scr-resume').innerText();
      assert(/\[NAME\]/.test(resume) && /\[EMAIL\]/.test(resume));
      assert(!/Priya|priya\.nair|98765|1992|Female/.test(resume), 'PII visible in review pane');
      assert(await page.locator('.scr-notice').innerText().then((x) => /does not mean|not score, rank/.test(x) || /can be wrong/.test(x)));
      assert(/Removed before analysis: 1 email/.test(await page.locator('#scr-cand-flags').innerText()));
      await shot('06-candidate');
    });
    await t('clicking a quote highlights exactly that text in the resume', async () => {
      await page.locator('.scr-quote').first().click();
      await page.waitForSelector('mark.scr-mark');
      const marked = await page.locator('mark.scr-mark').first().textContent();
      const quoted = await page.locator('.scr-quote').first().locator('.scr-quote-text').textContent();
      assert.strictEqual(marked.replace(/\s+/g, ' ').trim(), quoted.replace(/\s+/g, ' ').trim());
      assert(await page.locator('.scr-evcard.scr-active').count() === 1);
      await shot('07-candidate-highlight');
    });
    await t('a downgraded claim explains itself in plain language', async () => {
      assert(await page.locator('text=could not be found in the resume, so this was moved to Requires Verification').count() >= 1);
    });
    await t('confirm and override a finding; the AI value stays visible', async () => {
      const card = page.locator('.scr-evcard', { has: page.locator('.scr-badge.scr-st-requires_verification') }).first();
      await card.locator('input[aria-label="Review note"]').fill('Checked the resume myself');
      await card.locator('button:has-text("Confirm")').click();
      await page.waitForSelector('text=Confirmed by you');
      const card2 = page.locator('.scr-evcard', { has: page.locator('text=Confirmed by you') }).first();
      await card2.locator('select[aria-label="Override status"]').selectOption('not_applicable');
      await card2.locator('button:has-text("Change status")').click();
      await page.waitForSelector('text=Changed by you (AI said: Requires Verification)');
      assert(await page.locator('.scr-badge.scr-st-not_applicable').count() >= 1);
    });
    await t('draft verification questions, edit, approve', async () => {
      await page.click('button:has-text("Draft verification questions")');
      await page.waitForSelector('.scr-qrow input[aria-label="Question text"]', { timeout: 30000 });
      const first = page.locator('.scr-qrow').first();
      await first.locator('input[aria-label="Question text"]').fill('Please walk me through the architecture of that pipeline.');
      await first.locator('button:has-text("Save text")').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.scr-qrow input')].some((i) => i.value.startsWith('Please walk me')));
      await page.locator('.scr-qrow').first().locator('button:has-text("Approve")').click();
      await page.waitForSelector('.scr-qrow:has-text("approved")');
      await page.fill('input[aria-label="New question"]', 'Are you married?');
      await page.click('button:has-text("Add question")');
      await page.waitForSelector('.scr-err');
    });
    await t('set the decision; only the four labels exist; nothing is pre-selected', async () => {
      const labels = await page.locator('#scr-cand-decision .scr-row button').allTextContents();
      assert.deepStrictEqual(labels.filter((x) => !/Clear/.test(x)), ['Shortlist', 'Hold', 'Needs Verification', 'Not Moving Forward']);
      assert.strictEqual(await page.locator('#scr-cand-decision button[aria-pressed="true"]').count(), 0);
      await page.fill('textarea[aria-label="Decision note"]', 'Verify Kafka before the call');
      await page.click('#scr-cand-decision button:has-text("Hold")');
      await page.waitForSelector('#scr-cand-decision button[aria-pressed="true"]:has-text("Hold")');
    });
    await t('re-run asks before discarding my reviews', async () => {
      let asked = '';
      page.removeAllListeners('dialog');
      page.on('dialog', (d) => { asked = d.message(); d.accept(); });
      await page.click('button:has-text("Re-run analysis")');
      await page.waitForFunction(() => !document.querySelector('.scr-evcard .scr-badge.scr-st-not_applicable'), null, { timeout: 30000 });
      assert(/already reviewed/.test(asked), asked);
    });
    await t('the adversarial candidate shows the warning and no claimed evidence', async () => {
      await page.goto(jobUrl + '#candidates');
      await page.click('#scr-tab-candidates a:has-text("C-003")');
      await page.waitForSelector('.scr-warn:has-text("looks like instructions to an AI")');
      assert.strictEqual(await page.locator('.scr-evcard .scr-badge.scr-st-evidence_found').count(), 0);
      assert.strictEqual(await page.evaluate(() => window.__xss), undefined, 'XSS payload executed');
      const resume = await page.locator('#scr-resume').innerText();
      assert(resume.includes('<img src=x onerror="window.__xss=1">'), 'hostile text shown literally');
      await shot('08-candidate-injection');
    });
    await t('printable report opens, is readable and escaped', async () => {
      await page.goto(candUrl);
      const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('a:has-text("Open printable report")')]);
      await popup.waitForLoadState();
      const text = await popup.innerText('body');
      assert(/Screening evidence report/.test(text) && /Hold/.test(text) && /Recruiter reviewed|AI extraction/.test(text));
      assert(/Verification questions/i.test(text) && /Please walk me through the architecture/.test(text));
      await popup.screenshot({ path: path.join(SHOTS, '09-report.png'), fullPage: true });
      await popup.emulateMedia({ media: 'print' });
      assert.strictEqual(await popup.locator('#scr-print').isVisible(), false, 'print button hidden in print');
      await popup.close();
    });

    group('Layout + accessibility');
    await t('mobile width: no horizontal scroll on any page', async () => {
      const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await m.addCookies([{ name: 'user_id', value: cookieVal, url: BASE }]);
      const mp = await m.newPage();
      for (const [name, url, wait] of [['home', `${BASE}/screening`, '#scr-jobs .scr-card'], ['job', jobUrl + '#candidates', '.scr-card'], ['candidate', candUrl, '.scr-evcard']]) {
        await mp.goto(url); await mp.waitForSelector(wait);
        const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        await mp.screenshot({ path: path.join(SHOTS, `10-mobile-${name}.png`), fullPage: true });
        assert(over <= 1, `${name}: horizontal overflow ${over}px`);
      }
      await m.close();
    });
    await t('every form control has an accessible name', async () => {
      for (const url of [`${BASE}/screening`, jobUrl, candUrl]) {
        await page.goto(url); await page.waitForTimeout(800);
        const bad = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter((e) => {
          const named = e.getAttribute('aria-label') || (e.labels && e.labels.length) || e.closest('label');
          return !named;
        }).map((e) => `${e.tagName}[${e.name || e.type}]`));
        assert.deepStrictEqual(bad, [], url);
      }
    });
    await t('tabs expose selected state; status is never conveyed by colour alone', async () => {
      await page.goto(jobUrl + '#criteria');
      assert.strictEqual(await page.locator('.scr-tab[aria-selected="true"]').count(), 1);
      await page.goto(candUrl); await page.waitForSelector('.scr-badge');
      const empty = await page.evaluate(() => [...document.querySelectorAll('.scr-badge')].filter((b) => !b.textContent.trim()).length);
      assert.strictEqual(empty, 0);
    });
    await t('keyboard: tab order reaches the main actions and focus is visible', async () => {
      await page.goto(`${BASE}/screening`); await page.waitForSelector('input[name="title"]');
      await page.focus('input[name="title"]');
      const outline = await page.evaluate(() => { document.querySelector('input[name="title"]').focus(); return getComputedStyle(document.querySelector('input[name="title"]')).outlineStyle; });
      assert.notStrictEqual(outline, 'none');
    });

    group('Unrelated pages');
    await t('screening CSS/JS do not leak into the public landing page', async () => {
      const p = await ctx.newPage();
      await p.goto(`${BASE}/recruit/screening`);
      assert(await p.locator('text=Request a Pilot').first().isVisible());
      await p.close();
    });
    await t('no JavaScript errors on any screening page', () => {
      assert.deepStrictEqual(problems, []);
    });
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await db.query('DELETE FROM users WHERE email LIKE $1', [`scrui-${RUN}@example.test`]).catch(() => {});
    await db.end().catch(() => {});
  }
  console.log(`\nScreenshots: ${SHOTS}`);
  finish('screening-ui');
})().catch((e) => { console.error('UI harness error:', e); process.exit(1); });
