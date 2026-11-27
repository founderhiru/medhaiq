// tests/google-tts-provider.test.js
//
// Regression + acceptance suite for the Google TTS provider behind the
// TTS_PROVIDER feature flag (staging migration, 2026-11-27).
// Plain Node + assert, same convention as tests/vapi-silent-model.test.js.
// Run:  node tests/google-tts-provider.test.js
//
// No real Google or ElevenLabs call is ever made: both are mocked by local
// HTTP servers (base URLs are overridable in config/voice-server-config.js).
// The DB is stubbed. A REAL RSA keypair is generated so the service-account
// JWT's RS256 signature is cryptographically verified by the mock OAuth server.

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Stub the DB module BEFORE anything requires it ─────────────────────────
const dbCalls = [];
let dbShouldThrow = false;
require.cache[require.resolve(path.join(ROOT, 'db/index.js'))] = {
  id: 'stub-db', filename: 'stub-db', loaded: true,
  exports: { pool: { query: async (sql, params) => { dbCalls.push({ sql, params }); if (dbShouldThrow) throw new Error('db down'); return { rows: [] }; } } },
};

// ── Service-account fixture with a real key ────────────────────────────────
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = { type: 'service_account', client_email: 'medhaiq-tts@test-project.iam.gserviceaccount.com', private_key: PRIVATE_PEM };
const FAKE_MP3 = Buffer.from('ID3-fake-mp3-bytes-for-tests-' + 'x'.repeat(64));

// ── Mock Google (OAuth + TTS) and mock ElevenLabs ──────────────────────────
const state = {
  tokenCalls: 0, synthCalls: [], elevenCalls: [],
  tokenStatus: 200, synthStatus: 200, synthDelayMs: 0, synthBody: null,
  lastJwtCheck: null,
};
function readBody(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); }); }

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.url === '/token') {
    state.tokenCalls += 1;
    const form = new URLSearchParams(body);
    // Verify the assertion really is an RS256 JWT signed by our key.
    const [h, c, s] = (form.get('assertion') || '').split('.');
    const verifier = crypto.createVerify('RSA-SHA256'); verifier.update(h + '.' + c);
    state.lastJwtCheck = {
      grant: form.get('grant_type'),
      header: JSON.parse(Buffer.from(h || 'e30', 'base64url').toString()),
      claims: JSON.parse(Buffer.from(c || 'e30', 'base64url').toString()),
      sigValid: !!s && verifier.verify(publicKey, Buffer.from(s, 'base64url')),
    };
    if (state.tokenStatus !== 200) { res.writeHead(state.tokenStatus, { 'content-type': 'application/json' }); return res.end('{"error":"invalid_grant"}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ access_token: 'tok-' + state.tokenCalls, expires_in: 3600, token_type: 'Bearer' }));
  }
  if (req.url === '/v1/text:synthesize') {
    state.synthCalls.push({ auth: req.headers.authorization, body: JSON.parse(body) });
    const respond = () => {
      if (state.synthStatus !== 200) { res.writeHead(state.synthStatus, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"nope"}}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.synthBody || { audioContent: FAKE_MP3.toString('base64') }));
    };
    return state.synthDelayMs ? setTimeout(respond, state.synthDelayMs) : respond();
  }
  if (req.url.startsWith('/v1/text-to-speech/')) {
    state.elevenCalls.push({ url: req.url, key: req.headers['xi-api-key'], body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'character-cost': '10' });
    return res.end(Buffer.from('ELEVEN-AUDIO'));
  }
  res.writeHead(404); res.end();
});

function reset() {
  state.tokenCalls = 0; state.synthCalls = []; state.elevenCalls = [];
  state.tokenStatus = 200; state.synthStatus = 200; state.synthDelayMs = 0; state.synthBody = null; state.lastJwtCheck = null;
  dbCalls.length = 0; dbShouldThrow = false;
  googleProvider._resetForTests();
}

