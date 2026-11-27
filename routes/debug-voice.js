// routes/debug-voice.js
//
// PR3 deliverable of the MedhaIQ Voice Platform Architecture v1.0
// (frozen), per the PR3 Integration Plan's closing recommendation.
//
// A hidden, founder/staff-only diagnostic page that exercises the full
// QuestionSpeechService -> ElevenLabsTTSAdapter -> BrowserAudioPlayer
// chain (Play/Stop/Pause/Resume, voice selection, arbitrary text) --
// the same construction path used by interview-session.ejs when
// VOICE_PLAYBACK_PROVIDER=tts_pipeline, so it doubles as both a fast
// "is voice broken" check and a live rehearsal of the exact PR3 wiring.
//
// Gated with the same requireFounder pattern already used by
// routes/founder.js -- never linked from any nav, GET only, no writes.

const express = require('express');
const router = express.Router();
const { getUserById } = require('../db/auth');
const { isFounder } = require('../db/founder-access');

async function requireFounder(req, res, next) {
  const userId = req.cookies?.user_id;
  if (!userId) return res.status(401).send('Authentication required');
  const user = await getUserById(userId);
  if (!user) return res.status(401).send('Session expired');
  const founder = await isFounder(user.id);
  if (!founder) return res.status(403).send('Forbidden');
  req.user = user;
  next();
}

