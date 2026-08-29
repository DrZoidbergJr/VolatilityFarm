#!/usr/bin/env python3
"""Validate index.html's packed template before it ships.

This file's real content lives inside a JSON string in a
<script type="__bundler/template"> tag. A single bad escape sequence or an
unescaped apostrophe inside the DC Component's JS silently breaks the whole
page (JSON.parse throws, or the JS never executes) with no error visible
until someone opens the site. This script catches both failure modes before
they get committed, plus drift between reports/, the archive list inside
index.html, and sitemap.xml (nothing currently keeps these in sync
automatically, so a forgotten step silently orphans a report).
"""
import glob
import json
import os
import re
import sys

PATH = "index.html"
REPORTS_DIR = "reports"
SITEMAP_PATH = "sitemap.xml"


def fail(msg):
    print(f"FAIL: {msg}")
    return False


def check_report_sync(data):
    """Cross-check reports/*.htm against the hrefs referenced in
    index.html's DC Component and the URLs listed in sitemap.xml.

    Doesn't try to enforce an order or a specific set of fields -- just
    that every file on disk is reachable from the page and listed for
    crawlers, and that nothing in either list points at a file that no
    longer exists.
    """
    ok = True

    disk_files = {
        os.path.basename(p).replace("\\", "/")
        for p in glob.glob(os.path.join(REPORTS_DIR, "*.htm"))
    }

    href_pattern = re.compile(r"href:\s*'reports/([^']+\.htm)'")
    linked_files = set(href_pattern.findall(data))

    # The Latest-featured report uses openLatest/openLatestPrint bindings
    # with the same href shape but isn't in the reports() array (it's
    # deliberately excluded so it doesn't also show up in the Archive) --
    # pick those up too so it isn't flagged as "on disk but not linked".
    latest_pattern = re.compile(r"this\.openReport\([^,]*,\s*'reports/([^']+\.htm)'\)")
    linked_files |= set(latest_pattern.findall(data))

    missing_from_page = disk_files - linked_files
    if missing_from_page:
        ok = fail(f"{len(missing_from_page)} report(s) on disk but not linked from "
                  f"index.html (Latest or Archive): {sorted(missing_from_page)}")
    else:
        print(f"OK: all {len(disk_files)} report(s) on disk are linked from index.html")

    dangling_in_page = linked_files - disk_files
    if dangling_in_page:
        ok = fail(f"index.html links {len(dangling_in_page)} report(s) that don't exist "
                  f"on disk: {sorted(dangling_in_page)}")
    else:
        print(f"OK: no dangling report links in index.html")

    if os.path.exists(SITEMAP_PATH):
        with open(SITEMAP_PATH, "r", encoding="utf-8") as f:
            sitemap_text = f.read()
        sitemap_pattern = re.compile(r"<loc>https://volatilityfarm\.com/reports/([^<]+\.htm)</loc>")
        sitemap_files = set(sitemap_pattern.findall(sitemap_text))

        missing_from_sitemap = disk_files - sitemap_files
        if missing_from_sitemap:
            ok = fail(f"{len(missing_from_sitemap)} report(s) on disk but missing from "
                      f"sitemap.xml: {sorted(missing_from_sitemap)}")
        else:
            print(f"OK: all {len(disk_files)} report(s) on disk are listed in sitemap.xml")

        dangling_in_sitemap = sitemap_files - disk_files
        if dangling_in_sitemap:
            ok = fail(f"sitemap.xml lists {len(dangling_in_sitemap)} report(s) that don't "
                      f"exist on disk: {sorted(dangling_in_sitemap)}")
        else:
            print(f"OK: no dangling entries in sitemap.xml")
    else:
        print(f"WARN: {SITEMAP_PATH} not found, skipping sitemap sync check")

    return ok


def main():
    ok = True

    with open(PATH, "r", encoding="utf-8") as f:
        content = f.read()

    marker = '<script type="__bundler/template">'
    idx = content.find(marker)
    if idx == -1:
        return fail(f"could not find {marker!r} in {PATH}")

    start = idx + len(marker)
    i = start
    while content[i] in "\n\r\t ":
        i += 1

    decoder = json.JSONDecoder()
    try:
        data, end = decoder.raw_decode(content, i)
    except json.JSONDecodeError as e:
        # e.pos is an absolute index into `content` (the string passed to
        # raw_decode), not relative to the start offset `i`.
        ctx = content[max(0, e.pos - 100):e.pos + 100]
        print(f"FAIL: __bundler/template is not valid JSON: {e}")
        print(f"  context: {ctx!r}")
        return False

    print(f"OK: __bundler/template parses as JSON ({len(data)} chars)")

    # Locate the DC Component script block and check bracket/quote balance.
    idx_dc = data.find("class Component extends DCLogic")
    if idx_dc == -1:
        print("WARN: could not find DC Component block, skipping JS balance check")
    else:
        dc_end = data.find("</script>", idx_dc)
        dc_block = data[idx_dc:dc_end]

        pairs = [("{", "}"), ("(", ")"), ("[", "]")]
        for open_ch, close_ch in pairs:
            o, c = dc_block.count(open_ch), dc_block.count(close_ch)
            if o != c:
                ok = fail(f"DC Component {open_ch}{close_ch} mismatch: {o} vs {c}")
            else:
                print(f"OK: DC Component {open_ch}{close_ch} balanced ({o})")

        quote_count = dc_block.count("'")
        if quote_count % 2 != 0:
            ok = fail(f"DC Component has an odd number of single quotes ({quote_count}) "
                      f"-- a string literal is probably unterminated")
        else:
            print(f"OK: DC Component single-quote count is even ({quote_count})")

        # The actual bug that broke this file twice: a straight apostrophe
        # sitting inside a single-quoted JS string (e.g. 'Lowe's Companies')
        # terminates the string early. Flag any letter-apostrophe-letter
        # pattern so it gets caught before commit, not after deploy.
        contraction_pattern = re.compile(r"[a-zA-Z]'[a-zA-Z]")
        hazards = list(contraction_pattern.finditer(dc_block))
        if hazards:
            ok = fail(f"{len(hazards)} straight-apostrophe hazard(s) found inside the DC "
                      f"Component's JS -- these break single-quoted string literals. "
                      f"Use a curly apostrophe (') instead:")
            for m in hazards:
                s = max(0, m.start() - 30)
                e = min(len(dc_block), m.end() + 30)
                print(f"    ...{dc_block[s:e]!r}...")
        else:
            print("OK: no straight-apostrophe hazards in DC Component JS")

    # Mojibake check across the whole file: catches accidental double-UTF-8
    # encoding, which has also silently corrupted this file before.
    for marker_char, label in [("Ã", "Ã-mojibake"), ("â", "â-mojibake"), ("�", "replacement-char")]:
        count = content.count(marker_char)
        if count > 0:
            ok = fail(f"{count} occurrence(s) of {label} found -- likely double-encoded UTF-8")
        else:
            print(f"OK: no {label} found")

    if not check_report_sync(data):
        ok = False

    return ok


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
