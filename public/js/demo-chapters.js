// public/js/demo-chapters.js
//
// Drives the 5-chapter interactive "See How It Works" walkthrough
// (views/demo/how-it-works.ejs). No network calls other than the
// optional per-chapter audio file; no Vapi, no Stripe, no DB, no
// analytics. Designed to work perfectly as a pure visual walkthrough
// when NO audio files exist yet (public/audio/demo/*.mp3 are not
// created until real voiceover is generated).
(function () {
  var chapters = window.__MH_CHAPTERS__ || [];
  var closing = window.__MH_CLOSING__ || null;
  var allBeats = chapters.concat(closing ? [closing] : []);

  var nav = document.getElementById('mhChapterNav');
  var stage = document.getElementById('mhChapterStage');
  var audio = document.getElementById('mhChapterAudio');
  var enableVoiceBtn = document.getElementById('mhEnableVoiceBtn');

  if (!stage || !audio || allBeats.length === 0) return;

  var panels = Array.prototype.slice.call(stage.querySelectorAll('.mh-chapter-panel'));
  var navItems = nav ? Array.prototype.slice.call(nav.querySelectorAll('.mh-chapter-nav-item')) : [];

  var currentIndex = 0;
  var fallbackTimer = null;
  var voiceEnabled = false;       // persists across chapters once the visitor opts in
  var audioEverAvailable = false; // becomes true the first time any chapter's audio actually loads

  function clearFallbackTimer() {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function showEnableVoiceButton() {
    if (!enableVoiceBtn || voiceEnabled) return;
    enableVoiceBtn.style.display = 'inline-flex';
  }

  function hideEnableVoiceButton() {
    if (!enableVoiceBtn) return;
    enableVoiceBtn.style.display = 'none';
  }

  function activatePanel(index) {
    panels.forEach(function (panel) {
      var isMatch = Number(panel.getAttribute('data-chapter-index')) === index;
      panel.classList.toggle('is-active', isMatch);
    });
    // Nav only covers the 5 numbered chapters (indices 0-4), not the
    // closing beat — guard against index 5 (closing) safely.
    navItems.forEach(function (item) {
      var isMatch = Number(item.getAttribute('data-chapter-index')) === index;
      item.classList.toggle('is-active', isMatch);
      item.setAttribute('aria-current', isMatch ? 'true' : 'false');
    });
  }

  function goToNext() {
    var nextIndex = currentIndex + 1;
    if (nextIndex >= allBeats.length) return; // end of experience, stay on closing
    activateChapter(nextIndex);
  }

  function activateChapter(index) {
    clearFallbackTimer();
    currentIndex = index;
    activatePanel(index);

    var beat = allBeats[index];
    if (!beat) return;

    if (!beat.audioSrc) {
      fallbackTimer = setTimeout(goToNext, beat.fallbackDurationMs || 9000);
      return;
    }

    // Attempt to play this chapter's audio. Muted by default so
    // browsers reliably allow autoplay; if the visitor has already
    // enabled voice, carry that preference forward immediately.
    audio.muted = !voiceEnabled;
    audio.src = beat.audioSrc;
    audio.currentTime = 0;
    audio.load();

    var handledOutcome = false;

    function onCanPlay() {
      if (handledOutcome) return;
      handledOutcome = true;
      audioEverAvailable = true;
      if (!voiceEnabled) showEnableVoiceButton();
      audio.play().catch(function () {
        // Autoplay itself (even muted) was blocked by the browser —
        // fall back to the visual timer so the walkthrough still
        // progresses on its own.
        fallbackTimer = setTimeout(goToNext, beat.fallbackDurationMs || 9000);
      });
    }

    function onEnded() {
      goToNext();
    }

    function onError() {
      if (handledOutcome) return;
      handledOutcome = true;
      // No audio file at this path (expected until real voiceover is
      // added) — proceed as a pure visual walkthrough for this chapter.
      fallbackTimer = setTimeout(goToNext, beat.fallbackDurationMs || 9000);
    }

    audio.addEventListener('canplay', onCanPlay, { once: true });
    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onError, { once: true });

    // Safety net: if neither canplay nor error fires within 2.5s
    // (unusual network hiccup), don't leave the walkthrough stalled.
    setTimeout(function () {
      if (!handledOutcome) {
        handledOutcome = true;
        fallbackTimer = setTimeout(goToNext, beat.fallbackDurationMs || 9000);
      }
    }, 2500);
  }

  // Chapter nav clicks — jump immediately, autoplay continues onward
  // from the clicked chapter.
  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var index = Number(item.getAttribute('data-chapter-index'));
      if (index === currentIndex) return;
      activateChapter(index);
    });
  });

  // Enable Voice — subtle, persistent once clicked. Does not pause or
  // restart the currently playing chapter audio.
  if (enableVoiceBtn) {
    enableVoiceBtn.addEventListener('click', function () {
      voiceEnabled = true;
      audio.muted = false;
      hideEnableVoiceButton();
    });
  }

  // Begin the experience at Chapter 01 immediately on load — no second
  // Play screen, no intermediate state.
  activateChapter(0);
})();
