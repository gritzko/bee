#!/bin/sh
#  lite/test/rst/run.sh — LITE-037: `mark/rst.js`, the reStructuredText SUBSET
#  parser, and the `lite http` glue that renders a `.rst` URL.  Five legs:
#
#   1. the layering — the parser loads, and NOTHING inside the vendored files,
#      the gfm-* layer or the LITE-035 emitter carries a LITE-037 edit: `.rst`
#      builds the SAME commonmark nodes and `mark/html.js` emits them unchanged;
#   2. blocks — sections, paragraphs, bullet + enumerated lists, literal blocks,
#      block quotes, transitions;
#   3. inlines — emph/strong/literal, hyperlink targets and every reference
#      form, embedded URIs, standalone URIs, escapes;
#   4. DEGRADES and SAFETY — directives, roles, tables, footnotes and fields
#      come out as literal or plain text, a comment is dropped, source markup is
#      never HTML, a `javascript:` destination is plain text;
#   5. the wire — a `.rst` URL answers rendered HTML, the toggle serves the
#      painted source, and a relative link carries the RESOLVED href.
#
#  BEE-003: every URL of leg 5 carries its REPO — the fixture is `$WORK/repo`,
#  so the prefix is `/repo/`; a verb page is `/repo/<verb>/<path>` and a
#  RESOLVED reference `/repo/cat/<path>` or `/repo/list/<dir>/` (BEE-028).
#
#  THE SUBSET is the ticket's, and the parser is HAND-WRITTEN: docutils is
#  Python and there is no JS reST parser to vendor.  What is NOT in it degrades
#  and is pinned by leg 4 — it must never crash and never emit source markup.
#
#  Standalone: `sh lite/test/rst/run.sh` from anywhere (it cds itself).
#  $LITEJAB picks the runtime (default `jab`), built from THIS tree.
#  $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/rst
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "rst: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "rst: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "rst: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-rst.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "rst: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
echo "rst: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — the layering: one parser more, the SAME emitter
# ==========================================================================
DIRT=$(grep -l 'LITE-037' "$LITE"/mark/node.js "$LITE"/mark/common.js \
       "$LITE"/mark/inlines.js "$LITE"/mark/blocks.js \
       "$LITE"/mark/from-code-point.js "$LITE"/mark/gfm.js "$LITE"/mark/gfm-*.js \
       "$LITE"/mark/html.js)
if [ -z "$DIRT" ]
then ok "no LITE-037 edit inside the vendored files or the LITE-035 emitter"
else bad "the rst parser patched the markdown side: $DIRT"; fi

cat > "$WORK/drv.js" <<'DRVJS'
"use strict";
var rst = require("mark/rst.js");
var src = utf8.Decode(io.mmap("in.rst", "r").data());
io.writeAll(io.stdout, utf8.Encode(rst.toHtml(src)));    // io.log goes to stderr
DRVJS
run() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/drv.js')" \
          2>"$WORK/ex.err" ); }

printf 'x\n===\n' > "$WORK/in.rst"
if [ "$(run)" = '<h1 id="x">x</h1>' ]
then ok "mark/rst.js loads and emits off the require base"
else bad "the parser does not load" "$WORK/ex.err"; fi

#  rst <label> <reST: \n for a line end, \\ for a literal backslash> <html>
rst() {
    printf '%b' "$2" > "$WORK/in.rst"
    _want=$(printf '%b' "$3")
    _got=$(run)
    if [ "$_got" = "$_want" ]
    then ok "$1"
    else echo "  want $3"; echo "  got  $_got"
         bad "$1" "$WORK/in.rst" "$WORK/ex.err"; fi
}

# ==========================================================================
# leg 2 — blocks
# ==========================================================================
rst 'a title with an under- and an overline is the top level' \
    '=====\nTitle\n=====\n' \
    '<h1 id="title">Title</h1>\n'
rst 'the adornment styles rank in first-seen order' \
    'One\n===\n\nTwo\n---\n\nThree\n~~~~~\n\nAgain\n-----\n' \
    '<h1 id="one">One</h1>\n<h2 id="two">Two</h2>\n<h3 id="three">Three</h3>\n<h2 id="again">Again</h2>\n'
