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
    # The title argument can itself contain a comma (e.g. "Workday, Inc."),
    # so match on the href argument specifically rather than splitting on
    # the first comma.
    latest_pattern = re.compile(r"this\.openReport\('[^']*',\s*'reports/([^']+\.htm)'\)")
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

    # A browser's HTML tokenizer ends a <script> element's raw text at the
    # FIRST literal "</script" byte sequence, full stop -- it has no idea
    # the content is JSON, so JSON-escaping a </script> inside a string
    # (\"</script>\") does nothing to protect it. Any inner <script> tag
    # embedded in this template (JSON-LD, the DC Component, etc.) MUST have
    # its closing tag written as </script> instead of a literal
    # </script>, or the outer template tag truncates there and
    # JSON.parse throws "Unterminated string" in the actual browser --
    # a failure raw_decode() below cannot see, because Python's JSON
    # decoder has no concept of HTML tokenization and happily parses past
    # it. Simulate the browser's behavior explicitly first.
    browser_end = content.find("</script>", start)
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

    # The real outer closing tag is right after the JSON string ends.
    true_close = content.find("</script>", end - 1)
    if browser_end != -1 and browser_end < (true_close if true_close != -1 else len(content)):
        # There's a literal </script> INSIDE the JSON string content that
        # a browser's tokenizer would hit first, truncating the template
        # before its real end -- exactly the bug that broke this page.
        browser_text_len = browser_end - start
        ctx = content[max(0, browser_end - 100):browser_end + 20]
        ok = fail(
            f"a literal (unescaped) </script> appears inside the template content at "
            f"offset {browser_end - start}, before the template's real end. A browser's "
            f"HTML tokenizer would cut the <script type=\"__bundler/template\"> tag off "
            f"there (JS would see only {browser_text_len} chars instead of {end - i}), "
            f"causing 'Unterminated string' in JSON.parse. Escape it as <\\u002Fscript> "
            f"instead of </script>."
        )
        print(f"  context: {ctx!r}")
    else:
        print("OK: no literal </script> inside the template content that would "
              "truncate it early in a real browser")

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
