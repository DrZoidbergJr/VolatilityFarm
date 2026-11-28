// Share buttons for the Regimes and Drivers sections (see assets/js/share.js for the shared flow).
(function () {
  var SITE = 'https://volatilityfarm.com/';
  var REGIME_PANELS = [
    ['regime-chart-voo', 'SP500'], ['regime-chart-vixy', 'Volatility'], ['regime-chart-aaau', 'Gold'],
    ['regime-chart-bsv', 'Short-term bonds'], ['regime-chart-biv', 'Intermediate bonds'], ['regime-chart-blv', 'Long-term bonds']
  ];

  function chartOf(id) {
    var el = document.getElementById(id);
    return el && typeof Chart !== 'undefined' ? Chart.getChart(el) : null;
  }

  function lastLabel(chart) {
    var labels = chart && chart.data && chart.data.labels;
    return labels && labels.length ? String(labels[labels.length - 1]).slice(0, 16) : '';
  }

  function buildRegimes() {
    var breath = chartOf('regime-chart-breath');
    var asof = lastLabel(breath);
    var card = vfShare.newCanvas('Market regimes', 'US market breadth and regimes: SP500, volatility, gold and bonds', asof ? 'AS OF ' + asof : '');
    var ctx = card.ctx; var gap = 12;
    var breathH = 116;
    var r = vfShare.panel(ctx, card.left, card.top, card.width, breathH, 'US market breadth');
    vfShare.drawChart(ctx, breath, r, 1);
    ctx.fillStyle = '#7A6191'; ctx.font = "10px 'IBM Plex Mono',monospace"; ctx.textAlign = 'left';
    ctx.textBaseline = 'top'; ctx.fillText('NARROW', r.x + 4, r.y);
    ctx.textBaseline = 'bottom'; ctx.fillText('BROAD', r.x + 4, r.y + r.h - 18);
    var cols = 3; var rowsTop = card.top + breathH + gap;
    var cellW = Math.floor((card.width - gap * (cols - 1)) / cols);
    var cellH = Math.floor((card.bottom - rowsTop - gap) / 2);
    REGIME_PANELS.forEach(function (p, i) {
      var x = card.left + (i % cols) * (cellW + gap);
      var y = rowsTop + Math.floor(i / cols) * (cellH + gap);
      vfShare.drawChart(ctx, chartOf(p[0]), vfShare.panel(ctx, x, y, cellW, cellH, p[1]), 0.72);
    });
    vfShare.footer(ctx, 'volatilityfarm.com · Market regimes');
    return { canvas: card.canvas, asof: asof };
  }

  function buildDrivers() {
    var chart = chartOf('drivers-chart');
    var asof = lastLabel(chart);
    var card = vfShare.newCanvas('Market drivers', 'Underlying market decomposition into broad drivers (labels approximate)', asof ? 'AS OF ' + asof : '');
    var r = vfShare.panel(card.ctx, card.left, card.top, card.width, card.bottom - card.top, 'Market drivers');
    vfShare.drawChart(card.ctx, chart, r, 1.3);
    vfShare.footer(card.ctx, 'volatilityfarm.com · Market drivers');
    return { canvas: card.canvas, asof: asof };
  }

  var SECTIONS = [
    { kind: 'regimes', ready: function () { return chartOf('regime-chart-breath') && REGIME_PANELS.every(function (p) { return chartOf(p[0]); }); },
      build: buildRegimes, title: 'Market regimes — Volatility Farm' },
    { kind: 'drivers', ready: function () { return chartOf('drivers-chart'); },
      build: buildDrivers, title: 'Market drivers — Volatility Farm' }
  ];

  function wire(s) {
    var btn = document.getElementById(s.kind + '-share');
    var note = document.getElementById(s.kind + '-share-note');
    if (!btn || !note) return;
    btn.addEventListener('click', function () {
      if (!s.ready()) return;
      var built = s.build();
      vfShare.start({
        button: btn, note: note, kind: s.kind,
        params: built.asof ? { asof: built.asof } : {},
        canvas: built.canvas, title: s.title,
        imgName: 'volatility-farm-' + s.kind + (built.asof ? '-' + built.asof.slice(0, 10) : '') + '.png',
        fallback: SITE + '#' + s.kind
      });
    });
    // Charts load asynchronously; enable the button once they exist (give up quietly after a minute).
    var tries = 0;
    (function poll() {
      if (s.ready()) { vfShare.enable(btn, true); return; }
      if (++tries < 120) setTimeout(poll, 500);
    })();
  }

  function init() { SECTIONS.forEach(wire); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