let googleProvider, proxy, CFG, profiles;
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log('  PASS  ' + name); }
  catch (e) { failed += 1; console.log('  FAIL  ' + name + '\n        ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n        ') : e)); }
}
const settle = () => new Promise((r) => setTimeout(r, 30)); // let fire-and-forget recorders run

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  // Env BEFORE the config module loads (it reads env at require time).
  process.env.GOOGLE_TTS_API_BASE_URL = base;
  process.env.GOOGLE_OAUTH_TOKEN_URL = base + '/token';
  process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
  process.env.ELEVENLABS_API_KEY = 'xi-test-key';
  process.env.ELEVENLABS_API_BASE_URL = base;
  delete process.env.TTS_PROVIDER;

  CFG = require(path.join(ROOT, 'config/voice-server-config.js')).VOICE_SERVER_CONFIG;
  profiles = require(path.join(ROOT, 'config/voice-profiles.js'));
  googleProvider = require(path.join(ROOT, 'services/google-tts-provider.js'));
  proxy = require(path.join(ROOT, 'services/voice-tts-proxy.js'));
  const silenceLogs = process.env.TTS_TEST_VERBOSE ? null : console.log;
  if (silenceLogs) { console.__orig = console.log; }

  console.log('\nGoogle TTS provider — acceptance suite\n');

  // ═══ Feature flag / default provider ═══
  await check('DEFAULT: with TTS_PROVIDER unset, ElevenLabs is used and Google is never called', async () => {
    reset(); assert.strictEqual(CFG.ttsProvider, 'elevenlabs');
    const out = await proxy.synthesizeViaElevenLabs({ text: 'Hello there', voiceProfile: 'alex', language: 'en-US', userId: 1 });
    assert.strictEqual(proxy.getTtsProvider(), 'elevenlabs');
    assert.strictEqual(state.elevenCalls.length, 1);
    assert.strictEqual(state.elevenCalls[0].key, 'xi-test-key');
    assert.ok(state.elevenCalls[0].url.includes('/v1/text-to-speech/SQ8WYwlpzxrTbbuJgi38'), 'alex keeps her ElevenLabs voice id');
    assert.strictEqual(state.elevenCalls[0].body.voice_settings.speed, 0.9, 'ElevenLabs pacing untouched');
    assert.strictEqual(state.synthCalls.length, 0); assert.strictEqual(state.tokenCalls, 0);
    assert.strictEqual(out.buffer.toString(), 'ELEVEN-AUDIO');
  });

  await check('FLAG SAFETY: a typo or any non-"google" value keeps ElevenLabs', async () => {
    for (const v of ['goggle', 'GOOGLE_TTS', '', 'elevenlabs', 'true']) {
      CFG.ttsProvider = v; assert.strictEqual(proxy.getTtsProvider(), 'elevenlabs', 'value ' + JSON.stringify(v));
    }
    CFG.ttsProvider = 'google'; assert.strictEqual(proxy.getTtsProvider(), 'google');
    CFG.ttsProvider = 'elevenlabs';
  });

  await check('ROLLBACK: google -> elevenlabs flips instantly with no residue', async () => {
    reset(); CFG.ttsProvider = 'google';
    await proxy.synthesizeViaElevenLabs({ text: 'One', voiceProfile: 'marcus', userId: 1 });
    assert.strictEqual(state.synthCalls.length, 1); assert.strictEqual(state.elevenCalls.length, 0);
    CFG.ttsProvider = 'elevenlabs';
    await proxy.synthesizeViaElevenLabs({ text: 'Two', voiceProfile: 'marcus', userId: 1 });
    assert.strictEqual(state.elevenCalls.length, 1); assert.strictEqual(state.synthCalls.length, 1);
  });

  CFG.ttsProvider = 'google';

  // ═══ Authentication ═══
  await check('AUTH: service-account JWT is RS256, correctly signed, right claims; bearer token used', async () => {
    reset();
    await proxy.synthesizeViaElevenLabs({ text: 'Auth check', voiceProfile: 'alex', userId: 1 });
    const j = state.lastJwtCheck;
    assert.strictEqual(j.grant, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    assert.deepStrictEqual(j.header, { alg: 'RS256', typ: 'JWT' });
    assert.strictEqual(j.sigValid, true, 'RS256 signature must verify with the public key');
    assert.strictEqual(j.claims.iss, SA.client_email);
    assert.strictEqual(j.claims.scope, 'https://www.googleapis.com/auth/cloud-platform');
    assert.strictEqual(j.claims.aud, base + '/token');
    assert.ok(j.claims.exp - j.claims.iat <= 3600);
    assert.strictEqual(state.synthCalls[0].auth, 'Bearer tok-1');
  });

  await check('AUTH: token is cached across calls (1 token request for N syntheses)', async () => {
    reset();
    for (let i = 0; i < 5; i++) await proxy.synthesizeViaElevenLabs({ text: 'Q' + i, voiceProfile: 'sarah', userId: 1 });
    assert.strictEqual(state.tokenCalls, 1); assert.strictEqual(state.synthCalls.length, 5);
  });

  await check('AUTH: concurrent first calls share ONE token refresh (single-flight)', async () => {
    reset();
    await Promise.all([1, 2, 3, 4].map((i) => proxy.synthesizeViaElevenLabs({ text: 'P' + i, voiceProfile: 'raj', userId: 1 })));
    assert.strictEqual(state.tokenCalls, 1);
  });

  await check('AUTH FAILURE: OAuth endpoint rejects credentials -> UPSTREAM_AUTH', async () => {
    reset(); state.tokenStatus = 401;
    await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'x', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'UPSTREAM_AUTH');
    assert.strictEqual(state.synthCalls.length, 0, 'no synthesis attempted without a token');
  });

  await check('AUTH FAILURE: synthesize returns 403 -> UPSTREAM_AUTH', async () => {
    reset(); state.synthStatus = 403;
    await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'x', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'UPSTREAM_AUTH');
  });

  await check('AUTH FAILURE: a 401 from synthesize discards the cached token (next call re-authenticates)', async () => {
    reset(); await proxy.synthesizeViaElevenLabs({ text: 'a', voiceProfile: 'alex', userId: 1 });
    assert.strictEqual(state.tokenCalls, 1);
    state.synthStatus = 401;
    await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'b', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'UPSTREAM_AUTH');
    state.synthStatus = 200;
    await proxy.synthesizeViaElevenLabs({ text: 'c', voiceProfile: 'alex', userId: 1 });
    assert.strictEqual(state.tokenCalls, 2);
  });

  await check('CONFIG: missing credentials -> CONFIG_MISSING before any network call', async () => {
    reset(); const saved = CFG.googleTtsServiceAccountJson; CFG.googleTtsServiceAccountJson = null;
    await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'x', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'CONFIG_MISSING');
    assert.strictEqual(state.tokenCalls, 0); CFG.googleTtsServiceAccountJson = saved;
  });

  await check('CONFIG: malformed JSON / missing fields / unusable key -> CONFIG_MISSING (never leaks the key)', async () => {
    const saved = CFG.googleTtsServiceAccountJson;
    for (const bad of ['not json at all', JSON.stringify({ client_email: 'a@b' }), JSON.stringify({ client_email: 'a@b', private_key: 'NOT A PEM' })]) {
      reset(); CFG.googleTtsServiceAccountJson = bad;
      await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'x', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'CONFIG_MISSING' && !e.message.includes('NOT A PEM'));
    }
    CFG.googleTtsServiceAccountJson = saved;
  });

  await check('CONFIG: base64-encoded credentials and "\\n"-escaped private keys both work (Render env quirks)', async () => {
    const saved = CFG.googleTtsServiceAccountJson;
    reset(); CFG.googleTtsServiceAccountJson = Buffer.from(JSON.stringify(SA)).toString('base64');
    await proxy.synthesizeViaElevenLabs({ text: 'b64', voiceProfile: 'alex', userId: 1 });
    reset(); CFG.googleTtsServiceAccountJson = JSON.stringify({ ...SA, private_key: PRIVATE_PEM.replace(/\n/g, '\\n') });
    await proxy.synthesizeViaElevenLabs({ text: 'esc', voiceProfile: 'alex', userId: 1 });
    assert.strictEqual(state.synthCalls.length, 1); CFG.googleTtsServiceAccountJson = saved;
  });

  await check('SECURITY: private key, bearer token and credentials never appear in logs', async () => {
    reset(); const lines = []; const orig = console.log; const origE = console.error; const origW = console.warn;
    console.log = (...a) => lines.push(a.join(' ')); console.error = console.log; console.warn = console.log;
    try {
      await proxy.synthesizeViaElevenLabs({ text: 'log check', voiceProfile: 'alex', userId: 1 });
      state.tokenStatus = 401; googleProvider._resetForTests();
      await proxy.synthesizeViaElevenLabs({ text: 'log check 2', voiceProfile: 'alex', userId: 1 }).catch(() => {});
    } finally { console.log = orig; console.error = origE; console.warn = origW; }
    const all = lines.join('\n');
    assert.ok(all.length > 0);
    assert.ok(!all.includes('PRIVATE KEY'), 'no key material'); assert.ok(!all.includes('tok-'), 'no bearer token');
    assert.ok(!all.includes(SA.client_email), 'no service-account email');
  });

  // ═══ Success: all six personas × both tiers ═══
  const PERSONAS = ['alex', 'priya', 'marcus', 'sanjeev', 'sarah', 'raj'];
  for (const tier of ['chirp3hd', 'wavenet']) {
    for (const persona of PERSONAS) {
      await check(`SUCCESS [${tier}] persona ${persona}: right voice/accent, MP3, pacing 0.90, audio returned`, async () => {
        reset(); CFG.googleTtsVoiceTier = tier;
        const out = await proxy.synthesizeViaElevenLabs({ text: 'Tell me about a project.', voiceProfile: persona, userId: 9 });
        const call = state.synthCalls[0].body; const expected = profiles.resolveGoogleVoice(persona, tier);
        assert.strictEqual(call.voice.name, expected.name); assert.strictEqual(call.voice.languageCode, expected.languageCode);
        assert.strictEqual(call.audioConfig.audioEncoding, 'MP3');
        assert.strictEqual(call.audioConfig.speakingRate, CFG.ttsSpeed); assert.strictEqual(CFG.ttsSpeed, 0.9);
        assert.strictEqual(out.contentType, 'audio/mpeg'); assert.ok(out.buffer.equals(FAKE_MP3));
        assert.ok(expected.name.includes(tier === 'chirp3hd' ? 'Chirp3-HD' : 'Wavenet'));
      });
    }
  }
  CFG.googleTtsVoiceTier = 'chirp3hd';

  await check('VOICES: persona set is the intended accent/gender map, all names unique per tier', async () => {
    const exp = { alex: ['en-US', 'MALE'], priya: ['en-IN', 'FEMALE'], marcus: ['en-US', 'MALE'], sanjeev: ['en-IN', 'MALE'], sarah: ['en-US', 'FEMALE'], raj: ['en-IN', 'MALE'] };
    for (const tier of ['chirp3hd', 'wavenet']) {
      const names = new Set();
      for (const p of PERSONAS) {
        const v = profiles.resolveGoogleVoice(p, tier); assert.strictEqual(v.languageCode, exp[p][0]); assert.strictEqual(v.gender, exp[p][1]);
        assert.ok(v.name.startsWith(v.languageCode + '-')); names.add(v.name);
      }
      assert.strictEqual(names.size, 6, 'six distinct voices for ' + tier);
    }
    assert.ok(profiles.resolveGoogleVoice('nobody', 'chirp3hd').name.includes('Chirp3-HD'), 'unknown persona falls back, never throws');
    assert.ok(profiles.resolveGoogleVoice('alex', 'garbage').name.includes('Chirp3-HD'), 'unknown tier falls back to chirp3hd');
  });

  await check('PRESERVED: ElevenLabs persona voice IDs are byte-identical to before', async () => {
    const ids = { alex: 'SQ8WYwlpzxrTbbuJgi38', priya: 'C3aqZfd4M0h7Ys5tWGIS', marcus: 'ZoiZ8fuDWInAcwPXaVeq', sanjeev: 'YlKsPt31o1mfk5M6i78o', sarah: '299hhEjoz44O862N5H4G', raj: 'M50bdzdVCqNbr6HtbFB5' };
    for (const [k, id] of Object.entries(ids)) assert.strictEqual(profiles.resolveVoiceProfile(k).providerVoice, id);
    assert.strictEqual(profiles.resolveVoiceProfile('zzz').providerVoice, 'hpp4J3VqNfWAUOO0d1Us');
  });

  // ═══ Currency pronunciation preserved ═══
  await check('CURRENCY: "$25M" reaches Google as spoken words (shared normalization preserved)', async () => {
    reset(); await proxy.synthesizeViaElevenLabs({ text: 'During that $25M engagement you delivered ₹5Cr savings.', voiceProfile: 'alex', userId: 1 });
    const sent = state.synthCalls[0].body.input.text;
    assert.ok(sent.includes('twenty-five million dollars') && sent.includes('five crore rupees'), sent); assert.ok(!sent.includes('$25M'));
  });

  // ═══ Streaming-token path (what live interviews use) ═══
  await check('STREAM: prepare -> token -> Response body is the MP3, audio/mpeg, token single-use, owner-checked', async () => {
    reset();
    const token = proxy.prepareStream({ text: 'Streaming question', voiceProfile: 'priya', language: 'en-US', userId: 5 });
    await assert.rejects(() => proxy.streamViaElevenLabsToken({ token, userId: 6 }), (e) => e.code === 'TOKEN_FORBIDDEN');
    const t2 = proxy.prepareStream({ text: 'Streaming question', voiceProfile: 'priya', language: 'en-US', userId: 5 });
    const { upstreamResponse, contentType } = await proxy.streamViaElevenLabsToken({ token: t2, userId: 5 });
    assert.strictEqual(contentType, 'audio/mpeg');
    const { Readable } = require('stream');
    const chunks = []; for await (const c of Readable.fromWeb(upstreamResponse.body)) chunks.push(c);   // EXACTLY what routes/voice-tts.js does
    assert.ok(Buffer.concat(chunks).equals(FAKE_MP3));
    await assert.rejects(() => proxy.streamViaElevenLabsToken({ token: t2, userId: 5 }), (e) => e.code === 'TOKEN_NOT_FOUND');
    assert.strictEqual(state.synthCalls[0].body.voice.name, profiles.resolveGoogleVoice('priya', 'chirp3hd').name);
  });

  // ═══ Failure modes → same error codes as ElevenLabs path ═══
  await check('TIMEOUT: slow Google -> TIMEOUT within the configured limit', async () => {
    reset(); const saved = CFG.requestTimeoutMs; CFG.requestTimeoutMs = 250; state.synthDelayMs = 1500;
    const t0 = Date.now();
    await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'slow', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'TIMEOUT');
    assert.ok(Date.now() - t0 < 1000, 'aborted promptly'); CFG.requestTimeoutMs = saved;
  });

  await check('PROVIDER FAILURE: 500 / 429 / 400 -> UPSTREAM_ERROR', async () => {
    for (const s of [500, 503, 429, 400]) {
      reset(); state.synthStatus = s;
      await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'x', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'UPSTREAM_ERROR', 'status ' + s);
    }
  });

  await check('PROVIDER FAILURE: 200 with no/empty audioContent or non-JSON -> UPSTREAM_ERROR', async () => {
    for (const body of [{}, { audioContent: '' }, { audioContent: 123 }]) {
      reset(); state.synthBody = body;
      await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'x', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'UPSTREAM_ERROR');
    }
  });

  await check('NETWORK: unreachable Google -> NETWORK_ERROR', async () => {
    reset(); const saved = CFG.googleTtsApiBaseUrl; CFG.googleTtsApiBaseUrl = 'http://127.0.0.1:1';
    await assert.rejects(() => proxy.synthesizeViaElevenLabs({ text: 'x', voiceProfile: 'alex', userId: 1 }), (e) => e.code === 'NETWORK_ERROR');
    CFG.googleTtsApiBaseUrl = saved;
  });

  await check('ROUTE CONTRACT: every code the Google path throws is mapped by routes/voice-tts.js (same table as ElevenLabs)', async () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'routes/voice-tts.js'), 'utf8');
    for (const code of ['CONFIG_MISSING', 'UPSTREAM_AUTH', 'UPSTREAM_ERROR', 'TIMEOUT', 'NETWORK_ERROR']) assert.ok(src.includes(code + ':'), code);
  });

  // ═══ 5,000-byte limit ═══
  await check('LIMIT: text over Google\'s 5,000-byte limit is split on sentences; every request <= 5,000 bytes; audio concatenated', async () => {
    reset(); const long = Array.from({ length: 120 }, (_, i) => 'This is sentence number ' + i + ' of a very long interview prompt.').join(' ');
    assert.ok(Buffer.byteLength(long) > 5000);
    const out = await proxy.synthesizeViaElevenLabs({ text: long, voiceProfile: 'alex', userId: 1 });
    assert.ok(state.synthCalls.length >= 2);
    for (const c of state.synthCalls) assert.ok(Buffer.byteLength(c.body.input.text) <= 5000);
    assert.strictEqual(out.buffer.length, FAKE_MP3.length * state.synthCalls.length);
    assert.strictEqual(state.tokenCalls, 1);
  });

  // ═══ Cost / character tracking ═══
  await check('USAGE: characters of the SPOKEN text are recorded with tier, voice, source (even inside free allowance)', async () => {
    reset(); CFG.googleTtsVoiceTier = 'chirp3hd';
    await proxy.synthesizeViaElevenLabs({ text: 'Hello $25M', voiceProfile: 'sanjeev', userId: 42 }); await settle();
    assert.strictEqual(dbCalls.length, 1);
    const p = dbCalls[0].params; const spoken = state.synthCalls[0].body.input.text;
    assert.strictEqual(p[0], 'google'); assert.strictEqual(p[1], 'chirp3hd'); assert.strictEqual(p[2], profiles.resolveGoogleVoice('sanjeev', 'chirp3hd').name);
    assert.strictEqual(p[4], 'interview'); assert.strictEqual(p[5], '42'); assert.strictEqual(p[6], Array.from(spoken).length);
    assert.ok(Math.abs(p[8] - 30 / 1e6) < 1e-12, 'list price per char $30/1M');
    assert.strictEqual(p[9], 1000000);
    reset(); CFG.googleTtsVoiceTier = 'wavenet';
    await proxy.synthesizeViaElevenLabs({ text: 'Hi', voiceProfile: 'alex', userId: 1 }); await settle();
    assert.strictEqual(dbCalls[0].params[1], 'wavenet'); assert.ok(Math.abs(dbCalls[0].params[8] - 4 / 1e6) < 1e-12); assert.strictEqual(dbCalls[0].params[9], 4000000);
    CFG.googleTtsVoiceTier = 'chirp3hd';
  });

  await check('USAGE: a DB failure never breaks or delays audio', async () => {
    reset(); dbShouldThrow = true;
    const out = await proxy.synthesizeViaElevenLabs({ text: 'still works', voiceProfile: 'alex', userId: 1 }); await settle();
    assert.ok(out.buffer.equals(FAKE_MP3));
  });

  await check('USAGE: ElevenLabs path records NOTHING to the Google ledger', async () => {
    reset(); CFG.ttsProvider = 'elevenlabs';
    await proxy.synthesizeViaElevenLabs({ text: 'eleven', voiceProfile: 'alex', userId: 1 }); await settle();
    assert.ok(!dbCalls.some((c) => /tts_usage_log/.test(c.sql))); CFG.ttsProvider = 'google';
  });

  // ═══ Latency (server-side overhead of our code, mock Google = instant) ═══
  await check('LATENCY: warm-path overhead of our Google branch (mock Google) is small', async () => {
    reset(); await proxy.synthesizeViaElevenLabs({ text: 'warm', voiceProfile: 'alex', userId: 1 }); // warm token
    const runs = []; for (let i = 0; i < 25; i++) { const t0 = process.hrtime.bigint(); await proxy.synthesizeViaElevenLabs({ text: 'Tell me about a time you led a project.', voiceProfile: PERSONAS[i % 6], userId: 1 }); runs.push(Number(process.hrtime.bigint() - t0) / 1e6); }
    runs.sort((a, b) => a - b); const p50 = runs[12], p95 = runs[23];
    console.log(`        warm overhead vs instant mock: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (excludes real Google network time)`);
    assert.ok(p95 < 150, 'overhead p95 ' + p95);
  });

  // ═══ Gemini accent-blend audition (compare page only; live path must be unaffected) ═══
  await check('GEMINI: modelName + styling prompt are sent, speakingRate is NOT (support undocumented)', async () => {
    reset();
    const out = await googleProvider.synthesize({ text: 'Hello', languageCode: 'en-IN', voiceName: 'Iapetus', modelName: 'gemini-2.5-flash-tts', prompt: 'Speak with a 60% Indian accent.', speakingRate: 0.9 });
    const b = state.synthCalls[0].body;
    assert.strictEqual(b.voice.modelName, 'gemini-2.5-flash-tts'); assert.strictEqual(b.input.prompt, 'Speak with a 60% Indian accent.');
    assert.strictEqual(b.voice.name, 'Iapetus'); assert.strictEqual(b.voice.languageCode, 'en-IN');
    assert.strictEqual(b.audioConfig.audioEncoding, 'MP3'); assert.ok(!('speakingRate' in b.audioConfig));
    assert.ok(out.buffer.equals(FAKE_MP3));
  });

  await check('LIVE PATH UNCHANGED: Chirp/WaveNet requests carry speakingRate and NEVER prompt/modelName', async () => {
    for (const tier of ['chirp3hd', 'wavenet']) {
      reset(); CFG.googleTtsVoiceTier = tier;
      await proxy.synthesizeViaElevenLabs({ text: 'Live question', voiceProfile: 'sanjeev', userId: 1 });
      const b = state.synthCalls[0].body;
      assert.strictEqual(b.audioConfig.speakingRate, 0.9); assert.ok(!('prompt' in b.input)); assert.ok(!('modelName' in b.voice));
    }
    CFG.googleTtsVoiceTier = 'chirp3hd';
  });

  await check('GEMINI: audition does not touch the cost ledger (rate unverified, nothing invented)', async () => {
    reset(); await googleProvider.synthesize({ text: 'x', languageCode: 'en-US', voiceName: 'Sadaltager', modelName: 'gemini-2.5-flash-tts', prompt: 'p' }); await settle();
    assert.strictEqual(dbCalls.length, 0);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SUITE CRASH', e); process.exit(2); });