router.get('/', requireFounder, (req, res) => {
  res.render('debug-voice', {
    // Same bridge pattern as interview-session.ejs -- browser-safe only,
    // never the server-side VOICE_SERVER_CONFIG.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Google TTS voice compare (staging migration, 2026-11-27) -- TEMPORARY.
//
// Founder-only (same requireFounder gate as above). Lets the founder audition
// the Google Chirp 3 HD and WaveNet candidates per persona BY EAR and see real
// round-trip latency, before any voice is locked in. Independent of the
// TTS_PROVIDER flag (works while ElevenLabs is still the live default) but
// needs GOOGLE_TTS_SERVICE_ACCOUNT_JSON. Synthesis is on-demand, one voice per
// click, whitelisted to the candidate list below (no free-form voice names),
// so it cannot be used to burn quota arbitrarily. Each click is recorded in
// tts_usage_log with source='debug-compare'.
// DELETE this block once voices are chosen.
// ═══════════════════════════════════════════════════════════════════════════
const { GOOGLE_VOICES, GOOGLE_COMPARE_EXTRAS } = require('../config/voice-profiles');
const { VOICE_SERVER_CONFIG } = require('../config/voice-server-config');
const googleTts = require('../services/google-tts-provider');
const { normalizeSpokenCurrency } = require('../services/voice-tts-proxy');
const { recordTtsUsage } = require('../lib/tts-usage-recorder');

const COMPARE_PERSONAS = [
  ['alex', 'Alex Chen — Senior Principal Engineer (AWS)'],
  ['priya', 'Priya Ramesh — Partner (McKinsey)'],
  ['marcus', 'Marcus Webb — VP Product'],
  ['sanjeev', 'Sanjeev Nair — Engineering Director'],
  ['sarah', 'Sarah Kim — CEO, early-stage startup'],
  ['raj', 'Raj Mehta — Global Director (GCC)'],
];
const COMPARE_SAMPLES = [
  'Tell me about a time you led a project through real ambiguity, and what you personally decided.',
  'During that $25M engagement, what was the single metric you were accountable for, and how did it move?',
  'Thank you. That completes your interview. I will prepare your report now.',
];

// Flat whitelist: id -> voice descriptor. Built once from config.
const COMPARE_VOICES = [];
COMPARE_PERSONAS.forEach(([key]) => {
  ['chirp3hd', 'wavenet'].forEach((tier) => {
    const v = GOOGLE_VOICES[key][tier];
    COMPARE_VOICES.push({ tier, languageCode: v.languageCode, name: v.name, gender: v.gender, persona: key });
  });
});
GOOGLE_COMPARE_EXTRAS.forEach((v) => COMPARE_VOICES.push({ tier: v.tier, languageCode: v.languageCode, name: v.name, gender: v.gender, persona: null }));

// Accent-blend AUDITION (Gemini TTS). Google's en-IN / en-US voices are
// all-or-nothing accents; a "60% Indian / 40% American" blend can only be
// attempted by steering a Gemini TTS voice with a text prompt. How closely it
// follows such an instruction is NOT documented -- hence audition-only, with
// editable prompts, and never wired into live interviews from here.
// Usage is NOT written to tts_usage_log: Gemini TTS is billed per token and
// its rate has not been verified, so no cost is invented. Logged only.
const GEMINI_MODEL = 'gemini-2.5-flash-tts';
const PROMPT_SANJEEV = 'Speak as a senior engineering director: a calm, measured, professional voice. Use an English accent that is about 60% Indian English (Indian rhythm, intonation and vowel sounds) blended with about 40% American English. Pace slightly slower than normal conversation.';
const PROMPT_RAJ = 'Speak as a polished global executive: confident, composed, with executive presence. Use an English accent that is about 70% American English blended with about 30% Indian English (a light Indian lilt in rhythm and some vowels). Pace slightly slower than normal conversation.';
const GEMINI_EXPERIMENTS = [
  { label: 'Sanjeev — 60% Indian / 40% American (base accent en-IN)', languageCode: 'en-IN', name: 'Iapetus', prompt: PROMPT_SANJEEV },
  { label: 'Sanjeev — same prompt, different base (en-US)', languageCode: 'en-US', name: 'Iapetus', prompt: PROMPT_SANJEEV },
  { label: 'Raj — 70% American / 30% Indian (base accent en-US)', languageCode: 'en-US', name: 'Sadaltager', prompt: PROMPT_RAJ },
  { label: 'Raj — same prompt, different base (en-IN)', languageCode: 'en-IN', name: 'Sadaltager', prompt: PROMPT_RAJ },
];

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

router.get('/compare', requireFounder, (req, res) => {
  const rowsFor = (filter) => COMPARE_VOICES
    .map((v, id) => ({ v, id }))
    .filter(({ v }) => filter(v))
    .map(({ v, id }) => `<tr>
      <td>${escHtml(v.name)}</td><td>${escHtml(v.gender)}</td><td>${escHtml(v.languageCode)}</td>
      <td>${v.tier === 'chirp3hd' ? 'Chirp 3 HD ($30/1M)' : 'WaveNet ($4/1M)'}</td>
      <td><button data-id="${id}">▶ Play</button> <span class="m" id="m${id}"></span></td></tr>`).join('');
  const personaBlocks = COMPARE_PERSONAS.map(([key, label]) => `
    <h3>${escHtml(label)}</h3>
    <table><tr><th>Voice</th><th>Gender</th><th>Accent</th><th>Tier</th><th>Audition</th></tr>${rowsFor((v) => v.persona === key)}</table>`).join('');
  const sampleOpts = COMPARE_SAMPLES.map((s, i) => `<option value="${i}">${escHtml(s)}</option>`).join('');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google TTS voice compare (staging)</title>
<style>body{font:15px system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}
table{border-collapse:collapse;width:100%;margin-bottom:8px}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}
th{background:#f5f5f5}button{padding:4px 10px;cursor:pointer}.m{color:#555;font-size:13px}select{width:100%;padding:6px}
.note{background:#fff8e1;border:1px solid #f0d27a;padding:10px;border-radius:6px}</style></head><body>
<h2>Google TTS voice compare</h2>
<p class="note">Founder-only, temporary. Each Play = one synthesis (counts toward the free allowance). Pace is the live setting (speakingRate ${escHtml(VOICE_SERVER_CONFIG.ttsSpeed)}). Latency shown is the full server round-trip to first playable audio, measured from this browser.</p>
<p><b>Sample sentence</b><br><select id="sample">${sampleOpts}</select></p>
${personaBlocks}
<h3>Accent-blend experiments — Gemini TTS (Sanjeev &amp; Raj)</h3>
<p class="note">Google's standard voices cannot blend accents. These use a Gemini voice steered by a text prompt, so the blend is approximate and not guaranteed. Edit the prompt and press Play again to tune it. Pace is steered by the prompt here (not the 0.90 setting). Not billed through the cost ledger yet (per-token pricing unverified).</p>
<table>${GEMINI_EXPERIMENTS.map((g, i) => `<tr><td style="width:34%"><b>${escHtml(g.label)}</b><br><span class="m">${escHtml(GEMINI_MODEL)} · ${escHtml(g.name)} · ${escHtml(g.languageCode)}</span></td>
<td><textarea id="gp${i}" rows="4" style="width:100%" maxlength="500">${escHtml(g.prompt)}</textarea></td>
<td><button data-g="${i}">▶ Play</button><br><span class="m" id="gm${i}"></span></td></tr>`).join('')}</table>
<h3>Extra candidates (not used by any persona yet)</h3>
<table><tr><th>Voice</th><th>Gender</th><th>Accent</th><th>Tier</th><th>Audition</th></tr>${rowsFor((v) => v.persona === null)}</table>
<audio id="player"></audio>
<script>
document.querySelectorAll('button[data-id]').forEach(function(b){
  b.addEventListener('click', function(){
    var id=b.getAttribute('data-id'), m=document.getElementById('m'+id), t0=performance.now();
    m.textContent='synthesizing…'; b.disabled=true;
    fetch('/debug/voice/compare/audio?id='+id+'&sample='+document.getElementById('sample').value,{credentials:'same-origin'})
      .then(function(r){ if(!r.ok) return r.json().then(function(j){throw new Error(j.error||r.status)}); return r.blob(); })
      .then(function(blob){
        var ms=Math.round(performance.now()-t0);
        m.textContent=ms+' ms, '+Math.round(blob.size/1024)+' KB';
        var p=document.getElementById('player'); p.src=URL.createObjectURL(blob); return p.play();
      })
      .catch(function(e){ m.textContent='error: '+e.message; })
      .finally(function(){ b.disabled=false; });
  });
});
document.querySelectorAll('button[data-g]').forEach(function(b){
  b.addEventListener('click', function(){
    var i=b.getAttribute('data-g'), m=document.getElementById('gm'+i), t0=performance.now();
    m.textContent='synthesizing…'; b.disabled=true;
    fetch('/debug/voice/compare/gemini?i='+i+'&sample='+document.getElementById('sample').value+'&prompt='+encodeURIComponent(document.getElementById('gp'+i).value),{credentials:'same-origin'})
      .then(function(r){ if(!r.ok) return r.json().then(function(j){throw new Error(j.error||r.status)}); return r.blob(); })
      .then(function(blob){
        m.textContent=Math.round(performance.now()-t0)+' ms, '+Math.round(blob.size/1024)+' KB';
        var p=document.getElementById('player'); p.src=URL.createObjectURL(blob); return p.play();
      })
      .catch(function(e){ m.textContent='error: '+e.message; })
      .finally(function(){ b.disabled=false; });
  });
});
</script></body></html>`);
});

router.get('/compare/gemini', requireFounder, async (req, res) => {
  const i = parseInt(req.query.i, 10);
  const sampleIdx = parseInt(req.query.sample, 10) || 0;
  const exp = GEMINI_EXPERIMENTS[i];
  const sample = COMPARE_SAMPLES[sampleIdx];
  const prompt = typeof req.query.prompt === 'string' ? req.query.prompt.slice(0, 500) : exp && exp.prompt;
  if (!exp || !sample) return res.status(400).json({ error: 'unknown experiment or sample' });
  const startedAt = Date.now();
  try {
    const result = await googleTts.synthesize({
      text: normalizeSpokenCurrency(sample), languageCode: exp.languageCode, voiceName: exp.name,
      modelName: GEMINI_MODEL, prompt,
    });
    console.log('[TTS][debug-compare] gemini audition ' + JSON.stringify({ experiment: i, characters: result.characters, elapsedMs: Date.now() - startedAt }));
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'no-store');
    res.send(result.buffer);
  } catch (err) {
    res.status(err.code === 'TIMEOUT' ? 504 : 502).json({ error: err.message, code: err.code || 'UNKNOWN' });
  }
});

router.get('/compare/audio', requireFounder, async (req, res) => {
  const id = parseInt(req.query.id, 10);
  const sampleIdx = parseInt(req.query.sample, 10) || 0;
  const voice = COMPARE_VOICES[id];
  const sample = COMPARE_SAMPLES[sampleIdx];
  if (!voice || !sample) return res.status(400).json({ error: 'unknown voice or sample' });
  const startedAt = Date.now();
  try {
    const spoken = normalizeSpokenCurrency(sample);
    const result = await googleTts.synthesize({
      text: spoken, languageCode: voice.languageCode, voiceName: voice.name, speakingRate: VOICE_SERVER_CONFIG.ttsSpeed,
    });
    recordTtsUsage({
      voiceTier: voice.tier, voiceName: voice.name, languageCode: voice.languageCode,
      source: 'debug-compare', userId: req.user && req.user.id, characters: result.characters, latencyMs: Date.now() - startedAt,
    });
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'no-store');
    res.send(result.buffer);
  } catch (err) {
    res.status(err.code === 'TIMEOUT' ? 504 : 502).json({ error: err.message, code: err.code || 'UNKNOWN' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Google TTS usage + cost monitor (2026-11-27). PERMANENT, read-only.
//
// GET /debug/voice/usage  (founder-only, same requireFounder gate as above)
// Reads ONLY tts_usage_log (migration 037) -- never writes, never calls
// Google, never touches interview/session/scoring tables. Safe to open
// anytime; it cannot spend quota. Auto-refreshes every 60s.
//
// What it shows:
//   * Month-to-date characters per voice tier vs the monthly free allowance
//   * List-price cost (no free tier) and EXPECTED billed cost (after free tier)
//   * Live interviews vs founder test clicks (debug-compare), so tests are visible
//   * Per-persona voice breakdown, 6-month history, and the last 15 calls
//
// Honesty note shown on the page: these are OUR tracked numbers. Google Cloud
// Billing is the only true actual, and Gemini audition usage is not tracked.
// Month boundary is UTC, matching lib/tts-usage-recorder.js.
// ═══════════════════════════════════════════════════════════════════════════
const { RATES_PER_CHAR_USD, FREE_ALLOWANCE_CHARS } = require('../lib/tts-usage-recorder');

const MONTH_START_SQL = `date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
const TIER_LABEL = { chirp3hd: 'Chirp 3 HD', wavenet: 'WaveNet' };

function fmtInt(n) { return Number(n || 0).toLocaleString('en-US'); }
function fmtUsd(n) {
  const v = Number(n || 0);
  return '$' + (Math.abs(v) < 1 ? v.toFixed(4) : v.toFixed(2));
}
function fmtInr(usd, rate) {
  const v = Number(usd || 0) * rate;
  return '₹' + (Math.abs(v) < 100 ? v.toFixed(2) : Math.round(v).toLocaleString('en-IN'));
}

async function loadUsage() {
  const { pool } = require('../db/index'); // lazy, same as the recorder
  const run = (sql) => pool.query(sql).then((r) => r.rows);
  const [tiers, bySource, byVoice, history, recent] = await Promise.all([
    run(`SELECT voice_tier,
                COUNT(*)::int AS calls,
                COALESCE(SUM(characters),0)::bigint AS chars,
                COALESCE(SUM(estimated_list_cost_usd),0)::numeric AS list_usd,
                COALESCE(SUM(expected_billed_cost_usd),0)::numeric AS billed_usd,
                COALESCE(ROUND(AVG(latency_ms)),0)::int AS avg_ms
         FROM tts_usage_log
         WHERE provider = 'google' AND created_at >= ${MONTH_START_SQL}
         GROUP BY voice_tier`),
    run(`SELECT voice_tier, COALESCE(source,'interview') AS source,
                COUNT(*)::int AS calls, COALESCE(SUM(characters),0)::bigint AS chars
         FROM tts_usage_log
         WHERE provider = 'google' AND created_at >= ${MONTH_START_SQL}
         GROUP BY 1,2 ORDER BY 1,2`),
    run(`SELECT voice_tier, COALESCE(voice_name,'(unknown)') AS voice_name,
                COUNT(*)::int AS calls, COALESCE(SUM(characters),0)::bigint AS chars
         FROM tts_usage_log
         WHERE provider = 'google' AND created_at >= ${MONTH_START_SQL}
         GROUP BY 1,2 ORDER BY chars DESC LIMIT 20`),
    run(`SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC'),'YYYY-MM') AS month,
                voice_tier, COUNT(*)::int AS calls,
                COALESCE(SUM(characters),0)::bigint AS chars,
                COALESCE(SUM(estimated_list_cost_usd),0)::numeric AS list_usd,
                COALESCE(SUM(expected_billed_cost_usd),0)::numeric AS billed_usd
         FROM tts_usage_log
         WHERE provider = 'google'
           AND created_at >= (${MONTH_START_SQL}) - INTERVAL '5 months'
         GROUP BY 1,2 ORDER BY 1 DESC, 2`),
    run(`SELECT created_at, voice_tier, voice_name, COALESCE(source,'interview') AS source,
                characters, latency_ms
         FROM tts_usage_log WHERE provider = 'google'
         ORDER BY id DESC LIMIT 15`),
  ]);
  return { tiers, bySource, byVoice, history, recent };
}

router.get('/usage', requireFounder, async (req, res) => {
  const inrParam = parseFloat(req.query.inr);
  const inr = Number.isFinite(inrParam) && inrParam > 0 && inrParam < 1000 ? inrParam : 90;
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Google TTS usage</title>
<style>body{font:15px system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#111}
table{border-collapse:collapse;width:100%;margin:6px 0 18px}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}
th{background:#f5f5f5}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.card{border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:16px}
.bar{height:14px;background:#eee;border-radius:7px;overflow:hidden;margin:6px 0}
.bar>i{display:block;height:100%;background:#2e7d32}.bar.warn>i{background:#ef6c00}.bar.over>i{background:#c62828}
.note{background:#fff8e1;border:1px solid #f0d27a;padding:10px;border-radius:6px;font-size:13px}
.m{color:#555;font-size:13px}h3{margin:20px 0 4px}</style></head><body>`;
  let data;
  try {
    data = await loadUsage();
  } catch (err) {
    const missing = err && err.code === '42P01';
    console.error('[debug-voice/usage] load failed:', err && err.message);
    return res.status(missing ? 200 : 500).type('html').send(head + '<h2>Google TTS usage</h2><p class="note">' +
      (missing ? 'The usage table (tts_usage_log) does not exist yet. It is created by migration 037 on the next deploy.'
               : 'Could not load usage right now. Check the server logs for [debug-voice/usage].') + '</p></body></html>');
  }

  const byTier = {};
  data.tiers.forEach((t) => { byTier[t.voice_tier] = t; });
  const monthLabel = new Date().toISOString().slice(0, 7);
  const cards = Object.keys(RATES_PER_CHAR_USD).map((tier) => {
    const t = byTier[tier] || { calls: 0, chars: 0, list_usd: 0, billed_usd: 0, avg_ms: 0 };
    const allowance = FREE_ALLOWANCE_CHARS[tier];
    const chars = Number(t.chars);
    const pct = Math.min(100, (chars / allowance) * 100);
    const cls = chars >= allowance ? 'over' : pct >= 80 ? 'warn' : '';
    const left = Math.max(0, allowance - chars);
    return `<div class="card"><b>${escHtml(TIER_LABEL[tier])}</b>
      <span class="m"> — $${(RATES_PER_CHAR_USD[tier] * 1e6).toFixed(0)} per 1M chars after ${fmtInt(allowance)} free/month</span>
      <div class="bar ${cls}"><i style="width:${pct.toFixed(2)}%"></i></div>
      <div><b>${fmtInt(chars)}</b> of ${fmtInt(allowance)} free characters used (${pct.toFixed(2)}%) &middot; ${fmtInt(left)} left this month</div>
      <table><tr><th class="n">Calls</th><th class="n">Avg time (ms)</th><th class="n">List cost (no free tier)</th><th class="n">Expected billed</th></tr>
      <tr><td class="n">${fmtInt(t.calls)}</td><td class="n">${fmtInt(t.avg_ms)}</td>
      <td class="n">${fmtUsd(t.list_usd)} (${fmtInr(t.list_usd, inr)})</td>
      <td class="n"><b>${fmtUsd(t.billed_usd)} (${fmtInr(t.billed_usd, inr)})</b></td></tr></table></div>`;
  }).join('');

  const srcRows = data.bySource.length ? data.bySource.map((r) =>
    `<tr><td>${escHtml(TIER_LABEL[r.voice_tier] || r.voice_tier)}</td><td>${r.source === 'debug-compare' ? 'Founder test clicks' : escHtml(r.source === 'interview' ? 'Live interviews' : r.source)}</td><td class="n">${fmtInt(r.calls)}</td><td class="n">${fmtInt(r.chars)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="m">No usage recorded this month yet.</td></tr>';
  const voiceRows = data.byVoice.length ? data.byVoice.map((r) =>
    `<tr><td>${escHtml(r.voice_name)}</td><td>${escHtml(TIER_LABEL[r.voice_tier] || r.voice_tier)}</td><td class="n">${fmtInt(r.calls)}</td><td class="n">${fmtInt(r.chars)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="m">No usage recorded this month yet.</td></tr>';
  const histRows = data.history.length ? data.history.map((r) =>
    `<tr><td>${escHtml(r.month)}</td><td>${escHtml(TIER_LABEL[r.voice_tier] || r.voice_tier)}</td><td class="n">${fmtInt(r.calls)}</td><td class="n">${fmtInt(r.chars)}</td><td class="n">${fmtUsd(r.list_usd)}</td><td class="n">${fmtUsd(r.billed_usd)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="m">No history yet.</td></tr>';
  const recentRows = data.recent.length ? data.recent.map((r) =>
    `<tr><td>${escHtml(new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19))} UTC</td><td>${escHtml(r.voice_name || '')}</td><td>${r.source === 'debug-compare' ? 'test' : escHtml(r.source)}</td><td class="n">${fmtInt(r.characters)}</td><td class="n">${r.latency_ms == null ? '—' : fmtInt(r.latency_ms)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="m">No calls recorded yet.</td></tr>';

  res.set('Cache-Control', 'no-store');
  res.type('html').send(head + `<h2>Google TTS usage &amp; cost — ${escHtml(monthLabel)}</h2>
<p class="note">Founder-only, read-only; refreshes every 60 seconds. These are <b>our tracked numbers</b> (month starts at 00:00 UTC). "Expected billed" applies Google's free monthly allowance to our own running total. It cannot see other projects on the same billing account, and Gemini audition clicks are not tracked. <b>Google Cloud Billing is the only true bill</b> (it can lag up to a day). &#8377; shown at ${escHtml(inr)} per US$ — add <code>?inr=88</code> to the address to change it.</p>
${cards}
<h3>Live interviews vs founder test clicks (this month)</h3>
<table><tr><th>Tier</th><th>Source</th><th class="n">Calls</th><th class="n">Characters</th></tr>${srcRows}</table>
<h3>By voice (this month)</h3>
<table><tr><th>Voice</th><th>Tier</th><th class="n">Calls</th><th class="n">Characters</th></tr>${voiceRows}</table>
<h3>Monthly history (last 6 months)</h3>
<table><tr><th>Month</th><th>Tier</th><th class="n">Calls</th><th class="n">Characters</th><th class="n">List cost</th><th class="n">Expected billed</th></tr>${histRows}</table>
<h3>Last 15 calls</h3>
<table><tr><th>When</th><th>Voice</th><th>Source</th><th class="n">Characters</th><th class="n">Time (ms)</th></tr>${recentRows}</table>
</body></html>`);
});


module.exports = router;
