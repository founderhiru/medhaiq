/* Screening & Assessment Copilot — browser script.
 * Safety rule: NO innerHTML anywhere. Every piece of server data (resume
 * text, quotes, labels, JD text) is inserted with textContent, so hostile
 * document content cannot become markup. */
(function () {
  'use strict';

  var STATUS_LABELS = {
    evidence_found: 'Evidence Found',
    partial_evidence: 'Partial Evidence',
    not_found: 'Not Found in Resume',
    requires_verification: 'Requires Verification',
    not_applicable: 'Not Applicable'
  };
  var DOWNGRADE_NOTES = {
    quote_not_found_in_resume: 'The AI quoted text that could not be found in the resume, so this was moved to Requires Verification.',
    no_quote_supplied: 'The AI gave no supporting quote, so this was moved to Requires Verification.',
    invalid_status: 'The AI returned an unrecognised status, so this was moved to Requires Verification.',
    ai_not_applicable_blocked: 'Only a recruiter can mark a criterion Not Applicable.',
    verdict_language_removed: 'The AI wording included a judgement about the person, so it was removed.'
  };
  var FLAG_NOTES = {
    age: 'age', gender: 'gender', marital_status: 'marital status', religion_caste: 'religion or caste',
    appearance: 'appearance', nationality_origin: 'origin or nationality'
  };

  // ── tiny DOM helpers ──────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function $(id) { return document.getElementById(id); }

  function api(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var e = new Error(data.error || 'Something went wrong.');
          e.code = data.code; e.status = r.status; e.details = data.details;
          throw e;
        }
        return data;
      });
    });
  }
  function say(node, msg, isError) {
    if (!node) return;
    node.textContent = msg || '';
    node.className = 'scr-status' + (isError ? ' scr-err' : '');
  }
  function badge(status) {
    return el('span', { class: 'scr-badge scr-st-' + status, text: STATUS_LABELS[status] || status });
  }
  function fmtDate(s) { try { return new Date(s).toLocaleDateString(); } catch (e) { return ''; } }

  var root = $('scr-root');
  if (!root) return;
  var page = root.getAttribute('data-scr');

  // ══ HOME ══════════════════════════════════════════════════════════════
  function initHome() {
    var list = $('scr-jobs');
    function load() {
      api('GET', '/api/screening/jobs').then(function (d) {
        clear(list);
        if (!d.jobs.length) { list.appendChild(el('p', { class: 'scr-muted', text: 'No roles yet. Create your first one above.' })); return; }
        d.jobs.forEach(function (j) {
          list.appendChild(el('div', { class: 'scr-card' }, [
            el('div', null, [
              el('a', { class: 'scr-link scr-strong', href: '/screening/jobs/' + j.id, text: j.title }),
              el('div', { class: 'scr-muted scr-small', text: (j.criteriaState === 'approved' ? 'Criteria approved' : j.criteriaState === 'draft' ? 'Criteria in draft' : 'No criteria yet') + ' · ' + j.candidateCount + ' resume(s) · ' + fmtDate(j.createdAt) })
            ]),
            el('button', { type: 'button', class: 'scr-btn scr-btn-quiet', text: 'Delete', onclick: function () {
              if (!window.confirm('Delete "' + j.title + '" and all its resumes and findings? This cannot be undone.')) return;
              api('DELETE', '/api/screening/jobs/' + j.id).then(load).catch(function (e) { window.alert(e.message); });
            } })
          ]));
        });
      }).catch(function (e) { clear(list); list.appendChild(el('p', { class: 'scr-err', text: e.message })); });
    }
    load();
    var form = $('scr-new-job');
    var status = $('scr-new-status');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var fd = new FormData(form);
      var f = fd.get('jdFile');
      if (f && !f.size) fd.delete('jdFile');
      say(status, 'Creating…');
      api('POST', '/api/screening/jobs', fd).then(function (d) {
        window.location.href = '/screening/jobs/' + d.job.id;
      }).catch(function (e) { say(status, e.message, true); });
    });
  }

  // ══ JOB ═══════════════════════════════════════════════════════════════
  function initJob() {
    var jobId = root.getAttribute('data-job-id');
    var state = { job: null, criteria: [], candidates: [], source: null };
    // Upload results live here (not in the DOM) so they survive the list
    // refresh that follows every batch — otherwise a recruiter would never
    // see which files were rejected.
    var uploadLog = [];
    var tabs = ['criteria', 'candidates', 'inbox'];

    function showTab(name) {
      if (tabs.indexOf(name) < 0) name = 'criteria';
      tabs.forEach(function (t) {
        $('scr-tab-' + t).style.display = t === name ? '' : 'none';
      });
      Array.prototype.forEach.call(document.querySelectorAll('.scr-tab'), function (b) {
        var on = b.getAttribute('data-tab') === name;
        b.classList.toggle('scr-tab-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (window.location.hash !== '#' + name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ } }
      if (name === 'inbox') renderInbox();
    }
    Array.prototype.forEach.call(document.querySelectorAll('.scr-tab'), function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
    });

    function load(thenTab) {
      return api('GET', '/api/screening/jobs/' + jobId).then(function (d) {
        state.job = d.job; state.criteria = d.criteria; state.candidates = d.candidates;
        $('scr-job-title').textContent = d.job.title;
        renderFlags();
        renderCriteria();
        renderCandidates();
        showTab(thenTab || (window.location.hash || '').replace('#', '') || 'criteria');
      }).catch(function (e) { clear($('scr-tab-criteria')).appendChild(el('p', { class: 'scr-err', text: e.message })); });
    }

    function renderFlags() {
      var box = clear($('scr-job-flags'));
      var sens = (state.job.jdFlags || []).filter(function (f) { return f.type === 'sensitive_language'; });
      var inj = (state.job.jdFlags || []).filter(function (f) { return f.type === 'instruction_like_text'; });
      if (sens.length) {
        box.appendChild(el('div', { class: 'scr-warn', role: 'note' }, [
          el('strong', { text: 'Review this job description. ' }),
          'It appears to mention ' + sens.map(function (f) { return FLAG_NOTES[f.code] || f.code; }).join(', ') +
          '. MedhaIQ will not turn these into screening criteria, and they should not influence screening.'
        ]));
      }
      if (inj.length) {
        box.appendChild(el('div', { class: 'scr-warn', role: 'note', text: 'This job description contains text that looks like instructions to an AI. It is treated as ordinary content.' }));
      }
    }

    // ── Criteria tab ────────────────────────────────────────────────────
    function renderCriteria() {
      var pane = clear($('scr-tab-criteria'));
      var approved = state.job.criteriaState === 'approved';
      var status = el('span', { class: 'scr-status', role: 'status' });

      pane.appendChild(el('details', { class: 'scr-panel' }, [
        el('summary', { text: 'Job description' }),
        el('pre', { class: 'scr-pre', text: state.job.jdText || '' })
      ]));

      var head = el('div', { class: 'scr-panel' });
      head.appendChild(el('h3', { text: approved ? 'Approved screening criteria' : 'Screening criteria' }));
      head.appendChild(el('p', { class: 'scr-muted', text: approved
        ? 'These criteria are locked. Resumes are checked against exactly this list.'
        : 'Review every line. Nothing is checked against resumes until you approve the list.' }));
      if (state.source) {
        head.appendChild(el('p', { class: 'scr-muted scr-small', text: state.source === 'ai'
          ? 'Proposed by AI from the job description. Please check each line.'
          : 'The AI was not used. These were read from bullet points in the job description. Please check each line.' }));
      }

      var ul = el('div', { class: 'scr-crits' });
      if (!state.criteria.length) ul.appendChild(el('p', { class: 'scr-muted', text: 'No criteria yet.' }));
      state.criteria.forEach(function (c) {
        var row = el('div', { class: 'scr-crit' });
        if (approved) {
          row.appendChild(el('div', { class: 'scr-crit-main' }, [
            el('span', { class: 'scr-strong', text: c.text }),
            el('span', { class: 'scr-chip', text: c.importance })
          ]));
        } else {
          var text = el('input', { type: 'text', value: c.text, maxlength: 200, 'aria-label': 'Criterion text' });
          text.value = c.text;
          text.addEventListener('change', function () { patch(c.id, { text: text.value }, text); });
          var imp = el('select', { 'aria-label': 'Importance' }, [
            el('option', { value: 'required', text: 'Required' }), el('option', { value: 'preferred', text: 'Preferred' })
          ]);
          imp.value = c.importance;
          imp.addEventListener('change', function () { patch(c.id, { importance: imp.value }, imp); });
          row.appendChild(el('div', { class: 'scr-crit-main' }, [text, imp,
            el('button', { type: 'button', class: 'scr-btn scr-btn-quiet', text: 'Remove', onclick: function () {
              api('DELETE', '/api/screening/jobs/' + jobId + '/criteria/' + c.id).then(function () { return load('criteria'); }).catch(function (e) { say(status, e.message, true); });
            } })]));
        }
        if (c.jdQuote && c.jdQuoteVerified) row.appendChild(el('div', { class: 'scr-muted scr-small', text: 'From the job description: “' + c.jdQuote + '”' }));
        if (c.guidance) row.appendChild(el('div', { class: 'scr-muted scr-small', text: 'What counts: ' + c.guidance }));
        ul.appendChild(row);
      });
      head.appendChild(ul);

      function patch(cid, body, control) {
        api('PATCH', '/api/screening/jobs/' + jobId + '/criteria/' + cid, body).then(function () { say(status, 'Saved'); }).catch(function (e) { say(status, e.message, true); load('criteria'); });
      }

      if (!approved) {
        var addText = el('input', { type: 'text', maxlength: 200, placeholder: 'Add a criterion, e.g. “3+ years of Python”', 'aria-label': 'New criterion' });
        var addImp = el('select', { 'aria-label': 'New criterion importance' }, [
          el('option', { value: 'required', text: 'Required' }), el('option', { value: 'preferred', text: 'Preferred' })
        ]);
        head.appendChild(el('div', { class: 'scr-row' }, [addText, addImp,
          el('button', { type: 'button', class: 'scr-btn', text: 'Add', onclick: function () {
            api('POST', '/api/screening/jobs/' + jobId + '/criteria', { text: addText.value, importance: addImp.value, kind: 'other' })
              .then(function () { return load('criteria'); }).catch(function (e) { say(status, e.message, true); });
          } })]));
        head.appendChild(el('div', { class: 'scr-row' }, [
          el('button', { type: 'button', class: 'scr-btn', text: state.criteria.length ? 'Re-propose from job description (replaces this list)' : 'Propose criteria from job description', onclick: function () {
            if (state.criteria.length && !window.confirm('Replace the current list with a new proposal?')) return;
            say(status, 'Reading the job description…');
            api('POST', '/api/screening/jobs/' + jobId + '/criteria/propose').then(function (d) { state.source = d.source; return load('criteria'); })
              .catch(function (e) { say(status, e.message, true); });
          } }),
          el('button', { type: 'button', class: 'scr-btn scr-btn-primary', text: 'Approve criteria', onclick: function () {
            if (!window.confirm('Approve these criteria? Resumes will be checked against exactly this list.')) return;
            api('POST', '/api/screening/jobs/' + jobId + '/criteria/approve').then(function () { return load('criteria'); }).catch(function (e) { say(status, e.message, true); });
          } }),
          status
        ]));
      } else {
        head.appendChild(el('div', { class: 'scr-row' }, [
          el('button', { type: 'button', class: 'scr-btn', text: 'Reopen to edit', onclick: function () {
            if (!window.confirm('Reopen the criteria? If you change them after approving, findings already produced will be marked out of date.')) return;
            api('POST', '/api/screening/jobs/' + jobId + '/criteria/reopen').then(function () { return load('criteria'); }).catch(function (e) { say(status, e.message, true); });
          } }), status]));
      }
      pane.appendChild(head);
    }

    // ── Candidates tab ──────────────────────────────────────────────────
    function analyzeOne(candidateId, confirmReset) {
      return api('POST', '/api/screening/candidates/' + candidateId + '/analyze', { confirmReset: !!confirmReset });
    }

    function renderCandidates() {
      var pane = clear($('scr-tab-candidates'));
      var approved = state.job.criteriaState === 'approved';
      var up = el('div', { class: 'scr-panel' });
      up.appendChild(el('h3', { text: 'Add resumes' }));
      if (!approved) up.appendChild(el('p', { class: 'scr-muted', text: 'You can upload now, but analysis starts only after you approve the criteria.' }));
      up.appendChild(el('p', { class: 'scr-muted scr-small', text: 'PDF (text-based) or Word .docx, up to 5 MB and 15 pages each. Names, emails, phone numbers, links and fields like age or gender are removed before analysis. Original files are not stored.' }));
      var files = el('input', { type: 'file', multiple: true, accept: '.pdf,.docx', 'aria-label': 'Resume files' });
      var paste = el('textarea', { rows: 5, placeholder: 'Or paste one resume as text', 'aria-label': 'Resume text' });
      var label = el('input', { type: 'text', maxlength: 80, placeholder: 'Optional internal label for pasted text (no personal details needed)', 'aria-label': 'Label' });
      var auto = el('input', { type: 'checkbox', id: 'scr-auto' });
      auto.checked = approved; auto.disabled = !approved;
      var log = el('div', { class: 'scr-log', 'aria-live': 'polite' });
      function paint(entry) { entry.node.textContent = entry.text; entry.node.className = entry.bad ? 'scr-err' : 'scr-muted'; }
      uploadLog.forEach(function (entry) { entry.node = el('div'); paint(entry); log.appendChild(entry.node); });
      var go = el('button', { type: 'button', class: 'scr-btn scr-btn-primary', text: 'Add' });

      function line(text, bad) {
        var entry = { text: text, bad: !!bad, node: el('div') };
        uploadLog.push(entry); paint(entry); log.appendChild(entry.node);
        return { set: function (t2, b2) { entry.text = t2; entry.bad = !!b2; paint(entry); } };
      }

      go.addEventListener('click', function () {
        var queue = [];
        Array.prototype.forEach.call(files.files || [], function (f) { queue.push({ file: f }); });
        if (paste.value.trim()) queue.push({ text: paste.value, label: label.value });
        if (!queue.length) { line('Choose files or paste a resume first.', true); return; }
        go.disabled = true;
        clear(log); uploadLog.length = 0;
        var i = 0;
        (function next() {
          if (i >= queue.length) { go.disabled = false; files.value = ''; paste.value = ''; load('candidates'); return; }
          var item = queue[i]; i += 1;
          var name = item.file ? ('File ' + i + ' of ' + queue.length) : 'Pasted text';
          var fd = new FormData();
          if (item.file) fd.append('resumeFile', item.file); else { fd.append('resumeText', item.text); if (item.label) fd.append('label', item.label); }
          var p = line(name + ': adding…');
          api('POST', '/api/screening/jobs/' + jobId + '/candidates', fd).then(function (d) {
            if (d.duplicate) { p.set(name + ': already added as ' + d.existing.code + '.'); return null; }
            var added = name + ': added as ' + d.candidate.code + '.';
            p.set(added);
            if (auto.checked) {
              p.set(added + ' Analysing…');
              return analyzeOne(d.candidate.id, false)
                .then(function () { p.set(name + ': added as ' + d.candidate.code + ' and analysed.'); })
                .catch(function (e) { p.set(added + ' Analysis failed: ' + e.message + ' You can retry from the list below.', true); });
            }
            return null;
          }).catch(function (e) { p.set(name + ': ' + e.message, true); })
            .then(next);
        })();
      });
      up.appendChild(files); up.appendChild(paste); up.appendChild(label);
      up.appendChild(el('label', { class: 'scr-check' }, [auto, ' Analyse each resume right after adding it']));
      up.appendChild(el('div', { class: 'scr-row' }, [go]));
      up.appendChild(log);
      pane.appendChild(up);

      var listPanel = el('div', { class: 'scr-panel' });
      listPanel.appendChild(el('h3', { text: 'Resumes (' + state.candidates.length + ')' }));
      var pending = state.candidates.filter(function (c) { return !c.analyzed; });
      if (approved && pending.length) {
        var pStatus = el('span', { class: 'scr-status', role: 'status' });
        listPanel.appendChild(el('div', { class: 'scr-row' }, [
          el('button', { type: 'button', class: 'scr-btn', text: 'Analyse ' + pending.length + ' not yet analysed', onclick: function (ev) {
            var btn = ev.currentTarget; btn.disabled = true;
            var n = 0;
            (function next() {
              if (n >= pending.length) { load('candidates'); return; }
              var c = pending[n]; n += 1;
              say(pStatus, 'Analysing ' + n + ' of ' + pending.length + '…');
              analyzeOne(c.id, false).catch(function (e) { say(pStatus, c.code + ': ' + e.message, true); }).then(next);
            })();
          } }), pStatus]));
      }
      if (!state.candidates.length) listPanel.appendChild(el('p', { class: 'scr-muted', text: 'No resumes yet.' }));
      state.candidates.forEach(function (c) {
        listPanel.appendChild(el('div', { class: 'scr-card' }, [
          el('div', null, [
            el('a', { class: 'scr-link scr-strong', href: '/screening/candidates/' + c.id, text: c.code + (c.label ? ' — ' + c.label : '') }),
            el('div', { class: 'scr-muted scr-small', text: (c.analyzed ? 'Analysed' : 'Not analysed') + (c.decisionLabel ? ' · Decision: ' + c.decisionLabel : '') + (c.injectionFlagCount ? ' · contains instruction-like text' : '') })
          ]),
          el('button', { type: 'button', class: 'scr-btn scr-btn-quiet', text: 'Delete', onclick: function () {
            if (!window.confirm('Delete ' + c.code + ' and its findings? This cannot be undone.')) return;
            api('DELETE', '/api/screening/candidates/' + c.id).then(function () { return load('candidates'); }).catch(function (e) { window.alert(e.message); });
          } })
        ]));
      });
      pane.appendChild(listPanel);
    }

    // ── Inbox tab ───────────────────────────────────────────────────────
    function renderInbox() {
      var pane = clear($('scr-tab-inbox'));
      pane.appendChild(el('p', { class: 'scr-muted', text: 'Grouped by what the resumes show for the required criteria. Within each group, resumes stay in the order they were added; nothing is ranked.' }));
      api('GET', '/api/screening/jobs/' + jobId + '/inbox').then(function (d) {
        if (!d.total) { pane.appendChild(el('p', { class: 'scr-muted', text: 'Add resumes to see them here.' })); return; }
        d.groups.forEach(function (g) {
          if (!g.candidates.length) return;
          var box = el('div', { class: 'scr-panel' }, [el('h3', { text: g.title + ' (' + g.candidates.length + ')' })]);
          g.candidates.forEach(function (c) {
            var chips = el('div', { class: 'scr-chips' });
            ['evidence_found', 'partial_evidence', 'not_found', 'requires_verification', 'not_applicable'].forEach(function (s) {
              if (c.coverage[s]) chips.appendChild(el('span', { class: 'scr-badge scr-st-' + s, text: STATUS_LABELS[s] + ': ' + c.coverage[s] }));
            });
            box.appendChild(el('div', { class: 'scr-card' }, [
              el('div', null, [
                el('a', { class: 'scr-link scr-strong', href: '/screening/candidates/' + c.id, text: c.code + (c.label ? ' — ' + c.label : '') }),
                chips,
                el('div', { class: 'scr-muted scr-small', text: [
                  c.needsAttention ? c.needsAttention + ' item(s) to review' : '',
                  c.stale ? 'Out of date — criteria changed' : '',
                  c.decisionLabel ? 'Decision: ' + c.decisionLabel : '',
                  c.injectionFlagCount ? 'Contains instruction-like text' : ''
                ].filter(Boolean).join(' · ') })
              ])
            ]));
          });
          pane.appendChild(box);
        });
      }).catch(function (e) { pane.appendChild(el('p', { class: 'scr-err', text: e.message })); });
    }

    load();
  }

  // ══ CANDIDATE ═════════════════════════════════════════════════════════
  function initCandidate() {
    var cid = root.getAttribute('data-candidate-id');
    var M = null;
    var activeCrit = null;

    function load() {
      return api('GET', '/api/screening/candidates/' + cid).then(function (d) { M = d; render(); })
        .catch(function (e) { clear($('scr-cand-criteria')).appendChild(el('p', { class: 'scr-err', text: e.message })); });
    }
    function useModel(d) { M = d; render(); }

    function render() {
      $('scr-cand-title').textContent = M.candidate.code + (M.candidate.label ? ' — ' + M.candidate.label : '');
      $('scr-back').setAttribute('href', '/screening/jobs/' + root.getAttribute('data-job-id') + '#inbox');
      renderFlags(); renderActions(); renderCriteria(); renderResume(); renderQuestions(); renderDecision();
    }

    function renderFlags() {
      var box = clear($('scr-cand-flags'));
      var r = M.candidate.redactionSummary || {};
      box.appendChild(el('p', { class: 'scr-muted scr-small', text: 'Removed before analysis: ' + (r.emails || 0) + ' email(s), ' + (r.phones || 0) + ' phone number(s), ' + (r.links || 0) + ' link(s), ' + (r.sensitive_fields || 0) + ' personal field(s)' + (r.name_line ? ', the name line' : '') + '. Redaction is automatic and may miss details written inside sentences.' }));
      if ((M.candidate.injectionFlags || []).length) {
        box.appendChild(el('div', { class: 'scr-warn', role: 'note', text: 'This resume contains text that looks like instructions to an AI (for example “ignore previous instructions”). It was treated as ordinary resume content. Read the original resume carefully.' }));
      }
      if (M.anyStale) {
        box.appendChild(el('div', { class: 'scr-warn', role: 'note', text: 'The screening criteria changed after these findings were produced, so some are out of date. Re-run the analysis.' }));
      }
    }

    function renderActions() {
      var box = clear($('scr-cand-actions'));
      var status = el('span', { class: 'scr-status', role: 'status' });
      var approved = M.criteriaState === 'approved';
      var analyzed = !!M.candidate.analyzedAt;
      var run = el('button', { type: 'button', class: 'scr-btn scr-btn-primary', text: analyzed ? 'Re-run analysis' : 'Analyse against criteria', disabled: !approved, onclick: function () {
        function go(confirmReset) {
          say(status, 'Analysing…');
          api('POST', '/api/screening/candidates/' + cid + '/analyze', { confirmReset: confirmReset }).then(function (d) { useModel(d); })
            .catch(function (e) {
              if (e.code === 'confirm_reset') { if (window.confirm(e.message)) go(true); else say(status, ''); return; }
              say(status, e.message, true);
            });
        }
        go(false);
      } });
      var q = el('button', { type: 'button', class: 'scr-btn', text: 'Draft verification questions', disabled: !analyzed, onclick: function () {
        say(status, 'Drafting questions…');
        api('POST', '/api/screening/candidates/' + cid + '/questions/generate').then(function () { return load(); }).then(function () { say(status, 'Questions drafted — review them below.'); })
          .catch(function (e) { say(status, e.message, true); });
      } });
      var rep = el('a', { class: 'scr-btn', href: '/screening/candidates/' + cid + '/report', target: '_blank', rel: 'noopener', text: 'Open printable report' });
      var lab = el('input', { type: 'text', maxlength: 80, value: M.candidate.label || '', placeholder: 'Internal label', 'aria-label': 'Internal label' });
      lab.value = M.candidate.label || '';
      lab.addEventListener('change', function () {
        api('PATCH', '/api/screening/candidates/' + cid, { label: lab.value }).then(function () { M.candidate.label = lab.value || null; $('scr-cand-title').textContent = M.candidate.code + (lab.value ? ' — ' + lab.value : ''); say(status, 'Label saved'); }).catch(function (e) { say(status, e.message, true); });
      });
      if (!approved) box.appendChild(el('span', { class: 'scr-muted', text: 'Criteria are not approved, so analysis is paused.' }));
      [run, q, rep, lab, status].forEach(function (n) { box.appendChild(n); });
    }

    function renderCriteria() {
      var box = clear($('scr-cand-criteria'));
      box.appendChild(el('h3', { text: 'Criteria and evidence' }));
      if (!M.candidate.analyzedAt) box.appendChild(el('p', { class: 'scr-muted', text: 'Not analysed yet.' }));
      M.rows.forEach(function (r) {
        var e = r.evidence;
        var card = el('div', { class: 'scr-evcard' + (activeCrit === r.criterion.id ? ' scr-active' : '') });
        card.appendChild(el('div', { class: 'scr-ev-head' }, [
          el('span', { class: 'scr-strong', text: r.criterion.text }),
          el('span', { class: 'scr-chip', text: r.criterion.importance })
        ]));
        if (!e) { card.appendChild(el('div', { class: 'scr-muted', text: 'No finding yet.' })); box.appendChild(card); return; }
        card.appendChild(el('div', { class: 'scr-row' }, [badge(e.effectiveStatus),
          e.recruiterStatus ? el('span', { class: 'scr-muted scr-small', text: e.recruiterStatus === e.aiStatus ? 'Confirmed by you' : 'Changed by you (AI said: ' + (e.aiStatusLabel) + ')' }) : el('span', { class: 'scr-muted scr-small', text: 'AI finding — not reviewed' }),
          e.stale ? el('span', { class: 'scr-badge scr-st-stale', text: 'Out of date' }) : null]));
        if (e.aiRationale) card.appendChild(el('div', { class: 'scr-rationale', text: e.aiRationale }));
        if (e.downgradeReason && DOWNGRADE_NOTES[e.downgradeReason]) card.appendChild(el('div', { class: 'scr-muted scr-small', text: DOWNGRADE_NOTES[e.downgradeReason] }));
        e.quotes.forEach(function (qt) {
          card.appendChild(el('button', { type: 'button', class: 'scr-quote', onclick: function () { activeCrit = r.criterion.id; renderCriteria(); renderResume(qt.start); } }, [
            el('span', { class: 'scr-quote-text', text: qt.text }),
            el('span', { class: 'scr-muted scr-small', text: ' Page ' + qt.page + ', line ' + qt.line + ' — show in resume' })
          ]));
        });
        if (e.recruiterNote) card.appendChild(el('div', { class: 'scr-muted scr-small', text: 'Your note: ' + e.recruiterNote }));

        // review controls
        var note = el('input', { type: 'text', maxlength: 1000, placeholder: 'Optional note', 'aria-label': 'Review note' });
        note.value = e.recruiterNote || '';
        var sel = el('select', { 'aria-label': 'Override status' }, Object.keys(STATUS_LABELS).map(function (s) { return el('option', { value: s, text: STATUS_LABELS[s] }); }));
        sel.value = e.effectiveStatus;
        var st = el('span', { class: 'scr-status', role: 'status' });
        function review(body) {
          api('PUT', '/api/screening/candidates/' + cid + '/evidence/' + r.criterion.id, body).then(useModel).catch(function (er) { say(st, er.message, true); });
        }
        card.appendChild(el('div', { class: 'scr-row scr-review' }, [
          el('button', { type: 'button', class: 'scr-btn', text: 'Confirm', onclick: function () { review({ action: 'confirm', note: note.value }); } }),
          sel,
          el('button', { type: 'button', class: 'scr-btn', text: 'Change status', onclick: function () { review({ action: 'override', status: sel.value, note: note.value }); } }),
          e.recruiterStatus ? el('button', { type: 'button', class: 'scr-btn scr-btn-quiet', text: 'Clear my review', onclick: function () { review({ action: 'clear' }); } }) : null,
          note, st
        ]));
        box.appendChild(card);
      });
    }

    function renderResume(scrollTo) {
      var box = clear($('scr-resume'));
      var text = M.resumeText || '';
      var ranges = [];
      if (activeCrit !== null) {
        M.rows.forEach(function (r) {
          if (r.criterion.id === activeCrit && r.evidence) r.evidence.quotes.forEach(function (q) { ranges.push([q.start, q.end]); });
        });
      }
      ranges.sort(function (a, b) { return a[0] - b[0]; });
      var pos = 0; var firstMark = null;
      ranges.forEach(function (rg) {
        if (rg[0] < pos) return;
        if (rg[0] > pos) box.appendChild(document.createTextNode(text.slice(pos, rg[0])));
        var m = el('mark', { class: 'scr-mark', text: text.slice(rg[0], rg[1]) });
        if (!firstMark) firstMark = m;
        box.appendChild(m); pos = rg[1];
      });
      if (pos < text.length) box.appendChild(document.createTextNode(text.slice(pos)));
      if (firstMark && scrollTo !== undefined && firstMark.scrollIntoView) firstMark.scrollIntoView({ block: 'center' });
    }

    function renderQuestions() {
      var box = clear($('scr-cand-questions'));
      var all = [];
      M.rows.forEach(function (r) { r.questions.forEach(function (q) { all.push({ q: q, crit: r.criterion }); }); });
      var panel = el('div', { class: 'scr-panel' }, [el('h3', { text: 'Verification questions' })]);
      panel.appendChild(el('p', { class: 'scr-muted scr-small', text: 'Drafts are suggestions. Edit them, approve the ones you will use, or add your own. They appear in the printable report once approved.' }));
      if (!all.length) panel.appendChild(el('p', { class: 'scr-muted', text: 'No questions yet.' }));
      all.forEach(function (it) {
        var q = it.q;
        var input = el('input', { type: 'text', maxlength: 300, 'aria-label': 'Question text' });
        input.value = q.text;
        var st = el('span', { class: 'scr-status', role: 'status' });
        function upd(body) { api('PATCH', '/api/screening/candidates/' + cid + '/questions/' + q.id, body).then(function () { return load(); }).catch(function (e) { say(st, e.message, true); }); }
        panel.appendChild(el('div', { class: 'scr-qrow' }, [
          el('div', { class: 'scr-muted scr-small', text: it.crit.text + ' · ' + (q.origin === 'ai' ? 'AI draft' : 'Yours') + ' · ' + q.state }),
          input,
          el('div', { class: 'scr-row' }, [
            el('button', { type: 'button', class: 'scr-btn', text: 'Save text', onclick: function () { upd({ text: input.value }); } }),
            el('button', { type: 'button', class: 'scr-btn', text: q.state === 'approved' ? 'Un-approve' : 'Approve', onclick: function () { upd({ state: q.state === 'approved' ? 'draft' : 'approved' }); } }),
            el('button', { type: 'button', class: 'scr-btn scr-btn-quiet', text: 'Delete', onclick: function () { api('DELETE', '/api/screening/candidates/' + cid + '/questions/' + q.id).then(load).catch(function (e) { say(st, e.message, true); }); } }),
            st
          ])
        ]));
      });
      var csel = el('select', { 'aria-label': 'Criterion for new question' }, M.rows.map(function (r) { return el('option', { value: r.criterion.id, text: r.criterion.text }); }));
      var ntxt = el('input', { type: 'text', maxlength: 300, placeholder: 'Write your own question', 'aria-label': 'New question' });
      var nst = el('span', { class: 'scr-status', role: 'status' });
      panel.appendChild(el('div', { class: 'scr-row' }, [csel, ntxt,
        el('button', { type: 'button', class: 'scr-btn', text: 'Add question', onclick: function () {
          api('POST', '/api/screening/candidates/' + cid + '/questions', { criterionId: Number(csel.value), text: ntxt.value }).then(load).catch(function (e) { say(nst, e.message, true); });
        } }), nst]));
      box.appendChild(panel);
    }

    function renderDecision() {
      var box = clear($('scr-cand-decision'));
      box.appendChild(el('h3', { text: 'Your decision' }));
      box.appendChild(el('p', { class: 'scr-muted scr-small', text: 'Only you set this. MedhaIQ never recommends a decision.' }));
      var labels = { shortlist: 'Shortlist', hold: 'Hold', needs_verification: 'Needs Verification', not_moving_forward: 'Not Moving Forward' };
      var current = M.candidate.decision;
      var note = el('textarea', { rows: 3, maxlength: 1000, placeholder: 'Optional note for your own records', 'aria-label': 'Decision note' });
      note.value = M.candidate.decisionNote || '';
      var st = el('span', { class: 'scr-status', role: 'status' });
      function save(d) {
        api('PUT', '/api/screening/candidates/' + cid + '/decision', { decision: d, note: note.value })
          .then(function (r) { M.candidate.decision = r.candidate.decision; M.candidate.decisionNote = r.candidate.decisionNote; renderDecision(); })
          .catch(function (e) { say(st, e.message, true); });
      }
      var row = el('div', { class: 'scr-row' });
      Object.keys(labels).forEach(function (k) {
        row.appendChild(el('button', { type: 'button', class: 'scr-btn' + (current === k ? ' scr-btn-primary' : ''), 'aria-pressed': current === k ? 'true' : 'false', text: labels[k], onclick: function () { save(k); } }));
      });
      if (current) row.appendChild(el('button', { type: 'button', class: 'scr-btn scr-btn-quiet', text: 'Clear decision', onclick: function () { save(null); } }));
      box.appendChild(row); box.appendChild(note); box.appendChild(st);
    }

    load();
  }

  if (page === 'home') initHome();
  else if (page === 'job') initJob();
  else if (page === 'candidate') initCandidate();
})();
