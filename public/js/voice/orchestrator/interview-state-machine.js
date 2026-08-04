// public/js/voice/orchestrator/interview-state-machine.js
//
// Rev4A.1 — Passive FSM (observe-only).
// See rev4a1-passive-fsm-architecture.md for the full design doc.
//
// This module OBSERVES the interview lifecycle and logs inferred state
// transitions. It does NOT gate, block, or alter any existing control
// flow -- every call site that reports into this module already ran its
// real logic before (and independently of) the report. Rev4A.2 is the
// milestone that makes this authoritative; until then, nothing here can
// change interview behavior, even if the transition table below turns
// out to be wrong or incomplete.
//
// States (per Rev4 architecture doc): FREE, QUESTION_READY, SPEAKING,
// WAITING_FOR_RESPONSE, LISTENING, PROCESSING, COMPLETED.
//
// SPEAKING_PENDING (the existing InterviewVoiceController concept of "a
// new notify() arrived while still speaking") is intentionally NOT a
// top-level state here -- it's carried as a sub-flag on SPEAKING
// (hasQueuedNext), per the architecture note's reasoning: Rev4's state
// list doesn't include a queued state, so this avoids inventing one.

(function (global) {
  'use strict';

  var TRANSITIONS = {
    FREE:                 ['QUESTION_READY'],
    QUESTION_READY:       ['SPEAKING'],
    SPEAKING:             ['WAITING_FOR_RESPONSE', 'SPEAKING'], // SPEAKING->SPEAKING = queued-next flag only, see hasQueuedNext
    WAITING_FOR_RESPONSE: ['LISTENING'],
    LISTENING:            ['PROCESSING'],
    PROCESSING:           ['QUESTION_READY', 'COMPLETED'],
    COMPLETED:            []
  };
  // ANY -> FREE is always legal (call-end / hard reset escape hatch),
  // handled separately below rather than duplicated into every row above.

  function InterviewStateMachine() {
    this._state = 'FREE';
    this._sinceMs = Date.now();
    this._seq = 0;
    this._history = [];
  }

  InterviewStateMachine.prototype.getState = function () {
    return this._state;
  };

  InterviewStateMachine.prototype.getHistory = function () {
    return this._history.slice();
  };

  /**
   * Report an inferred transition. Never throws, never blocks -- purely
   * additive logging. Enhancements per founder sign-off (2026-08-04):
   *   1. durationInPrevStateMs -- time spent in the state being left.
   *   2. reason -- why this transition is happening, supplied by the
   *      call site (e.g. "speech_ended_naturally", "answer_submitted").
   *   3. seq -- monotonically increasing across this session, so the
   *      full ordering survives even if timestamps ever collide or logs
   *      interleave with other subsystems.
   *
   * @param {string} nextState
   * @param {Object} [meta]
   * @param {string} [meta.reason] - human-readable cause of this transition
   * @param {string|number} [meta.turnId]
   * @param {string|number} [meta.questionVersion]
   * @param {boolean} [meta.hasQueuedNext] - only meaningful for SPEAKING->SPEAKING
   */
  InterviewStateMachine.prototype.transition = function (nextState, meta) {
    meta = meta || {};
    var now = Date.now();
    var prevState = this._state;
    var durationInPrevStateMs = now - this._sinceMs;

    // No-op guard: re-reporting the same state (e.g. every keystroke
    // firing the LISTENING check) updates nothing and logs nothing --
    // keeps the log to one line per REAL transition, not one per event.
    if (nextState === prevState && !(nextState === 'SPEAKING' && meta.hasQueuedNext)) {
      return;
    }

    var isEscapeHatch = (nextState === 'FREE' && prevState !== 'FREE');
    var allowed = (TRANSITIONS[prevState] || []).indexOf(nextState) !== -1;
    var legal = allowed || isEscapeHatch;

    this._seq += 1;
    var entry = {
      seq: this._seq,
      prevState: prevState,
      nextState: nextState,
      legal: legal,
      reason: meta.reason || null,
      durationInPrevStateMs: durationInPrevStateMs,
      turnId: meta.turnId || null,
      questionVersion: (meta.questionVersion !== undefined ? meta.questionVersion : null),
      timestamp: now
    };
    this._history.push(entry);

    var tag = legal ? '[FSM]' : '[FSM-ILLEGAL]';
    console.log(
      tag + ' seq=' + entry.seq +
      ' ' + prevState + ' \u2192 ' + nextState +
      ' reason=' + entry.reason +
      ' durationInPrevStateMs=' + entry.durationInPrevStateMs +
      ' turnId=' + entry.turnId +
      ' questionVersion=' + entry.questionVersion
    );

    // Only actually move state on a legal transition (including the
    // escape hatch). An illegal transition is recorded for diagnostics
    // but the observed state does NOT change underneath it -- otherwise
    // a single miscategorized event could desync this module's own
    // notion of "current state" from reality for the rest of the
    // session. This is still purely observational: nothing outside this
    // module reads _state to make a decision yet (that's Rev4A.2).
    if (legal) {
      this._state = nextState;
      this._sinceMs = now;
    }
  };

  /**
   * Cross-check against the existing UI-display state machine
   * (setAIState in interview-session.ejs). Logs a divergence when the
   * two disagree, without altering either. See architecture note §3 --
   * this is the main diagnostic value of A.1: real evidence of how often
   * the current display state already drifts from a clean model.
   */
  var UI_STATE_TO_FSM_STATE = {
    LISTENING: 'LISTENING',
    ANALYZING: 'PROCESSING',
    GENERATING: 'PROCESSING',
    SESSION_COMPLETE: 'COMPLETED',
    GENERATING_REPORT: 'PROCESSING',
    FINISHED: 'COMPLETED'
    // PREPARING/CALIBRATING/READY intentionally unmapped -- pre-interview
    // and momentary states with no single clean FSM equivalent yet.
  };
  InterviewStateMachine.prototype.checkUiDivergence = function (uiStateKey) {
    var expected = UI_STATE_TO_FSM_STATE[uiStateKey];
    if (!expected) return; // unmapped UI state -- not a diagnostic gap, just not modeled yet
    if (expected !== this._state) {
      console.log(
        '[FSM-DIVERGENCE] setAIState(\'' + uiStateKey + '\') expected FSM state=' + expected +
        ' but FSM is actually at=' + this._state +
        ' seq=' + this._seq
      );
    }
  };

  global.MedhaIQVoice = global.MedhaIQVoice || {};
  global.MedhaIQVoice.InterviewStateMachine = InterviewStateMachine;
  global.MedhaIQ_FSM = new InterviewStateMachine(); // single instance, session-scoped, matches InterviewVoiceController's own module pattern
})(window);
