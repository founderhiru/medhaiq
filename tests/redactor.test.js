// tests/redactor.test.js
// Plain Node + assert (matches the rest of /tests). Run: node tests/redactor.test.js
// Covers: pattern detection, what is KEPT, name handling, restore round-trip,
// never-throws behaviour, and the gateway wiring (flag off = byte-identical
// request; flag on = no PII leaves, response restored) using a mocked SDK.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { createSession, detectHeaderName } = require('../ai/core/redactor');

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log('  ok  -', name); },
    (e) => { failed++; console.error('  FAIL -', name, '\n      ', e.message); }
  );
}

const SAMPLE = [
  'Priya Sharma',
  'Senior Engineering Manager',
  'Email: priya.sharma@gmail.com | Mobile: +91 98765 43210 | Alt: 98765-43211',
  'LinkedIn: https://www.linkedin.com/in/priya-sharma-123 | github.com/priyasharma',
  'PAN: ABCDE1234F  Aadhaar: 2345 6789 0123  Passport: K1234567',
  'Address: 12 MG Road, Indiranagar, Bengaluru',
  'PIN: 560038',
  'Led a 12-person team at Infosys from 2019 - 2023. Grew revenue 40% and cut cost by $4,500,000.',
  'B.Tech, IIT Madras. Skills: Node.js, Kubernetes, stakeholder management.',
].join('\n');

