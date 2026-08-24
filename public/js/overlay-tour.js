// public/js/overlay-tour.js
//
// "See How It Works" premium demo overlay. Dynamically loaded ONLY
// when the visitor clicks "See How It Works" on the real homepage
// (views/partials/hero.ejs) — never loaded otherwise.
//
// Architecture: a full-screen fixed overlay is appended to the current
// page. The REAL homepage underneath is never modified, highlighted,
// or interacted with — it simply continues existing, unchanged, behind
// the overlay. All content the visitor sees during the demo (including
// the "homepage" and "Platform menu" beats) plays inside ONE same-origin
// <iframe> inside the overlay, whose src is swapped as the demo
// progresses. Because the top-level document never navigates away,
// the shared dual-buffer audio elements are never destroyed — voiceover
// is genuinely continuous across every beat.
//
// Cinematic choreography (cursor movement, focus glow, click ripple,
// spotlight dimming) is provided by public/js/cinematic-fx.js, injected
// into whichever document the effect needs to run in (same-origin, so
// fully accessible for both real production pages and the fixture
// scene pages).
//
// No Vapi, no LLM calls, no DB writes, no Stripe, no credit
// consumption anywhere in this file.
(function () {
  if (window.__mhOverlayRunning__) return;
  window.__mhOverlayRunning__ = true;

  var overlay, iframe, closeBtn;
  var audioA = document.createElement('audio');
  var audioB = document.createElement('audio');
  [audioA, audioB].forEach(function (a) {
    a.preload = 'auto';
    a.muted = true;
    a.setAttribute('playsinline', '');
  });
  var activeAudio = audioA;
  var standbyAudio = audioB;
  var PRELOAD_LEAD_MS = 1500;
  var steps = null;
  var currentIndex = 0;
  var closed = false;

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'mhDemoOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#05070E;';

    iframe = document.createElement('iframe');
    iframe.id = 'mhDemoIframe';
    iframe.title = 'MedhaIQ';
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#0A0F1E;';
    overlay.appendChild(iframe);

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = [
      'position:absolute', 'top:20px', 'right:20px', 'z-index:10',
      'width:36px', 'height:36px', 'border-radius:50%',
      'background:rgba(10,15,30,0.55)', 'border:1px solid rgba(255,255,255,0.16)',
      'color:#F8FAFC', 'font-size:20px', 'line-height:1', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'backdrop-filter:blur(6px)', 'transition:background 0.15s ease',
    ].join(';');
    closeBtn.addEventListener('mouseenter', function () { closeBtn.style.background = 'rgba(10,15,30,0.8)'; });
    closeBtn.addEventListener('mouseleave', function () { closeBtn.style.background = 'rgba(10,15,30,0.55)'; });
    closeBtn.addEventListener('click', closeOverlay);
    overlay.appendChild(closeBtn);

    overlay.appendChild(audioA);
    overlay.appendChild(audioB);

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  }

  function closeOverlay() {
    if (closed) return;
    closed = true;
    activeAudio.pause();
    standbyAudio.pause();
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    window.__mhOverlayRunning__ = false;
  }

  function getIframeDoc() {
    try { return iframe.contentDocument; } catch (e) { return null; }
  }

  function injectFx(doc) {
    return new Promise(function (resolve) {
      if (!doc) return resolve();
      if (doc.defaultView && doc.defaultView.MHFx) return resolve();
      var script = doc.createElement('script');
      script.src = '/js/cinematic-fx.js';
      script.onload = function () { resolve(); };
      script.onerror = function () { resolve(); };
      doc.head.appendChild(script);
    });
  }

  function fx(doc) {
    return (doc && doc.defaultView && doc.defaultView.MHFx) ? doc.defaultView.MHFx : null;
  }

  // ---------------------------------------------------------------
  // Dual-buffer audio — identical proven pattern from the previous
  // build: preload the next clip while the current one plays, so
  // there's no perceptible gap between narration segments.
  // ---------------------------------------------------------------
  function swapAudioBuffers() {
    var tmp = activeAudio; activeAudio = standbyAudio; standbyAudio = tmp;
  }

  function preloadNextStep(nextIndex) {
    var next = steps[nextIndex];
    if (!next) return;
    standbyAudio.src = next.audioSrc;
    standbyAudio.load();
  }

  function playActiveStepAudio(step, onAdvance) {
    var handled = false;
    if (activeAudio.src.indexOf(step.audioSrc) === -1) {
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
      var dur = (activeAudio.duration && isFinite(activeAudio.duration)) ? activeAudio.duration * 1000 : (step.endS - step.startS) * 1000;
      var leadTimer = setTimeout(function () { preloadNextStep(currentIndex + 1); }, Math.max(dur - PRELOAD_LEAD_MS, 0));
      // The overlay itself only exists because of a real, synchronous
      // click on "See How It Works" — browsers generally permit
      // unmuted autoplay following a genuine user gesture. Try that
      // first (real sound, no separate "Enable Voice" control needed,
      // matching the approved minimal chrome); silently fall back to
      // muted playback if the browser blocks it regardless.
      activeAudio.muted = false;
      activeAudio.play().catch(function () {
        activeAudio.muted = true;
        activeAudio.play().catch(function () { clearTimeout(leadTimer); finishWithFallback(); });
      });
      activeAudio.addEventListener('ended', function () {
        clearTimeout(leadTimer);
        swapAudioBuffers();
        onAdvance();
      }, { once: true });
    }, { once: true });

    activeAudio.addEventListener('error', finishWithFallback, { once: true });
    setTimeout(finishWithFallback, 2500);
  }

  // ---------------------------------------------------------------
  // Per-step cinematic choreography. Each function runs inside the
  // CURRENT iframe document, using the fx library. Errors in any one
  // choreography step are swallowed (best-effort visual polish; a
  // missing selector should never break the demo's progression).
  // ---------------------------------------------------------------
  function safe(fn) {
    try { return fn(); } catch (e) { return Promise.resolve(); }
  }

  var CHOREOGRAPHY = {
    'homepage': function (doc) {
      var M = fx(doc);
      if (!M) return Promise.resolve();
      var trigger = doc.getElementById('mh-platform-trigger');
      if (!trigger) return Promise.resolve();
      return M.demonstrateClick(doc, trigger, { moveMs: 900, settleMs: 300 });
    },
    'platform-menu': function (doc) {
      var M = fx(doc);
      if (!M) return Promise.resolve();
      var wrap = doc.getElementById('mh-platform-wrap');
      var trigger = doc.getElementById('mh-platform-trigger');
      if (wrap && !wrap.classList.contains('mh-mega-open') && trigger) trigger.click();
      return M.wait(300).then(function () {
        var items = doc.querySelectorAll('#mh-megamenu a, .mh-nav-item-mega a, #mh-platform-wrap a');
        var menuPanel = doc.getElementById('mh-megamenu') || wrap;
        var zoomP = menuPanel ? M.zoomToward(doc, menuPanel, { scale: 1.05, duration: 750 }) : M.wait(0);
        return zoomP.then(function () {
          if (items && items.length > 0) {
            M.focusGlow(doc, items[0]);
            return M.wait(1700).then(function () {
              if (items.length > 1) M.focusGlow(doc, items[1]);
              return M.wait(1500);
            });
          }
        });
      }).then(function () {
        M.focusGlow(doc, null);
        return M.zoomReset(doc, { duration: 650 });
      });
    },
    'interview-setup': function (doc) {
      var M = fx(doc);
      if (!M) return Promise.resolve();
      var roleGrid = doc.querySelector('.role-grid');
      if (!roleGrid) return Promise.resolve();
      return M.zoomToward(doc, roleGrid, { scale: 1.06, duration: 850 }).then(function () {
        M.focusGlow(doc, roleGrid);
        return M.moveCursorTo(doc, roleGrid, 700);
      }).then(function () {
        return M.wait(1900);
      }).then(function () {
        M.hideCursor(doc);
        M.focusGlow(doc, null);
        return M.zoomReset(doc, { duration: 650 });
      });
    },
    'persona': function (doc) {
      var M = fx(doc);
      if (!M) return Promise.resolve();
      var grid = doc.querySelector('.persona-grid');
      var card = doc.querySelector('.persona-card[data-persona="marcus_webb"]') || doc.querySelector('.persona-card');
      if (grid) M.focusGlow(doc, grid);
      if (!card) return M.wait(1500);
      return M.wait(500).then(function () {
        return M.demonstrateClick(doc, card, { moveMs: 750, settleMs: 250 });
      }).then(function () {
        card.click();
        return M.wait(1200);
      }).then(function () { M.focusGlow(doc, null); });
    },
    'interview-live': function () { return Promise.resolve(); }, // hero moment: its own timeline JS handles motion; camera stays wide/still per "use sparingly"
    'report': function (doc) {
      var M = fx(doc);
      if (!M) return Promise.resolve();
      var score = doc.querySelector('.report-hero-score');
      var vectors = doc.querySelector('.report-hero-vectors');
      var evidence = doc.querySelector('.report-grid');
      var seq = [score, vectors, evidence].filter(Boolean);
      var p = M.wait(200);
      seq.forEach(function (el, i) {
        p = p.then(function () {
          return M.zoomToward(doc, el, { scale: 1.05, duration: 750 });
        }).then(function () {
          M.spotlight(doc, el);
          return M.wait(i === seq.length - 1 ? 2900 : 2300);
        });
      });
      return p.then(function () {
        M.spotlight(doc, null);
        return M.zoomReset(doc, { duration: 650 });
      });
    },
    'career-workspace': function (doc) {
      var M = fx(doc);
      if (!M) return Promise.resolve();
      var history = doc.querySelector('.pair-row--activity') || doc.querySelector('main');
      if (!history) return Promise.resolve();
      return M.zoomToward(doc, history, { scale: 1.05, duration: 800 }).then(function () {
        M.focusGlow(doc, history);
        return M.wait(2600);
      }).then(function () {
        M.focusGlow(doc, null);
        return M.zoomReset(doc, { duration: 650 });
      });
    },
    'closing': function () { return Promise.resolve(); },
  };

  function runStep() {
    var step = steps[currentIndex];
    if (!step) { closeOverlay(); return; }
    if (closed) return;

    var targetSrc = step.src;
    var needsNav = iframe.getAttribute('data-current-src') !== targetSrc;

    function afterLoad() {
      if (closed) return;
      var doc = getIframeDoc();
      injectFx(doc).then(function () {
        var choreo = CHOREOGRAPHY[step.id] || function () { return Promise.resolve(); };
        safe(function () { return choreo(doc); });
        playActiveStepAudio(step, function () {
          currentIndex += 1;
          runStep();
        });
      });
    }

    if (needsNav) {
      iframe.setAttribute('data-current-src', targetSrc);
      iframe.onload = function () {
        iframe.onload = null;
        setTimeout(afterLoad, 150);
      };
      iframe.src = targetSrc;
    } else {
      afterLoad();
    }
  }

  buildOverlay();

  fetch('/demo/tour/steps.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      steps = data;
      runStep();
    })
    .catch(function (err) {
      console.error('[overlay-tour] Failed to load tour steps:', err);
      closeOverlay();
    });
})();
