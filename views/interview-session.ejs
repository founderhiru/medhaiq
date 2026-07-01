<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interview Session — MedhaIQ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <script src="https://cdn.jsdelivr.net/npm/@vapi-ai/web/dist/vapi.umd.js" crossorigin="anonymous"></script>
  <link rel="stylesheet" href="/css/interview.css">
  <script src="https://cdn.jsdelivr.net/npm/@vapi-ai/web/dist/vapi.umd.cjs" crossorigin="anonymous"></script>
</head>
<body>

<div class="session-page">
  <div class="session-topbar">
    <div class="topbar-left">
      <div class="avatar <%= personaStyleColor %>" id="personaAvatar"></div>
      <div>
        <div class="topbar-name" id="personaName"></div>
        <div class="topbar-title" id="personaTitle"></div>
      </div>
    </div>
    <div class="topbar-center" id="questionCounter">Question 1 of 5</div>
    <div class="topbar-right" style="display:flex;align-items:center;gap:15px;">
      <video id="webcamPreview" autoplay playsinline muted
        style="width:40px;height:40px;border-radius:50%;background:#2a2a40;object-fit:cover;transform:scaleX(-1);display:none;border:2px solid #4f46e5;">
      </video>
      <button id="vapiBtn" class="end-btn" style="background:#2563eb;">Enable Audio/Video</button>
      <span id="vapiStatus" style="font-size:11px;color:#9ca3af;"></span>
      <span class="timer" id="timer">00:00</span>
      <button class="end-btn" id="endBtn">End Session</button>
    </div>
  </div>

  <div class="question-stage" id="stage">
    <div class="question-card" id="questionCard">
      <div class="question-text" id="questionText">Loading...</div>
    </div>
    <div class="answer-area" id="answerArea">
      <textarea
        class="answer-textarea"
        id="answerInput"
        placeholder="Type your answer here..."
        maxlength="4000"
      ></textarea>
      <div class="char-count" id="charCount">0 / 4000</div>
      <div class="answer-actions">
        <button class="submit-btn" id="submitBtn" disabled>Submit Answer</button>
        <button class="skip-btn" id="skipBtn">Skip →</button>
      </div>
    </div>
  </div>

  <div class="loading-state" id="loadingState" style="display:none;">
    <div class="loading-dots"><span></span><span></span><span></span></div>
    <div class="loading-text" id="loadingText">Reviewing your answer...</div>
  </div>

  <div class="score-badge" id="scoreBadge">
    <div class="badge-label">Answer Score</div>
    <div class="badge-score" id="badgeScore">--</div>
  </div>
</div>

