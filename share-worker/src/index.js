// Volatility Farm share links for Delta plots.
//
// POST /api/share?ticker=<T>&stem=<FILE-STEM>   body: 1200x630 PNG rendered by the site
//   -> { url } pointing at a new /s/<id> snapshot page.
// GET  /s/<id>       HTML with Open Graph / Twitter tags for link previews; people are sent on to the live chart.
// GET  /s/<id>.png   the stored snapshot image.

const IMG_W = 1200;
const IMG_H = 630;
const MAX_BYTES = 800 * 1024;
const ID_RE = /^[A-Za-z0-9]{10}$/;
const TICKER_RE = /^[A-Za-z0-9.\-]{1,12}$/;
const STEM_RE = /^[A-Za-z0-9._\-]{1,120}$/;
const RELATION_NAMES = { ln: 'relative', level: 'absolute' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/share') return await handleShare(request, env, url);
      let m = /^\/s\/([A-Za-z0-9]+)\.png$/.exec(path);
      if (m && request.method === 'GET') return await handleImage(env, m[1]);
      m = /^\/s\/([A-Za-z0-9]+)$/.exec(path);
      if (m && request.method === 'GET') return await handlePage(env, url, m[1]);
      if (path === '/' || path === '') return Response.redirect(env.SITE + '/#delta', 302);
      return text('Not found', 404);
    } catch (err) {
      console.error(err);
      return text('Something went wrong', 500);
    }
  }
};

function text(body, status, headers) {
  return new Response(body, { status: status || 200, headers: Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, headers || {}) });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json' }, cors || {}) });
}

async function handleShare(request, env, url) {
  const cors = corsHeaders(request, env);
  if (!cors) return text('Forbidden', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);

  if (env.SHARE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.SHARE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'Too many share links, please wait a minute.' }, 429, cors);
  }

  const ticker = url.searchParams.get('ticker') || '';
  const stem = url.searchParams.get('stem') || '';
  if (!TICKER_RE.test(ticker) || !STEM_RE.test(stem)) return json({ error: 'Unknown relation.' }, 400, cors);

  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BYTES) return json({ error: 'Image too large.' }, 413, cors);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json({ error: 'Image too large.' }, 413, cors);
  if (!isExpectedPng(bytes)) return json({ error: 'Invalid image.' }, 400, cors);

  const entry = await findRelation(env, ticker, stem);
  if (!entry) return json({ error: 'Unknown relation.' }, 400, cors);

  const id = newId();
  const meta = {
    ticker: entry.Ticker,
    stem,
    basket: entry.Basic_ticker.split('|').join(' | '),
    relation: RELATION_NAMES[entry.Relation] || entry.Relation,
    strength: String(Number(entry.Strength)),
    fundamentals: entry.fundamentals === '1',
    updated: entry.Date || '',
    created: new Date().toISOString().slice(0, 10)
  };
  await env.SHARES.put('img:' + id, bytes, { metadata: meta });
  return json({ url: url.origin + '/s/' + id, id }, 201, cors);
}

// PNG signature plus IHDR dimensions; everything else about the image is left to the browser that drew it.
function isExpectedPng(b) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 33) return false;
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return false;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return false;
  const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
  const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
  return w === IMG_W && h === IMG_H;
}

function newId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  let id = '';
  for (let i = 0; i < rnd.length; i++) id += chars[rnd[i] % chars.length];
  return id;
}

function splitLine(line) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function findRelation(env, ticker, stem) {
  const res = await fetch(env.SITE + '/reports/cointegration/manifest.csv', { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) return null;
  const lines = (await res.text()).replace(/\r\n/g, '\n').split('\n').filter((l) => l.length);
  const header = splitLine(lines[0]).map((h) => h.trim());
  const file = stem + '.csv';
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const row = {};
    header.forEach((h, c) => { row[h] = (cells[c] || '').trim(); });
    if (row.file === file && row.Ticker.toUpperCase() === ticker.toUpperCase()) return row;
  }
  return null;
}

async function handleImage(env, id) {
  if (!ID_RE.test(id)) return text('Not found', 404);
  const body = await env.SHARES.get('img:' + id, { type: 'arrayBuffer', cacheTtl: 86400 });
  if (!body) return text('Not found', 404);
  return new Response(body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function handlePage(env, url, id) {
  if (!ID_RE.test(id)) return text('Not found', 404);
  const found = await env.SHARES.getWithMetadata('img:' + id, { type: 'stream', cacheTtl: 86400 });
  if (!found || !found.value || !found.metadata) return text('Not found', 404);
  if (found.value.cancel) found.value.cancel();
  const m = found.metadata;
  const target = env.SITE + '/#delta/' + encodeURIComponent(m.ticker) + '/' + encodeURIComponent(m.stem);
  const title = m.ticker + ' vs ' + m.basket + ' — Delta · Volatility Farm';
  const bits = [m.relation + ' relation', 'strength ' + m.strength + ' of 4'];
  if (m.fundamentals) bits.push('with fundamentals');
  const desc = bits.join(', ') + '. Snapshot from ' + m.created + '; open for the live spread, forecast and exposures.';
  const page = url.origin + '/s/' + id;
  const img = page + '.png';
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(page)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Volatility Farm">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="${IMG_W}">
<meta property="og:image:height" content="${IMG_H}">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#2B1240;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px}img{max-width:100%;height:auto;border:1px solid #EAE2F6}a{color:#6D28D9}</style>
</head><body>
<img src="${esc(img)}" width="${IMG_W}" height="${IMG_H}" alt="${esc(title)}">
<p><a href="${esc(target)}">Open the live chart on Volatility Farm</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
