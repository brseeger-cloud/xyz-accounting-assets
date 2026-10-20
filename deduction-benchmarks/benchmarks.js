/* XYZ Deduction Benchmarks — compare widget + occupation search. No dependencies. */
(function () {
  'use strict';

  var fmt = function (n) {
    return '$' + Math.round(n).toLocaleString('en-AU');
  };

  var parse = function (v) {
    if (v == null) return null;
    var s = String(v).replace(/[$,\s]/g, '');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) && n >= 0 ? n : null;
  };

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // Wording must match docs/CONTENT-RULES.md exactly.
  var BANDS = [
    { max: 0.5, key: 'low', head: 'Well below average',
      body: 'You may be missing deductions people in your job commonly claim. Check the list below.' },
    { max: 1.5, key: 'typical', head: 'Within the typical range',
      body: 'Your claim looks normal for your occupation. Keep your receipts and records.' },
    { max: 3, key: 'high', head: 'Above average',
      body: 'That can be right if your work genuinely costs more. Make sure every dollar is backed by records.' },
    { max: Infinity, key: 'vhigh', head: 'Well above average',
      body: 'Claims this far above the norm are more likely to be reviewed. Have receipts and logbooks ready, or ask us to check it before you lodge.' }
  ];
  var CAUTION = 'Averages are a benchmark, not a target. Only claim what you spent for work and can prove.';

  var bandFor = function (ratio) {
    for (var i = 0; i < BANDS.length; i++) if (ratio < BANDS[i].max) return BANDS[i];
    return BANDS[BANDS.length - 1];
  };

  /**
   * Approximate share of claimants who claimed less than `x`, by linear
   * interpolation within the ATO claim-range bands. Returns null if no bands.
   */
  var percentile = function (x, bands) {
    if (!bands || !bands.length) return null;
    var total = 0;
    bands.forEach(function (b) { total += b.count || 0; });
    if (!total) return null;
    var below = 0;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var lo = b.min || 0;
      var hi = b.max == null ? lo * 2 : b.max; // open-ended top band: assume width = lower bound
      if (x < lo) break;
      if (x >= hi) { below += b.count; continue; }
      below += b.count * ((x - lo) / Math.max(1, hi - lo));
      break;
    }
    var p = Math.round((below / total) * 100);
    return Math.min(99, Math.max(1, p));
  };

  /* ---------------- Compare widget ---------------- */
  var dataEl = document.getElementById('xyzdb-data');
  if (dataEl) {
    var D = JSON.parse(dataEl.textContent);
    var totalIn = document.getElementById('xyzdb-total');
    var toggle = document.getElementById('xyzdb-breakdown-toggle');
    var breakdown = document.getElementById('xyzdb-breakdown');
    var catIns = breakdown ? breakdown.querySelectorAll('input[data-cat]') : [];
    var out = document.getElementById('xyzdb-result');
    var emptyHtml = out.innerHTML;
    var useBreakdown = false;

    var render = function () {
      var cats = {};
      var total = parse(totalIn.value);
      if (useBreakdown) {
        var sum = 0, any = false;
        catIns.forEach(function (el) {
          var v = parse(el.value);
          cats[el.getAttribute('data-cat')] = v;
          if (v != null) { sum += v; any = true; }
        });
        total = any ? sum : null;
        totalIn.value = any ? Math.round(sum).toLocaleString('en-AU') : '';
      }

      if (total == null || !D.total) {
        out.innerHTML = emptyHtml;
        out.removeAttribute('data-band');
        return;
      }

      var ratio = total / D.total;
      var band = bandFor(ratio);
      var pct = percentile(total, D.bands);
      var ratioTxt = ratio < 0.05 ? 'well under' : ratio.toFixed(1).replace(/\.0$/, '') + '×';

      var html = '<p class="xyzdb-result__eyebrow">Your result</p>' +
        '<p class="xyzdb-result__head">' + esc(band.head) + '</p>' +
        '<p class="xyzdb-result__fig">' + fmt(total) + '</p>' +
        '<p class="xyzdb-result__sub">' +
          (ratio < 0.05 ? 'Well under' : 'About <strong>' + ratioTxt + '</strong>') +
          ' the average of ' + fmt(D.total) + ' among ' + esc(D.plural) + ' who claimed.</p>';
      if (pct != null && total > 0) {
        html += '<p class="xyzdb-result__sub">Higher than about <strong>' + pct + '%</strong> of ' + esc(D.plural) + ' who claimed.</p>';
      }
      html += '<p class="xyzdb-result__body">' + esc(band.body) + '</p>';

      if (useBreakdown) {
        var rows = '';
        Object.keys(D.cats).forEach(function (k) {
          var v = cats[k], avg = D.cats[k].avg;
          if (v == null || !avg) return;
          var r = v / avg;
          rows += '<li><span>' + esc(D.cats[k].name.split(' (')[0]) + '</span><span>' +
            fmt(v) + ' · ' + (r < 0.05 ? '<0.1' : r.toFixed(1)) + '× avg</span></li>';
        });
        if (rows) html += '<ul class="xyzdb-result__cats">' + rows + '</ul>';
      }

      html += '<p class="xyzdb-result__caution">' + esc(CAUTION) + '</p>' +
        '<a class="xyzdb-btn xyzdb-btn--cta" href="' + esc(D.start) + '">Have a tax agent check it — Start my return, ' + esc(D.price) + '</a>';

      out.innerHTML = html;
      out.setAttribute('data-band', band.key);
    };

    var debounce;
    var schedule = function () { clearTimeout(debounce); debounce = setTimeout(render, 150); };

    totalIn.addEventListener('input', function () {
      if (useBreakdown) return;
      schedule();
    });
    catIns.forEach(function (el) { el.addEventListener('input', schedule); });

    if (toggle) {
      toggle.addEventListener('click', function () {
        useBreakdown = !useBreakdown;
        breakdown.hidden = !useBreakdown;
        toggle.setAttribute('aria-expanded', String(useBreakdown));
        toggle.textContent = useBreakdown ? 'Just enter a total' : 'Break it down by type';
        totalIn.readOnly = useBreakdown;
        if (useBreakdown && catIns[0]) catIns[0].focus();
        render();
      });
    }
  }

  /* ---------------- Hub search ---------------- */
  var idxEl = document.getElementById('xyzdb-index');
  var q = document.getElementById('xyzdb-q');
  if (idxEl && q) {
    var IDX = JSON.parse(idxEl.textContent);
    var list = document.getElementById('xyzdb-suggest');
    var active = -1;
    var results = [];

    var score = function (item, term) {
      var l = item.l.toLowerCase();
      if (l.indexOf(term) === 0) return 3;
      if (l.indexOf(term) > -1) return 2;
      for (var i = 0; i < item.s.length; i++) if (item.s[i].toLowerCase().indexOf(term) > -1) return 1;
      return 0;
    };

    var draw = function () {
      list.innerHTML = results.map(function (r, i) {
        return '<li role="option" id="xyzdb-opt-' + i + '"' + (i === active ? ' aria-selected="true"' : '') +
          '><a href="' + esc(r.u) + '">' + esc(r.l) + '</a></li>';
      }).join('');
      list.hidden = !results.length;
      q.setAttribute('aria-activedescendant', active > -1 ? 'xyzdb-opt-' + active : '');
    };

    q.addEventListener('input', function () {
      var term = q.value.trim().toLowerCase();
      active = -1;
      if (term.length < 2) { results = []; draw(); return; }
      results = IDX.map(function (it) { return { it: it, s: score(it, term) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.it.l.localeCompare(b.it.l); })
        .slice(0, 8).map(function (x) { return x.it; });
      draw();
    });

    q.addEventListener('keydown', function (e) {
      if (!results.length) return;
      if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { window.location.href = results[Math.max(0, active)].u; e.preventDefault(); }
      else if (e.key === 'Escape') { results = []; draw(); }
    });
  }

  // Exposed for tests.
  window.XYZDB = { percentile: percentile, bandFor: bandFor, parse: parse };
})();
