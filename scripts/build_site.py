#!/usr/bin/env python3
"""Generate index.html, sitemap.xml, llms.txt, feed.xml, and per-report
prev/next nav from reports/manifest.json.

reports/manifest.json is the single source of truth for "list every
report" data. Before this script existed (and before index.html was a
plain static file -- see scripts/templates/index_template.html), that
list was hand-maintained in four independent places (the archive array
inside the bundled JSON template, a duplicate outer JSON-LD ItemList, a
visually-hidden #static-fallback block for non-JS crawlers, and
llms.txt) with nothing keeping them in sync -- a report added to one
and forgotten in another was a real, repeated bug this project hit.
index.html is itself now a plain static file (no JSON-escaped template,
no client-side component runtime) assembled from
scripts/templates/index_template.html by splicing the hero/archive/
JSON-LD blocks into its <!-- HERO -->, <!-- ARCHIVE -->, and
<!-- JSONLD --> markers.

Run this after editing reports/manifest.json, before committing:

    python3 scripts/build_site.py

Then run scripts/validate_index.py to confirm the generated files are
consistent with what's on disk in reports/, and scripts/test_site.py
to confirm the page still behaves correctly in a real browser.
"""
import datetime
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(ROOT, "reports", "manifest.json")
TEMPLATE_DIR = os.path.join(ROOT, "scripts", "templates")
INDEX_TEMPLATE_PATH = os.path.join(TEMPLATE_DIR, "index_template.html")
LLMS_TEMPLATE_PATH = os.path.join(TEMPLATE_DIR, "llms_template.txt")
INDEX_OUT_PATH = os.path.join(ROOT, "index.html")
SITEMAP_OUT_PATH = os.path.join(ROOT, "sitemap.xml")
LLMS_OUT_PATH = os.path.join(ROOT, "llms.txt")
FEED_OUT_PATH = os.path.join(ROOT, "feed.xml")
REPORTS_DIR = os.path.join(ROOT, "reports")


def load_manifest():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def esc_html(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def esc_attr(s):
    return esc_html(s)


# ---------------------------------------------------------------------
# sitemap.xml
# ---------------------------------------------------------------------

def build_sitemap(manifest):
    base = manifest["site"]["base_url"]
    reports = manifest["reports"]
    hero_slugs = set(manifest["hero"])

    latest_date = max(r["date"] for r in reports) if reports else \
        datetime.date.today().isoformat()

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        f"    <loc>{base}/</loc>",
        f"    <lastmod>{latest_date}</lastmod>",
        "    <changefreq>daily</changefreq>",
        "    <priority>1.0</priority>",
        "  </url>",
    ]
    for r in reports:
        priority = "0.8" if r["slug"] in hero_slugs else "0.6"
        lines += [
            "  <url>",
            f"    <loc>{base}/{r['href']}</loc>",
            f"    <lastmod>{r['date']}</lastmod>",
            "    <changefreq>monthly</changefreq>",
            f"    <priority>{priority}</priority>",
            "  </url>",
        ]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------
# llms.txt
# ---------------------------------------------------------------------

def format_date_human(iso_date):
    dt = datetime.datetime.strptime(iso_date, "%Y-%m-%d")
    return f"{dt.day} {dt.strftime('%b')} {dt.year}"


def build_llms_txt(manifest):
    with open(LLMS_TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = f.read()

    base = manifest["site"]["base_url"]
    reports_sorted = sorted(manifest["reports"], key=lambda r: r["date"], reverse=True)

    lines = []
    for r in reports_sorted:
        date_human = format_date_human(r["date"])
        lines.append(f"- [{r['company']} - {date_human}]({base}/{r['href']}): {r['dek']}")
    reports_block = "\n".join(lines)

    return template.replace("{{REPORTS}}", reports_block)


# ---------------------------------------------------------------------
# feed.xml (RSS 2.0)
# ---------------------------------------------------------------------

RFC822_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                 "Sep", "Oct", "Nov", "Dec"]


def to_rfc822(iso_date):
    dt = datetime.datetime.strptime(iso_date, "%Y-%m-%d")
    return f"{dt.day:02d} {RFC822_MONTHS[dt.month - 1]} {dt.year} 00:00:00 GMT"


