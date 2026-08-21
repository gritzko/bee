#!/bin/sh
# bee/test/strict/run.sh — BEE-032: a `.mkd` page is StrictMark, not CommonMark.
# Before the fix `bee mark` fed `.mkd` to the CommonMark parser — a `Key: value`
# meta pair under a heading came out an indented CODE BLOCK, a `[Page]` shortcut
# stayed dead brackets — and `http cat` served the page as painted source, with
# no rendered heading at all.  Three legs:
#
#   1. the verb — `bee mark page.mkd` renders StrictMark: meta pairs, shortcut
#      and reference links, `*strong*`/`_emph_`/`~del~`, lists, quotes, fences;
#   2. the server — `GET /repo/cat/page.mkd` renders the same page and resolves
#      its links through the door, the `.md` neighbour untouched;
#   3. the dialects — a `.md` and a `.rst` page render as they always did, and
#      BEE-029's YAML preamble rule still holds on a `.mkd`.
#
# Standalone: `sh bee/test/strict/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/strict
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "strict: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "strict: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "strict: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-strict.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "strict: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
lite() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" mark "$@" ); }
echo "strict: runtime $RT, fixtures $WORK"

# The page: a ticket-shaped head (meta pairs under the H1), the two link cases,
# the inline set, a bullet list, a quote and a fenced block.
cat > "$WORK/page.mkd" <<'MKD'
#   Page Title
    Now: OPEN
    Sev: MED

Some *strong* and _emph_ and ~del~ text, a [Target] shortcut, an
[explicit link][1] and a `code` span.

 -  a bullet item
 -  another one

>   a quoted line

````js
    code();
````

[1]: http://example.com/ "the title"
MKD
# The page the shortcut names — the door must find it.
printf '#   Target\n\nthe target page\n' > "$WORK/Target.mkd"
# A `.md` neighbour: CommonMark, and it must render exactly as it always did.
printf '#   Md Page\n\n*not strong* but **strong**, and [dead] brackets.\n' \
  > "$WORK/plain.md"
# BEE-029's rule on a `.mkd`: the preamble is metadata, never a ruler.
printf -- '---\nlayout: post\n---\n\n#   Fronted\n\nbody text\n' > "$WORK/front.mkd"

