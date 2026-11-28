(function () {
  function reportPathFromHash() {
    var h = window.location.hash;
    if (!h || h.length < 2) return null;
    var path = h.slice(1);
    if (path.indexOf('reports/') !== 0) return null;
    return path;
  }

  function findReportAnchor(path) {
    var anchors = document.querySelectorAll('a[href="' + path + '"]');
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i].getAttribute('target') !== '_blank') return anchors[i];
    }
    return null;
  }

  function expandEarlierReports() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var t = buttons[i].textContent;
      if (t.indexOf('Earlier reports') !== -1) {
        buttons[i].click();
        return true;
      }
    }
    return false;
  }

  function tryOpenFromHash(attemptsLeft, expanded) {
    var path = reportPathFromHash();
    if (!path) return;
    var anchor = findReportAnchor(path);
    if (anchor) {
      anchor.click();
      return;
    }
    if (!expanded && expandEarlierReports()) {
      setTimeout(function () { tryOpenFromHash(attemptsLeft - 1, true); }, 150);
      return;
    }
    if (attemptsLeft > 0) {
      setTimeout(function () { tryOpenFromHash(attemptsLeft - 1, expanded); }, 150);
    }
  }

  function trySectionScroll(attemptsLeft, lastTop, stableCount) {
    var h = window.location.hash;
    if (!h || h.length < 2) return;
    var id = h.slice(1);
    if (id.indexOf('reports/') === 0) return;
    // Delta deep links (#delta/<TICKER>/<FILE>) skip the intro copy and land on the dropdowns and charts.
    if (id.indexOf('delta/') === 0) id = 'delta-controls';
    var el = document.getElementById(id);
    if (!el) {
      if (attemptsLeft > 0) {
        setTimeout(function () { trySectionScroll(attemptsLeft - 1); }, 150);
      }
      return;
    }
    stableCount = stableCount || 0;
    var top = el.getBoundingClientRect().top + window.pageYOffset;
    var isStable = lastTop !== undefined && Math.abs(top - lastTop) < 1;
    stableCount = isStable ? stableCount + 1 : 0;
    if (stableCount < 3 && attemptsLeft > 0) {
      setTimeout(function () { trySectionScroll(attemptsLeft - 1, top, stableCount); }, 100);
      return;
    }
    var prevBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    var header = document.getElementById('site-header');
    window.scrollTo(0, top - (header ? header.offsetHeight : 0));
    document.documentElement.style.scrollBehavior = prevBehavior;
  }

  function init() {
    tryOpenFromHash(20, false);
    trySectionScroll(40);
    setTimeout(function () { document.documentElement.style.scrollBehavior = 'smooth'; }, 4500);
  }

  window.addEventListener('popstate', function () {
    var path = reportPathFromHash();
    if (path) {
      tryOpenFromHash(20, false);
    } else if (window.__vfReadingOpen && window.__vfReadingOpen()) {
      // Only treat this as "user hit Back out of an open report" -- a
      // plain in-page nav click (e.g. <a href="#regimes">) also fires
      // popstate in real browsers, and would otherwise wrongly trigger
      // closeReport()'s window.scrollTo(0, 0), stomping on the native
      // scroll-to-anchor that was just about to happen.
      if (window.__vfCloseReport) window.__vfCloseReport();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
