#!/usr/bin/env python3
"""Validate index.html and the generated site files before they ship.

index.html is now a plain static file, generated from
scripts/templates/index_template.html + reports/manifest.json by
scripts/build_site.py -- it is no longer a JSON-escaped template, so
the escaping-hazard checks this script used to run (JSON-parseability,
browser-tokenizer truncation, brace/quote balance, straight-apostrophe
hazards) no longer apply; those failure modes can't occur in plain
HTML with ordinary <script> tags.

What this script checks instead:
  - index.html, reports/*.htm on disk, sitemap.xml, and
    reports/manifest.json all agree on exactly the same set of reports
    (a three-way cross-check -- a report can drift out of sync in any
    one of these without anything on the live site visibly breaking).
  - scripts/build_site.py's output is idempotent: regenerating from
    the current manifest produces byte-identical files to what's
    committed. This is the single highest-value check in this file,
    since "manifest.json was edited but build_site.py wasn't re-run"
    (or vice versa) is this project's main drift risk going forward.
  - No mojibake (double-encoded UTF-8) anywhere in the generated files
    or report pages -- this has silently corrupted content before.

This script does NOT check behavior (does the hero link to the right
report, do hash-based deep links open the right thing, etc.) -- that
needs a real browser. See scripts/test_site.py for that.
"""
import difflib
import glob
import importlib.util
import json
import os
import re
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(ROOT, "index.html")
REPORTS_DIR = os.path.join(ROOT, "reports")
MANIFEST_PATH = os.path.join(REPORTS_DIR, "manifest.json")
SITEMAP_PATH = os.path.join(ROOT, "sitemap.xml")
BUILD_SITE_PATH = os.path.join(ROOT, "scripts", "build_site.py")


def fail(msg):
    print(f"FAIL: {msg}")
    return False


def ok(msg):
    print(f"OK: {msg}")
    return True


def load_manifest():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def check_report_sync(index_html, manifest):
    """Cross-check reports/*.htm on disk against index.html's archive
    links, sitemap.xml, and reports/manifest.json -- a four-way check.
    Doesn't enforce order, just that every report is reachable from
    the page, listed for crawlers, and present in the manifest that
    generates both -- and that nothing in any of them points at a
    file that no longer exists.
    """
    passed = True

    disk_slugs = {
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(REPORTS_DIR, "*.htm"))
    }

    href_pattern = re.compile(r'href="(?:/)?reports/([^"]+)\.htm"')
    index_slugs = set(href_pattern.findall(index_html))

    manifest_slugs = {r["slug"] for r in manifest["reports"]}

    sitemap_slugs = set()
    if os.path.exists(SITEMAP_PATH):
        with open(SITEMAP_PATH, "r", encoding="utf-8") as f:
            sitemap_text = f.read()
        sitemap_pattern = re.compile(r"<loc>https://volatilityfarm\.com/reports/([^<]+)\.htm</loc>")
        sitemap_slugs = set(sitemap_pattern.findall(sitemap_text))
    else:
        print(f"WARN: {SITEMAP_PATH} not found, skipping sitemap sync check")

    checks = [
        ("index.html", index_slugs),
        ("manifest.json", manifest_slugs),
    ]
    if sitemap_slugs:
        checks.append(("sitemap.xml", sitemap_slugs))

    for label, slugs in checks:
        missing = disk_slugs - slugs
        if missing:
            passed = fail(f"{len(missing)} report(s) on disk but missing from {label}: {sorted(missing)}")
        else:
            ok(f"all {len(disk_slugs)} report(s) on disk are listed in {label}")

        dangling = slugs - disk_slugs
        if dangling:
            passed = fail(f"{label} references {len(dangling)} report(s) that don't exist on disk: {sorted(dangling)}")
        else:
            ok(f"no dangling report references in {label}")

    return passed


