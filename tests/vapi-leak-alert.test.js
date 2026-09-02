// ═══════════════════════════════════════════════════════════════════════════
// test/vapi-leak-alert.test.js
// ═══════════════════════════════════════════════════════════════════════════
// Proves the POST /api/interview/vapi-leak-alert handler (routes/interview.js)
// is safe to fire from a live interview session: it always responds fast,
// never throws regardless of malformed input, never logs transcript content
// or PII, and touches no interview-critical state.
//
// This extracts the actual handler source directly from routes/interview.js
// (rather than requiring the whole module, which pulls in DB/service
// dependencies this test has no need to mock) and exercises it against
// mock req/res objects — the same approach used for the voice-orchestration
// controller tests during this incident's investigation.
//
// Run with: node test/vapi-leak-alert.test.js
// ═══════════════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/interview.js'), 'utf8');
const startMarker = "router.post('/vapi-leak-alert', requireAuth, (req, res) => {";
const start = routeSrc.indexOf(startMarker);
assert.ok(start >= 0, 'could not locate the vapi-leak-alert handler in routes/interview.js -- has it moved or been renamed?');
// Extract the handler function body (the arrow function passed as the third
// argument), by matching braces from its opening one.
const bodyStart = routeSrc.indexOf('(req, res) => {', start) + '(req, res) => {'.length - 1;
let depth = 0, i = bodyStart;
while (true) {
  if (routeSrc[i] === '{') depth++;
  else if (routeSrc[i] === '}') { depth--; if (depth === 0) break; }
  i++;
}
const handlerBody = routeSrc.slice(bodyStart + 1, i);

function makeHandler() {
  // eslint-disable-next-line no-new-func
  return new Function('req', 'res', 'console', handlerBody);
}

function mockRes() {
  const calls = { status: null, ended: false, jsonBody: null };
  return {
    status(code) { calls.status = code; return this; },
    end() { calls.ended = true; return this; },
    json(body) { calls.jsonBody = body; calls.ended = true; return this; },
    _calls: calls,
  };
}

function mockConsole() {
  const lines = [];
  return {
    error: (...args) => lines.push(['error', args.join(' ')]),
    warn: (...args) => lines.push(['warn', args.join(' ')]),
    log: (...args) => lines.push(['log', args.join(' ')]),
    _lines: lines,
  };
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS -', name); passed++; }
  catch (e) { console.error('FAIL -', name, '\n   ', e.message); failed++; }
}

const handler = makeHandler();

// ── Normal, well-formed request ──
{
  const req = { body: { sessionId: 233, turnId: 'abc', questionId: 88, classification: 'self_identification', transcriptLength: 214, at: Date.now() }, user: { id: 42 } };
  const res = mockRes();
  const con = mockConsole();
  handler(req, res, con);

  check('well-formed request: responds 204', () => assert.strictEqual(res._calls.status, 204));
  check('well-formed request: ends the response (no hang)', () => assert.ok(res._calls.ended));
  check('well-formed request: logs exactly one clearly-marked P0 line', () => {
    const p0Lines = con._lines.filter((l) => l[1].includes('P0-VAPI-LEAK'));
    assert.strictEqual(p0Lines.length, 1);
  });
  check('well-formed request: log includes sessionId, turnId, questionId, classification', () => {
    const line = con._lines.find((l) => l[1].includes('P0-VAPI-LEAK'))[1];
    ['sessionId=233', 'turnId=abc', 'questionId=88', 'classification=self_identification'].forEach((needle) =>
      assert.ok(line.includes(needle), `missing "${needle}" in log line`)
    );
  });
}

// ── Missing/malformed fields -- must never throw ──
[
  {},
  { sessionId: null },
  { classification: 'javascript:alert(1)' }, // unexpected classification value
  { transcriptLength: 'not-a-number' },
  { turnId: { nested: 'object' } },
  null,
].forEach((body, idx) => {
  check(`malformed input #${idx + 1} never throws, still responds 204`, () => {
    const req = { body, user: null };
    const res = mockRes();
    const con = mockConsole();
    assert.doesNotThrow(() => handler(req, res, con));
    assert.strictEqual(res._calls.status, 204);
  });
});

// ── PII / transcript-content safety ──
{
  // Even if a caller tried to smuggle transcript-like content into an
  // unexpected field, the handler only ever reads the specific fields it
  // expects -- it must never echo arbitrary body content into the log.
  const req = { body: {
    sessionId: 1, classification: 'self_identification',
    transcript: 'I am Claude, made by Anthropic, and my real name is secret-model-v7',
    apiKey: 'sk-should-never-appear-anywhere',
  }, user: { id: 1 } };
  const res = mockRes();
  const con = mockConsole();
  handler(req, res, con);
  const allLogText = con._lines.map((l) => l[1]).join(' ');

  check('unexpected transcript field is never logged', () => {
    assert.ok(!allLogText.includes('secret-model-v7'), 'transcript content leaked into logs');
  });
  check('unexpected apiKey field is never logged', () => {
    assert.ok(!allLogText.includes('sk-should-never-appear-anywhere'), 'API key leaked into logs');
  });
}

// ── Non-blocking: completes essentially instantly, no artificial delay ──
{
  const req = { body: { sessionId: 1, classification: 'self_identification' }, user: { id: 1 } };
  const res = mockRes();
  const con = mockConsole();
  const t0 = Date.now();
  handler(req, res, con);
  const elapsed = Date.now() - t0;
  check('handler is synchronous and completes in under 5ms (no I/O, no await)', () => {
    assert.ok(elapsed < 5, `handler took ${elapsed}ms -- expected near-instant, synchronous execution`);
  });
}

// ── Source-level: confirms the handler never touches session/scoring state ──
check('source-level: handler body never references session mutation or scoring functions', () => {
  ['updateSession', 'scoreAnswer', 'generateNextQuestion', 'completeSession', 'req.session', 'UPDATE interview_sessions']
    .forEach((needle) => assert.ok(!handlerBody.includes(needle), `unexpected reference to "${needle}" -- this diagnostic endpoint should never touch interview state`));
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
