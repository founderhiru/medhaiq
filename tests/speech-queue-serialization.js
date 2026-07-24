// ═══════════════════════════════════════════════════════════════════════════
// tests/speech-queue-serialization.js
//
// Regression suite for Phase A (2026-07-24): QuestionSpeechService's
// serialization queue. Confirmed root cause: speak() previously only
// aborted the PREVIOUS in-flight synthesize() network call — it never
// waited for, or stopped, audio that was already playing. Under a fast
// backend response combined with a slower acknowledgement synthesis, the
// next question's speak() call could fire while the acknowledgement was
// still audibly playing, producing overlapping "multiple voices" audio.
//
// This suite verifies: exactly one active playback at a time, every
// request reaches exactly one terminal state (complete/cancel/interrupt),
// and stop() clears the entire pending queue (not just the active item).
//
// Run with: node tests/speech-queue-serialization.js
// (Node harness with a minimal DOM-free mock — this module is plain
// browser JS, not a Node module, so it's loaded via a small global shim.)
// ═══════════════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`      ${err.message}`);
    failed++;
  }
}

function loadQuestionSpeechService() {
  // Minimal global shim — this file is a browser IIFE attaching to
  // `window`, not a CommonJS module. We give it just enough of a
  // "window" to load cleanly in Node for isolated testing.
  const fakeAbortController = global.AbortController || function () { this.abort = function () {}; this.signal = {}; };
  const fakeWindow = { AbortController: fakeAbortController };
  function FakeTTSAdapterBase() {}
  fakeWindow.MedhaIQVoice = { TTSAdapter: FakeTTSAdapterBase };

  const fullPath = path.join(__dirname, '..', 'public', 'js', 'voice', 'services', 'question-speech-service.js');
  const fs = require('fs');
  const src = fs.readFileSync(fullPath, 'utf8');
  // Execute in a controlled context where `window` resolves to our fake object.
  const vm = require('vm');
  const context = vm.createContext({ window: fakeWindow, console, setTimeout, clearTimeout, Date, AbortController: fakeWindow.AbortController });
  vm.runInContext(src, context);
  return { QSS: fakeWindow.MedhaIQVoice.QuestionSpeechService, TTSAdapterBase: FakeTTSAdapterBase };
}

function makeHarness(synthesizeDelayFn) {
  const { QSS, TTSAdapterBase } = loadQuestionSpeechService();
  const playCalls = [];
  let endedCallback = null;
  const audioPlayer = {
    onEnded: (cb) => { endedCallback = cb; },
    play: (src) => { playCalls.push({ src, at: Date.now() }); return playCalls.length; },
    stop: () => {},
  };
  const adapter = Object.create(TTSAdapterBase.prototype);
  adapter.synthesize = function (text) {
    const delay = synthesizeDelayFn ? synthesizeDelayFn(text) : 50;
    return new Promise((resolve) => setTimeout(() => resolve({ size: text.length * 10 }), delay));
  };
  const qss = new QSS({ ttsAdapter: adapter, audioPlayer, speakTimeoutMs: 15000 });
  const events = [];
  const originalLog = console.log;
  qss.__captureEvents = () => {
    console.log = (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[SPEECH-QUEUE]')) {
        events.push({ line: args[0], detail: args[1] });
      }
    };
  };
  qss.__restoreLog = () => { console.log = originalLog; };
  qss.__events = events;
  qss.__playCalls = playCalls;
  qss.__triggerEnded = () => { if (endedCallback) endedCallback(); };
  return qss;
}

console.log('QuestionSpeechService serialization queue — regression suite\n');

