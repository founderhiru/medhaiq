// public/js/guided-tour.js
//
// Single controller for the entire continuous guided tour. Dynamically
// loaded ONLY when the visitor clicks "See How It Works" on the real
// homepage (views/partials/hero.ejs) — never loaded otherwise, so it
// costs nothing for any other visit.
//
// Architecture: the top-level browser document NEVER navigates away
// from "/" for the whole tour. This is deliberate, for two reasons:
//   1. Voiceover continuity — a single shared <audio> pair lives in
//      this document for the entire tour. A page navigation would
//      destroy and recreate the audio context, causing an audible gap.
//      Since the document never unloads, narration is genuinely
//      continuous, and the next clip is preloaded into a second,
//      inactive <audio> element before the current one finishes.
//   2. Visual seamlessness — steps 1-2 highlight real elements
//      directly on the live homepage. Steps 3+ dynamically insert one
//      full-viewport, borderless, same-origin <iframe> into this same
//      document and swap its src as the tour progresses. Because nothing
//      navigates, there is no separate "shell page," no duplicate
//      header, and no visible frame chrome — just the real homepage,
//      then the real/fixture page filling the entire viewport.
//
// No Vapi, no LLM calls, no DB writes, no Stripe, no credit
// consumption anywhere in this file. Voiceover is optional per step
// (public/audio/tour/*.mp3) and the whole experience works perfectly
// as a silent visual walkthrough when those files don't exist yet.
(function () {
  if (window.__mhGuidedTourRunning__) return;
  window.__mhGuidedTourRunning__ = true;

  var steps = null;

  function start() {
    ensureStylesheet();
    injectChrome();
    runStep();
  }

  fetch('/demo/tour/steps.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      steps = data;
      start();
    })
    .catch(function (err) {
      console.error('[guided-tour] Failed to load tour steps:', err);
    });

  var PRELOAD_LEAD_MS = 1500; // start loading next clip this long before current ends

  // ---------------------------------------------------------------
  // Chrome: thin progress line + Skip tour. Injected once, persists
  // for the entire tour since the document never unloads.
  // ---------------------------------------------------------------
  function ensureStylesheet() {
    if (document.getElementById('mhTourStylesheet')) return;
    var link = document.createElement('link');
    link.id = 'mhTourStylesheet';
    link.rel = 'stylesheet';
    link.href = '/css/demo-walkthrough.css';
    document.head.appendChild(link);
  }

  function injectChrome() {
    if (document.getElementById('mhTourChrome')) return;
    var chrome = document.createElement('div');
    chrome.className = 'mh-tour-chrome';
    chrome.id = 'mhTourChrome';
    chrome.innerHTML =
      '<div class="mh-tour-progress-track"><div class="mh-tour-progress-fill" id="mhTourProgressFill"></div></div>' +
      '<button type="button" class="mh-tour-skip" id="mhTourSkip">Skip tour</button>';
    document.body.appendChild(chrome);

    var voiceBtn = document.createElement('button');
    voiceBtn.type = 'button';
    voiceBtn.id = 'mhEnableVoiceBtn';
    voiceBtn.className = 'mh-enable-voice-btn';
    voiceBtn.style.display = 'none';
    voiceBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.5 8.5a5 5 0 0 1 0 7"></path></svg>Enable Voice';
    document.body.appendChild(voiceBtn);

    document.getElementById('mhTourSkip').addEventListener('click', endTour);
  }

  function updateProgress(index) {
    var fill = document.getElementById('mhTourProgressFill');
    if (fill) fill.style.width = Math.round(((index + 1) / steps.length) * 100) + '%';
  }

  // ---------------------------------------------------------------
  // Seamless full-viewport iframe — created once, on demand, the
  // first time a step needs it. No border, no chrome of its own; it
  // simply becomes the entire visible content area.
  // ---------------------------------------------------------------
  var iframe = null;
  function ensureIframe() {
    if (iframe) return iframe;
    iframe = document.createElement('iframe');
    iframe.id = 'mhTourIframe';
    iframe.title = 'MedhaIQ';
    iframe.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99990;background:#0A0F1E;';
    document.body.appendChild(iframe);
    return iframe;
  }

  function removeIframe() {
    if (iframe) { iframe.remove(); iframe = null; }
  }

  function getIframeDoc() {
    if (!iframe) return null;
    try { return iframe.contentDocument; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------
  // Highlight ring — appended to whichever document (homepage or the
  // iframe's contentDocument, same-origin) currently needs it.
  // ---------------------------------------------------------------
  function removeHighlight(hostDoc) {
    var doc = hostDoc || document;
    var ring = doc.getElementById('mhTourHighlightRing');
    if (ring) ring.remove();
  }

  function highlight(targetEl, hostDoc) {
    var doc = hostDoc || document;
    removeHighlight(doc);
    if (!targetEl) return;
    var rect = targetEl.getBoundingClientRect();
    var ring = doc.createElement('div');
    ring.id = 'mhTourHighlightRing';
    // Fully self-contained inline styling — this ring may be appended
    // to a real production page's document (e.g. the real
    // /preview/interview page inside the iframe) which never loads
    // demo-walkthrough.css. Relying on that external class here would
    // silently render an invisible, unstyled box in that document.
    ring.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:99998',
      'border:2px solid #3B82F6',
      'border-radius:10px',
      'box-shadow:0 0 0 4px rgba(59,130,246,0.18), 0 0 24px rgba(59,130,246,0.35)',
      'transition:all 0.3s ease',
      'top:' + (rect.top - 6) + 'px',
      'left:' + (rect.left - 6) + 'px',
      'width:' + (rect.width + 12) + 'px',
      'height:' + (rect.height + 12) + 'px',
    ].join(';');
    doc.body.appendChild(ring);
  }

  // ---------------------------------------------------------------
  // Dual-buffer audio — two <audio> elements, alternating. While the
  // active one plays step N, the inactive one preloads step N+1 so
  // there's no fetch/decode latency at the switch point. Both start
  // muted (browsers reliably autoplay muted); "Enable Voice" unmutes
  // whichever is active and the preference persists across the swap.
  // ---------------------------------------------------------------
  var audioA = document.createElement('audio');
  var audioB = document.createElement('audio');
  [audioA, audioB].forEach(function (a) {
    a.preload = 'auto';
    a.muted = true;
    a.setAttribute('playsinline', '');
    document.body.appendChild(a);
  });
  var activeAudio = audioA;
  var standbyAudio = audioB;
  var voiceEnabled = false;

  function swapAudioBuffers() {
    var tmp = activeAudio;
    activeAudio = standbyAudio;
    standbyAudio = tmp;
  }

  function bindVoiceButtonOnce() {
    var voiceBtn = document.getElementById('mhEnableVoiceBtn');
    if (!voiceBtn || voiceBtn._mhBound) return;
    voiceBtn._mhBound = true;
    voiceBtn.addEventListener('click', function () {
      voiceEnabled = true;
      activeAudio.muted = false;
      standbyAudio.muted = false;
      voiceBtn.style.display = 'none';
    });
  }

  // ---------------------------------------------------------------
  // Step engine
  // ---------------------------------------------------------------
  var currentIndex = 0;

  function endTour() {
    removeIframe();
    removeHighlight(document);
    activeAudio.pause();
    standbyAudio.pause();
    var chrome = document.getElementById('mhTourChrome');
    if (chrome) chrome.remove();
    var voiceBtn = document.getElementById('mhEnableVoiceBtn');
    if (voiceBtn) voiceBtn.remove();
    audioA.remove();
    audioB.remove();
    window.__mhGuidedTourRunning__ = false;
  }

  function preloadNextStep(nextIndex) {
    var next = steps[nextIndex];
    if (!next) return;
    standbyAudio.src = next.audioSrc;
    standbyAudio.load();
  }

  function playActiveStepAudio(step, onAdvance) {
    var voiceBtn = document.getElementById('mhEnableVoiceBtn');
    var handled = false;
    activeAudio.muted = !voiceEnabled;
    if (activeAudio.currentSrc !== step.audioSrc && activeAudio.src.indexOf(step.audioSrc) === -1) {
      activeAudio.src = step.audioSrc;
      activeAudio.currentTime = 0;
      activeAudio.load();
    }

    function finishWithFallback() {
      if (handled) return;
      handled = true;
      var dwellMs = (step.endS - step.startS) * 1000;
      var leadTimer = setTimeout(function () { preloadNextStep(currentIndex + 1); }, Math.max(dwellMs - PRELOAD_LEAD_MS, 0));
      setTimeout(function () { clearTimeout(leadTimer); onAdvance(); }, dwellMs);
    }

    activeAudio.addEventListener('canplay', function onCanPlay() {
      if (handled) return;
      handled = true;
      bindVoiceButtonOnce();
      if (!voiceEnabled && voiceBtn) voiceBtn.style.display = 'inline-flex';
      var dur = (activeAudio.duration && isFinite(activeAudio.duration)) ? activeAudio.duration * 1000 : (step.endS - step.startS) * 1000;
      var leadTimer = setTimeout(function () { preloadNextStep(currentIndex + 1); }, Math.max(dur - PRELOAD_LEAD_MS, 0));
      activeAudio.play().catch(function () { clearTimeout(leadTimer); finishWithFallback(); });
      activeAudio.addEventListener('ended', function () {
        clearTimeout(leadTimer);
        swapAudioBuffers();
        onAdvance();
      }, { once: true });
    }, { once: true });

    activeAudio.addEventListener('error', finishWithFallback, { once: true });
    setTimeout(finishWithFallback, 2500);
  }

  function applyHomepageStep(step) {
    if (step.id === 'homepage') {
      highlight(document.getElementById('mh-platform-trigger'), document);
    } else if (step.id === 'platform-menu') {
      removeHighlight(document);
      var wrap = document.getElementById('mh-platform-wrap');
      var trigger = document.getElementById('mh-platform-trigger');
      if (wrap && !wrap.classList.contains('mh-mega-open') && trigger) trigger.click();
    }
  }

  function applyIframeStep(step, doc) {
    if (!doc) return;
    if (step.id === 'interview-setup') {
      highlight(doc.querySelector('.role-grid'), doc);
    } else if (step.id === 'persona') {
      var grid = doc.querySelector('.persona-grid');
      highlight(grid, doc);
      var already = doc.querySelector('.persona-card.active');
      if (!already) {
        setTimeout(function () {
          var card = doc.querySelector('.persona-card[data-persona="marcus_webb"]') || doc.querySelector('.persona-card');
          if (card && !doc.querySelector('.persona-card.active')) card.click();
        }, Math.max((step.endS - step.startS) * 1000 - 2000, 500));
      }
    } else {
      removeHighlight(doc);
    }
  }

  function runStep() {
    var step = steps[currentIndex];
    if (!step) { endTour(); return; }
    updateProgress(currentIndex);

    if (step.mode === 'live-homepage') {
      removeIframe();
      applyHomepageStep(step);
      playActiveStepAudio(step, function () { currentIndex += 1; runStep(); });
      return;
    }

    // iframe-real or iframe-scene
    var frame = ensureIframe();
    var needsNav = frame.getAttribute('data-current-src') !== step.src;
    if (needsNav) {
      frame.setAttribute('data-current-src', step.src);
      frame.onload = function () {
        frame.onload = null;
        setTimeout(function () {
          applyIframeStep(step, getIframeDoc());
          playActiveStepAudio(step, function () { currentIndex += 1; runStep(); });
        }, 120);
      };
      frame.src = step.src;
    } else {
      applyIframeStep(step, getIframeDoc());
      playActiveStepAudio(step, function () { currentIndex += 1; runStep(); });
    }
  }
})();
