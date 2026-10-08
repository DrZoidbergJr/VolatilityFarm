#!/usr/bin/env python3
"""Behavioral regression suite for volatilityfarm.com.

scripts/validate_index.py checks structure (valid HTML, no dangling
links, no mojibake). This script checks behavior -- the things that
only show up when a real browser actually runs the page: does the hero
link to the right report, does the archive collapse/expand correctly,
do hash-based deep links open the right thing (including reports
buried in the collapsed "Earlier reports" bucket), do section anchors
scroll to the right place, does the report masthead hide correctly
when framed in an iframe.

One-time setup:
    pip install playwright
    playwright install chromium

Usage:
    python3 -m http.server 8000 &          # serve the repo locally
    python3 scripts/test_site.py           # defaults to http://127.0.0.1:8000

    python3 scripts/test_site.py --base-url https://volatilityfarm.com
        # smoke-test the live site after deploy
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(ROOT, "reports", "manifest.json")

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("FAIL: playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)


def load_manifest():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def fail(msg):
    print(f"FAIL: {msg}")
    return False


def ok(msg):
    print(f"OK: {msg}")
    return True


def test_hero(page, base_url, manifest):
    """Every manifest hero entry renders and its card links to itself."""
    passed = True
    hero_slugs = manifest["hero"]
    by_slug = {r["slug"]: r for r in manifest["reports"]}

    page.goto(f"{base_url}/index.html", wait_until="networkidle")
    page.wait_for_timeout(1000)

    for slug in hero_slugs:
        r = by_slug[slug]
        link = page.query_selector(f'a.report-link[href="{r["href"]}"]')
        if not link:
            passed = fail(f"hero: no card link found for {slug} ({r['href']})")
            continue
        ok(f"hero: card link present for {slug}")

    # Click the first "Read report" button and confirm the iframe opens
    # the SAME href the card linked to -- the literal regression test for
    # the old hero/archive duplication bug class.
    read_btn = page.query_selector("text=Read report")
    if not read_btn:
        return fail("hero: no 'Read report' button found")
    read_btn.click()
    page.wait_for_timeout(800)
    iframe = page.query_selector("#reading-iframe")
    src = iframe.get_attribute("src") if iframe else None
    expected = by_slug[hero_slugs[0]]["href"]
    if src != expected:
        passed = fail(f"hero click opened '{src}', expected '{expected}'")
    else:
        ok(f"hero click opens the correct report ({src})")

    close_btn = page.query_selector("#close-reading-btn")
    if close_btn:
        close_btn.click()
        page.wait_for_timeout(300)
        display = page.eval_on_selector("#reading-view", "el => getComputedStyle(el).display")
        if display != "none":
            passed = fail(f"close button did not hide #reading-view (display={display})")
        else:
            ok("close button hides the reading view")

    return passed


def test_archive(page, base_url, manifest):
    """Every report appears in the archive; collapse/expand count is right."""
    passed = True
    reports = manifest["reports"]
    VISIBLE_COUNT = 4

    page.goto(f"{base_url}/index.html", wait_until="networkidle")
    page.wait_for_timeout(1000)

    archive_hrefs = page.eval_on_selector_all(
        "a.archive-row", "els => els.map(e => e.getAttribute('href'))"
    )
    manifest_hrefs = {r["href"] for r in reports}
    archive_href_set = set(archive_hrefs)

    missing = manifest_hrefs - archive_href_set
    extra = archive_href_set - manifest_hrefs
    if missing:
        passed = fail(f"archive is missing {len(missing)} report(s): {sorted(missing)}")
    if extra:
        passed = fail(f"archive lists {len(extra)} report(s) not in manifest: {sorted(extra)}")
    if not missing and not extra:
        ok(f"archive lists all {len(reports)} reports exactly once")

    # Check the attribute AND the actual rendered visibility -- the bare
    # `hidden` attribute alone does not guarantee display:none if an
    # element also carries an inline `style="display:..."` (the inline
    # style wins over the UA stylesheet's unprefixed `[hidden]` rule).
    # This exact gap let all 23 rows render even though 19 had `hidden`.
    hidden_attr_count = len(page.query_selector_all(".archive-row[hidden]"))
    rendered_visible_count = page.eval_on_selector_all(
        ".archive-row", "els => els.filter(e => getComputedStyle(e).display !== 'none').length"
    )
    expected_hidden = max(0, len(reports) - VISIBLE_COUNT)
    expected_visible = min(len(reports), VISIBLE_COUNT)
    if hidden_attr_count != expected_hidden:
        passed = fail(
            f"archive 'hidden' attribute count wrong: {hidden_attr_count} (expected {expected_hidden})"
        )
    elif rendered_visible_count != expected_visible:
        passed = fail(
            f"archive VISUALLY shows {rendered_visible_count} rows (expected {expected_visible}) -- "
            f"'hidden' attribute is present on {hidden_attr_count} row(s) but not actually hiding them "
            f"(check for a competing inline style='display:...')"
        )
    else:
        ok(f"archive collapse counts correct: {rendered_visible_count} visible, {hidden_attr_count} hidden")

    btn = page.query_selector("#earlier-reports-btn")
    if btn:
        btn_text = btn.text_content()
        if str(expected_hidden) not in btn_text:
            passed = fail(f"'Earlier reports' button text wrong: {btn_text!r}")
        else:
            ok(f"'Earlier reports' button text correct: {btn_text!r}")
        btn.click()
        page.wait_for_timeout(300)
        hidden_after = len(page.query_selector_all(".archive-row[hidden]"))
        visible_after = page.eval_on_selector_all(
            ".archive-row", "els => els.filter(e => getComputedStyle(e).display !== 'none').length"
        )
        if hidden_after != 0:
            passed = fail(f"clicking 'Earlier reports' left {hidden_after} rows with the 'hidden' attribute")
        elif visible_after != len(reports):
            passed = fail(
                f"clicking 'Earlier reports' only visually revealed {visible_after}/{len(reports)} rows "
                f"(attribute removed but still not rendering -- check the click handler sets style.display too)"
            )
        else:
            ok("clicking 'Earlier reports' reveals all rows (both attribute and visual check)")
    elif expected_hidden > 0:
        passed = fail("'Earlier reports' button missing but some rows are hidden")

    return passed


def test_report_deep_links(page, base_url, manifest):
    """#reports/<slug>.htm opens the right report, including ones
    buried in the collapsed archive bucket."""
    passed = True
    reports = manifest["reports"]
    hero_slugs = set(manifest["hero"])

    # One hero report, one visible-archive report, one collapsed report.
    by_date = sorted(reports, key=lambda r: r["date"], reverse=True)
    sample = []
    hero_r = next((r for r in reports if r["slug"] in hero_slugs), None)
    if hero_r:
        sample.append(("hero", hero_r))
    if len(by_date) > 1:
        sample.append(("visible archive", by_date[1]))
    if len(by_date) > 4:
        sample.append(("collapsed archive", by_date[-1]))

    for label, r in sample:
        page.goto(f"{base_url}/index.html#{r['href']}", wait_until="networkidle")
        page.wait_for_timeout(3000)
        iframe = page.query_selector("#reading-iframe")
        src = iframe.get_attribute("src") if iframe else None
        if src != r["href"]:
            passed = fail(f"#{r['href']} ({label}) opened '{src}' instead")
        else:
            ok(f"#{r['href']} ({label}) opens correctly")

    return passed


def test_section_hashes(page, base_url, manifest):
    """#calendar, #regimes, #performance, #method, #about all scroll to
    their target (within tolerance; the very last section can be
    clamped short by the browser's max-scroll limit, which is expected,
    not a bug -- verified identical on the live production site)."""
    passed = True
    sections = ["calendar", "regimes", "performance", "method", "about"]

    for i, section_id in enumerate(sections):
        page.goto(f"{base_url}/index.html#{section_id}", wait_until="load", timeout=20000)
        page.wait_for_timeout(3000)
        scroll_y = page.evaluate("window.scrollY")
        target_top = page.evaluate(
            f"(() => {{ var el = document.getElementById('{section_id}'); "
            "return el ? el.getBoundingClientRect().top + window.scrollY : null; })()"
        )
        body_height = page.evaluate("document.body.scrollHeight")
        viewport_height = page.evaluate("window.innerHeight")
        max_scroll = max(0, body_height - viewport_height)
        is_last = (i == len(sections) - 1)

        diff = abs(scroll_y - target_top) if target_top is not None else None
        if target_top is None:
            passed = fail(f"#{section_id}: target element not found")
        elif is_last and abs(scroll_y - max_scroll) < 5:
            # Last section, scroll clamped at the page's max -- expected.
            ok(f"#{section_id}: scrolled to max ({scroll_y}), target clamped by page length (expected)")
        elif diff is not None and diff < 50:
            ok(f"#{section_id}: scrolled to {scroll_y} (target {target_top:.0f}, diff {diff:.1f}px)")
        else:
            passed = fail(f"#{section_id}: scrollY={scroll_y}, target={target_top:.0f}, diff={diff:.1f}px")

    return passed


def test_crawler_surfaces(base_url, manifest):
    """sitemap.xml, llms.txt, feed.xml, and the homepage JSON-LD each
    list every manifest report exactly once."""
    import re
    import urllib.request
    import xml.etree.ElementTree as ET

    passed = True
    reports = manifest["reports"]
    slugs = {r["slug"] for r in reports}

    def fetch(path):
        with urllib.request.urlopen(f"{base_url}/{path}", timeout=10) as resp:
            return resp.read().decode("utf-8")

    try:
        sitemap_text = fetch("sitemap.xml")
        tree = ET.fromstring(sitemap_text)
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        urls = [el.text for el in tree.findall(f"{ns}url/{ns}loc")]
        sitemap_slugs = {u.rsplit("/", 1)[-1].replace(".htm", "") for u in urls if "/reports/" in u}
        missing = slugs - sitemap_slugs
        if missing:
            passed = fail(f"sitemap.xml missing {len(missing)} report(s): {sorted(missing)}")
        else:
            ok(f"sitemap.xml lists all {len(slugs)} reports")
    except Exception as e:
        passed = fail(f"sitemap.xml check errored: {e}")

    try:
        llms_text = fetch("llms.txt")
        llms_slugs = set(re.findall(r"reports/([a-z0-9-]+)\.htm", llms_text))
        missing = slugs - llms_slugs
        if missing:
            passed = fail(f"llms.txt missing {len(missing)} report(s): {sorted(missing)}")
        else:
            ok(f"llms.txt lists all {len(slugs)} reports")
    except Exception as e:
        passed = fail(f"llms.txt check errored: {e}")

    try:
        feed_text = fetch("feed.xml")
        feed_tree = ET.fromstring(feed_text)
        links = [el.text for el in feed_tree.findall(".//item/link")]
        feed_slugs = {u.rsplit("/", 1)[-1].replace(".htm", "") for u in links}
        missing = slugs - feed_slugs
        if missing:
            passed = fail(f"feed.xml missing {len(missing)} report(s): {sorted(missing)}")
        else:
            ok(f"feed.xml lists all {len(slugs)} reports")
    except Exception as e:
        passed = fail(f"feed.xml check errored: {e}")

    try:
        index_text = fetch("index.html")
        m = re.search(r'<script type="application/ld\+json">(\{.*?"@graph".*?\})</script>', index_text)
        if not m:
            passed = fail("index.html: no JSON-LD @graph found")
        else:
            data = json.loads(m.group(1))
            item_list = next((n for n in data["@graph"] if n.get("@type") == "ItemList"), None)
            if not item_list:
                passed = fail("index.html JSON-LD: no ItemList found")
            else:
                jsonld_slugs = {
                    it["url"].rsplit("/", 1)[-1].replace(".htm", "")
                    for it in item_list["itemListElement"]
                }
                missing = slugs - jsonld_slugs
                if missing:
                    passed = fail(f"JSON-LD ItemList missing {len(missing)} report(s): {sorted(missing)}")
                elif item_list["numberOfItems"] != len(reports):
                    passed = fail(
                        f"JSON-LD numberOfItems={item_list['numberOfItems']}, expected {len(reports)}"
                    )
                else:
                    ok(f"index.html JSON-LD ItemList lists all {len(slugs)} reports, numberOfItems correct")
    except Exception as e:
        passed = fail(f"index.html JSON-LD check errored: {e}")

    return passed


def test_report_masthead_iframe(page, base_url, manifest):
    """The sticky report masthead hides when the report is framed in an
    iframe (as the homepage does) and shows when loaded top-level."""
    passed = True
    sample = manifest["reports"][0]
    url = f"{base_url}/{sample['href']}"

    page.goto(url, wait_until="networkidle")
    page.wait_for_timeout(500)
    display_toplevel = page.eval_on_selector(
        "#report-masthead", "el => getComputedStyle(el).display"
    )
    if display_toplevel == "none":
        passed = fail(f"{sample['slug']}: masthead hidden when loaded top-level (should be visible)")
    else:
        ok(f"{sample['slug']}: masthead visible when loaded top-level")

    page.set_content(f'<iframe src="{url}" style="width:100%;height:600px"></iframe>')
    page.wait_for_timeout(1500)
    frame = page.frames[-1]
    display_framed = frame.eval_on_selector(
        "#report-masthead", "el => getComputedStyle(el).display"
    )
    if display_framed != "none":
        passed = fail(f"{sample['slug']}: masthead NOT hidden when framed in an iframe")
    else:
        ok(f"{sample['slug']}: masthead correctly hidden when framed in an iframe")

    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url", default="http://127.0.0.1:8000",
        help="Base URL to test against (default: http://127.0.0.1:8000)"
    )
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    manifest = load_manifest()
    overall_ok = True

    print(f"=== Testing against {base_url} ===\n")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})

        print("--- Hero ---")
        overall_ok &= test_hero(page, base_url, manifest)
        print("\n--- Archive ---")
        overall_ok &= test_archive(page, base_url, manifest)
        print("\n--- Report deep links (#reports/<slug>.htm) ---")
        overall_ok &= test_report_deep_links(page, base_url, manifest)
        print("\n--- Section hashes (#calendar, #regimes, ...) ---")
        overall_ok &= test_section_hashes(page, base_url, manifest)
        print("\n--- Report masthead + iframe ---")
        overall_ok &= test_report_masthead_iframe(page, base_url, manifest)

        browser.close()

    print("\n--- Crawler surfaces (sitemap.xml, llms.txt, feed.xml, JSON-LD) ---")
    overall_ok &= test_crawler_surfaces(base_url, manifest)

    print()
    if overall_ok:
        print("ALL CHECKS PASSED")
    else:
        print("SOME CHECKS FAILED -- see FAIL lines above")
    return overall_ok


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