<script>
(function() {
  const sessionId = '<%= sessionId %>';
  let currentQuestionId = '<%= questionId %>';
  let questionCount = <%= answeredCount %> + 1;
  const maxQuestions = 5;
  let startTime = Date.now();
  let timerInterval;
  let personaInitials = '<%= personaInitials %>';
  let personaName = '<%= personaName %>';
  let personaTitle = '<%= personaTitle %>';
  let personaStyleColor = '<%= personaStyleColor %>';
  let questionType = '<%= questionType %>';
  const initialQuestionText = `<%- questionText.replace(/`/g, '\\`') %>`;

  document.getElementById('personaAvatar').textContent = personaInitials;
  document.getElementById('personaName').textContent = personaName;
  document.getElementById('personaTitle').textContent = personaTitle;
  document.getElementById('personaAvatar').className = 'avatar ' + personaStyleColor;

  function tick() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    document.getElementById('timer').textContent = mins + ':' + secs;
  }
  timerInterval = setInterval(tick, 1000);

  function updateCounter() {
    document.getElementById('questionCounter').textContent =
      'Question ' + questionCount + ' of ' + maxQuestions;
  }

  const answerInput = document.getElementById('answerInput');
  answerInput.addEventListener('input', function() {
    document.getElementById('charCount').textContent = this.value.length + ' / 4000';
    document.getElementById('submitBtn').disabled = !this.value.trim();
  });

  function showLoading(text) {
    document.getElementById('stage').style.display = 'none';
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('loadingText').textContent = text;
  }

  function showQuestion(q, type) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('stage').style.display = 'flex';
    document.getElementById('questionText').textContent = q.text;
    const card = document.getElementById('questionCard');
    const existingTip = card.querySelector('.question-tip');
    if (existingTip) existingTip.remove();
    if (type !== 'drill_down') {
      card.insertAdjacentHTML('beforeend',
        '<div class="question-tip">Tip: Use the STAR framework — Situation, Task, Action, Result.</div>');
    }
    answerInput.value = '';
    document.getElementById('charCount').textContent = '0 / 4000';
    document.getElementById('submitBtn').disabled = true;
    answerInput.focus();
  }

  function showScore(score) {
    const badge = document.getElementById('scoreBadge');
    const scoreEl = document.getElementById('badgeScore');
    scoreEl.textContent = score;
    scoreEl.className = 'badge-score ' + (score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low');
    badge.classList.add('show');
    setTimeout(() => badge.classList.remove('show'), 3000);
  }

  document.getElementById('submitBtn').addEventListener('click', submitAnswer);
  document.getElementById('skipBtn').addEventListener('click', function() { submitAnswer(true); });

  async function submitAnswer(skip) {
    const answerText = skip ? '' : answerInput.value.trim();
    if (!skip && !answerText) return;
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    showLoading(personaName + ' is reviewing your answer...');
    try {
      const resp = await fetch('/api/interview/sessions/' + sessionId + '/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: currentQuestionId, answerText, skip }),
      });
      const data = await resp.json();
      if (data.sessionEnded) {
        clearInterval(timerInterval);
        window.location.href = '/interview/report/' + data.reportId;
        return;
      }
      if (data.scores && !skip) {
        showScore(data.scores.weighted.toFixed(0));
      }
      currentQuestionId = data.question.id;
      questionCount++;
      updateCounter();
      showQuestion(data.question, data.question.type);
    } catch (err) {
      alert('Failed to submit. Please try again.');
      document.getElementById('stage').style.display = 'flex';
      document.getElementById('loadingState').style.display = 'none';
      btn.disabled = false;
    }
  }

  document.getElementById('endBtn').addEventListener('click', async function() {
    if (!confirm('End this interview session? You won\'t be able to continue.')) return;
    clearInterval(timerInterval);
    try {
      await fetch('/api/interview/sessions/' + sessionId, { method: 'DELETE' });
    } catch (e) {}
    window.location.href = '/dashboard/history';
  });

  updateCounter();
  if (initialQuestionText) {
    showQuestion({ text: initialQuestionText }, questionType);
  }
})();
</script>

<script>
(function() {
  const VAPI_PUBLIC_KEY   = '<%= vapiPublicKey %>';
  const VAPI_ASSISTANT_ID = '<%= vapiAssistantId %>';

  const btn    = document.getElementById('vapiBtn');
  const status = document.getElementById('vapiStatus');
  const webcam = document.getElementById('webcamPreview');

  if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID || typeof window.Vapi === 'undefined') {
    btn.style.display = 'none';
    return;
  }

  const vapi = new window.Vapi(VAPI_PUBLIC_KEY);
  let isLive = false;
  let webcamStream = null;

  async function startWebcam() {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      webcam.srcObject = webcamStream;
      webcam.style.display = 'block';
    } catch (e) {
      console.warn('[MedhaIQ] Webcam not available:', e.message);
    }
  }

  function stopWebcam() {
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
    webcam.style.display = 'none';
  }

  btn.addEventListener('click', function() {
    if (!isLive) {
      btn.textContent = 'Connecting...';
      btn.disabled = true;
      vapi.start(VAPI_ASSISTANT_ID, {
        variableValues: {
          personaName:     '<%= personaName %>',
          personaTitle:    '<%= personaTitle %>',
          roleTitle:       '<%= roleTitle || "" %>',
          experienceLevel: '<%= experienceLevel || "" %>',
          orgPreset:       '<%= orgPreset || "" %>',
        }
      });
      startWebcam();
    } else {
      vapi.stop();
      stopWebcam();
    }
  });

  vapi.on('call-start', function() {
    isLive = true;
    btn.textContent = 'End Voice Session';
    btn.style.background = '#dc2626';
    btn.disabled = false;
    status.textContent = '● Voice active';
    status.style.color = '#22c55e';
  });

  vapi.on('call-end', function() {
    isLive = false;
    btn.textContent = 'Enable Audio/Video';
    btn.style.background = '#2563eb';
    btn.disabled = false;
    status.textContent = 'Session ended';
    status.style.color = '#9ca3af';
    stopWebcam();
  });

  vapi.on('speech-start', function() {
    status.textContent = '● AI speaking';
    status.style.color = '#a78bfa';
  });

  vapi.on('speech-end', function() {
    status.textContent = '● Voice active';
    status.style.color = '#22c55e';
  });

  vapi.on('error', function(e) {
    console.error('[Vapi]', e);
    isLive = false;
    btn.textContent = 'Retry Voice';
    btn.style.background = '#2563eb';
    btn.disabled = false;
    status.textContent = 'Error — check console';
    status.style.color = '#ef4444';
    stopWebcam();
  });
})();
</script>

</body>
</html>