def check_build_idempotent():
    """Regenerate index.html/sitemap.xml/llms.txt/feed.xml into a temp
    dir and diff against what's committed. A mismatch means
    reports/manifest.json was edited without re-running
    scripts/build_site.py, or vice versa -- the single most likely way
    this project's generated files can silently drift out of sync.
    """
    passed = True

    spec = importlib.util.spec_from_file_location("build_site", BUILD_SITE_PATH)
    build_site = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build_site)

    manifest = build_site.load_manifest()

    generated = {
        "sitemap.xml": build_site.build_sitemap(manifest),
        "llms.txt": build_site.build_llms_txt(manifest),
        "feed.xml": build_site.build_feed(manifest),
    }
    if os.path.exists(build_site.INDEX_TEMPLATE_PATH):
        generated["index.html"] = build_site.build_index(manifest)

    for filename, new_content in generated.items():
        committed_path = os.path.join(ROOT, filename)
        if not os.path.exists(committed_path):
            passed = fail(f"{filename} does not exist on disk -- run scripts/build_site.py")
            continue
        with open(committed_path, "r", encoding="utf-8") as f:
            committed_content = f.read()
        if new_content != committed_content:
            passed = fail(
                f"{filename} is out of date -- regenerating from reports/manifest.json "
                f"produces different content. Run: python3 scripts/build_site.py"
            )
            diff = list(difflib.unified_diff(
                committed_content.splitlines(keepends=True),
                new_content.splitlines(keepends=True),
                fromfile=f"committed/{filename}",
                tofile=f"regenerated/{filename}",
            ))
            for line in diff[:20]:
                print(f"    {line.rstrip()}")
            if len(diff) > 20:
                print(f"    ... ({len(diff) - 20} more diff lines)")
        else:
            ok(f"{filename} is up to date with reports/manifest.json")

    return passed


def check_mojibake():
    """Catch accidental double-UTF-8 encoding across every generated
    file and report page -- this has silently corrupted content
    before, with no symptom beyond a stray glyph in rendered text.
    """
    passed = True
    paths = [INDEX_PATH, os.path.join(ROOT, "llms.txt")]
    paths += sorted(glob.glob(os.path.join(REPORTS_DIR, "*.htm")))

    markers = [("Ã", "Ã-mojibake"), ("â", "â-mojibake"), ("�", "replacement-char")]
    total_hits = {label: 0 for _, label in markers}

    for path in paths:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        for marker_char, label in markers:
            count = content.count(marker_char)
            if count:
                total_hits[label] += count
                passed = fail(f"{count} occurrence(s) of {label} found in {os.path.relpath(path, ROOT)}")

    for label, count in total_hits.items():
        if count == 0:
            ok(f"no {label} found in any checked file")

    return passed


def check_structure(index_html):
    """Basic structural sanity: div balance, required ids present
    exactly once, no leftover template-component syntax from the old
    bundled-template architecture.
    """
    passed = True

    opens = len(re.findall(r"<div[\s>]", index_html))
    closes = index_html.count("</div>")
    if opens != closes:
        passed = fail(f"<div> balance mismatch: {opens} opens vs {closes} closes")
    else:
        ok(f"<div> tags balanced ({opens})")

    for required_id in ["reading-view", "browsing-view", "calendar", "regimes",
                         "performance", "reports", "method", "about"]:
        count = index_html.count(f'id="{required_id}"')
        if count != 1:
            passed = fail(f'id="{required_id}" appears {count} times, expected exactly 1')
        else:
            ok(f'id="{required_id}" present exactly once')

    # Template-binding syntax specifically (e.g. "{{ openTitle }}"), not a
    # bare "}}" -- which occurs legitimately in the JSON-LD script as two
    # adjacent closing braces and would otherwise false-positive here.
    binding_count = len(re.findall(r"\{\{\s*\w+\s*\}\}", index_html))
    leftover_patterns = ["sc-if", "sc-for", "sc-camel", "style-hover", "<x-dc", "DCLogic"]
    any_found = binding_count > 0
    if binding_count:
        passed = fail(f"{binding_count} leftover template-binding occurrence(s) like '{{{{ name }}}}'")
    for pattern in leftover_patterns:
        count = index_html.count(pattern)
        if count:
            any_found = True
            passed = fail(f"{count} leftover occurrence(s) of {pattern!r} (old bundled-template syntax)")
    if not any_found:
        ok("no leftover bundled-template syntax")

    return passed


def main():
    ok_overall = True

    if not os.path.exists(INDEX_PATH):
        return fail(f"{INDEX_PATH} not found")
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        index_html = f.read()

    if not os.path.exists(MANIFEST_PATH):
        return fail(f"{MANIFEST_PATH} not found")
    manifest = load_manifest()

    print("--- Structure ---")
    if not check_structure(index_html):
        ok_overall = False

    print("\n--- Report sync (disk vs index.html vs manifest.json vs sitemap.xml) ---")
    if not check_report_sync(index_html, manifest):
        ok_overall = False

    print("\n--- Build idempotency ---")
    if not check_build_idempotent():
        ok_overall = False

    print("\n--- Mojibake ---")
    if not check_mojibake():
        ok_overall = False

    return ok_overall


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