def build_feed(manifest):
    site = manifest["site"]
    base = site["base_url"]
    reports_sorted = sorted(manifest["reports"], key=lambda r: r["date"], reverse=True)
    build_date = to_rfc822(datetime.date.today().isoformat())

    items = []
    for r in reports_sorted:
        url = f"{base}/{r['href']}"
        items.append(
            "    <item>\n"
            f"      <title>{esc_html(r['ticker'])} — {esc_html(r['company'])}</title>\n"
            f"      <link>{esc_html(url)}</link>\n"
            f"      <guid isPermaLink=\"true\">{esc_html(url)}</guid>\n"
            f"      <pubDate>{to_rfc822(r['date'])}</pubDate>\n"
            f"      <description>{esc_html(r['dek'])}</description>\n"
            "    </item>"
        )
    items_block = "\n".join(items)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0">\n'
        "  <channel>\n"
        f"    <title>{esc_html(site['name'])}</title>\n"
        f"    <link>{esc_html(base)}/</link>\n"
        f"    <description>{esc_html(site['tagline'])}</description>\n"
        "    <language>en-us</language>\n"
        f"    <lastBuildDate>{build_date}</lastBuildDate>\n"
        f"{items_block}\n"
        "  </channel>\n"
        "</rss>\n"
    )


# ---------------------------------------------------------------------
# JSON-LD ItemList (for index.html head)
# ---------------------------------------------------------------------

def build_jsonld(manifest):
    base = manifest["site"]["base_url"]
    site = manifest["site"]
    reports_sorted = sorted(manifest["reports"], key=lambda r: r["date"], reverse=True)

    graph = [
        {
            "@type": "Organization",
            "@id": f"{base}/#organization",
            "name": site["name"],
            "url": f"{base}/",
            "description": site["tagline"],
        },
        {
            "@type": "WebSite",
            "@id": f"{base}/#website",
            "url": f"{base}/",
            "name": site["name"],
            "description": site["tagline"],
            "publisher": {"@id": f"{base}/#organization"},
        },
        {
            "@type": "ItemList",
            "@id": f"{base}/#reports",
            "name": "Company reports - post release, short-term view",
            "itemListOrder": "https://schema.org/ItemListOrderDescending",
            "numberOfItems": len(reports_sorted),
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": i + 1,
                    "url": f"{base}/{r['href']}",
                    "name": f"{r['company']} - short-term view",
                }
                for i, r in enumerate(reports_sorted)
            ],
        },
    ]
    data = {"@context": "https://schema.org", "@graph": graph}
    json_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f'<script type="application/ld+json">{json_str}</script>'


# ---------------------------------------------------------------------
# Hero + archive HTML blocks (for index.html body)
# ---------------------------------------------------------------------

def card_html(r, highlighted):
    border = "2px solid #B42318" if highlighted else "1px solid #EAE2F6"
    tag_label = "Highlighted" if highlighted else "New"
    tag_color = "#B42318" if highlighted else "#047857"
    tag_bg = "#FDF5F4" if highlighted else "#ECFDF3"
    cta_bg = "#B42318" if highlighted else "#4C1D95"
    date_human = format_date_human(r["date"])
    href = esc_attr(r["href"])
    ticker = esc_html(r["ticker"])
    company = esc_html(r["company"])
    dek = r["dek"]
    headline = r["headline"]

    return f'''<div style="display:flex;flex-direction:column;gap:24px">
<a href="{href}" data-title="{ticker} &middot; {company}" class="report-link vf-hero-card" style="display:block;background:#FAF8FE;border:{border};border-radius:3px;padding:clamp(28px,3vw,44px);color:#2B1240;min-height:300px;cursor:pointer">
<div style="display:flex;flex-direction:column;height:100%;justify-content:space-between;gap:36px">
<div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="#4C1D95" stroke-width="2"><path d="M16 3 L29 14 M16 3 L3 14 M16 3 v26"></path></svg>
<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6D28D9">{ticker}</span>
</div>
<div style="display:flex;flex-direction:column;gap:14px">
<div style="font-family:'Libre Baskerville',serif;font-size:clamp(24px,2.4vw,30px);line-height:1.35;color:#2B1240">{ticker} &middot; {company}</div>
<div style="width:48px;height:2px;background:#8B5CF6"></div>
<div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#6B4C85">{esc_html(r['tag'])} &middot; {r['sections']} sections &middot; tables, charts, verdict</div>
</div>
</div>
</a>
<div style="display:flex;flex-direction:column;gap:22px">
<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:{tag_color};background:{tag_bg};border-radius:2px;padding:5px 9px">{tag_label}</span>
<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#7A6191">{date_human} &middot; {esc_html(r['tag'])} &middot; Read</span>
</div>
<h2 style="font-family:'Libre Baskerville',serif;font-weight:400;font-size:clamp(22px,2.4vw,28px);line-height:1.3;margin:0;text-wrap:pretty">{headline}</h2>
<p style="font-size:15px;line-height:1.75;color:#453059;margin:0;text-wrap:pretty">{dek}</p>
<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:4px">
<a href="{href}" data-title="{ticker} &middot; {company}" class="report-link vf-read-btn" style="font-family:'Libre Franklin',sans-serif;font-weight:500;font-size:14px;background:{cta_bg};color:#ffffff;border-radius:3px;padding:13px 24px;min-height:44px;display:flex;align-items:center;cursor:pointer">Read report</a>
</div>
</div>
</div>'''