# ==========================================================================
# leg 1 — the verb: `bee mark page.mkd` renders StrictMark
# ==========================================================================
run() {   # run <file> -> $WORK/out
    lite "$1" > "$WORK/out" 2>"$WORK/err"; RC=$?
    [ "$RC" = 0 ] || bad "mark $1 (rc $RC)" "$WORK/out" "$WORK/err"
}
#  BEE-052: the rendered page now wraps its prose in `<span id="b<byte>">`
#  anchors so a permalink can land in it, so these checks read the page with
#  that plumbing stripped: what they pin is the MARKUP SHAPE, and the anchors
#  themselves are pinned on their own below.  `hasraw` reads the bytes as served.
bare()  { sed -e 's/<span[^>]*>//g' -e 's|</span>||g' -e 's/ id="b[0-9]*"//g' "$1"; }
hasraw() { if grep -qF "$2" "$WORK/out"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/out"; fi; }
has()   { if bare "$WORK/out" | grep -qF "$2"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/out"; fi; }
hasnt() { if bare "$WORK/out" | grep -qF "$2"; then bad "$1 — '$2' is there" "$WORK/out"; else ok "$1"; fi; }

run page.mkd
has   "the H1 opener renders"              '<h1 id="page-title">Page Title</h1>'
#  BEE-052: and the page is a LANDING PLACE — every block and every token of
#  prose wears `id="b<byte>"`, the ONE fragment a reference speaks
#  (render/html.js:135:AW), so a permalink into a rendered `.mkd` lands where it
#  points instead of at the top.  The H1's own byte is its LINE's first, quad
#  included; `.mark :target` is what makes the landing show.
hasraw "the H1 anchors on the byte its line begins at" '<h1 id="page-title"><span id="b0">'
hasraw "a word of prose is addressable on its own"     '<span id="b4">Page</span>'
hasraw "a meta key answers for its own line"           '<dt id="b15">'
hasraw "inline markup answers for its delimiter"       '<strong id="b48">'
has   "a meta pair is a key"               "<dt>Now</dt>"
has   "a meta pair is a value"             "<dd>OPEN</dd>"
has   "the second meta pair too"           "<dt>Sev</dt>"
hasnt "a meta pair is no code block"       "<pre><code>Now: OPEN"
hasnt "a meta pair is no prose"            "<p>Now: OPEN"
has   "one star is strong"                 "<strong>strong</strong>"
has   "one underscore is emphasis"         "<em>emph</em>"
has   "one tilde is a deletion"            "<del>del</del>"
has   "a code span is code"                "<code>code</code>"
has   "a shortcut resolves to its page"    '<a href="Target.html">Target</a>'
hasnt "a shortcut leaves no brackets"      "[Target]"
has   "a reference link takes its url"     'href="http://example.com/"'
has   "a reference link takes its title"   'title="the title"'
hasnt "a reference definition is no prose" "http://example.com/ &quot;"
has   "a bullet list opens"                "<ul>"
has   "a bullet item renders"              "<li>a bullet item</li>"
has   "a quote renders"                    "<blockquote>"
has   "a fence renders as code"            '<pre><code class="language-js">'
has   "the fenced body is dedented"        ">code();"

run front.mkd
hasnt "BEE-029: the preamble leaves no ruler"   "<hr />"
hasnt "BEE-029: the preamble is not rendered"   "layout: post"
has   "BEE-029: the .mkd body still renders"    '<h1 id="fronted">Fronted</h1>'

run plain.md
has   "a .md page is still CommonMark"          "<strong>strong</strong>"
has   "a .md single star is still emphasis"     "<em>not strong</em>"
has   "a .md dead shortcut keeps its brackets"  "[dead]"

# ==========================================================================
# leg 2 — the server: `GET /repo/cat/page.mkd` renders, and links go by door
# ==========================================================================
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    echo "strict: SKIP the http leg — no git or no curl" >&2
else
REPO="$WORK/repo"; mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  cp "$WORK/page.mkd" page.mkd
  cp "$WORK/Target.mkd" Target.mkd
  cp "$WORK/plain.md" plain.md
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'the page' || exit 1
) || { echo "strict: cannot build the fixture repo" >&2; exit 2; }

PORT="${LITEPORT:-18032}"
BASE="http://127.0.0.1:$PORT"
( cd "$REPO"; exec env HOME="$FAKEHOME" "$RT" http --port "$PORT" ) > "$WORK/srv.log" 2>&1 &
SRVPID=$!
N=0
while [ "$N" -lt 100 ]; do
    curl -s -o /dev/null "$BASE/" && break
    grep -qi "in use" "$WORK/srv.log" && break
    N=$((N + 1)); sleep 0.1
done
if grep -qi "in use" "$WORK/srv.log"; then
    echo "strict: SKIP the http leg — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
    kill "$SRVPID" 2>/dev/null; SRVPID=""
elif [ "$N" -ge 100 ]; then
    bad "the server never answered on $PORT" "$WORK/srv.log"
else
    ok "the listener came up on $PORT"
    curl -s -o "$WORK/out" "$BASE/repo/cat/page.mkd"
    has   "GET cat/page.mkd renders the H1"     '<h1 id="page-title">Page Title</h1>'
    has   "GET cat/page.mkd renders a meta key" "<dt>Now</dt>"
    has   "GET cat/page.mkd renders strong"     "<strong>strong</strong>"
    has   "GET cat/page.mkd resolves a shortcut" '/repo/cat/Target.mkd"'
    has   "GET cat/page.mkd keeps a source door" "/repo/raw/page.mkd"
    curl -s -o "$WORK/out" "$BASE/repo/cat/plain.md"
    has   "GET cat/plain.md is still CommonMark" "<strong>strong</strong>"
    curl -s -o "$WORK/out" "$BASE/repo/raw/page.mkd"
    hasraw "raw/page.mkd still paints the source" '<span class="tok-T"'
    kill "$SRVPID" 2>/dev/null; SRVPID=""
fi
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/strict] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/strict] $CHECKS checks, runtime $RT"
exit 0