rst 'a paragraph keeps its own line breaks' \
    'A paragraph\nwith two lines.\n' \
    '<p>A paragraph\nwith two lines.</p>\n'
rst 'two paragraphs, split by the blank line' \
    'One.\n\nTwo.\n' \
    '<p>One.</p>\n<p>Two.</p>\n'
rst 'a bullet list, the three markers' \
    '- one\n- two\n\n* three\n\n+ four\n' \
    '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ul>\n<li>three</li>\n</ul>\n<ul>\n<li>four</li>\n</ul>\n'
rst 'a bullet item wraps and holds its continuation' \
    '- one that wraps\n  onto a second line\n- two\n' \
    '<ul>\n<li>one that wraps\nonto a second line</li>\n<li>two</li>\n</ul>\n'
rst 'a bullet list nests by indent' \
    '- one\n\n  - inner\n  - other\n\n- two\n' \
    '<ul>\n<li>\n<p>one</p>\n<ul>\n<li>inner</li>\n<li>other</li>\n</ul>\n</li>\n<li>\n<p>two</p>\n</li>\n</ul>\n'
rst 'an enumerated list, the dot and the paren forms' \
    '1. one\n2. two\n\n1) three\n\n(1) four\n' \
    '<ol>\n<li>one</li>\n<li>two</li>\n</ol>\n<ol>\n<li>three</li>\n</ol>\n<ol>\n<li>four</li>\n</ol>\n'
rst 'an enumerated list that does not start at one keeps the start' \
    '3. one\n4. two\n' \
    '<ol start="3">\n<li>one</li>\n<li>two</li>\n</ol>\n'
rst 'the auto-enumerator # counts from one' \
    '#. one\n#. two\n' \
    '<ol>\n<li>one</li>\n<li>two</li>\n</ol>\n'
rst 'a literal block: the :: opener leaves one colon behind' \
    'It follows::\n\n    literal *not emph*\n      deeper still\n\nafter\n' \
    '<p>It follows:</p>\n<pre><code>literal *not emph*\n  deeper still\n</code></pre>\n<p>after</p>\n'
rst 'a spaced :: opener leaves no colon' \
    'It follows ::\n\n    x\n' \
    '<p>It follows</p>\n<pre><code>x\n</code></pre>\n'
rst 'a :: paragraph of its own vanishes' \
    '::\n\n    x\n' \
    '<pre><code>x\n</code></pre>\n'
rst 'a tab-indented sub-list stays inside its item (LITE-039)' \
    ' 1. One.\n\n\t- a\n\t- b\n\n 2. Two.\n' \
    '<ol>\n<li>\n<p>One.</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n</li>\n<li>\n<p>Two.</p>\n</li>\n</ol>\n'
rst 'an item body deeper than its marker is no block quote (LITE-039)' \
    ' 1. Objects.\n\n     Body text.\n\n\t- Tasks\n\n     Tail text.\n' \
    '<ol>\n<li>\n<p>Objects.</p>\n<p>Body text.</p>\n<ul>\n<li>Tasks</li>\n</ul>\n<p>Tail text.</p>\n</li>\n</ol>\n'
rst 'an alpha-enumerated list is a list, not quoted prose (LITE-040)' \
    'a. One:\n\n   body a\n\nb. Two.\n' \
    '<ol type="a">\n<li>\n<p>One:</p>\n<p>body a</p>\n</li>\n<li>\n<p>Two.</p>\n</li>\n</ol>\n'
rst 'uppercase enumerators ride type=A, tight' \
    'A) First\nB) Second\n' \
    '<ol type="A">\n<li>First</li>\n<li>Second</li>\n</ol>\n'
rst 'an initial opens no list — A. Smith stays prose (LITE-040)' \
    'A. Smith went home.\nHe was tired.\n' \
    '<p>A. Smith went home.\nHe was tired.</p>\n'
