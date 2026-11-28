(function () {
  var COLORS = { portfolio: '#4C1D95', spx: '#8B5CF6', vti: '#B42318' };
  var HAIR = '#EAE2F6'; var MUTED = '#7A6191'; var INK = '#2B1240';
  var MONO = "'IBM Plex Mono',monospace";

  var METRIC_FORMAT = {
    'Beta to SPX': { kind: 'pct', digits: 1 },
    'Alpha to SPX': { kind: 'pct', digits: 1 },
    'Sharpe': { kind: 'num', digits: 2 },
    'Calmar': { kind: 'num', digits: 2 },
    'Max drawdown': { kind: 'pct', digits: 2 },
    'Average position duration (days)': { kind: 'num', digits: 1 }
  };

  function parseCSV(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.length > 0; });
    if (lines.length < 2) return [];
    var header = lines[0].split(',');
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(',');
      var row = {};
      for (var c = 0; c < header.length; c++) { row[header[c].trim()] = cells[c] !== undefined ? cells[c].trim() : ''; }
      rows.push(row);
    }
    return rows;
  }

  function formatMetric(label, value) {
    var fmt = METRIC_FORMAT[label];
    var n = parseFloat(value);
    if (isNaN(n)) return value;
    if (!fmt) return value;
    if (fmt.kind === 'pct') { return (n * 100).toFixed(fmt.digits) + '%'; }
    return n.toFixed(fmt.digits);
  }

  function renderChart(rows) {
    var canvas = document.getElementById('performance-chart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') { vfUI.chart(canvas, 'error', 'performance data'); return; }
    if (rows.length === 0) { vfUI.chart(canvas, 'empty', 'performance data'); return; }
    vfUI.chart(canvas, 'ok');
    var labels = rows.map(function (r) { return r.date; });
    var portfolio = rows.map(function (r) { return parseFloat(r.Portfolio); });
    var spx = rows.map(function (r) { return parseFloat(r.SPX); });
    var vti = rows.map(function (r) { return parseFloat(r.VTI); });
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Portfolio', data: portfolio, borderColor: COLORS.portfolio, backgroundColor: 'rgba(76,29,149,.08)', fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .15 },
          { label: 'SPX', data: spx, borderColor: COLORS.spx, backgroundColor: 'transparent', fill: false, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, tension: .15 },
          { label: 'VTI', data: vti, borderColor: COLORS.vti, backgroundColor: 'transparent', fill: false, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, tension: .15 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'end', labels: { color: INK, font: { family: MONO, size: 11 }, boxWidth: 12, usePointStyle: true } },
          tooltip: {
            backgroundColor: '#fff', borderColor: HAIR, borderWidth: 1, titleColor: INK, bodyColor: INK,
            titleFont: { family: MONO, size: 10 }, bodyFont: { family: MONO, size: 11 }, padding: 10,
            callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + c.parsed.y.toFixed(2); } }
          }
        },
        scales: {
          x: { ticks: { color: MUTED, font: { family: MONO, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: HAIR, drawTicks: false }, border: { color: HAIR } },
          y: { ticks: { color: MUTED, font: { family: MONO, size: 10 } }, grid: { color: HAIR, drawTicks: false }, border: { color: HAIR } }
        }
      }
    });
  }

  function renderMetricsTable(rows) {
    var tbody = document.getElementById('performance-tbody');
    if (!tbody) return;
    var table = document.getElementById('performance-table');
    if (rows.length === 0) { vfUI.block(table, 'empty', 'performance metrics'); return; }
    vfUI.block(table, 'ok');
    var html = '';
    rows.forEach(function (r) {
      var label = r.metric; var value = formatMetric(label, r.value);
      html += '<tr><td style="padding:10px 8px 10px 0;border-top:1px solid ' + HAIR + ';color:#5A4272">' + label + '</td><td style="padding:10px 0;border-top:1px solid ' + HAIR + ';text-align:right;font-family:' + MONO + ';color:' + INK + ';font-variant-numeric:tabular-nums">' + value + '</td></tr>';
    });
    tbody.innerHTML = html;
  }

  function loadPerformance() {
    if (!document.getElementById('performance-chart')) return;
    vfUI.chart(document.getElementById('performance-chart'), 'loading', 'performance data');
    vfUI.block(document.getElementById('performance-table'), 'loading', 'performance metrics');
    fetch('reports/res_rel_portfolio.csv')
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(function (text) { renderChart(parseCSV(text)); })
      .catch(function (err) {
        console.warn('[performance] failed to load portfolio CSV:', err);
        vfUI.chart(document.getElementById('performance-chart'), 'error', 'performance data');
      });
    fetch('reports/res_res_portfolio_performance.csv')
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(function (text) { renderMetricsTable(parseCSV(text)); })
      .catch(function (err) {
        console.warn('[performance] failed to load metrics CSV:', err);
        vfUI.block(document.getElementById('performance-table'), 'error', 'performance metrics');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPerformance);
  } else {
    loadPerformance();
  }
})();
