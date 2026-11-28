(function () {
  var iframe = document.getElementById('reading-iframe');
  var titleEl = document.getElementById('reading-title');
  var openFullLink = document.getElementById('reading-open-full');
  var readingView = document.getElementById('reading-view');
  var browsingView = document.getElementById('browsing-view');
  var closeBtn = document.getElementById('close-reading-btn');

  function openReport(href, title) {
    if (!href || href === '#') return;
    iframe.src = href;
    iframe.title = title;
    titleEl.textContent = title;
    openFullLink.href = href;
    readingView.style.display = 'flex';
    browsingView.style.display = 'none';
    if (window.history && window.history.pushState) {
      window.history.pushState({ dcReport: href }, '', '#' + href);
    }
    window.scrollTo(0, 0);
  }

  function closeReport() {
    readingView.style.display = 'none';
    browsingView.style.display = 'flex';
    if (window.history && window.history.pushState) {
      window.history.pushState({}, '', window.location.pathname + window.location.search);
    }
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a.report-link');
    if (!a || a.target === '_blank') return;
    e.preventDefault();
    openReport(a.getAttribute('href'), a.dataset.title || a.textContent.trim());
  });

  if (closeBtn) closeBtn.addEventListener('click', closeReport);

  var earlierBtn = document.getElementById('earlier-reports-btn');
  if (earlierBtn) {
    earlierBtn.addEventListener('click', function () {
      var hidden = document.querySelectorAll('.archive-row[hidden]');
      for (var i = 0; i < hidden.length; i++) {
        hidden[i].removeAttribute('hidden');
        hidden[i].style.display = 'grid';
      }
      document.getElementById('earlier-reports-wrap').style.display = 'none';
    });
  }

  window.__vfCloseReport = closeReport;
  window.__vfReadingOpen = function () { return readingView.style.display !== 'none'; };
})();