rst 'CJK punctuation opens and closes inline markup (LITE-042)' \
    '文，``budget`` 是。**强**文\n' \
    '<p>文，<code>budget</code> 是。<strong>强</strong>文</p>\n'
rst 'a line block renders as lines, not a paragraph (LITE-042)' \
    '| line one\n| line two\n|\n| line three\n' \
    '<div class="line-block">\n<div class="line">line one</div>\n<div class="line">line two</div>\n<div class="line"><br /></div>\n<div class="line">line three</div>\n</div>\n'
rst 'an attribution marks a real quotation, kept and dashed (LITE-042)' \
    'Intro:\n\n   "Quote text."\n\n   -- Sherlock\n' \
    '<p>Intro:</p>\n<blockquote>\n<p>&quot;Quote text.&quot;</p>\n<p class="attribution">— Sherlock</p>\n</blockquote>\n'
rst 'a term over an indented body is a definition list (LITE-041)' \
    'dev_pm_opp_add\n   Add a new OPP.\n\n   Second para.\n' \
    '<dl>\n<dt>dev_pm_opp_add</dt>\n<dd>\n<p>Add a new OPP.</p>\n<p>Second para.</p>\n</dd>\n</dl>\n'
rst 'definition items chain into one dl' \
    'term one\n   def one\n\nterm two\n   def two\n' \
    '<dl>\n<dt>term one</dt>\n<dd>\n<p>def one</p>\n</dd>\n<dt>term two</dt>\n<dd>\n<p>def two</p>\n</dd>\n</dl>\n'
rst 'a literal opener is no term' \
    'Example::\n\n   code here\n' \
    '<p>Example:</p>\n<pre><code>code here\n</code></pre>\n'
rst 'an indented LIST is layout, not a quotation — no border bar (LITE-039)' \
    'Choose:\n\n  - a\n  - b\n' \
    '<p>Choose:</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n'
rst 'indented prose among an indented list still quotes' \
    'Says:\n\n  - a\n\n  who said it\n' \
    '<p>Says:</p>\n<blockquote>\n<ul>\n<li>a</li>\n</ul>\n<p>who said it</p>\n</blockquote>\n'
rst 'an indented block on its own is a block quote' \
    'A lead.\n\n    quoted words\n\nafter\n' \
    '<p>A lead.</p>\n<blockquote>\n<p>quoted words</p>\n</blockquote>\n<p>after</p>\n'
rst 'a transition is a rule' \
    'One.\n\n----\n\nTwo.\n' \
    '<p>One.</p>\n<hr />\n<p>Two.</p>\n'

# ==========================================================================
# leg 3 — inlines, hyperlink targets and references
# ==========================================================================
rst 'emphasis, strong and inline literal' \
    'A *emph*, a **strong** and a ``literal``.\n' \
    '<p>A <em>emph</em>, a <strong>strong</strong> and a <code>literal</code>.</p>\n'
rst 'an inline literal is verbatim — no nesting inside it' \
    '``a *b* and c_``\n' \
    '<p><code>a *b* and c_</code></p>\n'
rst 'a backslash escapes the markup character' \
    'not \\*emph\\* here\n' \
    '<p>not *emph* here</p>\n'
rst 'an embedded URI names its own destination' \
    'See `the site <https://e.org/a?b=1&c=2>`_ now.\n' \
    '<p>See <a href="https://e.org/a?b=1&amp;c=2">the site</a> now.</p>\n'
rst 'a named reference resolves against its target' \
    'See target_ now.\n\n.. _target: https://e.org/t\n' \
    '<p>See <a href="https://e.org/t">target</a> now.</p>\n'
rst 'a phrase reference resolves the same way' \
    'See `two words`_ now.\n\n.. _two words: https://e.org/w\n' \
    '<p>See <a href="https://e.org/w">two words</a> now.</p>\n'
rst 'a target may be defined before its reference' \
    '.. _early: https://e.org/e\n\nSee early_.\n' \
    '<p>See <a href="https://e.org/e">early</a>.</p>\n'
