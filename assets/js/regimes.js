(function () {
  var HAIR = '#EAE2F6'; var MUTED = '#7A6191'; var INK = '#2B1240';
  var MONO = "'IBM Plex Mono',monospace";
  var TICKERS = [
    { key: 'VOO', canvas: 'regime-chart-voo', color: [76, 29, 149] },
    { key: 'VIXY', canvas: 'regime-chart-vixy', color: [180, 35, 24] },
    { key: 'AAAU', canvas: 'regime-chart-aaau', color: [217, 158, 10] },
    { key: 'BSV', canvas: 'regime-chart-bsv', color: [4, 120, 87] },
    { key: 'BIV', canvas: 'regime-chart-biv', color: [37, 99, 235] },
    { key: 'BLV', canvas: 'regime-chart-blv', color: [109, 40, 217] }
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

  function renderRegimeChart(canvasId, points, rgb) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (typeof Chart === 'undefined') { vfUI.chart(canvas, 'error', 'market regimes'); return; }
    if (points.length === 0) { vfUI.chart(canvas, 'empty', 'market regimes'); return; }
    vfUI.chart(canvas, 'ok');
    var n = points.length;
    var QUAD_PP = [43, 18, 64];
    var QUAD_NN = [43, 18, 64];
    var QUAD_PN = [220, 206, 244];
    var QUAD_NP = [220, 206, 244];
    var ZERO_LINE = '#8B5CF6';
    function quadrantColor(p) {
      if (p.x >= 0 && p.y >= 0) return QUAD_PP;
      if (p.x < 0 && p.y < 0) return QUAD_NN;
      if (p.x >= 0 && p.y < 0) return QUAD_PN;
      return QUAD_NP;
    }
    function gridColor(ctx) {
      return ctx.tick.value === 0 ? ZERO_LINE : HAIR;
    }
    function gridWidth(ctx) {
      return ctx.tick.value === 0 ? 1.5 : 1;
    }
    var pointColors = points.map(function (p, i) {
      var alpha = n <= 1 ? 1 : 0.35 + 0.6 * (i / (n - 1));
      var c = quadrantColor(p);
      return 'rgba(' + c.join(',') + ',' + alpha.toFixed(3) + ')';
    });
    var pointRadii = points.map(function (p, i) { return i === n - 1 ? 0 : 3; });
    var lineColors = points.map(function (p, i) {
      var alpha = n <= 1 ? 1 : 0.2 + 0.55 * (i / (n - 1));
      var c = quadrantColor(points[i]);
      return 'rgba(' + c.join(',') + ',' + alpha.toFixed(3) + ')';
    });
    new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            data: points,
            showLine: true,
            fill: false,
            borderWidth: 1.25,
            segment: {
              borderColor: function (ctx) { return lineColors[ctx.p1DataIndex]; }
            },
            pointBackgroundColor: pointColors,
            pointBorderColor: pointColors,
            pointRadius: pointRadii,
            pointHoverRadius: pointRadii.map(function (r) { return r + 2; }),
            tension: 0,
            order: 2
          },
          {
            data: [points[n - 1]],
            showLine: false,
            pointStyle: 'rectRot',
            pointBackgroundColor: '#6D28D9',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 8,
            pointHoverRadius: 10,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fff', borderColor: HAIR, borderWidth: 1, titleColor: INK, bodyColor: INK,
            titleFont: { family: MONO, size: 10 }, bodyFont: { family: MONO, size: 11 }, padding: 8,
            callbacks: {
              title: function () { return ''; },
              label: function (c) {
                var pct = function (v) { return (v * 100).toFixed(0) + '%'; };
                return 'Persistency ' + pct(c.parsed.x) + ', Volatility ' + pct(c.parsed.y) + (c.datasetIndex === 1 ? ' (latest)' : '');
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear', min: -1, max: 1,
            title: { display: true, text: 'Persistency', color: MUTED, font: { family: MONO, size: 10 } },
            ticks: {
              color: MUTED, font: { family: MONO, size: 9 }, stepSize: 0.5,
              callback: function (value) {
                if (value === -0.5) return 'mean-reverting';
                if (value === 0.5) return 'trending';
                return '';
              }
            },
            grid: { color: gridColor, lineWidth: gridWidth, drawTicks: false }, border: { color: HAIR }
          },
          y: {
            type: 'linear', min: -1, max: 1,
            title: { display: true, text: 'Volatility', color: MUTED, font: { family: MONO, size: 10 } },
            ticks: {
              color: MUTED, font: { family: MONO, size: 9 }, stepSize: 0.5,
              callback: function (value) {
                if (value === -1) return 'calm';
                if (value === 1) return 'volatile';
                return '';
              }
            },
            grid: { color: gridColor, lineWidth: gridWidth, drawTicks: false }, border: { color: HAIR }
          }
        }
      }
    });
  }

  function renderBreathChart(canvasId, rows) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (typeof Chart === 'undefined') { vfUI.chart(canvas, 'error', 'market breadth'); return; }
    if (rows.length === 0) { vfUI.chart(canvas, 'empty', 'market breadth'); return; }
    vfUI.chart(canvas, 'ok');
    var n = rows.length;
    var labels = rows.map(function (r) { return r.timestamp; });
    var values = rows.map(function (r) { return r.value; });
    var negativeShadePlugin = {
      id: 'negativeShade',
      beforeDraw: function (chart) {
        var yScale = chart.scales.y;
        var xScale = chart.scales.x;
        if (!yScale || !xScale) return;
        var ctx = chart.ctx;
        var zeroY = yScale.getPixelForValue(0);
        var bottomY = yScale.getPixelForValue(yScale.min);
        if (bottomY <= zeroY) return;
        ctx.save();
        ctx.fillStyle = '#DCCEF4';
        ctx.fillRect(xScale.left, zeroY, xScale.right - xScale.left, bottomY - zeroY);
        ctx.restore();
      }
    };
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            data: values,
            borderColor: '#6D28D9',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1.25,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0,
            order: 2
          },
          {
            data: values.map(function (v, i) { return i === n - 1 ? v : null; }),
            showLine: false,
            pointStyle: 'rectRot',
            pointBackgroundColor: '#6D28D9',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            pointRadius: function (ctx) { return ctx.dataIndex === n - 1 ? 8 : 0; },
            pointHoverRadius: function (ctx) { return ctx.dataIndex === n - 1 ? 10 : 0; },
            order: 1
          }
        ]
      },
      plugins: [negativeShadePlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fff', borderColor: HAIR, borderWidth: 1, titleColor: INK, bodyColor: INK,
            titleFont: { family: MONO, size: 10 }, bodyFont: { family: MONO, size: 11 }, padding: 8,
            callbacks: {
              title: function (items) { return items.length ? labels[items[0].dataIndex] : ''; },
              label: function (c) { return (c.parsed.y * 100).toFixed(1) + '%'; }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: MUTED, font: { family: MONO, size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            grid: { display: false }, border: { color: HAIR }
          },
          y: {
            min: -1, max: 1,
            ticks: { display: false },
            grid: {
              color: function (ctx) { return ctx.tick.value === 0 ? '#8B5CF6' : HAIR; },
              lineWidth: function (ctx) { return ctx.tick.value === 0 ? 1.5 : 1; },
              drawTicks: false
            },
            border: { display: false }
          }
        }
      }
    });
  }

  function loadRegimes() {
    if (!document.getElementById('regime-chart-voo')) return;
    TICKERS.forEach(function (t) { vfUI.chart(document.getElementById(t.canvas), 'loading', 'market regimes'); });
    vfUI.chart(document.getElementById('regime-chart-breath'), 'loading', 'market breadth');
    fetch('reports/res_market_regimes.csv')
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(function (text) {
        var rows = parseCSV(text);
        TICKERS.forEach(function (t) {
          var points = rows.map(function (r) {
            return { x: parseFloat(r[t.key + '_H']), y: parseFloat(r[t.key + '_std']) };
          }).filter(function (p) { return !isNaN(p.x) && !isNaN(p.y); });
          renderRegimeChart(t.canvas, points, t.color);
        });
      })
      .catch(function (err) {
        console.warn('[regimes] failed to load market regimes CSV:', err);
        TICKERS.forEach(function (t) { vfUI.chart(document.getElementById(t.canvas), 'error', 'market regimes'); });
      });
    fetch('reports/res_breath.csv')
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(function (text) {
        var rows = parseCSV(text).map(function (r) {
          return { timestamp: r.timestamp, value: parseFloat(r.Breath) };
        }).filter(function (r) { return !isNaN(r.value); });
        renderBreathChart('regime-chart-breath', rows);
      })
      .catch(function (err) {
        console.warn('[regimes] failed to load breath CSV:', err);
        vfUI.chart(document.getElementById('regime-chart-breath'), 'error', 'market breadth');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRegimes);
  } else {
    loadRegimes();
  }
})();
