#!/bin/sh
#  lite/test/mark/run.sh — LITE-030: the vendored commonmark.js 0.31.2 parse
#  half (`mark/`), exercised through the lite runtime.  Two legs:
#
#   1. the vendoring — the five files load as `require("mark/...")`, with no
#      ESM syntax and no npm name left in them;
#   2. conformance — spec examples parsed and dumped as a one-line AST sexp,
#      covering the block stack (headings, code, html, quotes, lists and their
#      nesting) and the inline precedence (code > raw html > links > emphasis),
#      not the long tail.  `EX n` is the example's number in the spec.
#
#  ATTRIBUTION.  The Markdown inputs below are taken from the CommonMark spec
#  (test/spec.txt, version 0.31.2), Copyright (C) 2014-15 John MacFarlane,
#  released under the Creative Commons CC-BY-SA 4.0 license,
#  <http://creativecommons.org/licenses/by-sa/4.0/>; this file is a derivative
#  of it.  spec.txt itself is NOT vendored, and the expected trees are ours,
#  read off the spec's expected HTML.  The parser under test is BSD-2-Clause,
#  see mark/LICENSE.
#
#  DIVERGENCES from upstream commonmark.js, both deliberate (LITE-030) and
#  both pinned by a check below:
#   -  normalizeURI is the identity (no mdurl), so a link destination keeps its
#      source bytes: EX 489 gives `/my uri` where upstream gives `/my%20uri`.
#   -  the entity table is INTERIM: numeric references in full plus a short
#      named table, every other `&name;` verbatim — `&Dcaron;` does not decode.
#
#  Standalone: `sh lite/test/mark/run.sh` from anywhere (it cds itself).
#  $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/mark
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "mark: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "mark: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "mark: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-mark.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "mark: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
echo "mark: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — the vendoring: nothing ESM, no npm name and no file-relative
# specifier survived vendor.sh, and all five modules load off the base
# ==========================================================================
DIRT=$(grep -lE '^(import|export)[ {]|"mdurl|"entities"|minimist|require\("\./' \
       "$LITE"/mark/*.js)
if [ -z "$DIRT" ]
then ok "the five vendored files carry no ESM syntax and no npm dep"
else bad "still ESM or npm-bound: $DIRT"; fi

cat > "$WORK/load.js" <<'LOADJS'
"use strict";
var names = ["node", "common", "inlines", "blocks", "from-code-point"];
var out = [];
for (var i = 0; i < names.length; i++)
    out.push(names[i] + "=" + typeof require("mark/" + names[i] + ".js"));
out.push("parse=" + typeof new (require("mark/blocks.js"))().parse("x"));
io.writeAll(io.stdout, utf8.Encode(out.join(" ") + "\n"));
LOADJS
GOT=$( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/load.js')" \
       2>"$WORK/load.err" )
WANT="node=function common=object inlines=function blocks=function from-code-point=function parse=object"
if [ "$GOT" = "$WANT" ]
then ok "all five modules load off the require base as mark/*.js"
else bad "module load: '$GOT'" "$WORK/load.err"; fi

# ==========================================================================
# leg 2 — conformance.  The driver parses $WORK/in.md and prints the AST as
# one sexp line: containers nest, leaves carry their literal, and the few
# attributes that matter (level, list kind/tightness/start, info, dest/title).
# Non-ASCII is escaped \uXXXX so the expectations below stay plain ASCII.
# ==========================================================================
cat > "$WORK/drv.js" <<'DRVJS'
"use strict";
var Parser = require("mark/blocks.js");
function q(s) {
    return JSON.stringify(s).replace(/[\u0080-\uffff]/g, function (c) {
        return "\\u" + (0x10000 + c.charCodeAt(0)).toString(16).slice(1);
    });
}
function dump(n) {
    var t = n.type, s = "(" + t;
    if (t === "heading") s += " " + n.level;
    else if (t === "list") {
        s += " " + n.listType + (n.listTight ? " tight" : " loose");
        if (n.listType === "ordered")
            s += " start=" + n.listStart + " delim=" + n.listDelimiter;
    } else if (t === "code_block") { if (n.info) s += " info=" + q(n.info); }
    else if (t === "link" || t === "image")
        s += " " + q(n.destination) + (n.title ? " " + q(n.title) : "");
    if (n.literal !== null && n.literal !== undefined) s += " " + q(n.literal);
    for (var c = n.firstChild; c; c = c.next) s += " " + dump(c);
    return s + ")";
}
var doc = new Parser().parse(utf8.Decode(io.mmap("in.md", "r").data()));
io.writeAll(io.stdout, utf8.Encode(dump(doc) + "\n"));   // io.log goes to stderr
DRVJS

#  ex <label> <markdown: \n for a line end, \\ for a literal backslash> <want>
ex() {
    printf '%b' "$2" > "$WORK/in.md"
    _got=$( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval \
            "require('$WORK/drv.js')" 2>"$WORK/ex.err" )
    if [ "$_got" = "$3" ]
    then ok "$1"
    else echo "  want $3"; echo "  got  $_got"
         bad "$1" "$WORK/in.md" "$WORK/ex.err"; fi
}

# ---- backslash escapes and character references --------------------------
ex 'EX 15 an escaped backslash still opens emphasis' \
   '\\\\*emphasis*\n' \
   '(document (paragraph (text "\\") (emph (text "emphasis"))))'
ex 'EX 13 a backslash before a non-punctuation char is literal' \
   '\\A\\a\\3\n' \
   '(document (paragraph (text "\\") (text "A") (text "\\") (text "a") (text "\\") (text "3")))'
ex 'EX 26 numeric references, decimal, and NUL to U+FFFD' \
   'foo &#35; &#1234; &#0; bar\n' \
   '(document (paragraph (text "foo ") (text "#") (text " ") (text "\u04d2") (text " ") (text "\ufffd") (text " bar")))'
ex 'hex references, either case of the x' \
   '&#X22; &#xa9;\n' \
   '(document (paragraph (text "\"") (text " ") (text "\u00a9")))'
ex 'EX 25 named references, the interim table' \
   '&nbsp; &amp; &copy; &AElig;\n' \
   '(document (paragraph (text "\u00a0") (text " ") (text "&") (text " ") (text "\u00a9") (text " ") (text "\u00c6")))'
ex 'EX 30 an unknown name stays verbatim, and so does &Dcaron; -- DIVERGENCE' \
   '&MadeUpEntity; &Dcaron;\n' \
   '(document (paragraph (text "&MadeUpEntity;") (text " ") (text "&Dcaron;")))'
ex 'EX 28 malformed references are not references' \
   '&nbsp &x; &#; &#x;\n&#87654321;\n' \
   '(document (paragraph (text "&") (text "nbsp ") (text "&") (text "x; ") (text "&") (text "#; ") (text "&") (text "#x;") (softbreak) (text "&") (text "#87654321;")))'
# ---- leaf blocks: rules, headings, code, html ----------------------------
ex 'EX 43 the three thematic-break characters' \
   '***\n---\n___\n' \
   '(document (thematic_break) (thematic_break) (thematic_break))'
ex 'EX 62 ATX headings, all six levels' \
   '# foo\n## foo\n### foo\n#### foo\n##### foo\n###### foo\n' \
   '(document (heading 1 (text "foo")) (heading 2 (text "foo")) (heading 3 (text "foo")) (heading 4 (text "foo")) (heading 5 (text "foo")) (heading 6 (text "foo")))'
ex 'EX 64 a hash with no space is not a heading' \
   '#5 bolt\n\n#hashtag\n' \
   '(document (paragraph (text "#5 bolt")) (paragraph (text "#hashtag")))'
ex 'EX 66 heading text takes inlines and escapes' \
   '# foo *bar* \\*baz\\*\n' \
   '(document (heading 1 (text "foo ") (emph (text "bar")) (text " ") (text "*") (text "baz") (text "*")))'
ex 'EX 71 a closing sequence and the leading indent are stripped' \
   '## foo ##\n  ###   bar    ###\n' \
   '(document (heading 2 (text "foo")) (heading 3 (text "bar")))'
ex 'EX 79 empty ATX headings' \
   '## \n#\n### ###\n' \
   '(document (heading 2) (heading 1) (heading 3))'
ex 'EX 80 setext headings take the paragraph as their text' \
   'Foo *bar*\n=========\n\nFoo *bar*\n---------\n' \
   '(document (heading 1 (text "Foo ") (emph (text "bar"))) (heading 2 (text "Foo ") (emph (text "bar"))))'
ex 'EX 107 an indented code block keeps its extra indent' \
   '    a simple\n      indented code block\n' \
   '(document (code_block "a simple\n  indented code block\n"))'
ex 'EX 119 a fenced code block is verbatim' \
   '```\n<\n >\n```\n' \
   '(document (code_block "<\n >\n"))'
ex 'EX 124 a shorter backtick run inside a longer fence is content' \
   '````\naaa\n```\n``````\n' \
   '(document (code_block "aaa\n```\n"))'
ex 'EX 132 the fence indent is stripped from the content lines' \
   '  ```\naaa\n  aaa\naaa\n  ```\n' \
   '(document (code_block "aaa\naaa\naaa\n"))'
ex 'EX 142 the info string' \
   '```ruby\ndef foo(x)\n  return 3\nend\n```\n' \
   '(document (code_block info="ruby" "def foo(x)\n  return 3\nend\n"))'
ex 'EX 163 an html block runs to the blank line, verbatim' \
   '<Warning>\n*bar*\n</Warning>\n' \
   '(document (html_block "<Warning>\n*bar*\n</Warning>"))'
ex 'EX 148 a type-6 html block ends at the blank line, then inlines resume' \
   '<table><tr><td>\n<pre>\n**Hello**,\n\n_world_.\n</pre>\n</td></tr></table>\n' \
   '(document (html_block "<table><tr><td>\n<pre>\n**Hello**,") (paragraph (emph (text "world")) (text ".") (softbreak) (html_inline "</pre>")) (html_block "</td></tr></table>"))'
# ---- paragraphs, blank lines, breaks -------------------------------------
ex 'EX 219 a blank line separates paragraphs' \
   'aaa\n\nbbb\n' \
   '(document (paragraph (text "aaa")) (paragraph (text "bbb")))'
ex 'EX 227 blank and whitespace-only lines produce no node' \
   '  \n\naaa\n  \n\n# aaa\n\n  \n' \
   '(document (paragraph (text "aaa")) (heading 1 (text "aaa")))'
ex 'EX 648 a line end inside a paragraph is a softbreak' \
   'foo\nbaz\n' \
   '(document (paragraph (text "foo") (softbreak) (text "baz")))'
ex 'EX 633 two trailing spaces are a hard line break' \
   'foo  \nbaz\n' \
   '(document (paragraph (text "foo") (linebreak) (text "baz")))'
# ---- container blocks: quotes, list items, lists -------------------------
ex 'EX 228 a block quote holds a whole block stack' \
   '> # Foo\n> bar\n> baz\n' \
   '(document (block_quote (heading 1 (text "Foo")) (paragraph (text "bar") (softbreak) (text "baz"))))'
ex 'EX 230 the quote marker may be indented and may wobble' \
   '   > # Foo\n   > bar\n > baz\n' \
   '(document (block_quote (heading 1 (text "Foo")) (paragraph (text "bar") (softbreak) (text "baz"))))'
ex 'EX 240 a quote of blank lines is an empty quote' \
   '>\n>  \n> \n' \
   '(document (block_quote))'
ex 'EX 253 leaf blocks at the document level, side by side' \
   'A paragraph\nwith two lines.\n\n    indented code\n\n> A block quote.\n' \
   '(document (paragraph (text "A paragraph") (softbreak) (text "with two lines.")) (code_block "indented code\n") (block_quote (paragraph (text "A block quote."))))'
ex 'EX 270 an item holds a code block at the item indent' \
   '- foo\n\n      bar\n' \
   '(document (list bullet loose (item (paragraph (text "foo")) (code_block "bar\n"))))'
ex 'EX 288 an ordered item holds the same stack, indented to its content' \
   '   1.  A paragraph\n       with two lines.\n\n           indented code\n\n       > A block quote.\n' \
   '(document (list ordered loose start=1 delim=. (item (paragraph (text "A paragraph") (softbreak) (text "with two lines.")) (code_block "indented code\n") (block_quote (paragraph (text "A block quote."))))))'
ex 'EX 301 changing the bullet character starts a new list' \
   '- foo\n- bar\n+ baz\n' \
   '(document (list bullet tight (item (paragraph (text "foo"))) (item (paragraph (text "bar")))) (list bullet tight (item (paragraph (text "baz")))))'
ex 'EX 305 an ordered list interrupts a paragraph only at 1.' \
   'The number of windows in my house is\n1.  The number of doors is 6.\n' \
   '(document (paragraph (text "The number of windows in my house is")) (list ordered tight start=1 delim=. (item (paragraph (text "The number of doors is 6.")))))'
ex 'EX 306 a blank line between items makes the list loose' \
   '- foo\n\n- bar\n\n\n- baz\n' \
   '(document (list bullet loose (item (paragraph (text "foo"))) (item (paragraph (text "bar"))) (item (paragraph (text "baz")))))'
ex 'EX 307 nested lists, tightness decided per list' \
   '- foo\n  - bar\n    - baz\n\n\n      bim\n' \
   '(document (list bullet tight (item (paragraph (text "foo")) (list bullet tight (item (paragraph (text "bar")) (list bullet loose (item (paragraph (text "baz")) (paragraph (text "bim")))))))))'
ex 'EX 320 a quote inside an item, and the item after it' \
   '* a\n  > b\n  >\n* c\n' \
   '(document (list bullet tight (item (paragraph (text "a")) (block_quote (paragraph (text "b")))) (item (paragraph (text "c")))))'
ex 'EX 175 an html block inside a list item' \
   '- <div>\n- foo\n' \
   '(document (list bullet tight (item (html_block "<div>")) (item (paragraph (text "foo")))))'
# ---- inlines: code spans, raw html, emphasis, links, images --------------
ex 'EX 328 a code span' \
   '`foo`\n' \
   '(document (paragraph (code "foo")))'
ex 'EX 335 a code span folds its line ends into spaces' \
   '``\nfoo\nbar  \nbaz\n``\n' \
   '(document (paragraph (code "foo bar   baz")))'
ex 'EX 342 a code span beats a link bracket' \
   '[not a `link](/foo`)\n' \
   '(document (paragraph (text "[") (text "not a ") (code "link](/foo") (text ")")))'
ex 'EX 343 a code span beats raw html' \
   '`<a href="`">`\n' \
   '(document (paragraph (code "<a href=\"") (text "\"") (text ">") (text "`")))'
ex 'EX 344 raw html beats a code span the other way round' \
   '<a href="`">`\n' \
   '(document (paragraph (html_inline "<a href=\"`\">") (text "`")))'
ex 'EX 613 raw inline html tags' \
   '<a><bab><c2c>\n' \
   '(document (paragraph (html_inline "<a>") (html_inline "<bab>") (html_inline "<c2c>")))'
ex 'EX 350 emphasis' \
   '*foo bar*\n' \
   '(document (paragraph (emph (text "foo bar"))))'
ex 'EX 358 an opener followed by whitespace does not open' \
   '_ foo bar_\n' \
   '(document (paragraph (text "_") (text " foo bar") (text "_")))'
ex 'EX 402 intraword underscore runs stay literal inside strong' \
   '__foo__bar__baz__\n' \
   '(document (paragraph (strong (text "foo") (text "__") (text "bar") (text "__") (text "baz"))))'
ex 'EX 403 strong emphasis' \
   '__(bar)__.\n' \
   '(document (paragraph (strong (text "(bar)")) (text ".")))'
ex 'EX 411 strong nests inside emphasis' \
   '*foo**bar**baz*\n' \
   '(document (paragraph (emph (text "foo") (strong (text "bar")) (text "baz"))))'
ex 'EX 412 an unmatched run stays literal inside the emphasis' \
   '*foo**bar*\n' \
   '(document (paragraph (emph (text "foo") (text "**") (text "bar"))))'
ex 'EX 421 a bare delimiter run is not empty emphasis' \
   '**** is not an empty strong emphasis\n' \
   '(document (paragraph (text "****") (text " is not an empty strong emphasis")))'
ex 'EX 482 an inline link with a title' \
   '[link](/uri "title")\n' \
   '(document (paragraph (link "/uri" "title" (text "link"))))'
ex 'EX 486 an empty destination' \
   '[link](<>)\n' \
   '(document (paragraph (link "" (text "link"))))'
ex 'EX 495 an escaped paren in the destination' \
   '[link](\\(foo\\))\n' \
   '(document (paragraph (link "(foo)" (text "link"))))'
ex 'EX 489 a pointy-bracket destination keeps its space -- DIVERGENCE, no mdurl' \
   '[link](</my uri>)\n' \
   '(document (paragraph (link "/my uri" (text "link"))))'
ex 'EX 192 a link reference definition, used by a shortcut reference' \
   '[foo]: /url "title"\n\n[foo]\n' \
   '(document (paragraph (link "/url" "title" (text "foo"))))'
ex 'EX 555 a collapsed reference, matched case-insensitively' \
   '[Foo][]\n\n[foo]: /url "title"\n' \
   '(document (paragraph (link "/url" "title" (text "Foo"))))'
ex 'EX 559 a full reference whose label carries inlines' \
   '[[*foo* bar]]\n\n[*foo* bar]: /url "title"\n' \
   '(document (paragraph (text "[") (link "/url" "title" (emph (text "foo")) (text " bar")) (text "]")))'
ex 'EX 535 a link beats emphasis that would cross it' \
   '[foo *bar][ref]*\n\n[ref]: /uri\n' \
   '(document (paragraph (link "/uri" (text "foo ") (text "*") (text "bar")) (text "*")))'
ex 'EX 552 a definition needs its label on one line' \
   '[\n ]\n\n[\n ]: /uri\n' \
   '(document (paragraph (text "[") (softbreak) (text "]")) (paragraph (text "[") (softbreak) (text "]") (text ": /uri")))'
ex 'EX 572 an image' \
   '![foo](/url "title")\n' \
   '(document (paragraph (image "/url" "title" (text "foo"))))'
ex 'EX 594 an autolink' \
   '<http://foo.bar.baz>\n' \
   '(document (paragraph (link "http://foo.bar.baz" (text "http://foo.bar.baz"))))'
ex 'EX 596 an autolink of a non-http scheme' \
   '<irc://foo.bar:2233/baz>\n' \
   '(document (paragraph (link "irc://foo.bar:2233/baz" (text "irc://foo.bar:2233/baz"))))'
ex 'EX 607 empty pointy brackets are not an autolink' \
   '<>\n' \
   '(document (paragraph (text "<") (text ">")))'
ex 'EX 526 an autolink beats a link bracket' \
   '[foo<https://example.com/?search=](uri)>\n' \
   '(document (paragraph (text "[") (text "foo") (link "https://example.com/?search=](uri)" (text "https://example.com/?search=](uri)"))))'

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/mark] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/mark] $CHECKS checks, runtime $RT"
exit 0
