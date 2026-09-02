// ═══════════════════════════════════════════════════════════════════════════
// test/vapi-silent-model.test.js
// ═══════════════════════════════════════════════════════════════════════════
// P0 regression test (2026-08-31 incident): proves routes/vapi-silent-model.js
// structurally cannot produce conversational text, regardless of what Vapi
// sends it. This is the repository-side half of the acceptance test — it
// proves the endpoint itself is safe. It does NOT prove the live Vapi
// assistant is actually configured to call this endpoint (that requires the
// manual dashboard/live-call verification described in the incident report;
// no code-only test can substitute for that).
//
// Run with: node test/vapi-silent-model.test.js
// (No test framework dependency — plain assertions, zero new packages,
// matching this repo's existing lightweight validation style.)
// ═══════════════════════════════════════════════════════════════════════════
const assert = require('assert');
const http = require('http');
const express = require('express');
const vapiSilentModelRouter = require('../routes/vapi-silent-model');

function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api', vapiSilentModelRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function post(server, body) {
  const port = server.address().port;
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, path: '/api/vapi-silent-model/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// A realistic Vapi custom-LLM request: conversation history that WOULD, if
// sent to a real model, very plausibly provoke exactly the "I'm Claude..."
// self-identification the incident captured.
const REALISTIC_VAPI_REQUEST = {
  model: 'silent-stub',
  temperature: 0,
  messages: [
    { role: 'system', content: 'You are not a conversational agent...' },
    { role: 'user', content: 'Who are you? Are you Claude?' },
  ],
};

async function run() {
  const server = await startTestServer();
  let passed = 0, failed = 0;
  function check(name, fn) {
    try { fn(); console.log('PASS -', name); passed++; }
    catch (e) { console.error('FAIL -', name, '\n   ', e.message); failed++; }
  }

  // ── Non-streaming ──
  const nonStream = await post(server, REALISTIC_VAPI_REQUEST);
  const nonStreamBody = JSON.parse(nonStream.raw);

  check('non-streaming: HTTP 200', () => assert.strictEqual(nonStream.status, 200));
  check('non-streaming: content is empty string, not conversational text', () => {
    assert.strictEqual(nonStreamBody.choices[0].message.content, '');
  });
  check('non-streaming: delta.content is ALSO empty (contract-shape defense)', () => {
    assert.strictEqual(nonStreamBody.choices[0].delta.content, '');
  });
  check('non-streaming: finish_reason is stop (never left open for continuation)', () => {
    assert.strictEqual(nonStreamBody.choices[0].finish_reason, 'stop');
  });
  check('non-streaming: response text never contains a self-identification leak', () => {
    const flat = JSON.stringify(nonStreamBody).toLowerCase();
    ['claude', 'anthropic', 'openai', 'gemini', 'i am an ai', "i'm an ai", 'language model']
      .forEach((needle) => assert.ok(!flat.includes(needle), `leaked term found: "${needle}"`));
  });

  // ── Streaming ──
  const streamReq = Object.assign({}, REALISTIC_VAPI_REQUEST, { stream: true });
  const streamRes = await post(server, streamReq);
  check('streaming: HTTP 200', () => assert.strictEqual(streamRes.status, 200));
  check('streaming: Content-Type is text/event-stream', () => {
    assert.ok(String(streamRes.headers['content-type']).includes('text/event-stream'));
  });
  check('streaming: contains exactly one content chunk, and it is empty', () => {
    const dataLines = streamRes.raw.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
    assert.strictEqual(dataLines.length, 1, 'expected exactly one SSE data chunk before [DONE]');
    const chunk = JSON.parse(dataLines[0].slice(6));
    assert.strictEqual(chunk.choices[0].delta.content, '');
  });
  check('streaming: terminates with [DONE]', () => {
    assert.ok(streamRes.raw.includes('data: [DONE]'));
  });
  check('streaming: never contains a self-identification leak', () => {
    const flat = streamRes.raw.toLowerCase();
    ['claude', 'anthropic', 'openai', 'gemini'].forEach((needle) =>
      assert.ok(!flat.includes(needle), `leaked term found: "${needle}"`)
    );
  });

  // ── No external network call is possible ──
  // This is a structural argument, not a runtime assertion: the endpoint's
  // entire implementation (routes/vapi-silent-model.js) contains zero
  // require() of any AI SDK, zero fetch/axios/http calls to any model
  // provider, and zero API key usage. Confirmed by direct source inspection
  // as part of this incident's investigation, restated here so it is not
  // silently lost the next time this file is edited.
  check('source-level: no AI SDK import or outbound HTTP call exists in the route file', () => {
    // Strip comments first so documentation text (e.g. "OpenAI-compatible
    // shape", a protocol reference) doesn't false-positive against actual
    // code that would invoke a real provider.
    const rawSrc = require('fs').readFileSync(require.resolve('../routes/vapi-silent-model'), 'utf8');
    const codeOnly = rawSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/\/\/.*$/gm, '');           // line comments
    ['require(\'anthropic', 'require("anthropic', 'require(\'openai', 'require("openai',
     'fetch(', 'axios', 'http.request(', 'https.request(']
      .forEach((needle) => assert.ok(!codeOnly.toLowerCase().includes(needle.toLowerCase()), `unexpected outbound-capable code: "${needle}"`));
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error('Test harness error:', e); process.exit(1); });
