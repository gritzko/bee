#!/bin/sh
#  lite/test/mark/gfm/run.sh — LITE-031: the four GitHub Flavored Markdown
#  extensions on the vendored commonmark.js parser ([/todo/LITE/LITE-030]),
#  exercised through the lite runtime.  Five legs:
#
#   1. the layering — `mark/gfm.js` and its four parts load, and every edit
#      inside the five vendored files carries the LITE-031 code;
#   2. strikethrough — one or two tildes, three or more inert;
#   3. task list items — the CHECKED state on the item node;
#   4. extended autolinks — www / url / email, with the trimming rules;
#   5. tables — the delimiter row, alignment, and inline-only cells.
#
#  ATTRIBUTION.  The Markdown inputs marked `EX n` below are taken from the
#  GitHub Flavored Markdown Spec, version 0.29-gfm (2019-04-06), Copyright (C)
#  2019 GitHub Inc., released under the Creative Commons CC-BY-SA 4.0 license,
#  <http://creativecommons.org/licenses/by-sa/4.0/>; this file is a derivative
#  of it.  `EX n` is the example's number in that spec.  The spec itself is NOT
#  vendored.  The parser under test is BSD-2-Clause, see mark/LICENSE.
#
#  THE ORACLE for every expectation here is the reference C implementation,
#  `cmark-gfm -e strikethrough -e table -e tasklist -e autolink` (0.29.0.gfm.13):
#  the trees below were read off ITS html, not off a second JS parser, and each
#  one was cross-checked against it byte for byte while it was written.  Where
#  cmark-gfm and the prose spec disagree, cmark-gfm wins — noted per case.
#
#  DIVERGENCES from cmark-gfm, deliberate:
#   -  extended autolinks are a sweep over the PARSED text nodes, not an inline
#      matcher, so `*` and `` ` `` inside a bare url end it where cmark-gfm's
#      inline matcher would swallow them.  Adjacent text nodes are joined
#      first, which covers the `&` and unmatched-bracket splits (EX 627).
#   -  the LITE-030 divergences (identity normalizeURI, interim entity table)
#      still hold.
#
#  Standalone: `sh lite/test/mark/gfm/run.sh` from anywhere (it cds itself).
#  $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/mark/gfm
LITE=$(cd "$CASE/../../.." && pwd)               # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "gfm: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "gfm: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "gfm: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-gfm.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "gfm: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
echo "gfm: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — the layering: the extensions are their own files, the vendored five
# carry marked hooks only, and the whole thing loads off the require base
# ==========================================================================
DIRT=$(grep -lE '^(import|export)[ {]|"mdurl|"entities"|minimist|require\("\./' \
       "$LITE"/mark/*.js)
if [ -z "$DIRT" ]
then ok "the gfm files are CJS too, no ESM syntax and no npm dep"
else bad "still ESM or npm-bound: $DIRT"; fi

#  Every hook inside a vendored file must name the ticket, or a vendor.sh
#  re-run cannot be reviewed.  node.js, inlines.js and blocks.js have them;
#  common.js and from-code-point.js are untouched by LITE-031.
HOOKED=0
for f in node inlines blocks; do
    N=$(grep -c 'LITE-031' "$LITE/mark/$f.js")
    [ "$N" -gt 0 ] && HOOKED=$((HOOKED + 1))
done
UNTOUCHED=$(grep -l 'LITE-031' "$LITE/mark/common.js" \
            "$LITE/mark/from-code-point.js" 2>/dev/null)
if [ "$HOOKED" = 3 ] && [ -z "$UNTOUCHED" ]
then ok "the vendored hooks are marked LITE-031, and only three files have any"
else bad "vendored hooks: $HOOKED of 3 marked, stray: $UNTOUCHED"; fi

cat > "$WORK/load.js" <<'LOADJS'
"use strict";
var names = ["gfm", "gfm-strike", "gfm-table", "gfm-tasklist", "gfm-autolink"];
var out = [];
for (var i = 0; i < names.length; i++)
    out.push(names[i] + "=" + typeof require("mark/" + names[i] + ".js"));
out.push("parse=" + typeof new (require("mark/gfm.js"))().parse("x"));
io.writeAll(io.stdout, utf8.Encode(out.join(" ") + "\n"));
LOADJS
GOT=$( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/load.js')" \
       2>"$WORK/load.err" )
WANT="gfm=function gfm-strike=object gfm-table=object gfm-tasklist=function gfm-autolink=function parse=object"
if [ "$GOT" = "$WANT" ]
then ok "gfm.js and its four parts load as mark/gfm*.js"
else bad "module load: '$GOT'" "$WORK/load.err"; fi

# ==========================================================================
# The driver: the same one-line AST sexp as LITE-030's leg, plus the three
# GFM node types and the two GFM node fields (taskChecked, tableAlign as one
# letter per column: l/c/r or `-`, and `head` on the header row).
# ==========================================================================
cat > "$WORK/drv.js" <<'DRVJS'
"use strict";
var Parser = require("mark/gfm.js");
function q(s) {
    return JSON.stringify(s).replace(/[-￿]/g, function (c) {
        return "\\u" + (0x10000 + c.charCodeAt(0)).toString(16).slice(1);
    });
}
function dump(n) {
    var t = n.type, s = "(" + t;
    if (t === "heading") s += " " + n.level;
    else if (t === "list") s += " " + n.listType + (n.listTight ? " tight" : " loose");
    else if (t === "item" && n.taskChecked !== undefined)
        s += n.taskChecked ? " [x]" : " [ ]";
    else if (t === "table")
        s += " " + n.tableAlign.map(function (a) {
            return a === null ? "-" : a[0];
        }).join("");
    else if (t === "table_row" && n.tableHeader) s += " head";
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

# ==========================================================================
# leg 2 — strikethrough: a `~` delimiter run in the emphasis machinery
# ==========================================================================
ex 'EX 491 one tilde and two tildes both strike' \
   '~~Hi~~ Hello, ~there~ world!\n' \
   '(document (paragraph (strikethrough (text "Hi")) (text " Hello, ") (strikethrough (text "there")) (text " world") (text "!")))'
ex 'EX 492 a paragraph break stops the scan' \
   'This ~~has a\n\nnew paragraph~~.\n' \
   '(document (paragraph (text "This ") (text "~~") (text "has a")) (paragraph (text "new paragraph") (text "~~") (text ".")))'
ex 'EX 493 three or more tildes are inert' \
   'This will ~~~not~~~ strike.\n' \
   '(document (paragraph (text "This will ") (text "~~~") (text "not") (text "~~~") (text " strike.")))'
ex 'a run pairs only with a run of its own length' \
   '~~foo~\n' \
   '(document (paragraph (text "~~") (text "foo") (text "~")))'
ex 'an inner unequal run stays literal inside the strike' \
   '~foo~~bar~\n' \
   '(document (paragraph (strikethrough (text "foo") (text "~~") (text "bar"))))'
ex 'strikethrough nests, and nests inside emphasis' \
   '*a ~b ~~c~~ d~*\n' \
   '(document (paragraph (emph (text "a ") (strikethrough (text "b ") (strikethrough (text "c")) (text " d")))))'
ex 'a tilde delimiter beats a crossing emphasis one, as `*` does' \
   '~~foo *bar~~ baz*\n' \
   '(document (paragraph (strikethrough (text "foo ") (text "*") (text "bar")) (text " baz") (text "*")))'
ex 'a lone tilde is text' \
   'a ~ b\n' \
   '(document (paragraph (text "a ") (text "~") (text " b")))'
ex 'a tilde is still verbatim inside a code span' \
   '`~~x~~`\n' \
   '(document (paragraph (code "~~x~~")))'

# ==========================================================================
# leg 3 — task list items: the marker leaves the text, the state goes on the
# node (LITE-031: `[x]` and `[X]` are both CHECKED, and neither is StrictMark's
# `-[x]` wontfix — that mapping is [/todo/LITE/LITE-032]'s)
# ==========================================================================
ex 'EX 279 an unchecked and a checked item' \
   '- [ ] foo\n- [x] bar\n' \
   '(document (list bullet tight (item [ ] (paragraph (text "foo"))) (item [x] (paragraph (text "bar")))))'
ex 'EX 280 task lists nest' \
   '- [x] foo\n  - [ ] bar\n  - [X] baz\n- [ ] bim\n' \
   '(document (list bullet tight (item [x] (paragraph (text "foo")) (list bullet tight (item [ ] (paragraph (text "bar"))) (item [x] (paragraph (text "baz"))))) (item [ ] (paragraph (text "bim")))))'
ex 'an ordered item takes the marker too' \
   '1. [x] done\n' \
   '(document (list ordered tight (item [x] (paragraph (text "done")))))'
ex 'the marker needs a space or tab after it' \
   '- [x]nospace\n' \
   '(document (list bullet tight (item (paragraph (text "[") (text "x") (text "]") (text "nospace")))))'
ex 'a line end after the marker is not that whitespace' \
   '- [x]\n  qux\n' \
   '(document (list bullet tight (item (paragraph (text "[") (text "x") (text "]") (softbreak) (text "qux")))))'
ex 'only a space, x or X between the brackets' \
   '- [y] no\n' \
   '(document (list bullet tight (item (paragraph (text "[") (text "y") (text "]") (text " no")))))'
ex 'the marker must open the FIRST block of the item' \
   '- text\n  [ ] not\n' \
   '(document (list bullet tight (item (paragraph (text "text") (softbreak) (text "[") (text " ") (text "]") (text " not")))))'
ex 'the rest of the item keeps its blocks' \
   '- [x] a\n\n  b\n' \
   '(document (list bullet loose (item [x] (paragraph (text "a")) (paragraph (text "b")))))'

# ==========================================================================
# leg 4 — extended autolinks
# ==========================================================================
ex 'EX 622 a bare www link, with http:// inserted' \
   'www.commonmark.org\n' \
   '(document (paragraph (link "http://www.commonmark.org" (text "www.commonmark.org"))))'
ex 'EX 623 non-space non-< characters follow the domain' \
   'Visit www.commonmark.org/help for more information.\n' \
   '(document (paragraph (text "Visit ") (link "http://www.commonmark.org/help" (text "www.commonmark.org/help")) (text " for more information.")))'
ex 'EX 624 trailing punctuation is trimmed, interior punctuation is not' \
   'Visit www.commonmark.org/a.b.\n' \
   '(document (paragraph (text "Visit ") (link "http://www.commonmark.org/a.b" (text "www.commonmark.org/a.b")) (text ".")))'
ex 'EX 625 an unmatched trailing paren is trimmed, a matched one is kept' \
   'www.google.com/search?q=Markup+(business)))\n' \
   '(document (paragraph (link "http://www.google.com/search?q=Markup+(business)" (text "www.google.com/search?q=Markup+(business)")) (text "))")))'
ex 'EX 625 the balance rule lets an autolink sit inside parens' \
   '(www.google.com/search?q=Markup+(business))\n' \
   '(document (paragraph (text "(") (link "http://www.google.com/search?q=Markup+(business)" (text "www.google.com/search?q=Markup+(business)")) (text ")")))'
ex 'EX 626 interior parens are left alone when the link does not end in one' \
   'www.google.com/search?q=(business))+ok\n' \
   '(document (paragraph (link "http://www.google.com/search?q=(business))+ok" (text "www.google.com/search?q=(business))+ok"))))'
ex 'EX 627 an `&name=` tail is part of the link' \
   'www.google.com/search?q=commonmark&hl=en\n' \
   '(document (paragraph (link "http://www.google.com/search?q=commonmark&hl=en" (text "www.google.com/search?q=commonmark&hl=en"))))'
ex 'EX 627 an `&name;` tail is not' \
   'www.google.com/search?q=commonmark&hl;\n' \
   '(document (paragraph (link "http://www.google.com/search?q=commonmark" (text "www.google.com/search?q=commonmark")) (text "&hl;")))'
ex 'EX 628 a `<` ends the autolink' \
   'www.commonmark.org/he<lp\n' \
   '(document (paragraph (link "http://www.commonmark.org/he" (text "www.commonmark.org/he")) (text "<lp")))'
ex 'EX 629 the http and https schemes, with the paren balance' \
   'http://commonmark.org\n\n(Visit https://encrypted.google.com/search?q=Markup+(business))\n' \
   '(document (paragraph (link "http://commonmark.org" (text "http://commonmark.org"))) (paragraph (text "(Visit ") (link "https://encrypted.google.com/search?q=Markup+(business)" (text "https://encrypted.google.com/search?q=Markup+(business)")) (text ")")))'
ex 'EX 630 an email, with mailto: inserted' \
   'foo@bar.baz\n' \
   '(document (paragraph (link "mailto:foo@bar.baz" (text "foo@bar.baz"))))'
ex 'EX 631 a + may precede the @ but not follow it' \
   'hello@mail+xyz.example is not valid, but hello+xyz@mail.example is.\n' \
   '(document (paragraph (text "hello@mail+xyz.example is not valid, but ") (link "mailto:hello+xyz@mail.example" (text "hello+xyz@mail.example")) (text " is.")))'
ex 'EX 632 a trailing dot is trimmed off an email' \
   'a.b-c_d@a.b.\n' \
   '(document (paragraph (link "mailto:a.b-c_d@a.b" (text "a.b-c_d@a.b")) (text ".")))'
ex 'EX 632 a trailing - or _ makes it no email at all' \
   'a.b-c_d@a.b-\n' \
   '(document (paragraph (text "a.b-c") (text "_") (text "d@a.b-")))'
ex 'EX 633 the mailto: and xmpp: protocols are kept as the scheme' \
   'mailto:a.b-c_d@a.b/\n\nxmpp:foo@bar.baz/txt\n' \
   '(document (paragraph (link "mailto:a.b-c_d@a.b" (text "mailto:a.b-c_d@a.b")) (text "/")) (paragraph (link "xmpp:foo@bar.baz/txt" (text "xmpp:foo@bar.baz/txt"))))'
ex 'no underscore in the last two segments of the domain' \
   'www.x www.xxx.yyy._zzz www._xxx.yyy.zzz\n' \
   '(document (paragraph (link "http://www.x" (text "www.x")) (text " www.xxx.yyy._zzz ") (link "http://www._xxx.yyy.zzz" (text "www._xxx.yyy.zzz"))))'
ex 'a www link only after a line start, whitespace, or one of *_~(' \
   'x www.a.com y=www.b.com\n' \
   '(document (paragraph (text "x ") (link "http://www.a.com" (text "www.a.com")) (text " y=www.b.com")))'
ex 'no autolink inside a link, and none inside a code span' \
   '[www.a.com](/x) and `www.b.com`\n' \
   '(document (paragraph (link "/x" (text "www.a.com")) (text " and ") (code "www.b.com")))'

# ==========================================================================
# leg 5 — tables: header row, delimiter row, data rows, inline-only cells
# ==========================================================================
ex 'EX 198 a table is header, delimiter and data rows' \
   '| foo | bar |\n| --- | --- |\n| baz | bim |\n' \
   '(document (table -- (table_row head (table_cell (text "foo")) (table_cell (text "bar"))) (table_row (table_cell (text "baz")) (table_cell (text "bim")))))'
ex 'EX 199 the colons give the alignment, the pipes may be ragged' \
   '| abc | defghi |\n:-: | -----------:\nbar | baz\n' \
   '(document (table cr (table_row head (table_cell (text "abc")) (table_cell (text "defghi"))) (table_row (table_cell (text "bar")) (table_cell (text "baz")))))'
ex 'EX 200 an escaped pipe is cell content, inside a span as well' \
   '| f\\|oo  |\n| ------ |\n| b `\\|` az |\n| b **\\|** im |\n' \
   '(document (table - (table_row head (table_cell (text "f|oo"))) (table_row (table_cell (text "b ") (code "|") (text " az"))) (table_row (table_cell (text "b ") (strong (text "|")) (text " im")))))'
ex 'EX 201 another block structure breaks the table' \
   '| abc | def |\n| --- | --- |\n| bar | baz |\n> bar\n' \
   '(document (table -- (table_row head (table_cell (text "abc")) (table_cell (text "def"))) (table_row (table_cell (text "bar")) (table_cell (text "baz")))) (block_quote (paragraph (text "bar"))))'
ex 'EX 202 a pipeless line is still a row, a blank line ends the table' \
   '| abc | def |\n| --- | --- |\nbar\n\nbar\n' \
   '(document (table -- (table_row head (table_cell (text "abc")) (table_cell (text "def"))) (table_row (table_cell (text "bar")) (table_cell))) (paragraph (text "bar")))'
ex 'EX 203 header and delimiter cell counts must match' \
   '| abc | def |\n| --- |\n| bar |\n' \
   '(document (paragraph (text "| abc | def |") (softbreak) (text "| --- |") (softbreak) (text "| bar |")))'
ex 'EX 204 a short row is padded, a long one is cut' \
   '| abc | def |\n| --- | --- |\n| bar |\n| bar | baz | boo |\n' \
   '(document (table -- (table_row head (table_cell (text "abc")) (table_cell (text "def"))) (table_row (table_cell (text "bar")) (table_cell)) (table_row (table_cell (text "bar")) (table_cell (text "baz")))))'
ex 'EX 205 a header alone is a table' \
   '| abc | def |\n| --- | --- |\n' \
   '(document (table -- (table_row head (table_cell (text "abc")) (table_cell (text "def")))))'
ex 'the line above the delimiter row is the header, the rest stays a paragraph' \
   'lead in\n| a | b |\n| - | - |\n| 1 | 2 |\n' \
   '(document (paragraph (text "lead in")) (table -- (table_row head (table_cell (text "a")) (table_cell (text "b"))) (table_row (table_cell (text "1")) (table_cell (text "2")))))'
ex 'a table nests inside a quote and inside a list item' \
   '> | a |\n> | - |\n\n- | b |\n  | - |\n' \
   '(document (block_quote (table - (table_row head (table_cell (text "a"))))) (list bullet tight (item (table - (table_row head (table_cell (text "b")))))))'
ex 'cells take inlines, never blocks' \
   '| *a* | [b](/u) |\n| --- | --- |\n| # c | ~~d~~ |\n' \
   '(document (table -- (table_row head (table_cell (emph (text "a"))) (table_cell (link "/u" (text "b")))) (table_row (table_cell (text "# c")) (table_cell (strikethrough (text "d"))))))'

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/mark/gfm] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/mark/gfm] $CHECKS checks, runtime $RT"
exit 0