def build_hero_html(manifest):
    hero_slugs = manifest["hero"]
    by_slug = {r["slug"]: r for r in manifest["reports"]}
    cards = []
    for i, slug in enumerate(hero_slugs):
        r = by_slug[slug]
        cards.append(card_html(r, highlighted=(i == 0)))
    max_width = "max-width:620px;" if len(cards) == 1 else ""
    inner = "\n".join(cards)
    return (
        f'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));'
        f'gap:clamp(32px,4vw,56px);align-items:start;{max_width}">\n{inner}\n</div>'
    )


def archive_row_html(r, hidden):
    date_human = format_date_human(r["date"])
    # The bare `hidden` attribute alone does NOT visually hide this element:
    # its default UA-stylesheet rule is `[hidden]{display:none}` with no
    # `!important`, so the inline `style="display:grid;..."` below wins and
    # the row stays visible regardless of the attribute. Bake the correct
    # `display` value into the inline style itself; keep the `hidden`
    # attribute too for semantics/accessibility (screen readers, "find in
    # page"), but don't rely on it alone for the visual effect.
    hidden_attr = " hidden" if hidden else ""
    display = "none" if hidden else "grid"
    href = esc_attr(r["href"])
    return (
        f'<a href="{href}" data-title="{esc_html(r["ticker"])} &middot; {esc_html(r["company"])}" '
        f'class="archive-row report-link vf-archive-row"{hidden_attr} style="display:{display};grid-template-columns:minmax(96px,110px) '
        'minmax(220px,1fr) minmax(90px,120px) 64px;gap:clamp(12px,2vw,32px);align-items:baseline;padding:22px 4px;'
        'border-top:1px solid #EAE2F6;color:#2B1240;cursor:pointer">\n'
        f'<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#6D28D9">{date_human}</span>\n'
        '<span style="display:flex;flex-direction:column;gap:6px">\n'
        f'<span style="font-family:\'Libre Baskerville\',serif;font-size:clamp(16px,1.5vw,19px);line-height:1.4">{esc_html(r["company"])}</span>\n'
        f'<span style="font-size:14px;line-height:1.7;color:#5A4272;text-wrap:pretty">{r["dek"]}</span>\n'
        '</span>\n'
        f'<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6D28D9">{esc_html(r["tag"])}</span>\n'
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#7A6191;text-align:right">Read</span>\n'
        '</a>'
    )


def build_archive_html(manifest):
    VISIBLE_COUNT = 4
    reports_sorted = sorted(manifest["reports"], key=lambda r: r["date"], reverse=True)
    rows = [archive_row_html(r, hidden=(i >= VISIBLE_COUNT)) for i, r in enumerate(reports_sorted)]
    earlier_count = max(0, len(reports_sorted) - VISIBLE_COUNT)
    rows_html = "\n".join(rows)
    hairline = '<div style="border-top:1px solid #EAE2F6"></div>'
    button_html = ""
    if earlier_count > 0:
        button_html = (
            '\n<div id="earlier-reports-wrap" style="display:flex;justify-content:center;padding:28px 0 4px">\n'
            '<button id="earlier-reports-btn" class="vf-earlier-btn" style="display:flex;align-items:center;gap:10px;'
            "font-family:'Libre Franklin',sans-serif;font-weight:500;font-size:14px;color:#4C1D95;"
            'background:#ffffff;border:1px solid #DCCEF4;border-radius:3px;padding:12px 20px;'
            f'min-height:44px;cursor:pointer">Earlier reports ({earlier_count})</button>\n'
            '</div>'
        )
    return f'{rows_html}\n{hairline}{button_html}\n'


# ---------------------------------------------------------------------
# Per-report prev/next nav + RSS link injection
# ---------------------------------------------------------------------

