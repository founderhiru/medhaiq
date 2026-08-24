// public/js/cinematic-fx.js
//
// Shared cinematic primitives for the "See How It Works" premium demo
// overlay. Loaded into EVERY document the demo shows — both real
// production pages (via dynamic injection from the parent overlay
// controller, since those pages don't reference this file themselves)
// and the fixture-driven scene pages (which include it directly).
// Exposes window.MHFx. No network calls beyond loading this file
// itself; purely visual DOM/CSS effects.
(function () {
  if (window.MHFx) return;

  var STYLE_ID = 'mh-fx-styles';

  function ensureStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mh-fx-cursor{position:fixed;width:22px;height:22px;z-index:2147483000;pointer-events:none;',
      'transition:left 0.65s cubic-bezier(.4,0,.2,1),top 0.65s cubic-bezier(.4,0,.2,1),opacity 0.25s ease;opacity:0;}',
      '.mh-fx-cursor svg{width:100%;height:100%;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.45));}',
      '.mh-fx-cursor.mh-fx-visible{opacity:1;}',
      '.mh-fx-ripple{position:fixed;width:14px;height:14px;border-radius:50%;',
      'background:rgba(59,130,246,0.55);z-index:2147482999;pointer-events:none;',
      'transform:translate(-50%,-50%) scale(0);animation:mh-fx-ripple-anim 0.6s ease-out forwards;}',
      '@keyframes mh-fx-ripple-anim{0%{transform:translate(-50%,-50%) scale(0);opacity:0.9;}',
      '100%{transform:translate(-50%,-50%) scale(4.5);opacity:0;}}',
      '.mh-fx-glow{position:fixed;pointer-events:none;z-index:2147482998;border-radius:12px;',
      'box-shadow:0 0 0 1px rgba(96,165,250,0.55), 0 0 26px 4px rgba(59,130,246,0.35);',
      'transition:top 0.5s cubic-bezier(.4,0,.2,1),left 0.5s cubic-bezier(.4,0,.2,1),',
      'width 0.5s cubic-bezier(.4,0,.2,1),height 0.5s cubic-bezier(.4,0,.2,1),opacity 0.4s ease;opacity:0;}',
      '.mh-fx-glow.mh-fx-visible{opacity:1;}',
      '.mh-fx-spotlight{position:fixed;pointer-events:none;z-index:2147482997;border-radius:14px;',
      'box-shadow:0 0 0 9999px rgba(4,6,14,0.58);',
      'transition:top 0.55s cubic-bezier(.4,0,.2,1),left 0.55s cubic-bezier(.4,0,.2,1),',
      'width 0.55s cubic-bezier(.4,0,.2,1),height 0.55s cubic-bezier(.4,0,.2,1),opacity 0.45s ease;opacity:0;}',
      '.mh-fx-spotlight.mh-fx-visible{opacity:1;}',
    ].join('');
    doc.head.appendChild(style);
  }

  function ensureCursor(doc) {
    var cursor = doc.getElementById('mhFxCursor');
    if (cursor) return cursor;
    cursor = doc.createElement('div');
    cursor.id = 'mhFxCursor';
    cursor.className = 'mh-fx-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" fill="white" stroke="#1E293B" stroke-width="1"><path d="M4 2l14 8-6 2-2 6z"/></svg>';
    doc.body.appendChild(cursor);
    return cursor;
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
  }

  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  var MHFx = {
    // Moves the cinematic cursor to the given element (or point), over
    // `duration` ms. Resolves once the CSS transition finishes.
    moveCursorTo: function (doc, target, duration) {
      ensureStyles(doc);
      var cursor = ensureCursor(doc);
      var point = (target && target.nodeType) ? centerOf(target) : target;
      cursor.style.transitionDuration = ((duration || 650) / 1000) + 's';
      cursor.style.left = (point.x - 3) + 'px';
      cursor.style.top = (point.y - 2) + 'px';
      cursor.classList.add('mh-fx-visible');
      return wait(duration || 650);
    },

    hideCursor: function (doc) {
      var cursor = doc.getElementById('mhFxCursor');
      if (cursor) cursor.classList.remove('mh-fx-visible');
    },

    // Shows a brief ripple at the cursor's current position (or a
    // given point), simulating a click response.
    clickRipple: function (doc, point) {
      ensureStyles(doc);
      var cursor = doc.getElementById('mhFxCursor');
      var p = point || (cursor ? { x: parseFloat(cursor.style.left) + 3, y: parseFloat(cursor.style.top) + 2 } : { x: 0, y: 0 });
      var ripple = doc.createElement('div');
      ripple.className = 'mh-fx-ripple';
      ripple.style.left = p.x + 'px';
      ripple.style.top = p.y + 'px';
      doc.body.appendChild(ripple);
      setTimeout(function () { ripple.remove(); }, 650);
      return wait(150);
    },

    // Soft glow ring around an element — the "this is what we're
    // talking about" cue. Not a stark tutorial-style ring; a subtle
    // premium halo. Pass null to fade the current glow out.
    focusGlow: function (doc, target) {
      ensureStyles(doc);
      var glow = doc.getElementById('mhFxGlow');
      if (!glow) {
        glow = doc.createElement('div');
        glow.id = 'mhFxGlow';
        glow.className = 'mh-fx-glow';
        doc.body.appendChild(glow);
      }
      if (!target) {
        glow.classList.remove('mh-fx-visible');
        return;
      }
      var r = target.getBoundingClientRect();
      glow.style.top = (r.top - 8) + 'px';
      glow.style.left = (r.left - 8) + 'px';
      glow.style.width = (r.width + 16) + 'px';
      glow.style.height = (r.height + 16) + 'px';
      glow.classList.add('mh-fx-visible');
    },

    // Dims everything except a cut-out region around the target
    // element — used sparingly, for moments that need full attention
    // (e.g. the overall score on the report). Pass null to clear.
    spotlight: function (doc, target) {
      ensureStyles(doc);
      var spot = doc.getElementById('mhFxSpotlight');
      if (!spot) {
        spot = doc.createElement('div');
        spot.id = 'mhFxSpotlight';
        spot.className = 'mh-fx-spotlight';
        doc.body.appendChild(spot);
      }
      if (!target) {
        spot.classList.remove('mh-fx-visible');
        return;
      }
      var r = target.getBoundingClientRect();
      spot.style.top = (r.top - 14) + 'px';
      spot.style.left = (r.left - 14) + 'px';
      spot.style.width = (r.width + 28) + 'px';
      spot.style.height = (r.height + 28) + 'px';
      spot.classList.add('mh-fx-visible');
    },

    // Subtle camera zoom toward a target — the "wide view -> gentle
    // focus -> pull back" language from the approved spec. Scales the
    // whole document around the target's center, deliberately modest
    // (default 1.08x) so it reads as an intelligent camera nudge, not
    // a "Google Maps zoom." Always pair with zoomReset() before moving
    // to the next region/step.
    zoomToward: function (doc, target, opts) {
      opts = opts || {};
      var scale = opts.scale || 1.08;
      var duration = opts.duration || 900;
      if (!target || !doc || !doc.body) return wait(0);
      var rect = target.getBoundingClientRect();
      var vw = doc.documentElement.clientWidth || 1;
      var vh = doc.documentElement.clientHeight || 1;
      var originX = ((rect.left + rect.width / 2) / vw) * 100;
      var originY = ((rect.top + rect.height / 2) / vh) * 100;
      doc.documentElement.style.overflow = 'hidden';
      doc.body.style.transition = 'transform ' + (duration / 1000) + 's cubic-bezier(.4,0,.2,1)';
      doc.body.style.transformOrigin = originX + '% ' + originY + '%';
      doc.body.style.transform = 'scale(' + scale + ')';
      return wait(duration);
    },

    zoomReset: function (doc, opts) {
      opts = opts || {};
      var duration = opts.duration || 700;
      if (!doc || !doc.body) return wait(0);
      doc.body.style.transition = 'transform ' + (duration / 1000) + 's cubic-bezier(.4,0,.2,1)';
      doc.body.style.transform = 'scale(1)';
      return wait(duration);
    },

    clearAll: function (doc) {
      this.focusGlow(doc, null);
      this.spotlight(doc, null);
      this.hideCursor(doc);
      this.zoomReset(doc, { duration: 0 });
    },

    // Convenience choreography: gently zoom toward the target, move
    // cursor to it, glow it, pause, ripple-click it, brief settle
    // pause, then pull the camera back out. Returns a Promise. Used
    // for every "the demo performs this click" beat.
    demonstrateClick: function (doc, target, opts) {
      opts = opts || {};
      var self = this;
      return self.zoomToward(doc, target, { scale: opts.zoomScale || 1.07, duration: opts.zoomMs || 800 })
        .then(function () {
          self.focusGlow(doc, target);
          return self.moveCursorTo(doc, target, opts.moveMs || 650);
        })
        .then(function () { return wait(opts.settleMs || 220); })
        .then(function () { return self.clickRipple(doc, centerOf(target)); })
        .then(function () { return wait(opts.holdMs || 500); })
        .then(function () {
          self.focusGlow(doc, null);
          return self.zoomReset(doc, { duration: opts.zoomOutMs || 650 });
        });
    },

    wait: wait,
  };

  window.MHFx = MHFx;
})();
