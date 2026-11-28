(function () {
  var DIR = 'reports/cointegration/';
  var HAIR = '#EAE2F6'; var MUTED = '#7A6191'; var INK = '#2B1240';
  var MONO = "'IBM Plex Mono',monospace";
  var DELTA_COLOR = '#4C1D95';
  var SERIES_COLORS = ['#8B5CF6', '#B42318', '#059669', '#D97706', '#0E7490', '#6D28D9'];
  var NON_SERIES = { '': 1, 'Delta': 1, 'forecast': 1 };

  var entries = [];
  var fileCache = {};
  var charts = [];

  // Quote-aware split so a quoted field holding commas stays intact.
  function splitLine(line) {
    var out = []; var cur = ''; var q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') { q = !q; }
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.length > 0; });
    if (lines.length < 2) return { header: [], rows: [] };
    var header = splitLine(lines[0]).map(function (h) { return h.trim(); });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = splitLine(lines[i]);
      var row = {};
      for (var c = 0; c < header.length; c++) { row[header[c]] = cells[c] !== undefined ? cells[c].trim() : ''; }
      rows.push(row);
    }
    return { header: header, rows: rows };
  }

  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(msg) {
    var el = document.getElementById('delta-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function relationLabel(e) {
    var meta = [];
    if (e.Strength) meta.push('Strength ' + formatDetail(e.Strength) + ' of 4');
    if (e.fundamentals === '1') meta.push('w fundm');
    return e.Basic_ticker.split('|').join(' | ') + (meta.length ? '  ·  ' + meta.join(' · ') : '');
  }

  function populateTickers() {
    var sel = document.getElementById('delta-ticker');
    var seen = {}; var tickers = []; var best = {};
    entries.forEach(function (e) {
      if (!seen[e.Ticker]) { seen[e.Ticker] = 1; tickers.push(e.Ticker); }
      best[e.Ticker] = Math.max(best[e.Ticker] || 0, parseFloat(e.Strength) || 0);
    });
    // Tickers with a strength 4 relation first, then strength 3, then the rest; manifest order within each group.
    function rank(t) { return best[t] >= 4 ? 0 : best[t] >= 3 ? 1 : 2; }
    tickers = tickers.map(function (t, i) { return [t, i]; })
      .sort(function (a, b) { return rank(a[0]) - rank(b[0]) || a[1] - b[1]; })
      .map(function (x) { return x[0]; });
    sel.innerHTML = tickers.map(function (t) { return '<option value="' + escapeHTML(t) + '">' + escapeHTML(t) + '</option>'; }).join('');
  }

  function populateRelations() {
    var ticker = document.getElementById('delta-ticker').value;
    var sel = document.getElementById('delta-relation');
    var list = entries.filter(function (e) { return e.Ticker === ticker; });
    // Group by basket, newest first within a basket.
    list.sort(function (a, b) {
      if (a.Basic_ticker !== b.Basic_ticker) return a.Basic_ticker < b.Basic_ticker ? -1 : 1;
      return a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0;
    });
    sel.innerHTML = list.map(function (e) {
      return '<option value="' + escapeHTML(e.file) + '">' + escapeHTML(relationLabel(e)) + '</option>';
    }).join('');
  }

  // Splits a column into actual and forecast datasets; the forecast line starts at the last actual point so the two join.
  function splitForecast(rows, key) {
    var actual = []; var forecast = [];
    var lastActual = -1;
    rows.forEach(function (r, i) {
      var v = parseFloat(r[key]);
      if (isNaN(v)) v = null;
      var isF = r.forecast === '1';
      actual.push(isF ? null : v);
      forecast.push(isF ? v : null);
      if (!isF) lastActual = i;
    });
    if (lastActual >= 0 && lastActual + 1 < rows.length) forecast[lastActual] = actual[lastActual];
    return { actual: actual, forecast: forecast, lastActual: lastActual };
  }

  function formatValue(v) { return v.toFixed(2); }

  // Labels the current value (last non-forecast point) and the final forecast point.
  var pointLabels = {
    id: 'deltaPointLabels',
    afterDatasetsDraw: function (chart, args, opts) {
      var ctx = chart.ctx; var area = chart.chartArea;
      (opts.points || []).forEach(function (p) {
        var el = chart.getDatasetMeta(p.dataset).data[p.index];
        var v = chart.data.datasets[p.dataset].data[p.index];
        if (!el || v === null || v === undefined) return;
        var text = formatValue(v);
        ctx.save();
        ctx.font = '10px ' + MONO;
        var w = ctx.measureText(text).width + 8; var h = 16;
        var x = p.align === 'right' ? el.x - w : el.x - w / 2;
        x = Math.max(area.left, Math.min(x, area.right - w));
        var y = el.y - h - 6;
        if (y < area.top) y = el.y + 6;
        ctx.fillStyle = opts.color;
        ctx.beginPath(); ctx.arc(el.x, el.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = opts.color; ctx.lineWidth = 1;
        ctx.fillRect(x, y, w, h); ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
        ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(text, x + 4, y + h / 2 + .5);
        ctx.restore();
      });
    }
  };

  function makeChart(canvas, labels, rows, key, color, showLegend, yTitle) {
    var parts = splitForecast(rows, key);
    var datasets = [
      { label: key, data: parts.actual, borderColor: color, backgroundColor: 'transparent', borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 4, tension: .15, spanGaps: false }
    ];
    var points = [];
    if (parts.lastActual >= 0) points.push({ dataset: 0, index: parts.lastActual, align: 'center' });
    if (parts.forecast.some(function (v) { return v !== null; })) {
      datasets.push({ label: key + ' forecast', data: parts.forecast, borderColor: color, backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 4, tension: .15, spanGaps: false });
      for (var i = parts.forecast.length - 1; i > parts.lastActual; i--) {
        if (parts.forecast[i] !== null) { points.push({ dataset: 1, index: i, align: 'right' }); break; }
      }
    }
    return new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      plugins: [pointLabels],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 8 } },
        plugins: {
          deltaPointLabels: { points: points, color: color },
          legend: { display: showLegend, position: 'top', align: 'end', labels: { color: INK, font: { family: MONO, size: 11 }, boxWidth: 12, usePointStyle: true } },
          tooltip: {
            backgroundColor: '#fff', borderColor: HAIR, borderWidth: 1, titleColor: INK, bodyColor: INK,
            titleFont: { family: MONO, size: 10 }, bodyFont: { family: MONO, size: 11 }, padding: 10,
            filter: function (item) { return item.parsed.y !== null; },
            callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + c.parsed.y.toFixed(3); } }
          }
        },
        scales: {
          x: { ticks: { color: MUTED, font: { family: MONO, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, callback: function (v) { return this.getLabelForValue(v).slice(5, 10); } }, grid: { color: HAIR, drawTicks: false }, border: { color: HAIR } },
          y: { title: { display: true, text: yTitle, color: MUTED, font: { family: MONO, size: 10 } }, ticks: { color: MUTED, font: { family: MONO, size: 10 }, precision: 2, callback: function (v) { return formatValue(v); } }, grid: { color: HAIR, drawTicks: false }, border: { color: HAIR } }
        }
      }
    });
  }

  var RELATION_NAMES = { ln: 'relative', level: 'absolute' };
  var YES_NO = { '0': 'no', '1': 'yes' };

  function formatDetail(v) {
    var n = Number(v);
    return v === '' || v === undefined ? '—' : isNaN(n) ? v : String(n);
  }

  function renderDetails(file) {
    var tbody = document.getElementById('delta-details-tbody');
    if (!tbody) return;
    var e = entries.filter(function (x) { return x.file === file; })[0] || {};
    tbody.innerHTML = [
      ['Relation', RELATION_NAMES[e.Relation] || e.Relation],
      ['Strength', e.Strength === '' || e.Strength === undefined ? e.Strength : formatDetail(e.Strength) + ' of 4'],
      ['Including fundamentals', YES_NO[e.fundamentals] || e.fundamentals],
      ['Recent earnings', e.Release_date || 'not applicable'],
      ['Updated at', e.Date]
    ].map(function (d) {
      return '<tr><td style="padding:10px 8px 10px 0;border-top:1px solid ' + HAIR + ';color:#5A4272">' + d[0] + '</td><td style="padding:10px 0;border-top:1px solid ' + HAIR + ';text-align:right;font-family:' + MONO + ';color:' + INK + ';font-variant-numeric:tabular-nums">' + escapeHTML(formatDetail(d[1])) + '</td></tr>';
    }).join('');
  }

  function clearCharts() {
    charts.forEach(function (c) { c.destroy(); });
    charts = [];
    var wrap = document.getElementById('delta-series');
    if (wrap) wrap.innerHTML = '';
  }

  function mainCanvas() { return document.getElementById('delta-chart'); }

  function renderFile(file, parsed) {
    clearCharts();
    var rows = parsed.rows;
    if (!rows.length) {
      setStatus('');
      vfUI.chart(mainCanvas(), 'empty', 'delta data');
      return;
    }
    vfUI.chart(mainCanvas(), 'ok');
    var labels = rows.map(function (r) { return (r[parsed.header[0]] || '').slice(0, 16); });
    var ticker = document.getElementById('delta-ticker').value;

    document.getElementById('delta-main-title').textContent = 'Delta · ' + ticker;
    charts.push(makeChart(document.getElementById('delta-chart'), labels, rows, 'Delta', DELTA_COLOR, true, 'Spread'));

    var seriesKeys = parsed.header.filter(function (h) { return !NON_SERIES[h]; });
    var wrap = document.getElementById('delta-series');
    wrap.innerHTML = seriesKeys.map(function (k, i) {
      return '<div class="delta-series-card" style="background:#FAF8FE;border:1px solid #EAE2F6;border-radius:3px;padding:20px;display:flex;flex-direction:column">' +
        '<div style="font-family:' + MONO + ';font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6D28D9;margin-bottom:12px">' + escapeHTML(k) + '</div>' +
        '<div style="position:relative;height:220px"><canvas id="delta-series-' + i + '"></canvas></div></div>';
    }).join('');
    seriesKeys.forEach(function (k, i) {
      charts.push(makeChart(document.getElementById('delta-series-' + i), labels, rows, k, SERIES_COLORS[i % SERIES_COLORS.length], false, 'Exposures'));
    });
    setStatus('');
  }

  // Deep links: #delta/<TICKER>/<FILE-STEM>, FILE-STEM = manifest file name without ".csv".
  function stemOf(file) { return String(file).replace(/\.csv$/i, ''); }

  function parseHash() {
    var m = /^#delta\/([^\/]+)\/([^\/]+)$/.exec(window.location.hash);
    if (!m) return null;
    try { return { ticker: decodeURIComponent(m[1]), stem: decodeURIComponent(m[2]) }; } catch (e) { return null; }
  }

  // Selects the ticker + relation named by the hash. Returns false (leaving the selects alone) if it doesn't match the manifest.
  function applyHash() {
    var want = parseHash();
    if (!want) return false;
    var entry = entries.filter(function (e) {
      return e.Ticker.toUpperCase() === want.ticker.toUpperCase() && stemOf(e.file) === want.stem;
    })[0];
    if (!entry) return false;
    document.getElementById('delta-ticker').value = entry.Ticker;
    populateRelations();
    document.getElementById('delta-relation').value = entry.file;
    return true;
  }

  function updateHash() {
    var ticker = document.getElementById('delta-ticker').value;
    var file = document.getElementById('delta-relation').value;
    if (!ticker || !file || !window.history || !window.history.replaceState) return;
    var hash = '#delta/' + encodeURIComponent(ticker) + '/' + encodeURIComponent(stemOf(file));
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + hash);
  }

  function scrollToSection() {
    var el = document.getElementById('delta');
    if (!el) return;
    var header = document.getElementById('site-header');
    var prev = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, el.getBoundingClientRect().top + window.pageYOffset - (header ? header.offsetHeight : 0));
    document.documentElement.style.scrollBehavior = prev;
  }

  function loadFile() {
    var file = document.getElementById('delta-relation').value;
    if (!file) return;
    renderDetails(file);
    if (typeof Chart === 'undefined') { clearCharts(); vfUI.chart(mainCanvas(), 'error', 'delta data'); return; }
    if (fileCache[file]) { renderFile(file, fileCache[file]); return; }
    setStatus('');
    vfUI.chart(mainCanvas(), 'loading', 'delta data');
    fetch(DIR + encodeURIComponent(file))
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(function (text) {
        fileCache[file] = parseCSV(text);
        if (document.getElementById('delta-relation').value === file) renderFile(file, fileCache[file]);
      })
      .catch(function (err) {
        console.warn('[delta] failed to load ' + file + ':', err);
        if (document.getElementById('delta-relation').value !== file) return;
        clearCharts();
        vfUI.chart(mainCanvas(), 'error', 'delta data');
      });
  }

  function loadDelta() {
    if (!document.getElementById('delta-chart')) return;
    setStatus(vfUI.message('loading', 'delta relations'));
    vfUI.chart(mainCanvas(), 'loading', 'delta data');
    fetch(DIR + 'manifest.csv')
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(function (text) {
        entries = parseCSV(text).rows.filter(function (e) { return e.Ticker && e.Basic_ticker && e.file; });
        if (!entries.length) {
          setStatus(vfUI.message('empty', 'delta relations'));
          vfUI.chart(mainCanvas(), 'empty', 'delta data');
          return;
        }
        setStatus('');
        populateTickers();
        if (!applyHash()) populateRelations();
        document.getElementById('delta-ticker').addEventListener('change', function () { populateRelations(); updateHash(); loadFile(); });
        document.getElementById('delta-relation').addEventListener('change', function () { updateHash(); loadFile(); });
        window.addEventListener('hashchange', function () {
          if (applyHash()) { loadFile(); scrollToSection(); }
        });
        loadFile();
      })
      .catch(function (err) {
        console.warn('[delta] failed to load manifest:', err);
        setStatus(vfUI.message('error', 'delta relations'));
        vfUI.chart(mainCanvas(), 'error', 'delta data');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDelta);
  } else {
    loadDelta();
  }
})();
