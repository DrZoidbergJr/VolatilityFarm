# Volatility Farm

Source for [volatilityfarm.com](https://volatilityfarm.com), served by GitHub Pages straight from `main`.

## Structure

- `index.html` -- the landing page. **Generated**: edit `scripts/templates/index_template.html` and rebuild, never
  `index.html` itself.
- `assets/js/` -- one script per page section (calendar, regimes, drivers, drift, delta, performance, report reader,
  hash router) plus `common.js` for shared loading/empty/error states. The build stamps each `<script src>` with a
  `?v=<hash>` of the file, so browsers pick up changes immediately.
- `assets/og/` -- per-report 1200x630 link-preview cards (see below).
- `reports/` -- report pages (`<company-slug>-<YYYY-MM-DD>.htm`), `reports/manifest.json` (the list of reports, hero
  and archive), and the CSVs the sections chart. `reports/cointegration/` feeds the Delta section.
- `sitemap.xml`, `llms.txt`, `feed.xml` -- generated from the manifest.
- `share-worker/` -- the Cloudflare Worker behind Delta share links (see below).
- `scripts/` -- `build_site.py`, `validate_index.py`, `test_site.py`, `make_social_cards.py`, and `templates/`.

## Everyday workflow

```sh
python3 scripts/build_site.py        # regenerate index.html, sitemap.xml, llms.txt, feed.xml, report pagers
python3 scripts/validate_index.py    # structure, report sync, build idempotency, mojibake, double-escapes
python3 -m http.server 8765          # then, in another shell:
python3 scripts/test_site.py --base-url http://127.0.0.1:8765   # Playwright checks in a real browser
```

## Adding a report

1. Put the `.htm` file in `reports/` and add its entry to `reports/manifest.json` (first `hero` entry is the
   highlighted Latest card).
2. `python3 scripts/make_social_cards.py --slug <slug>` -- renders `assets/og/<slug>.png` and points the report's
   `og:image` / `twitter:image` at it (`--force` re-renders existing cards).
3. Build, validate, test as above, then commit.

## Delta share links

The Delta section's **Share** button renders the current plots to a 1200x630 PNG in the browser and uploads it to
the `vf-share` Worker (`https://vf-share.volatilityfarm.workers.dev`), which stores it in Workers KV and returns a
short link `/s/<id>`. That page carries Open Graph / Twitter tags pointing at `/s/<id>.png`, so X, iMessage, Slack,
LinkedIn, Discord etc. preview the snapshot; people who open it are redirected to the live chart
(`https://volatilityfarm.com/#delta/<TICKER>/<file-stem>`).

The Worker only accepts uploads from the site's origin, only 1200x630 PNGs under 800KB, only relations present in
`reports/cointegration/manifest.csv`, and at most 10 per minute per IP. Preview text comes from the manifest, never
from the uploader.

```sh
cd share-worker
npx wrangler login     # once per machine
npx wrangler dev --port 8787 --ip 127.0.0.1   # local; the site uses it when served from localhost/127.0.0.1
npx wrangler deploy    # publish changes
```

## Pre-commit hook

Git hooks aren't versioned, so each clone needs this once:

```sh
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
if git diff --cached --name-only | grep -qE '^(index\.html|sitemap\.xml|reports/.*\.htm)$'; then
    python3 scripts/validate_index.py || {
        echo "pre-commit: validation failed. Commit blocked." >&2
        exit 1
    }
fi
EOF
chmod +x .git/hooks/pre-commit
```