rst 'anonymous references take the anonymous targets in order' \
    'One `first`__ and two `second`__.\n\n.. __: https://e.org/1\n.. __: https://e.org/2\n' \
    '<p>One <a href="https://e.org/1">first</a> and two <a href="https://e.org/2">second</a>.</p>\n'
rst 'an unresolved reference stays plain text, never a dead link' \
    'See nosuch_ and `no phrase`_.\n' \
    '<p>See nosuch_ and `no phrase`_.</p>\n'
rst 'a standalone URI links itself, trailing punctuation left out' \
    'Read https://e.org/x, or mailto:a@b.org.\n' \
    '<p>Read <a href="https://e.org/x">https://e.org/x</a>, or <a href="mailto:a@b.org">mailto:a@b.org</a>.</p>\n'
rst 'a reference inside emphasis still resolves' \
    '*see target_ here*\n\n.. _target: https://e.org/t\n' \
    '<p><em>see <a href="https://e.org/t">target</a> here</em></p>\n'
rst 'a section title takes inline markup, and its slug takes the text' \
    'Doc *title*\n===========\n' \
    '<h1 id="doc-title">Doc <em>title</em></h1>\n'
rst 'a single-backtick title reference reads as a citation' \
    'See `Some Book` today.\n' \
    '<p>See <em>Some Book</em> today.</p>\n'
rst 'a phrase reference resolves to a section title anchor (LITE-038)' \
    'Intro Part\n==========\n\nSee `Intro Part`_.\n' \
    '<h1 id="intro-part">Intro Part</h1>\n<p>See <a href="#intro-part">Intro Part</a>.</p>\n'
rst 'a simple reference reaches a section title too' \
    'Intro\n=====\n\nSee Intro_.\n' \
    '<h1 id="intro">Intro</h1>\n<p>See <a href="#intro">Intro</a>.</p>\n'
rst 'an explicit target outranks a section title of the same name' \
    'Both\n====\n\nSee Both_.\n\n.. _both: https://e.org/b\n' \
    '<h1 id="both">Both</h1>\n<p>See <a href="https://e.org/b">Both</a>.</p>\n'

# ==========================================================================
# leg 4 — the DEGRADES, and safety
# ==========================================================================
rst 'a directive degrades to literal text, body included' \
    '.. note::\n\n   Mind the gap.\n' \
    '<pre><code>.. note::\n\n   Mind the gap.\n</code></pre>\n'
rst 'an image directive degrades the same way — no img, no fetch' \
    '.. image:: logo.png\n   :width: 20\n' \
    '<pre><code>.. image:: logo.png\n   :width: 20\n</code></pre>\n'
rst 'a comment is dropped, as reST drops it' \
    'Kept.\n\n.. a comment\n   and its body\n\nAlso kept.\n' \
    '<p>Kept.</p>\n<p>Also kept.</p>\n'
rst 'a footnote definition degrades to literal text' \
    '.. [1] The note itself.\n' \
    '<pre><code>.. [1] The note itself.\n</code></pre>\n'
rst 'a grid table degrades to literal text, its art intact' \
    '+---+---+\n| a | b |\n+===+===+\n| 1 | 2 |\n+---+---+\n' \
    '<pre><code>+---+---+\n| a | b |\n+===+===+\n| 1 | 2 |\n+---+---+\n</code></pre>\n'
rst 'a role degrades to literal, a footnote ref and a substitution to plain' \
    'A :ref:`thing`, a note [1]_ and a |sub| here.\n' \
    '<p>A <code>thing</code>, a note [1]_ and a |sub| here.</p>\n'
rst 'a two-part Sphinx role degrades to a literal the same way (LITE-038)' \
    'In :c:type:`struct cred <cred>` and :c:func:`kmalloc`.\n' \
    '<p>In <code>struct cred &lt;cred&gt;</code> and <code>kmalloc</code>.</p>\n'
rst 'a field list reads as Name: value pairs, a line each (LITE-039)' \
    ':Author: Someone\n:Version: 2\n' \
    '<p><strong>Author:</strong> Someone</p>\n<p><strong>Version:</strong> 2</p>\n'
