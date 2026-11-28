#!/usr/bin/env python3
"""Render a 1200x630 social card PNG per report and point each report's
og:image / twitter:image at it.

Usage:
  python3 scripts/make_social_cards.py              # all reports (skips existing PNGs)
  python3 scripts/make_social_cards.py --slug SLUG  # one report
  python3 scripts/make_social_cards.py --force      # re-render even if PNG exists

Cards come from scripts/templates/social_card_template.html, rendered with
Playwright/Chromium (brand Google Fonts), then palette-optimized with Pillow.
Meta tags are only rewritten when they differ, so re-runs are no-ops.
"""
import argparse
import datetime
import html
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "reports", "manifest.json")
TEMPLATE = os.path.join(ROOT, "scripts", "templates", "social_card_template.html")
OUT_DIR = os.path.join(ROOT, "assets", "og")
BASE = "https://volatilityfarm.com"

IMG_RE = re.compile(r'(<meta\s+(?:property="og:image"|name="twitter:image")\s+content=")[^"]*(")')


def fmt_date(iso):
    d = datetime.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b %Y')}"


def render_html(tpl, r):
    text = (r.get("headline") or r.get("dek") or "").strip()
    vals = {"DATE": fmt_date(r["date"]), "TICKER": r["ticker"],
            "COMPANY": r["company"], "HEADLINE": text}
    out = tpl
    for k, v in vals.items():
        out = out.replace("{{" + k + "}}", html.escape(v, quote=True))
    return out


def update_meta(slug):
    path = os.path.join(ROOT, "reports", slug + ".htm")
    with open(path, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    url = f"{BASE}/assets/og/{slug}.png"
    new = IMG_RE.sub(lambda m: m.group(1) + url + m.group(2), src)
    if new == src:
        return False
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(new)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    with open(MANIFEST, encoding="utf-8") as f:
        reports = json.load(f)["reports"]
    if args.slug:
        reports = [r for r in reports if r["slug"] == args.slug]
        if not reports:
            print(f"FAIL: slug {args.slug!r} not in manifest")
            return 1
    with open(TEMPLATE, encoding="utf-8") as f:
        tpl = f.read()
    os.makedirs(OUT_DIR, exist_ok=True)

    todo = [r for r in reports
            if args.force or not os.path.exists(os.path.join(OUT_DIR, r["slug"] + ".png"))]
    rendered = 0
    if todo:
        from playwright.sync_api import sync_playwright
        from PIL import Image
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1200, "height": 630})
            for r in todo:
                page.set_content(render_html(tpl, r), wait_until="networkidle")
                page.evaluate("document.fonts.ready")
                # Shrink long company names to fit one line before the ellipsis kicks in.
                page.evaluate("""() => {
                    const el = document.querySelector('.company');
                    Object.assign(el.style, { display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: '0', flex: '1 1 auto' });
                    let size = parseFloat(getComputedStyle(el).fontSize);
                    while (el.scrollWidth > el.clientWidth && size > 34) {
                        size -= 2; el.style.fontSize = size + 'px';
                    }
                }""")
                png = page.screenshot(clip={"x": 0, "y": 0, "width": 1200, "height": 630})
                img = Image.open(io.BytesIO(png)).convert("RGB")
                img = img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
                img.save(os.path.join(OUT_DIR, r["slug"] + ".png"), optimize=True)
                rendered += 1
            browser.close()

    meta_changed = sum(1 for r in reports if update_meta(r["slug"]))
    print(f"Cards: {rendered} rendered, {len(reports) - rendered} skipped (exist); "
          f"meta updated in {meta_changed} report(s), {len(reports) - meta_changed} already correct")
    return 0


if __name__ == "__main__":
    sys.exit(main())