(async () => {
  console.log('redactor');

  await test('removes all identifiers from a resume', () => {
    const s = createSession({ detectHeaderName: true });
    const out = s.redact(SAMPLE);
    for (const leaked of ['priya.sharma@gmail.com', '98765 43210', '98765-43211', 'linkedin.com/in/priya',
      'github.com/priyasharma', 'ABCDE1234F', '2345 6789 0123', 'K1234567', 'MG Road', '560038', 'Priya', 'Sharma']) {
      assert(!out.includes(leaked), `leaked: ${leaked}\n${out}`);
    }
    const c = s.getCounts();
    assert(c.EMAIL === 1 && c.PAN === 1 && c.AADHAAR === 1 && c.PASSPORT === 1 && c.PIN === 1 && c.ADDRESS === 1, JSON.stringify(c));
    assert(c.PHONE === 2 && c.URL === 2 && c.NAME >= 1, JSON.stringify(c));
  });

  await test('keeps skills, titles, companies, colleges, numbers and years', () => {
    const out = createSession({ detectHeaderName: true }).redact(SAMPLE);
    for (const kept of ['Senior Engineering Manager', 'Infosys', 'IIT Madras', 'Node.js', 'Kubernetes',
      'stakeholder management', '12-person team', '2019 - 2023', '40%', '$4,500,000']) {
      assert(out.includes(kept), `lost: ${kept}`);
    }
  });

  await test('restore round-trips strings, arrays and nested objects', () => {
    const s = createSession({ detectHeaderName: true });
    const out = s.redact(SAMPLE);
    assert.strictEqual(s.restore(out), SAMPLE);
    const obj = { a: 'Contact [EMAIL_1]', b: ['[PHONE_1]', { c: '[NAME_1] led it' }], n: 5, z: null };
    const r = s.restore(obj);
    assert.strictEqual(r.a, 'Contact priya.sharma@gmail.com');
    assert.strictEqual(r.b[1].c.endsWith('led it'), true);
    assert.strictEqual(r.n, 5);
    assert.strictEqual(r.z, null);
    assert.strictEqual(s.restore('[EMAIL_99]'), '[EMAIL_99]'); // unknown token untouched
  });

  await test('known names are redacted wherever they appear (case-insensitive, whole word)', () => {
    const s = createSession({ names: ['Ravi Kumar'] });
    const out = s.redact('My manager ravi kumar and Ravi said Kumar was fired. Ravina stayed.');
    assert(!/ravi kumar/i.test(out) && !/\bRavi\b/.test(out) && !/\bKumar\b/.test(out), out);
    assert(out.includes('Ravina'), 'whole-word match must not eat Ravina');
  });

  await test('null / empty / short names and non-strings are safe', () => {
    const s = createSession({ names: [null, undefined, '', 'A'] });
    assert.strictEqual(s.redact('plain text'), 'plain text');
    assert.strictEqual(s.redact(''), '');
    assert.strictEqual(s.redact(undefined), undefined);
    assert.strictEqual(s.redact(42), 42);
  });

  await test('answers with no personal data are returned unchanged', () => {
    const t = 'I reduced p95 latency from 800ms to 200ms by caching, which saved 30% of infra spend in 2022.';
    const s = createSession();
    assert.strictEqual(s.redact(t), t);
    assert.strictEqual(s.getTotal(), 0);
  });

  await test('same value gets the same token across system and message', () => {
    const s = createSession();
    const a = s.redact('mail a@b.com');
    const b = s.redact('again a@b.com and c@d.com');
    assert(a.includes('[EMAIL_1]') && b.includes('[EMAIL_1]') && b.includes('[EMAIL_2]'));
  });

  await test('system prompt string and {static,dynamic} forms', () => {
    const s = createSession();
    assert(!s.redactSystem('x a@b.com').includes('a@b.com'));
    const o = s.redactSystem({ static: 'fixed', dynamic: 'cand a@b.com' });
    assert.strictEqual(o.static, 'fixed');
    assert(!o.dynamic.includes('a@b.com'));
  });

  await test('header-name detector ignores headings and lines with digits', () => {
    assert.strictEqual(detectHeaderName('Jordan Ellis\nVP of Global Operations'), 'Jordan Ellis');
    assert.strictEqual(detectHeaderName('RESUME\nWork Experience\nLed a team'), null);
    assert.strictEqual(detectHeaderName('Curriculum Vitae\n\nAsha K Menon\n'), 'Asha K Menon');
    assert.strictEqual(detectHeaderName('Led a cross functional team of 40'), null);
  });

  await test('repo resume fixtures: name removed, content kept, nothing else mangled', () => {
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter((f) => /resume\.txt$|junior-engineer\.txt$/.test(f));
    assert(files.length >= 3);
    for (const f of files) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      const s = createSession({ detectHeaderName: true });
      const out = s.redact(t);
      const name = detectHeaderName(t);
      assert(name && !out.includes(name), `${f}: header name not removed`);
      assert(out.length >= t.length - 20, `${f}: unexpectedly large removal`);
      assert.strictEqual(s.restore(out), t, `${f}: round trip failed`);
    }
  });

  // ── Gateway wiring with a mocked SDK ────────────────────────────────────
  const sent = [];
  let reply = '';
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === '@anthropic-ai/sdk') {
      return class FakeAnthropic {
        constructor() {
          this.messages = {
            create: async (body) => { sent.push(body); return { content: [{ type: 'text', text: reply }], usage: { input_tokens: 1, output_tokens: 1 } }; },
            countTokens: async () => ({ input_tokens: 1 }),
          };
        }
      };
    }
    return origLoad.call(this, request, ...rest);
  };
  process.env.ANTHROPIC_API_KEY = 'test';
  const provider = require('../ai/providers/anthropic');
  const MODEL = 'test-model';

  await test('flag OFF (default): request is byte-identical, nothing redacted', async () => {
    delete process.env.AI_REDACTION;
    sent.length = 0; reply = '{"ok":true}';
    const msg = 'Resume: priya@gmail.com +91 98765 43210';
    const res = await provider.chatJSON(msg, { model: MODEL, system: 'sys priya@gmail.com', redact: { names: ['Priya'] } });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(sent[0].messages[0].content, msg);
    assert(sent[0].system[0].text.includes('priya@gmail.com'));
  });

  await test('flag ON: no PII reaches the provider; response is restored', async () => {
    process.env.AI_REDACTION = 'on';
    sent.length = 0; reply = '{"summary":"[NAME_1] can be reached at [EMAIL_1]","skills":["Node.js"]}';
    const res = await provider.chatJSON('Candidate Priya Sharma, priya@gmail.com, +91 98765 43210',
      { model: MODEL, system: { static: 'STATIC', dynamic: 'dyn priya@gmail.com' }, redact: { names: ['Priya Sharma'] } });
    const wire = JSON.stringify(sent[0]);
    for (const leaked of ['priya@gmail.com', '98765 43210', 'Priya', 'Sharma']) assert(!wire.includes(leaked), `leaked ${leaked}`);
    assert.strictEqual(res.summary, 'Priya Sharma can be reached at priya@gmail.com');
    assert.deepStrictEqual(res.skills, ['Node.js']);
    assert.strictEqual(sent[0].system[0].text, 'STATIC'); // static (cached) block untouched
    assert(sent[0].system[0].cache_control, 'cache_control still on static block');
  });

  await test('flag ON + redact:false opts a call out', async () => {
    process.env.AI_REDACTION = 'on';
    sent.length = 0; reply = '{"ok":1}';
    await provider.chatJSON('a@b.com', { model: MODEL, system: 's', redact: false });
    assert.strictEqual(sent[0].messages[0].content, 'a@b.com');
  });

  await test('flag ON: chat() restores text and invalid JSON still throws as before', async () => {
    process.env.AI_REDACTION = 'on';
    sent.length = 0; reply = 'Hello [EMAIL_1]';
    assert.strictEqual(await provider.chat('x a@b.com', { model: MODEL }), 'Hello a@b.com');
    reply = 'not json';
    await assert.rejects(() => provider.chatJSON('hi', { model: MODEL, system: 's' }));
  });

  Module._load = origLoad;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