PAGER_START = "<!-- PAGER START -->"
PAGER_END = "<!-- PAGER END -->"
RSS_LINK = '<link rel="alternate" type="application/rss+xml" title="Volatility Farm" href="/feed.xml">'


def build_pager_html(prev_r, next_r):
    parts = ['<nav class="report-pager" style="display:flex;justify-content:space-between;'
             "gap:16px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--accent);"
             'margin-top:16px;padding-top:16px;border-top:1px solid var(--hair)">']
    if prev_r:
        parts.append(
            f'<a href="/{esc_attr(prev_r["href"])}" style="color:var(--accent);text-decoration:none">'
            f'&larr; {esc_html(prev_r["ticker"])} · {esc_html(prev_r["company"])}</a>'
        )
    else:
        parts.append("<span></span>")
    if next_r:
        parts.append(
            f'<a href="/{esc_attr(next_r["href"])}" style="color:var(--accent);text-decoration:none">'
            f'{esc_html(next_r["ticker"])} · {esc_html(next_r["company"])} &rarr;</a>'
        )
    else:
        parts.append("<span></span>")
    parts.append("</nav>")
    return "\n".join(parts)


def update_report_pagers(manifest):
    reports_sorted = sorted(manifest["reports"], key=lambda r: r["date"])
    updated = []
    for i, r in enumerate(reports_sorted):
        fn = os.path.join(REPORTS_DIR, r["slug"] + ".htm")
        if not os.path.exists(fn):
            print(f"WARN: {fn} referenced in manifest but not found on disk, skipping pager", file=sys.stderr)
            continue
        with open(fn, "r", encoding="utf-8") as f:
            content = f.read()

        prev_r = reports_sorted[i - 1] if i > 0 else None
        next_r = reports_sorted[i + 1] if i < len(reports_sorted) - 1 else None
        pager_html = build_pager_html(prev_r, next_r)
        block = f"{PAGER_START}\n{pager_html}\n{PAGER_END}"

        if PAGER_START in content and PAGER_END in content:
            pattern = re.compile(re.escape(PAGER_START) + r".*?" + re.escape(PAGER_END), re.S)
            new_content = pattern.sub(block, content, count=1)
        else:
            marker = '<a href="/" style="display:inline-block;margin-top:20px;'
            idx = content.find(marker)
            if idx == -1:
                print(f"WARN: could not find insertion point for pager in {fn}", file=sys.stderr)
                continue
            new_content = content[:idx] + block + "\n" + content[idx:]

        if RSS_LINK not in new_content:
            llms_marker = '<link rel="alternate" type="text/markdown" href="/llms.txt"'
            idx2 = new_content.find(llms_marker)
            if idx2 != -1:
                line_end = new_content.find("\n", idx2)
                new_content = new_content[:line_end + 1] + RSS_LINK + "\n" + new_content[line_end + 1:]

        if new_content != content:
            with open(fn, "w", encoding="utf-8", newline="") as f:
                f.write(new_content)
            updated.append(r["slug"])

    return updated


# ---------------------------------------------------------------------
# index.html assembly
# ---------------------------------------------------------------------

def build_index(manifest):
    with open(INDEX_TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = f.read()

    hero_html = build_hero_html(manifest)
    archive_html = build_archive_html(manifest)
    jsonld_html = build_jsonld(manifest)

    out = template
    out = out.replace("<!-- HERO -->", hero_html)
    out = out.replace("<!-- ARCHIVE -->", archive_html)
    out = out.replace("<!-- JSONLD -->", jsonld_html)
    return out


def main():
    manifest = load_manifest()

    sitemap = build_sitemap(manifest)
    with open(SITEMAP_OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(sitemap)
    print(f"wrote {SITEMAP_OUT_PATH}")

    llms = build_llms_txt(manifest)
    with open(LLMS_OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(llms)
    print(f"wrote {LLMS_OUT_PATH}")

    feed = build_feed(manifest)
    with open(FEED_OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(feed)
    print(f"wrote {FEED_OUT_PATH}")

    if os.path.exists(INDEX_TEMPLATE_PATH):
        index_html = build_index(manifest)
        with open(INDEX_OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
            f.write(index_html)
        print(f"wrote {INDEX_OUT_PATH}")
    else:
        print(f"SKIP index.html: {INDEX_TEMPLATE_PATH} not found yet", file=sys.stderr)

    updated = update_report_pagers(manifest)
    print(f"updated pager nav in {len(updated)} report(s): {updated}")


if __name__ == "__main__":
    main()
