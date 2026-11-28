// Shared "Share" flow for chart sections (Delta, Regimes, Drivers).
// A section draws a 1200x630 snapshot with the helpers below, then vfShare.start() uploads it to the vf-share Worker
// and shows the returned short link (Copy link / Share… / Image). Link previews on X, iMessage, Slack etc. show the
// snapshot; opening the link lands on the live section.
(function () {
  var W = 1200; var H = 630; var PAD = 40;
  var INK = '#2B1240'; var MUTED = '#7A6191'; var HAIR = '#EAE2F6';
  var MONO = "'IBM Plex Mono',monospace";
  var API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? 'http://127.0.0.1:8787' : 'https://vf-share.volatilityfarm.workers.dev';
  var NOTE_BTN = "font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6D28D9;background:#fff;border:1px solid #DCCEF4;border-radius:3px;padding:7px 12px;cursor:pointer;text-decoration:none";

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // White card with the brand bar, wordmark, a serif title, an optional mono meta line and a right-aligned stamp.
  function newCanvas(title, meta, stamp) {
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#6D28D9'; ctx.fillRect(0, 0, 8, H);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = INK; ctx.font = "700 20px 'Libre Baskerville',serif"; ctx.fillText('Volatility Farm', PAD, 24);
    if (stamp) {
      ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.font = '15px ' + MONO;
      ctx.fillText(stamp, W - PAD, 28);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = INK; ctx.font = "700 30px 'Libre Baskerville',serif"; ctx.fillText(title, PAD, 58);
    if (meta) { ctx.fillStyle = '#5A4272'; ctx.font = '15px ' + MONO; ctx.fillText(meta, PAD, 102); }
    return { canvas: c, ctx: ctx, top: meta ? 132 : 108, bottom: H - 40, left: PAD, width: W - PAD * 2 };
  }

  function footer(ctx, text) {
    ctx.fillStyle = '#6D28D9'; ctx.font = '13px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, PAD, H - 28);
  }

  // Panel box with a title; returns the area left for the chart.
  function panel(ctx, x, y, w, h, title) {
    ctx.fillStyle = '#FAF8FE'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = HAIR; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#6D28D9'; ctx.font = '600 13px ' + MONO; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(String(title).toUpperCase(), x + 12, y + 10);
    return { x: x + 8, y: y + 30, w: w - 16, h: h - 38 };
  }

  // Redraws an existing chart into rect. It is laid out at rect/k CSS pixels with devicePixelRatio k, so text and
  // lines scale by k without touching the section's own chart options.
  function drawChart(ctx, chart, rect, k) {
    if (!chart) return;
    var cfg = chart.config._config || chart.config;
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + (rect.w / k) + 'px;height:' + (rect.h / k) + 'px';
    var cv = document.createElement('canvas');
    holder.appendChild(cv); document.body.appendChild(holder);
    var data = cfg.data || {};
    var copy = new Chart(cv, {
      type: cfg.type,
      data: { labels: data.labels, datasets: (data.datasets || []).map(function (d) { return Object.assign({}, d); }) },
      plugins: cfg.plugins,
      options: Object.assign({}, cfg.options, { responsive: true, maintainAspectRatio: false, animation: false, devicePixelRatio: k, events: [] })
    });
    ctx.drawImage(cv, rect.x, rect.y, rect.w, rect.h);
    copy.destroy(); holder.remove();
  }

  function enable(btn, on) {
    if (!btn) return;
    btn.disabled = !on;
    btn.style.opacity = on ? '1' : '.5';
    btn.style.cursor = on ? 'pointer' : 'default';
  }

  function resetNote(note) {
    if (!note) return;
    note.innerHTML = '';
    note.style.display = 'none';
  }

  function noteText(note, msg) {
    if (!note) return;
    note.textContent = msg;
    note.style.display = 'block';
  }

  // The link panel's buttons are fresh clicks, so clipboard and the share sheet are allowed there.
  function showLink(note, link, title, imgName, imgURL) {
    var id = note.id;
    note.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
      '<input id="' + id + '-url" readonly value="' + esc(link) + '" style="font-family:' + MONO + ';font-size:12px;color:' + INK + ';border:1px solid #DCCEF4;border-radius:3px;padding:7px 10px;flex:1 1 260px;min-width:0;background:#fff">' +
      '<button type="button" id="' + id + '-copy" style="' + NOTE_BTN + '">Copy link</button>' +
      (navigator.share ? '<button type="button" id="' + id + '-native" style="' + NOTE_BTN + '">Share…</button>' : '') +
      '<a href="' + esc(imgURL) + '" download="' + esc(imgName) + '" style="' + NOTE_BTN + '">Image</a>' +
      '</div><div id="' + id + '-msg" style="margin-top:6px">Link created — anyone you share it with sees this snapshot in the preview.</div>';
    note.style.display = 'block';
    var input = document.getElementById(id + '-url');
    var msg = document.getElementById(id + '-msg');
    input.addEventListener('focus', function () { input.select(); });
    function legacyCopy() { input.focus(); input.select(); document.execCommand('copy'); msg.textContent = 'Link copied.'; }
    document.getElementById(id + '-copy').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () { msg.textContent = 'Link copied.'; }, legacyCopy);
      } else { legacyCopy(); }
    });
    var nativeBtn = document.getElementById(id + '-native');
    if (nativeBtn) nativeBtn.addEventListener('click', function () {
      navigator.share({ title: title, url: link }).catch(function () {});
    });
  }

  // opts: button, note, kind, params (query object), canvas, title, imgName, fallback (live link),
  //       stillValid() -> false if the section changed while uploading.
  function start(opts) {
    var imgURL = opts.canvas.toDataURL('image/png');
    var stillValid = opts.stillValid || function () { return true; };
    enable(opts.button, false);
    noteText(opts.note, 'Creating share link…');
    var q = ['kind=' + encodeURIComponent(opts.kind)];
    Object.keys(opts.params || {}).forEach(function (k) { q.push(encodeURIComponent(k) + '=' + encodeURIComponent(opts.params[k])); });
    opts.canvas.toBlob(function (blob) {
      fetch(API + '/api/share?' + q.join('&'), { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob })
        .then(function (res) { return res.json().then(function (body) { if (!res.ok) throw new Error(body && body.error || ('HTTP ' + res.status)); return body; }); })
        .then(function (body) { if (stillValid()) showLink(opts.note, body.url, opts.title, opts.imgName, imgURL); })
        .catch(function (err) {
          console.warn('[share] failed:', err);
          if (stillValid()) noteText(opts.note, "Couldn't create a share link (" + err.message + '). The live link still works: ' + opts.fallback);
        })
        .then(function () { enable(opts.button, true); });
    }, 'image/png');
  }

  window.vfShare = {
    W: W, H: H, newCanvas: newCanvas, footer: footer, panel: panel, drawChart: drawChart,
    enable: enable, resetNote: resetNote, start: start
  };
})();