rst 'a field value takes its indented continuation' \
    ':Note: one\n   and two\n' \
    '<p><strong>Note:</strong> one and two</p>\n'
rst 'a role at line start is no field' \
    ':c:type:`x` leads.\n' \
    '<p><code>x</code> leads.</p>\n'
rst 'source markup is TEXT — an .rst page never carries the document`s HTML' \
    'A <script>alert(1)</script> and a <b>tag</b>.\n' \
    '<p>A &lt;script&gt;alert(1)&lt;/script&gt; and a &lt;b&gt;tag&lt;/b&gt;.</p>\n'
rst 'a raw:: directive is literal text too, never markup' \
    '.. raw:: html\n\n   <script>alert(1)</script>\n' \
    '<pre><code>.. raw:: html\n\n   &lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>\n'
rst 'a javascript: destination renders as plain text' \
    'A `click <javascript:alert(1)>`_ here.\n' \
    '<p>A click here.</p>\n'
rst 'a data: target goes the same way' \
    'A bad_ one.\n\n.. _bad: data:text/html,<script>x</script>\n' \
    '<p>A bad one.</p>\n'

#  Nothing in the subset may take the parser down: every one of these is a
#  malformed or truncated construct, and each must simply come back as a page.
cat > "$WORK/rough.js" <<'ROUGHJS'
"use strict";
var rst = require("mark/rst.js");
var ins = ["", "\n\n\n", "=====\n", "Title\n==\n", "``unclosed\n", "*unclosed\n",
           "`unclosed <http://x\n", ".. \n", ".. _:\n", ".. _a:\n\nsee a_\n",
           "- \n- \n", "1.\n2.\n", "::\n", "::\n\n", "|\n|\n", "+--+\n",
           ":a:`\n", "x__\n", "\\\\", "- x\n  - y\n    - z\n      - w\n"];
var bad = 0;
for (var i = 0; i < ins.length; i++) {
    try { rst.toHtml(ins[i]); } catch (e) { bad++; io.log("threw on " + i + ": " + e + "\n"); }
}
io.writeAll(io.stdout, utf8.Encode(bad === 0 ? "clean\n" : "threw " + bad + "\n"));
ROUGHJS
GOT=$( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/rough.js')" \
       2>"$WORK/rough.err" )
if [ "$GOT" = "clean" ]
then ok "20 malformed constructs parse without throwing"
else bad "the parser threw: $GOT" "$WORK/rough.err"; fi

# ==========================================================================
# leg 5 — the wire: `.rst` renders, `/raw/` paints, links resolve at render time
# ==========================================================================
command -v git  >/dev/null 2>&1 || { echo "rst: SKIP the wire leg — no git" >&2
                                     echo "rst: $CHECKS checks, $FAILED failed"
                                     [ "$FAILED" = 0 ] || exit 1; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "rst: SKIP the wire leg — no curl" >&2
                                     echo "rst: $CHECKS checks, $FAILED failed"
                                     [ "$FAILED" = 0 ] || exit 1; exit 0; }
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'X0\n' > sub/x.txt
  printf 'Other\n=====\n\nBack to `the doc <../doc.rst>`_.\n' > sub/other.rst
  printf '#   Kept\n\npainted, not rendered\n' > doc.mkd
  cat > doc.rst <<'DOCRST'
===========
Doc *title*
===========

A `file <sub/x.txt>`_, a `page <sub/other.rst>`_, a `dir <sub>`_,
a `miss <nosuch.rst>`_, a `bad <javascript:alert(1)>`_, an out_.

A bare sub/x.txt in prose, and a missing nosuch.xyz:9 too.

Head two
--------

- a bullet
- another

1. first
2. second

A literal block follows::

    literal *not emph* stays flat

----

A :ref:`role`, a note [1]_ and a <script>alert(1)</script>.

.. note::

   A directive body degrades.

.. a comment that is dropped

.. _out: https://e.org/a?b=1&c=2
DOCRST
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed' || exit 1
) || { echo "rst: cannot build the fixture repo" >&2; exit 2; }

