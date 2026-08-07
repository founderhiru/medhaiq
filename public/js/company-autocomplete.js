// company-autocomplete.js
// Generic, reusable autocomplete dropdown, built for (and first used by)
// the "Tailor your Interview" Target Company field
// (views/interview-setup.ejs), but not hardcoded to it — any current or
// future text input can opt in with one call:
//
//   MedhaIQCompanyAutocomplete.attach(inputEl, {
//     source: window.MedhaIQCompanies,  // optional, defaults to this
//     onSelect: function (companyName) { ... }  // optional
//   });
//
// Design notes:
// - Pure client-side string filtering. No network calls, ever — the
//   whole point is that suggestions feel instantaneous while typing.
// - Never restricts input. The dropdown is purely assistive: closing it
//   (Escape, clicking away, or just not picking anything) leaves
//   whatever the user typed completely untouched. This is intentional
//   per spec — "Autocomplete should assist, not restrict."
// - Only company NAME is passed to onSelect today. If a future feature
//   upgrades the dataset to {name, industry, ...} objects, this file's
//   `.name` accessor (see `labelOf` below) is the one place that needs
//   to change — everything else (filtering, rendering, keyboard nav)
//   keeps working unmodified.

(function () {
  function labelOf(entry) {
    // Accepts either a plain string (today's dataset shape) or a
    // {name, ...} object (the future-metadata shape) without the
    // caller needing to know which.
    return typeof entry === 'string' ? entry : (entry && entry.name) || '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Wraps the substring of `label` that matches `query` in <mark>, for
  // the "highlight the matching text" requirement. Case-insensitive;
  // preserves the label's original casing in the output.
  function highlightMatch(label, query) {
    var idx = label.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(label);
    var before = escapeHtml(label.slice(0, idx));
    var match = escapeHtml(label.slice(idx, idx + query.length));
    var after = escapeHtml(label.slice(idx + query.length));
    return before + '<mark>' + match + '</mark>' + after;
  }

  function filterCompanies(source, query, limit) {
    var q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    var startsWith = [];
    var contains = [];
    for (var i = 0; i < source.length; i++) {
      var label = labelOf(source[i]);
      var lower = label.toLowerCase();
      if (lower.indexOf(q) === 0) {
        startsWith.push(source[i]);
      } else if (lower.indexOf(q) !== -1) {
        contains.push(source[i]);
      }
      if (startsWith.length >= limit) break; // startsWith matches are the most relevant; stop early once we have enough
    }
    return startsWith.concat(contains).slice(0, limit);
  }

  function attach(inputEl, opts) {
    opts = opts || {};
    var source = opts.source || window.MedhaIQCompanies || [];
    var limit = opts.limit || 9;
    var onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};

    // The dropdown is positioned absolutely, so its offset parent needs
    // position:relative. Rather than require every caller to remember
    // to set that up in CSS, wrap the input in a plain relative div
    // here if its parent doesn't already provide one.
    var wrap = inputEl.parentElement;
    if (!wrap || getComputedStyle(wrap).position === 'static') {
      wrap = document.createElement('div');
      wrap.style.position = 'relative';
      inputEl.parentNode.insertBefore(wrap, inputEl);
      wrap.appendChild(inputEl);
    }

    var dropdown = document.createElement('div');
    dropdown.className = 'miq-autocomplete-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.style.display = 'none';
    wrap.appendChild(dropdown);

    var items = [];      // current filtered results (raw entries)
    var activeIdx = -1;  // keyboard-highlighted index, -1 = none

    function close() {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      items = [];
      activeIdx = -1;
      inputEl.removeAttribute('aria-activedescendant');
      inputEl.setAttribute('aria-expanded', 'false');
    }

    function render(query) {
      dropdown.innerHTML = '';
      items.forEach(function (entry, i) {
        var label = labelOf(entry);
        var row = document.createElement('div');
        row.className = 'miq-autocomplete-item' + (i === activeIdx ? ' active' : '');
        row.id = 'miq-ac-opt-' + i;
        row.setAttribute('role', 'option');
        row.innerHTML = highlightMatch(label, query);
        row.addEventListener('mousedown', function (e) {
          // mousedown (not click) fires before the input's blur handler,
          // so the selection registers before the dropdown would
          // otherwise close from losing focus.
          e.preventDefault();
          select(i);
        });
        row.addEventListener('mouseenter', function () {
          activeIdx = i;
          updateActiveClasses();
        });
        dropdown.appendChild(row);
      });
      dropdown.style.display = items.length ? 'block' : 'none';
    }

    function updateActiveClasses() {
      var rows = dropdown.querySelectorAll('.miq-autocomplete-item');
      rows.forEach(function (r, i) { r.classList.toggle('active', i === activeIdx); });
      if (activeIdx >= 0) {
        inputEl.setAttribute('aria-activedescendant', 'miq-ac-opt-' + activeIdx);
        var el = rows[activeIdx];
        if (el) el.scrollIntoView({ block: 'nearest' });
      } else {
        inputEl.removeAttribute('aria-activedescendant');
      }
    }

    function select(i) {
      var label = labelOf(items[i]);
      inputEl.value = label;
      close();
      onSelect(label, items[i]);
      inputEl.focus();
    }

    inputEl.addEventListener('input', function () {
      var q = inputEl.value;
      items = filterCompanies(source, q, limit);
      activeIdx = -1;
      if (items.length) {
        inputEl.setAttribute('aria-expanded', 'true');
        render(q.trim());
      } else {
        close();
      }
    });

    inputEl.addEventListener('keydown', function (e) {
      if (dropdown.style.display === 'none' || !items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % items.length;
        updateActiveClasses();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + items.length) % items.length;
        updateActiveClasses();
      } else if (e.key === 'Enter') {
        if (activeIdx >= 0) {
          e.preventDefault();
          select(activeIdx);
        }
        // else: no suggestion highlighted, let Enter behave normally
        // (free-form text is always allowed — this is intentional).
      } else if (e.key === 'Escape') {
        // Close just the dropdown. stopPropagation so a parent "Escape
        // closes the whole modal" handler (if any) doesn't also fire
        // from the same keypress — closing the suggestion list should
        // take one Escape, closing the modal should take a second.
        e.stopPropagation();
        close();
      }
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });

    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-autocomplete', 'list');
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.setAttribute('autocomplete', 'off'); // avoid the browser's own suggestion list competing with ours

    return { close: close };
  }

  window.MedhaIQCompanyAutocomplete = { attach: attach };
})();
