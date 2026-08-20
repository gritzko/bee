#!/bin/sh
# bee/test/markverb/run.sh — `bee mark <page>`: ONE rendered page on stdout, the
# beagle mark CLI's job (beagle/mark/README.mkd) with the writing left to the
# shell.  Three legs:
#
#   1. the page — a whole document (doctype, the site's hardcoded stylesheet
#      link, the emitted body), titled by the file's own name;
#   2. the links — a `.mkd`/`.md`/`.rst` destination takes the `.html` rendered
#      beside it, an absolute url and a plain file ride verbatim;
#   3. the refusals — plain words on stderr, NOTHING on stdout, non-zero rc.
#
# Standalone: `sh bee/test/markverb/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/markverb
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "markverb: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "markverb: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "markverb: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-markverb.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "markverb: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
lite() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" mark "$@" ); }
echo "markverb: runtime $RT, fixtures $WORK"

# BEE-032: the fixture speaks StrictMark — reference links only (the dialect
# has no inline `[text](url)` form), and `*` spells strong, not em.
cat > "$WORK/page.mkd" <<'MKD'
#   The page

Hello *world*, see [the abc][a], [a note][n], [the source][s]
and [away][w].

 -  a bullet

[a]: abc.mkd
[n]: sub/n.md
[s]: main.js
[w]: http://elsewhere/z.mkd#frag
MKD
: > "$WORK/empty.mkd"
printf 'Title\n=====\n\nSee `the abc <abc.rst>`_ here.\n' > "$WORK/p.rst"

# ==========================================================================
# leg 1 — the page: one self-contained document, titled by the file name
# ==========================================================================
lite page.mkd > "$WORK/p.out" 2>"$WORK/p.err"; RC=$?
if [ "$RC" = 0 ] && [ -s "$WORK/p.out" ]
then ok "\`bee mark page.mkd\` writes a page, rc 0"
else bad "mark page.mkd (rc $RC)" "$WORK/p.out" "$WORK/p.err"; fi
for want in '^<!DOCTYPE html>$' '<title>page</title>' '<h1 id="the-page">The page</h1>' '<strong>world</strong>' '</body></html>'; do
    if grep -q "$want" "$WORK/p.out"
    then ok "the page carries $want"
    else bad "no $want in the page" "$WORK/p.out"; fi
done
# The site's stylesheet, hardcoded — and NONE of bee's own terminal palette.
if grep -q '<link rel="stylesheet" href="/assets/css/style.css">' "$WORK/p.out" &&
   ! grep -q '<style>\|class="mark"\|class="hunk"' "$WORK/p.out"
then ok "the head links /assets/css/style.css, and no palette is inlined"
else bad "the stylesheet link is wrong" "$WORK/p.out"; fi
# An EMPTY page renders empty and still rc 0 — mmap of zero bytes maps nothing.
lite empty.mkd > "$WORK/e.out" 2>"$WORK/e.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '<body>$' "$WORK/e.out"
then ok "an EMPTY page renders as an empty body, rc 0"
else bad "empty page (rc $RC)" "$WORK/e.out" "$WORK/e.err"; fi
# The reST dialect goes through the same emitter, off its own parser.
lite p.rst > "$WORK/r.out" 2>"$WORK/r.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '<h1 id="title">Title</h1>' "$WORK/r.out"
then ok "an .rst page renders through the same emitter"
else bad "mark p.rst (rc $RC)" "$WORK/r.out" "$WORK/r.err"; fi

# ==========================================================================
# leg 2 — the links: a PAGE link takes the .html rendered beside it, every
# other destination rides verbatim (there is no door in a dump)
# ==========================================================================
link() {   # link <label> <want-href>
    if grep -q "$2" "$WORK/p.out"
    then ok "$1"
    else bad "$1: no $2" "$WORK/p.out"; fi
}
link "a .mkd reference link becomes .html"   'href="abc.html">the abc<'
link "a .md link in a subdir keeps its dir"  'href="sub/n.html">a note<'
link "a plain file link is verbatim"         'href="main.js">the source<'
link "an absolute url is verbatim, fragment and all" \
     'href="http://elsewhere/z.mkd#frag">away<'
# The .rst link swap is the same one, off the same table.
link_rst() { grep -q 'href="abc.html">the abc<' "$WORK/r.out"; }
if link_rst
then ok "an .rst destination becomes .html too"
else bad "the .rst link was not swapped" "$WORK/r.out"; fi

# ==========================================================================
# leg 3 — the refusals: plain words on stderr, nothing on stdout, non-zero rc
# ==========================================================================
refuse() {   # refuse <label> <words> [arg...]
    _lbl=$1; _words=$2; shift 2
    lite "$@" > "$WORK/x.out" 2>"$WORK/x.err"; _rc=$?
    if [ "$_rc" != 0 ] && [ ! -s "$WORK/x.out" ] && grep -q "$_words" "$WORK/x.err"
    then ok "refused in plain words: $_lbl"
    else bad "$_lbl (rc $_rc)" "$WORK/x.out" "$WORK/x.err"; fi
}
refuse "no page named"       "needs ONE page"       --plain
refuse "two pages, one stdout" "needs ONE page"     page.mkd empty.mkd
refuse "a file that is no page" "is no .mkd, .md or .rst page" main.js
refuse "a page that is not there" "there is no readable" gone.mkd

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/markverb] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/markverb] $CHECKS checks, runtime $RT"
exit 0
