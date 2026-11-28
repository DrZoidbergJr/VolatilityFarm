(function () {
  var HAIR = '#EAE2F6'; var MUTED = '#7A6191'; var INK = '#2B1240';
  var MONO = "'IBM Plex Mono',monospace";
  var DRIVER_SERIES = [
    { key: 'MarketSVD1', label: 'Beta', color: '#4C1D95' },
    { key: 'MarketSVD2', label: 'Driver2', color: '#6D28D9' },
    { key: 'MarketSVD3', label: 'Bonds', color: '#8B5CF6' },
    { key: 'MarketSVD4', label: 'Value', color: '#B42318' },
    { key: 'MarketSVD5', label: 'Risk', color: '#047857' }
  ];

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

  function renderDriversChart(rows) {
    var canvas = document.getElementById('drivers-chart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') { vfUI.chart(canvas, 'error', 'market drivers'); return; }
    if (rows.length === 0) { vfUI.chart(canvas, 'empty', 'market drivers'); return; }
    vfUI.chart(canvas, 'ok');
    var labels = rows.map(function (r) { return r.index; });
    var datasets = DRIVER_SERIES.map(function (s) {
      return {
        label: s.label,
        data: rows.map(function (r) { return parseFloat(r[s.key]); }),
        borderColor: s.color,
        backgroundColor: 'transparent',
        fill: false,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.15
      };
    });
    var negativeShadePlugin = {
      id: 'negativeShade',
      beforeDraw: function (chart) {
        var yScale = chart.scales.y;
        var xScale = chart.scales.x;
        if (!yScale || !xScale) return;
        var ctx = chart.ctx;
        var zeroY = yScale.getPixelForValue(0);
        var bottomY = yScale.getPixelForValue(yScale.min);
        if (bottomY <= zeroY || yScale.min >= 0) return;
        ctx.save();
        ctx.fillStyle = '#DCCEF4';
        ctx.fillRect(xScale.left, zeroY, xScale.right - xScale.left, bottomY - zeroY);
        ctx.restore();
      }
    };
    new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      plugins: [negativeShadePlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'start', labels: { color: INK, font: { family: MONO, size: 11 }, boxWidth: 12, usePointStyle: true } },
          tooltip: {
            backgroundColor: '#fff', borderColor: HAIR, borderWidth: 1, titleColor: INK, bodyColor: INK,
            titleFont: { family: MONO, size: 10 }, bodyFont: { family: MONO, size: 11 }, padding: 10,
            callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + c.parsed.y.toFixed(3); } }
          }
        },
        scales: {
          x: { ticks: { color: MUTED, font: { family: MONO, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: HAIR, drawTicks: false }, border: { color: HAIR } },
          y: {
            ticks: { color: MUTED, font: { family: MONO, size: 10 } },
            grid: {
              color: function (ctx) { return ctx.tick.value === 0 ? '#8B5CF6' : HAIR; },
              lineWidth: function (ctx) { return ctx.tick.value === 0 ? 1.5 : 1; },
              drawTicks: false
            },
            border: { color: HAIR }
          }
        }
      }
    });
  }

  function loadDrivers() {
    if (!document.getElementById('drivers-chart')) return;
    vfUI.chart(document.getElementById('drivers-chart'), 'loading', 'market drivers');
    fetch('reports/res_market_drivers.csv')
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(function (text) { renderDriversChart(parseCSV(text)); })
      .catch(function (err) {
        console.warn('[drivers] failed to load market drivers CSV:', err);
        vfUI.chart(document.getElementById('drivers-chart'), 'error', 'market drivers');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDrivers);
  } else {
    loadDrivers();
  }
})();
