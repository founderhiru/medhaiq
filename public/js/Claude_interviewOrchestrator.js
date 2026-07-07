// ═══════════════════════════════════════════════════════════════════════════
// public/js/interviewOrchestrator.js
// MedhaIQ Session Bootstrap Orchestrator — v2.0
//
// Owns two small, strict state machines that the inline engine scripts in
// views/interview-session.ejs call into:
//
//  1. CALIBRATION GATE (fixes cold-start desync, image A):
//     BOOT → CALIBRATING → READY.
//     While CALIBRATING, the question card is hidden and the pulsing
//     "Calibrating Interviewer Persona…" loader shows. The question is
//     revealed only when the Vapi socket certifies `call-start`
//     (voiceConnected()) — with a hard safety valve: a fallback timer
//     ALWAYS reveals the question after `fallbackMs`, so a candidate with
//     no mic, a blocked mic, or a Vapi outage is never stuck staring at a
//     loader. Text-only sessions bypass the gate entirely.
//
//  2. INPUT GATE (fixes text/audio misalignment, image B):
//     The answer box + submit button lock while the interviewer is
//     speaking a question, and unlock on speech-end — so the candidate
//     can never answer a question that hasn't finished being read.
//     Safety valve: auto-unlock after `maxLockMs` in case a speech-end
//     event is ever missed. Skip/End Session stay usable at all times.
//
// No dependencies. Exposes a single global: window.MedhaIQOrchestrator.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var CAL = { state: 'BOOT', revealFn: null, fallbackTimer: null, revealed: false };
  var GATE = { locked: false, unlockTimer: null };

  function reveal(reason) {
    if (CAL.revealed) return;
    CAL.revealed = true;
    CAL.state = 'READY';
    if (CAL.fallbackTimer) { clearTimeout(CAL.fallbackTimer); CAL.fallbackTimer = null; }
    try { if (typeof CAL.revealFn === 'function') CAL.revealFn(reason); }
    catch (e) { console.error('[orchestrator] reveal failed', e); }
  }

  function inputEls() {
    return {
      input: document.getElementById('answerInput'),
      submit: document.getElementById('submitBtn'),
    };
  }

  window.MedhaIQOrchestrator = {
    /* ── Calibration gate ─────────────────────────────────────────────── */

    /**
     * Begin the bootstrap sequence.
     * @param {Object} opts
     * @param {boolean}  opts.hasVoice   voice configured for this session
     * @param {Function} opts.onReveal   paints the canonical Question 1
     * @param {number}  [opts.fallbackMs=8000] safety reveal if voice never connects
     */
    calibrate: function (opts) {
      opts = opts || {};
      CAL.revealFn = opts.onReveal;
      if (!opts.hasVoice) { reveal('text-only'); return; }
      CAL.state = 'CALIBRATING';
      CAL.fallbackTimer = setTimeout(function () {
        console.warn('[orchestrator] voice did not certify in time — revealing via fallback');
        reveal('fallback-timer');
      }, typeof opts.fallbackMs === 'number' ? opts.fallbackMs : 8000);
    },

    /** Vapi certified `call-start` — reveal immediately. */
    voiceConnected: function () { reveal('voice-connected'); },

    /** True once the question has been revealed (any path). */
    isReady: function () { return CAL.revealed; },

    /* ── Input gate ───────────────────────────────────────────────────── */

    /**
     * Lock the answer box while the interviewer is speaking.
     * @param {number} [maxLockMs=25000] safety auto-unlock
     */
    lockInput: function (maxLockMs) {
      var els = inputEls();
      if (!els.input) return;
      GATE.locked = true;
      els.input.disabled = true;
      els.input.setAttribute('data-locked-placeholder', els.input.placeholder || '');
      els.input.placeholder = 'Listen to the question…';
      if (els.submit) els.submit.disabled = true;
      if (GATE.unlockTimer) clearTimeout(GATE.unlockTimer);
      GATE.unlockTimer = setTimeout(function () {
        console.warn('[orchestrator] input auto-unlocked by safety timer');
        window.MedhaIQOrchestrator.unlockInput();
      }, typeof maxLockMs === 'number' ? maxLockMs : 25000);
    },

    /** Speech playback finished — let the candidate answer. */
    unlockInput: function () {
      var els = inputEls();
      if (GATE.unlockTimer) { clearTimeout(GATE.unlockTimer); GATE.unlockTimer = null; }
      if (!GATE.locked) return;
      GATE.locked = false;
      if (els.input) {
        els.input.disabled = false;
        var ph = els.input.getAttribute('data-locked-placeholder');
        if (ph) els.input.placeholder = ph;
        try { els.input.focus(); } catch (e) {}
      }
      /* submit stays disabled until there is typed/spoken content —
         the engine's own input listener manages that, untouched. */
    },

    isInputLocked: function () { return GATE.locked; },
  };
})();