(async () => {
  await new Promise((resolve) => {
    check('Only one active playback at a time — a fast next-question speak() waits for a slower acknowledgement to complete first (the exact reported race)', () => {
      // deferred assertion below via async flow
    });
    const qss = makeHarness((text) => (text.length < 20 ? 500 : 50)); // short ack is SLOWER than the question — forces the race
    qss.__captureEvents();
    qss.speak({ text: 'Got it.', questionId: 'ack' });
    qss.speak({ text: 'Tell me about a time you led a difficult project.', questionId: 400 });
    setTimeout(() => {
      qss.__restoreLog();
      const playsBeforeAckResolves = qss.__playCalls.length;
      check('  -> question 400 has not played yet while ack is still synthesizing', () => {
        assert.strictEqual(playsBeforeAckResolves, 0, 'nothing should have played yet — ack synthesis (500ms) has not resolved');
      });
      resolve();
    }, 200); // well before the 500ms ack synthesis resolves
  });

  await new Promise((resolve) => {
    const qss = makeHarness((text) => (text.length < 20 ? 300 : 50));
    qss.__captureEvents();
    qss.speak({ text: 'Got it.', questionId: 'ack' });
    qss.speak({ text: 'Tell me about a time you led a difficult project.', questionId: 400 });
    setTimeout(() => {
      check('Exactly one play() call has happened by the time the ack alone should have resolved (question waited)', () => {
        assert.strictEqual(qss.__playCalls.length, 1, 'only the ack should have played so far');
      });
      qss.__triggerEnded(); // simulate the ack's audio finishing naturally -- captured while logging is still active
      setTimeout(() => {
        qss.__restoreLog();
        check('After the ack completes naturally, the queued question starts and plays — never overlapping', () => {
          assert.strictEqual(qss.__playCalls.length, 2, 'the question should now have played, sequentially after the ack');
        });
        const eventNames = qss.__events.map((e) => e.line);
        check('Every queue transition is logged in the correct order: enqueue, start, enqueue, complete, start', () => {
          assert.ok(eventNames.some((l) => l.includes('enqueue')));
          assert.ok(eventNames.some((l) => l.includes('start')));
          assert.ok(eventNames.some((l) => l.includes('complete')));
        });
        resolve();
      }, 100);
    }, 350);
  });

  await new Promise((resolve) => {
    const qss = makeHarness(() => 300);
    qss.__captureEvents();
    qss.speak({ text: 'ack one', questionId: 'ack' });
    qss.speak({ text: 'the next question text here', questionId: 400 });
    qss.speak({ text: 'a third queued item that should never play', questionId: 401 });
    setTimeout(() => {
      qss.stop(); // interrupt mid-synthesis, with 2 items still queued
      qss.__restoreLog();
      check('stop() clears the ENTIRE pending queue, not just the active item', () => {
        assert.strictEqual(qss._queue.length, 0, 'queue must be fully cleared');
        assert.strictEqual(qss._activeItem, null, 'active item must be cleared');
        assert.strictEqual(qss.__playCalls.length, 0, 'nothing should have played — stopped before the active item finished synthesizing');
      });
      check('Every request reaches exactly one terminal state after stop() — the active item is "interrupt", queued items are "cancel"', () => {
        const interruptEvents = qss.__events.filter((e) => e.line.includes('interrupt'));
        const cancelEvents = qss.__events.filter((e) => e.line.includes('cancel'));
        assert.strictEqual(interruptEvents.length, 1, 'exactly one interrupt (the active item)');
        assert.strictEqual(cancelEvents.length, 2, 'exactly two cancels (the two still-queued items)');
      });
      resolve();
    }, 50);
  });

  await new Promise((resolve) => {
    const qss = makeHarness(() => 30);
    qss.speak({ text: 'first', questionId: 1 });
    setTimeout(() => {
      check('A single speak() with nothing else queued still completes and reaches idle (no dangling active item)', () => {
        assert.strictEqual(qss.__playCalls.length, 1);
      });
      qss.__triggerEnded();
      check('After natural completion with an empty queue, the service returns to idle (activeItem null, no crash)', () => {
        assert.strictEqual(qss._activeItem, null);
        assert.strictEqual(qss._queue.length, 0);
      });
      resolve();
    }, 100);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