PORT="${LITEPORT:-18037}"
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
                                   echo "rst: $CHECKS checks, $FAILED failed"; exit 1; }

get() { curl -s -o "$WORK/page.html" -w '%{http_code} %{content_type}' "$BASE$1"; }
has()   { if grep -qF "$2" "$WORK/page.html"
          then ok "$1"; else bad "$1 (missing: $2)" "$WORK/page.html"; fi; }
hasnt() { if grep -qF "$2" "$WORK/page.html"
          then bad "$1 (present: $2)" "$WORK/page.html"; else ok "$1"; fi; }

R=$(get /repo/cat/doc.rst)
[ "$R" = "200 text/html; charset=utf-8" ] && ok "a .rst URL answers 200 text/html" \
  || bad "GET /repo/cat/doc.rst -> '$R'" "$WORK/page.html"
has   "the .rst URL is RENDERED by default"        '<h1 id="doc-title">Doc <em>title</em></h1>'
hasnt "the rendered page carries no painted spans" 'class="tok-'
has   "a section underline becomes the next level" '<h2 id="head-two">Head two</h2>'
has   "a bullet list rides the rendered page"      '<li>a bullet</li>'
has   "an enumerated list rides it too"            '<li>first</li>'
has   "the literal block is a pre, flat inside"    '<pre><code>literal *not emph* stays flat'
has   "a bare prose ref autolinks per wiki/Link.mkd (LITE-043)" ">sub/x.txt</a>"
if grep -q '<a href="[^"]*nosuch.xyz' "$WORK/page.html"
then bad "an unresolved bare ref must stay plain" "$WORK/page.html"
else ok  "an unresolved bare ref stays plain"; fi
has   "the transition is a rule"                   '<hr />'
has   "a relative link carries the RESOLVED href"  '<a href="/repo/cat/sub/x.txt">file</a>'
has   "an .rst target links to its RENDERED page"  '<a href="/repo/cat/sub/other.rst">page</a>'
has   "a directory target links to the list view"  '<a href="/repo/list/sub/">dir</a>'
has   "a named target resolves its absolute url"   '<a href="https://e.org/a?b=1&amp;c=2">out</a>'
hasnt "an unresolvable target is NOT a link"       '>miss</a>'
has   "an unresolvable target stays plain text"    'a miss,'
hasnt "a javascript: link never reaches the page"  'javascript:'
hasnt "source markup never reaches it as markup"   '<script'
has   "source markup reaches it as visible text"   '&lt;script&gt;alert(1)&lt;/script&gt;'
has   "a directive degrades on the served page"    '.. note::'
hasnt "a comment is dropped on the served page"    'a comment that is dropped'
has   "a role degrades to a literal"               '<code>role</code>'
has   "the page offers the source toggle"          '<a href="/repo/raw/doc.rst">source</a>'
has   "the LITE-034 shell wraps the fragment"      '<link rel="stylesheet" href="/style.css">'

R=$(get /repo/raw/doc.rst)
[ "$R" = "200 text/html; charset=utf-8" ] && ok "the toggle URL answers 200 text/html" \
  || bad "GET /repo/raw/doc.rst -> '$R'" "$WORK/page.html"
has   "the toggle serves the PAINTED source"       'class="tok-'
hasnt "the painted source renders no heading"      '<h1 id='
has   "the painted view links back to rendered"    '<a href="/repo/cat/doc.rst">rendered</a>'

get /repo/cat/sub/other.rst > /dev/null
has   "a link out of a subdir resolves against ITS dir" '<a href="/repo/cat/doc.rst">the doc</a>'

get /repo/cat/doc.mkd > /dev/null
has   "a .mkd renders as StrictMark (BEE-032)"     '<h1 id="kept">'
has   "and keeps its painted-source door"          '/repo/raw/doc.mkd'

kill "$SRVPID" 2>/dev/null; SRVPID=""
echo "rst: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
echo "PASS [lite/rst] $CHECKS checks"
