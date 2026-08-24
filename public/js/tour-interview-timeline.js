// public/js/tour-interview-timeline.js
//
// Drives the scripted animation for the guided-tour's interview scene
// (views/demo/tour-scenes/interview.ejs). Runs entirely inside this
// scene's own iframe document — no communication with the parent tour
// shell is required for the animation itself. Zero network calls, zero
// Vapi/API usage; all content comes from window.__MH_TOUR_INTERVIEW_SCRIPT__,
// server-rendered from data/demo/walkthrough-fixture.js.
(function () {
  var script = window.__MH_TOUR_INTERVIEW_SCRIPT__;
  if (!script) return;

  var startedAt = performance.now();
  var timerEl = document.getElementById('tourTimer');
  var qCounterEl = document.getElementById('tourQCounter');
  var followupBadge = document.getElementById('tourFollowupBadge');
  var questionTextEl = document.getElementById('tourQuestionText');
  var qEyebrowEl = document.getElementById('tourQEyebrow');
  var transcriptEl = document.getElementById('tourTranscript');
  var scoreToastEl = document.getElementById('tourScoreToast');
  var toastScoreEl = document.getElementById('tourToastScore');
  var ringFillEl = document.getElementById('tourRingFill');
  var ringLabelEl = document.getElementById('tourRingLabel');

  var VECTOR_EL = {
    structure: { fill: document.getElementById('tourVecStructure'), val: document.getElementById('tourVecStructureV') },
    domain: { fill: document.getElementById('tourVecDomain'), val: document.getElementById('tourVecDomainV') },
    strategy: { fill: document.getElementById('tourVecStrategy'), val: document.getElementById('tourVecStrategyV') },
    communication: { fill: document.getElementById('tourVecCommunication'), val: document.getElementById('tourVecCommunicationV') },
    leadership: { fill: document.getElementById('tourVecLeadership'), val: document.getElementById('tourVecLeadershipV') },
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  var timerInterval = setInterval(function () {
    var elapsedSec = Math.floor((performance.now() - startedAt) / 1000);
    if (timerEl) timerEl.textContent = pad(Math.floor(elapsedSec / 60)) + ':' + pad(elapsedSec % 60);
  }, 250);

  function typeLine(line, container, onDone) {
    container.innerHTML = '';
    var p = document.createElement('div');
    p.className = 'mh-demo-transcript-line';
    container.appendChild(p);
    var i = 0;
    var interval = setInterval(function () {
      p.textContent = line.slice(0, i + 1);
      i++;
      if (i >= line.length) {
        clearInterval(interval);
        if (onDone) onDone();
      }
    }, 16);
  }

  function applyTurn(turn) {
    if (turn.qEyebrow) {
      qEyebrowEl.textContent = turn.qEyebrow;
      questionTextEl.textContent = turn.questionText;
      followupBadge.style.display = turn.isFollowUp ? 'inline-flex' : 'none';
      if (turn.isFollowUp) qCounterEl.textContent = 'Question 2 / 5';
    }
    if (turn.transcriptLine) {
      typeLine(turn.transcriptLine, transcriptEl);
    }
    if (turn.starProgress) {
      turn.starProgress.forEach(function (step) {
        var node = document.getElementById('tourStar-' + step);
        if (node) node.classList.add('done');
      });
    }
    if (turn.vectors) {
      Object.keys(turn.vectors).forEach(function (key) {
        var target = VECTOR_EL[key];
        if (!target || !target.fill) return;
        var v = turn.vectors[key];
        target.fill.style.width = v + '%';
        target.val.textContent = v;
      });
    }
    if (typeof turn.overallScore === 'number') {
      var circumference = 213;
      var offset = circumference - (turn.overallScore / 100) * circumference;
      ringFillEl.style.strokeDashoffset = offset;
      ringLabelEl.textContent = turn.overallScore;
      toastScoreEl.textContent = turn.overallScore;
      scoreToastEl.classList.add('show');
    }
  }

  script.turns.forEach(function (turn) {
    setTimeout(function () { applyTurn(turn); }, turn.atMs);
  });

  setTimeout(function () { clearInterval(timerInterval); }, script.totalDurationMs);
})();
