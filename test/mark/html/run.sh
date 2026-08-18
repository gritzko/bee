#!/bin/sh
#  lite/test/mark/html/run.sh — LITE-035: `mark/html.js`, the AST -> HTML walk
#  over the vendored parser ([/todo/LITE/LITE-030], [/todo/LITE/LITE-031]), and
#  the `lite serve` glue that renders a `.md` URL.  Six legs:
#
#   1. the layering — the emitter loads, and NOTHING inside the five vendored
#      files or the gfm-* layer carries a LITE-035 edit;
#   2. blocks and inlines — spec examples through parse+emit;
#   3. the GFM four — table, task list, strikethrough, extended autolink;
#   4. SAFETY — raw HTML as visible text, `javascript:`/`data:` destinations
#      dropped to plain text, an obfuscated scheme caught;
#   5. heading anchors — the slug ids and their numbering;
#   6. the wire — a `.md` URL answers rendered HTML, the toggle serves the
#      painted source, and a relative link carries the RESOLVED href.
#
#  ATTRIBUTION.  The Markdown inputs marked `EX n` are taken from the CommonMark
#  Spec, version 0.31.2, Copyright (C) 2014-15 John MacFarlane (EX 1-652), and
#  from the GitHub Flavored Markdown Spec, version 0.29-gfm (2019-04-06),
#  Copyright (C) 2019 GitHub Inc. (the table, task list, strikethrough and
#  autolink cases), both released under the Creative Commons CC-BY-SA 4.0
#  license, <http://creativecommons.org/licenses/by-sa/4.0/>; this file is a
#  derivative of them.  Neither spec is vendored.  The parser under test is
#  BSD-2-Clause, see mark/LICENSE.
#
#  THE ORACLE is the reference C implementation, `cmark-gfm -e strikethrough
#  -e table -e tasklist -e autolink` (0.29.0.gfm.13) in its SAFE default, never
#  a second JS parser: every expectation below was read off ITS output, and when
#  $CMARK names the binary each one is re-confirmed against it on the spot.
#
#  DIVERGENCES from cmark-gfm, all deliberate and all pinned by a check below:
#   -  SAFETY, ours is the stricter: raw HTML is ESCAPED and shown as text where
#      cmark drops it for a `<!-- raw HTML omitted -->` comment, and a
#      `javascript:`/`vbscript:`/`data:`/`file:` destination renders as PLAIN
#      TEXT where cmark keeps an `<a href="">`.  Both stances carry no script.
#   -  headings carry a slug `id`, which cmark does not emit; leg 2 strips
#      ` id="..."` off `<hN` before comparing, leg 5 asserts the ids themselves.
#  INHERITED from the parse half, not fixed here:
#   -  `normalizeURI` is the identity (LITE-030), so a destination keeps its
#      source bytes and the emitter escapes it at RENDER time instead —
#      houdini_escape_href's own rule, which is why `</my uri>` still agrees.
#   -  the entity table is INTERIM (LITE-030): numeric refs in full plus ~90
#      named ones, every other `&name;` verbatim.
#   -  the vendored core is CommonMark 0.31.2 while cmark-gfm is on 0.29, so
#      the two disagree on nested `****strong****` runs and on the unicode
#      punctuation flanking rule — parser ground, out of this ticket's scope.
#
#  Standalone: `sh lite/test/mark/html/run.sh` from anywhere (it cds itself).
#  $LITEJAB picks the runtime (default `jab`), built from THIS tree.
#  $CMARK points at the cmark-gfm binary (default ~/tmp/cmark-gfm/build/src/).
#  $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/mark/html
LITE=$(cd "$CASE/../../.." && pwd)               # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "html: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "html: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
CMARK="${CMARK:-$HOME/tmp/cmark-gfm/build/src/cmark-gfm}"
CMOPT="-e strikethrough -e table -e tasklist -e autolink"
[ -x "$CMARK" ] || { echo "html: no cmark-gfm at $CMARK — the oracle legs are skipped" >&2
                     CMARK=""; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "html: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-mark-html.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "html: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
echo "html: runtime $RT, oracle ${CMARK:-none}, fixtures $WORK"

# ==========================================================================
# leg 1 — the layering: the emitter reads the AST, it does not patch it
# ==========================================================================
DIRT=$(grep -l 'LITE-035' "$LITE"/mark/node.js "$LITE"/mark/common.js \
       "$LITE"/mark/inlines.js "$LITE"/mark/blocks.js \
       "$LITE"/mark/from-code-point.js "$LITE"/mark/gfm.js "$LITE"/mark/gfm-*.js)
if [ -z "$DIRT" ]
then ok "no LITE-035 edit inside the vendored files or the gfm-* layer"
else bad "the emitter patched the parser: $DIRT"; fi

cat > "$WORK/drv.js" <<'DRVJS'
"use strict";
var html = require("mark/html.js");
var src = utf8.Decode(io.mmap("in.md", "r").data());
io.writeAll(io.stdout, utf8.Encode(html.toHtml(src)));   // io.log goes to stderr
DRVJS
run() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/drv.js')" \
          2>"$WORK/ex.err" ); }

printf '# x\n' > "$WORK/in.md"
if [ "$(run)" = '<h1 id="x">x</h1>' ]
then ok "mark/html.js loads and emits off the require base"
else bad "the emitter does not load" "$WORK/ex.err"; fi

#  mine <label> <markdown: \n for a line end, \\ for a literal backslash> <html>
#  — the emitter alone.  A heading id is ours and cmark has none, so it comes
#  off before any comparison; leg 5 asserts the ids themselves.
mine() {
    printf '%b' "$2" > "$WORK/in.md"
    _want=$(printf '%b' "$3")
    _got=$(run | sed 's|\(<h[1-6]\) id="[^"]*"|\1|g')
    if [ "$_got" = "$_want" ]
    then ok "$1"
    else echo "  want $3"; echo "  got  $_got"
         bad "$1" "$WORK/in.md" "$WORK/ex.err"; fi
}

#  ex — the same, plus THE ORACLE: cmark-gfm must render it identically.
ex() {
    mine "$1" "$2" "$3"
    [ -n "$CMARK" ] || return 0
    _cm=$($CMARK $CMOPT "$WORK/in.md")
    if [ "$_cm" = "$_want" ]
    then ok "cmark-gfm agrees: $1"
    else echo "  cmark $_cm"; bad "cmark-gfm disagrees: $1" "$WORK/in.md"; fi
}

# ==========================================================================
# leg 2 — blocks and inlines
# ==========================================================================
ex 'EX 43 the three thematic-break characters' \
   '***\n---\n___\n' \
   '<hr />\n<hr />\n<hr />\n'
ex 'EX 62 ATX headings, all six levels' \
   '# foo\n## foo\n### foo\n#### foo\n##### foo\n###### foo\n' \
   '<h1>foo</h1>\n<h2>foo</h2>\n<h3>foo</h3>\n<h4>foo</h4>\n<h5>foo</h5>\n<h6>foo</h6>\n'
ex 'EX 80 setext headings take the paragraph as their text' \
   'Foo *bar*\n=========\n\nFoo *bar*\n---------\n' \
   '<h1>Foo <em>bar</em></h1>\n<h2>Foo <em>bar</em></h2>\n'
ex 'EX 107 an indented code block keeps its extra indent' \
   '    a simple\n      indented code block\n' \
   '<pre><code>a simple\n  indented code block\n</code></pre>\n'
ex 'EX 119 a fenced code block is verbatim, and escapes' \
   '```\n<\n >\n```\n' \
   '<pre><code>&lt;\n &gt;\n</code></pre>\n'
ex 'EX 143 the first word of the info string is the language class' \
   '~~~~    ruby startline=3 $%@#$\ndef foo(x)\n  return 3\nend\n~~~~~~~\n' \
   '<pre><code class="language-ruby">def foo(x)\n  return 3\nend\n</code></pre>\n'
ex 'EX 228 a block quote holds blocks of its own' \
   '> # Foo\n> bar\n> baz\n' \
   '<blockquote>\n<h1>Foo</h1>\n<p>bar\nbaz</p>\n</blockquote>\n'
ex 'EX 253 a document of three different blocks' \
   'A paragraph\nwith two lines.\n\n    indented code\n\n> A block quote.\n' \
   '<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>\n'
ex 'EX 264 a loose list item wraps its blocks in <p>' \
   '- Foo\n\n      bar\n\n\n      baz\n' \
   '<ul>\n<li>\n<p>Foo</p>\n<pre><code>bar\n\n\nbaz\n</code></pre>\n</li>\n</ul>\n'
ex 'EX 288 an ordered list, loose, with code and a quote inside' \
   '   1.  A paragraph\n       with two lines.\n\n           indented code\n\n       > A block quote.\n' \
   '<ol>\n<li>\n<p>A paragraph\nwith two lines.</p>\n<pre><code>indented code\n</code></pre>\n<blockquote>\n<p>A block quote.</p>\n</blockquote>\n</li>\n</ol>\n'
ex 'EX 300 a heading and a setext heading inside list items' \
   '- # Foo\n- Bar\n  ---\n  baz\n' \
   '<ul>\n<li>\n<h1>Foo</h1>\n</li>\n<li>\n<h2>Bar</h2>\nbaz</li>\n</ul>\n'
ex 'an ordered list that does not start at one keeps the start' \
   '3. one\n4. two\n' \
   '<ol start="3">\n<li>one</li>\n<li>two</li>\n</ol>\n'
ex 'EX 328 a code span' \
   '`foo`\n' \
   '<p><code>foo</code></p>\n'
ex 'EX 350 emphasis' \
   '*foo bar*\n' \
   '<p><em>foo bar</em></p>\n'
ex 'EX 393 strong inside emphasis' \
   '*(**foo**)*\n' \
   '<p><em>(<strong>foo</strong>)</em></p>\n'
ex 'EX 486 an empty link destination' \
   '[link](<>)\n' \
   '<p><a href="">link</a></p>\n'
ex 'EX 502 a backslash in a destination is not an escape' \
   '[link](foo\\bar)\n' \
   '<p><a href="foo%5Cbar">link</a></p>\n'
ex 'EX 581 an image with an empty alt' \
   '![](/url)\n' \
   '<p><img src="/url" alt="" /></p>\n'
ex 'EX 602 a space in an autolink makes it text' \
   '<https://foo.bar/baz bim>\n' \
   '<p>&lt;<a href="https://foo.bar/baz">https://foo.bar/baz</a> bim&gt;</p>\n'
ex 'EX 633 two trailing spaces are a hard break' \
   'foo  \nbaz\n' \
   '<p>foo<br />\nbaz</p>\n'
ex 'EX 634 a trailing backslash is a hard break' \
   'foo\\\nbaz\n' \
   '<p>foo<br />\nbaz</p>\n'
ex 'EX 652 runs of spaces inside a paragraph survive' \
   'Multiple     spaces\n' \
   '<p>Multiple     spaces</p>\n'
ex 'a link with a title, and emphasis in the link text' \
   '[*text*](/u "the title")\n' \
   '<p><a href="/u" title="the title"><em>text</em></a></p>\n'
ex 'an image title, and an alt read as plain text' \
   '![a *b* `c`](/pic.png "pt")\n' \
   '<p><img src="/pic.png" alt="a b c" title="pt" /></p>\n'
ex 'a reference link and its definition' \
   '[foo][bar]\n\n[bar]: /url "t"\n' \
   '<p><a href="/url" title="t">foo</a></p>\n'
ex 'the identity normalizeURI is cured at RENDER time: the href escapes here' \
   '[a](</my uri>) [b](/q?x=1&y=2)\n' \
   '<p><a href="/my%20uri">a</a> <a href="/q?x=1&amp;y=2">b</a></p>\n'
ex 'a numeric reference decodes, an unknown name stays verbatim' \
   '&#35; &amp; &copy; &MadeUpEntity;\n' \
   '<p># &amp; © &amp;MadeUpEntity;</p>\n'

# ==========================================================================
# leg 3 — the GFM four
# ==========================================================================
ex 'EX 198 a table, header and body' \
   '| foo | bar |\n| --- | --- |\n| baz | bim |\n' \
   '<table>\n<thead>\n<tr>\n<th>foo</th>\n<th>bar</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>baz</td>\n<td>bim</td>\n</tr>\n</tbody>\n</table>\n'
ex 'EX 199 the colons of the delimiter row set the alignment' \
   '| abc | defghi |\n:-: | -----------:\nbar | baz\n' \
   '<table>\n<thead>\n<tr>\n<th align="center">abc</th>\n<th align="right">defghi</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="center">bar</td>\n<td align="right">baz</td>\n</tr>\n</tbody>\n</table>\n'
ex 'EX 200 an escaped pipe is a cell character' \
   '| f\\|oo  |\n| ------ |\n| b `\\|` az |\n' \
   '<table>\n<thead>\n<tr>\n<th>f|oo</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>b <code>|</code> az</td>\n</tr>\n</tbody>\n</table>\n'
ex 'EX 205 a header row with no body row emits no tbody' \
   '| abc | def |\n| --- | --- |\n' \
   '<table>\n<thead>\n<tr>\n<th>abc</th>\n<th>def</th>\n</tr>\n</thead>\n</table>\n'
ex 'EX 279 an unchecked and a checked task item, the boxes disabled' \
   '- [ ] foo\n- [x] bar\n' \
   '<ul>\n<li><input type="checkbox" disabled="" /> foo</li>\n<li><input type="checkbox" checked="" disabled="" /> bar</li>\n</ul>\n'
ex 'EX 280 task lists nest' \
   '- [x] foo\n  - [ ] bar\n  - [X] baz\n- [ ] bim\n' \
   '<ul>\n<li><input type="checkbox" checked="" disabled="" /> foo\n<ul>\n<li><input type="checkbox" disabled="" /> bar</li>\n<li><input type="checkbox" checked="" disabled="" /> baz</li>\n</ul>\n</li>\n<li><input type="checkbox" disabled="" /> bim</li>\n</ul>\n'
ex 'a loose task item keeps its blocks' \
   '- [x] a\n\n  b\n' \
   '<ul>\n<li><input type="checkbox" checked="" disabled="" /> \n<p>a</p>\n<p>b</p>\n</li>\n</ul>\n'
ex 'EX 491 one tilde and two tildes both strike' \
   '~~Hi~~ Hello, ~there~ world!\n' \
   '<p><del>Hi</del> Hello, <del>there</del> world!</p>\n'
ex 'EX 493 three or more tildes are inert' \
   'This will ~~~not~~~ strike.\n' \
   '<p>This will ~~~not~~~ strike.</p>\n'
ex 'EX 622 a bare www link, with http:// inserted' \
   'www.commonmark.org\n' \
   '<p><a href="http://www.commonmark.org">www.commonmark.org</a></p>\n'
ex 'EX 627 an &name= tail is part of the autolink' \
   'www.google.com/search?q=commonmark&hl=en\n' \
   '<p><a href="http://www.google.com/search?q=commonmark&amp;hl=en">www.google.com/search?q=commonmark&amp;hl=en</a></p>\n'
ex 'EX 632 an email autolink' \
   'foo@bar.baz\n' \
   '<p><a href="mailto:foo@bar.baz">foo@bar.baz</a></p>\n'

# ==========================================================================
# leg 4 — SAFE BY DEFAULT.  Ours is asserted whole; cmark is asserted to
# refuse the same danger under its own safe default, in its own spelling.
# ==========================================================================
safe() {   # safe <label> <markdown> <our html>
    mine "$1" "$2" "$3"
    [ -n "$CMARK" ] || return 0
    $CMARK $CMOPT "$WORK/in.md" > "$WORK/cm.html"
    if grep -qiE '<script|javascript:|vbscript:|data:text' "$WORK/cm.html"
    then bad "cmark-gfm lets it through: $1" "$WORK/cm.html"
    else ok "cmark-gfm refuses it too: $1"; fi
}
safe 'a raw HTML block is visible text, not markup' \
     '<div onclick="x">\n<script>alert(1)</script>\n' \
     '&lt;div onclick=&quot;x&quot;&gt;\n&lt;script&gt;alert(1)&lt;/script&gt;\n'
safe 'a raw HTML inline is visible text too' \
     'a <b onmouseover="x">c</b> d\n' \
     '<p>a &lt;b onmouseover=&quot;x&quot;&gt;c&lt;/b&gt; d</p>\n'
safe 'a javascript: link renders as plain text' \
     '[click](javascript:alert(1))\n' \
     '<p>click</p>\n'
safe 'a data: link renders as plain text, image exception included' \
     '[a](data:text/html,<script>x</script>)\n\n![i](data:image/png;base64,AAA)\n' \
     '<p>a</p>\n<p>i</p>\n'
safe 'a vbscript: and a file: destination go the same way' \
     '[a](vbscript:msgbox) [b](file:///etc/passwd)\n' \
     '<p>a b</p>\n'
safe 'the gate is case-blind' \
     '[a](  JaVaScRiPt:alert(1)) [b](JAVASCRIPT:x)\n' \
     '<p>a b</p>\n'
safe 'an entity-encoded scheme is decoded before the gate sees it' \
     '[a](&#106;avascript:alert(1))\n' \
     '<p>a</p>\n'
safe 'an image src takes the same gate as an href' \
     '![alt](javascript:alert(1))\n' \
     '<p>alt</p>\n'
safe 'a title and an alt cannot break out of their attribute' \
     '[a](/u "x\\"onload=y") ![b](/i "z\\"onload=y")\n' \
     '<p><a href="/u" title="x&quot;onload=y">a</a> <img src="/i" alt="b" title="z&quot;onload=y" /></p>\n'

#  The gate itself, on strings no Markdown link can carry: whitespace and
#  control characters come out before the scheme is read, as a browser reads it.
cat > "$WORK/danger.js" <<'DANGERJS'
"use strict";
var d = require("mark/html.js").dangerous;
var ins = ["javascript:x", " \tJAVASCRIPT:x", "java\nscript:x", "j avascript:x",
           "data:image/png;base64,AA", "file:///etc/passwd", "vbscript:x",
           "https://x.org/j", "/rel/path", "notjavascript:x", "#anchor"];
var out = [];
for (var i = 0; i < ins.length; i++) out.push(d(ins[i]) ? "1" : "0");
io.writeAll(io.stdout, utf8.Encode(out.join("") + "\n"));
DANGERJS
GOT=$( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/danger.js')" \
       2>"$WORK/danger.err" )
if [ "$GOT" = "11111110000" ]
then ok "the scheme gate strips whitespace and controls before it reads"
else bad "the scheme gate: '$GOT' is not 11111110000" "$WORK/danger.err"; fi

# ==========================================================================
# leg 5 — heading anchors
# ==========================================================================
printf '# Hello, *World*!\n\n## Hello World\n\n## Hello World\n\n### 1.2 Release notes\n\n####\n' \
  > "$WORK/in.md"
run > "$WORK/anch.html"
ids() { grep -c "id=\"$1\"" "$WORK/anch.html"; }
[ "$(ids hello-world)" = 1 ] && ok "a heading slug lowercases, drops punctuation, hyphenates" \
  || bad "no id=hello-world" "$WORK/anch.html"
[ "$(ids hello-world-1)" = 1 ] && [ "$(ids hello-world-2)" = 1 ] \
  && ok "a repeated slug is numbered, first one bare" \
  || bad "repeated slugs are not numbered" "$WORK/anch.html"
[ "$(ids 12-release-notes)" = 1 ] && ok "digits and dots: 1.2 Release notes -> 12-release-notes" \
  || bad "no id=12-release-notes" "$WORK/anch.html"
[ "$(ids section)" = 1 ] && ok "an empty heading falls back to section" \
  || bad "no id=section" "$WORK/anch.html"

# ==========================================================================
# leg 6 — the wire: `.md` renders, `/raw/` paints, links resolve at render time
# ==========================================================================
command -v git  >/dev/null 2>&1 || { echo "html: SKIP the wire leg — no git" >&2
                                     echo "html: $CHECKS checks, $FAILED failed"
                                     [ "$FAILED" = 0 ] || exit 1; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "html: SKIP the wire leg — no curl" >&2
                                     echo "html: $CHECKS checks, $FAILED failed"
                                     [ "$FAILED" = 0 ] || exit 1; exit 0; }
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'X0\n' > sub/x.txt
  printf '#   Other\n\nback to [the doc](../doc.md)\n' > sub/other.md
  printf '#   Kept\n\npainted, not rendered\n' > doc.mkd
  printf '#   Doc *title*\n\nA [file](sub/x.txt), a [page](sub/other.md), a [dir](sub),\na [miss](nosuch.md), a [bad](javascript:alert(1)), an [out](https://e.org/a?b=1&c=2).\n\n##  Head two\n\n- [x] done\n\n| a | b |\n| :- | -: |\n| 1 | 2 |\n\n<script>alert(1)</script>\n' > doc.md
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed' || exit 1
) || { echo "html: cannot build the fixture repo" >&2; exit 2; }

PORT="${LITEPORT:-18035}"
BASE="http://127.0.0.1:$PORT"
( cd "$REPO"; exec env HOME="$FAKEHOME" "$RT" http --port "$PORT" ) \
  > "$WORK/srv.log" 2>&1 &
SRVPID=$!
i=0
while [ "$i" -lt 50 ]; do
    curl -s -o /dev/null "$BASE/" && break
    i=$((i + 1)); sleep 0.2
done
kill -0 "$SRVPID" 2>/dev/null || { bad "the fixture server did not come up" "$WORK/srv.log"
                                   echo "html: $CHECKS checks, $FAILED failed"; exit 1; }

get() { curl -s -o "$WORK/page.html" -w '%{http_code} %{content_type}' "$BASE$1"; }
has()   { if grep -qF "$2" "$WORK/page.html"
          then ok "$1"; else bad "$1 (missing: $2)" "$WORK/page.html"; fi; }
hasnt() { if grep -qF "$2" "$WORK/page.html"
          then bad "$1 (present: $2)" "$WORK/page.html"; else ok "$1"; fi; }

R=$(get /repo/cat/doc.md)
[ "$R" = "200 text/html; charset=utf-8" ] && ok "a .md URL answers 200 text/html" \
  || bad "GET /repo/cat/doc.md -> '$R'" "$WORK/page.html"
has   "the .md URL is RENDERED by default"        '<h1 id="doc-title">Doc <em>title</em></h1>'
hasnt "the rendered page carries no painted spans" 'class="tok-'
has   "the GFM checkbox rides the rendered page"   '<input type="checkbox" checked="" disabled="" />'
has   "the GFM table rides it too"                 '<th align="left">a</th>'
has   "a relative link carries the RESOLVED href"  '<a href="/repo/sub/x.txt">file</a>'
has   "a .md target links to its RENDERED page"    '<a href="/repo/sub/other.md">page</a>'
has   "a directory target links to the list view"  '<a href="/repo/sub/">dir</a>'
has   "an absolute url rides as it was typed"      '<a href="https://e.org/a?b=1&amp;c=2">out</a>'
hasnt "an unresolvable target is NOT a link"       '>miss</a>'
has   "an unresolvable target stays plain text"    'a miss,'
hasnt "a javascript: link never reaches the page"  'javascript:'
hasnt "raw HTML never reaches the page as markup"  '<script'
has   "raw HTML reaches it as visible text"        '&lt;script&gt;alert(1)&lt;/script&gt;'
has   "the page offers the source toggle"          '<a href="/repo/raw/doc.md">source</a>'
has   "the LITE-034 shell wraps the fragment"      '<link rel="stylesheet" href="/style.css">'

R=$(get /repo/raw/doc.md)
[ "$R" = "200 text/html; charset=utf-8" ] && ok "the toggle URL answers 200 text/html" \
  || bad "GET /repo/raw/doc.md -> '$R'" "$WORK/page.html"
has   "the toggle serves the PAINTED source"       'class="tok-'
hasnt "the painted source renders no heading"      '<h1 id='
has   "the painted view links back to rendered"    '<a href="/repo/cat/doc.md">rendered</a>'

get /repo/cat/sub/other.md > /dev/null
has   "a link out of a subdir resolves against ITS dir" '<a href="/repo/doc.md">the doc</a>'

get /repo/cat/doc.mkd > /dev/null
has   "a .mkd is still painted source (LITE-034)"  'class="tok-'
hasnt "a .mkd is not rendered"                     '<h1 id='

R=$(get /style.css)
case "$R" in
    "200 text/css"*) ok "the one stylesheet still answers" ;;
    *) bad "GET /style.css -> '$R'" ;;
esac
has   "the sheet carries the rendered-body rules"  '.mark table{border-collapse:collapse}'

kill "$SRVPID" 2>/dev/null; SRVPID=""
echo "html: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
echo "PASS [lite/mark/html] $CHECKS checks"
