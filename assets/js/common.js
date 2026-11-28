// Shared loading / empty / error status messages for the data-driven sections.
// Loaded first (all page scripts are deferred and run in document order).
//   vfUI.message(kind, thing)  -> text for kind 'loading' | 'empty' | 'error'
//   vfUI.chart(canvas, kind, thing)  -> overlay inside the chart box ('ok' clears it)
//   vfUI.block(el, kind, thing)      -> status line above a table/block ('ok' clears it)
(function () {
  var STYLE = "font-family:'IBM Plex Mono',monospace;font-size:12px;color:#7A6191";

  function message(kind, thing) {
    if (kind === 'loading') return 'Loading ' + thing + '…';
    if (kind === 'empty') return 'No ' + thing + ' available right now.';
    return "Couldn't load " + thing + ". Please try again later.";
  }

  function findStatus(host, before) {
    var n = host.querySelector(':scope > .vf-status');
    if (n) return n;
    n = document.createElement('div');
    n.className = 'vf-status';
    n.setAttribute('role', 'status');
    if (before) host.insertBefore(n, before); else host.appendChild(n);
    return n;
  }

  function chart(canvas, kind, thing) {
    if (!canvas || !canvas.parentElement) return;
    var host = canvas.parentElement;
    var n = findStatus(host, null);
    if (kind === 'ok') {
      n.style.display = 'none';
      canvas.style.visibility = '';
      return;
    }
    n.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;' +
      'justify-content:center;text-align:center;padding:8px;' + STYLE;
    n.textContent = message(kind, thing);
    canvas.style.visibility = 'hidden';
  }

  function block(el, kind, thing) {
    if (!el || !el.parentElement) return;
    var n = findStatus(el.parentElement, el);
    if (kind === 'ok') {
      n.style.display = 'none';
      el.style.display = '';
      return;
    }
    n.style.cssText = 'padding:8px 4px;' + STYLE;
    n.textContent = message(kind, thing);
    el.style.display = 'none';
  }

  window.vfUI = { message: message, chart: chart, block: block };
})();
