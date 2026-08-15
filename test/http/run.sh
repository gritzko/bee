#!/bin/sh
# lite/test/http/run.sh — LITE-034: `lite http`, the repo browser over HTTP.
# One long-running verb, so this leg starts it once against a fixture repo and
# then walks the URL table with curl, asserting three things per page:
#
#   * the STATUS LINE  — a view answers 200, a refusal 404, a write 405
#   * the CONTENT TYPE — text/html for a page, text/css for the ONE sheet
#   * the PAINT        — the dog tok tags as <span class="tok-X">, the diff wash
#                        as side-in/side-rm, and the pager's own click targets
#                        as <a href> to the matching URL
#
# What it also pins, because they are the ticket's constraints:
#   * NO write endpoint — POST/PUT/DELETE are refused, no body is ever read;
#   * NO CommonMark — a .mkd file serves as syntax-painted SOURCE, no <h1>;
#   * ONE stylesheet, generated off view/theme.js, linked by every page.
#
# The headless half (the URL table both ways, theme -> CSS, the painter over
# hand-built hunks) is test/http/url.js, run last.
#
# Standalone: `sh lite/test/http/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/http
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "http: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "http: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git  >/dev/null 2>&1 || { echo "http: SKIP — no git to build a fixture" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "http: SKIP — no curl to drive the server" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "http: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-http.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "http: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
PORT="${LITEPORT:-18034}"
BASE="http://127.0.0.1:$PORT"
echo "http: runtime $RT, fixtures $WORK, port $PORT"

# ==========================================================================
# the fixture — three commits, one uncommitted edit, a subdir, a .mkd carrying a
# path reference and a ticket code, and a name with a SPACE in it (the escape).
#
# target.c is FIXED-WIDTH (`int MARK00n;\n`, 13 bytes a line), so every byte
# offset below is arithmetic this test can state rather than mine:
#   C0  six lines            line n starts at (n-1)*13; MARK004's name at 43,
#                            MARK002's at 17
#   C2  two lines PREPENDED (12 bytes each) and MARK002 DELETED, so today
#       line 1 @0  line 2 @12  line 3 @24  MARK001
#       line 4 @37 MARK003     line 5 @50 MARK004 (name @54)
#       line 6 @63 MARK005     line 7 @76 MARK006
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'A0\n' > a.txt
  printf 'X0\n' > sub/x.txt
  printf 'SPACED\n' > "a b.txt"
  printf '#   Doc\n\nA path sub/x.txt and a ticket LITE-034.\n' > doc.mkd
  printf 'int MARK001;\nint MARK002;\nint MARK003;\nint MARK004;\nint MARK005;\nint MARK006;\n' \
    > target.c
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed' || exit 1
  printf 'X1\n' > sub/x.txt
  git add -A
  GIT_AUTHOR_DATE='@1700086400 +0000' GIT_COMMITTER_DATE='@1700086400 +0000' \
    git commit -q -m 'C1 edit sub' || exit 1
  printf 'int TOP001;\nint TOP002;\nint MARK001;\nint MARK003;\nint MARK004;\nint MARK005;\nint MARK006;\n' \
    > target.c
  git add -A
  GIT_AUTHOR_DATE='@1700172800 +0000' GIT_COMMITTER_DATE='@1700172800 +0000' \
    git commit -q -m 'C2 two lines prepended, MARK002 gone' || exit 1
  printf 'A0-dirty\n' >> a.txt                   # uncommitted: `lite diff` bare
) || { echo "http: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
TIP=$(g rev-parse HEAD); TIP8=$(echo "$TIP" | cut -c1-8)
C1=$(g rev-parse HEAD~1); C18=$(echo "$C1" | cut -c1-8)
C0=$(g rev-parse HEAD~2); C08=$(echo "$C0" | cut -c1-8)
XBLOB=$(g rev-parse "HEAD:sub/x.txt")

# The two permalinks, minted the way index/hook.js mints one: the ANCHORED blob
# is C0's target.c, the offsets are the arithmetic above.  `ron.encode` and the
# hashlet packing are index/perma.js's own, so this test mints no format itself.
B0=$(g rev-parse "$C0:target.c"); B2=$(g rev-parse "HEAD:target.c")
PM=$( cd "$REPO" && HOME="$FAKEHOME" LITE_B0="$B0" LITE_B2="$B2" "$RT" --eval '
  const p = require("index/perma.js");
  const h = p.mintHashlet(io.getenv("LITE_B0"), [io.getenv("LITE_B2")]);
  io.log(p.packOffset(43) + ":" + h + " " + p.packOffset(17) + ":" + h + "\n");' 2>&1 )
PMOVED=$(echo "$PM" | cut -d' ' -f1)             # MARK004: moved down two lines
PGONE=$(echo "$PM" | cut -d' ' -f2)              # MARK002: deleted at C2
case "$PMOVED" in
    *:*) ok "the fixture minted permalinks: $PMOVED $PGONE" ;;
    *)   bad "cannot mint the fixture permalinks: '$PM'"; exit 1 ;;
esac
# The page OF references — uncommitted, because `cat` serves worktree bytes.
printf '//  moved: target.c:%s\n//  gone:  target.c:%s\n//  line:  target.c:6\n//  miss:  nosuch.c:3\nint here;\n' \
  "$PMOVED" "$PGONE" > "$REPO/ref.c"

# ==========================================================================
# the refusals FIRST — they run in the foreground, before a port is taken
# ==========================================================================
refuse() {   # refuse <label> <dir> <word...>
    _l=$1; _d=$2; shift 2
    ( cd "$_d" && HOME="$FAKEHOME" "$RT" http "$@" ) > "$WORK/r.out" 2>"$WORK/r.err"
    _rc=$?
    if [ "$_rc" != 0 ] && [ ! -s "$WORK/r.out" ]
    then ok "refused: $_l"
    else bad "$_l should be refused (rc $_rc)" "$WORK/r.out" "$WORK/r.err"; fi
}
refuse "an unknown option"  "$REPO" --wat
refuse "a port of zero"     "$REPO" --port 0
refuse "a port past 65535"  "$REPO" --port 70000
refuse "a port that is not a number" "$REPO" --port eight
refuse "no repository here" "$WORK"

# ==========================================================================
# up it goes — one server for every page below
# ==========================================================================
( cd "$REPO"; exec env HOME="$FAKEHOME" "$RT" http --port "$PORT" ) \
  > "$WORK/srv.log" 2>&1 &
SRVPID=$!
N=0
while [ "$N" -lt 100 ]; do
    curl -s -o /dev/null "$BASE/" && break
    grep -qi "in use" "$WORK/srv.log" && break
    N=$((N + 1)); sleep 0.1
done
if grep -qi "in use" "$WORK/srv.log"; then
    echo "http: SKIP — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
    SRVPID=""; exit 0
fi
if [ "$N" -lt 100 ]; then ok "the listener came up on $PORT"
else bad "the server never answered on $PORT" "$WORK/srv.log"; exit 1; fi
# Localhost only, and it says so: no flag in this verb opens it up.
if grep -q "http://127.0.0.1:$PORT/" "$WORK/srv.log"
then ok "it binds 127.0.0.1 and says so"
else bad "no loopback banner on the message stream" "$WORK/srv.log"; fi

page() {   # page <label> <url> <want-status>
    curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE$2"
    _st=$(head -1 "$WORK/hdr" | tr -d '\r')
    case "$_st" in
        "HTTP/1.1 $3"*) ok "$1 [$2] $_st" ;;
        *) bad "$1 [$2]: '$_st' want $3" "$WORK/hdr" "$WORK/body" ;;
    esac
}
has()   { if grep -qF "$2" "$WORK/body"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/body"; fi; }
hasnt() { if grep -qF "$2" "$WORK/body"; then bad "$1 — '$2' is there" "$WORK/body"; else ok "$1"; fi; }
hdr()   { if grep -qiF "$2" "$WORK/hdr"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/hdr"; fi; }

# ==========================================================================
# leg 1 — `/` is the root list, and its rows carry the pager's own targets
# ==========================================================================
page "the root list" "/" 200
hdr  "it is html" "Content-Type: text/html; charset=utf-8"
hdr  "with a length" "Content-Length:"
has  "the banner names the view" '<div class="banner">list</div>'
has  "the ONE stylesheet is linked" '<link rel="stylesheet" href="/style.css">'
has  "a file row links to its cat page" '<a href="/cat/a.txt">'
has  "a dir row links to its list page" '<a href="/list/sub/">'
has  "the wt marker slot is painted" 'class="tok-E"'
has  "the wt marker column is there" '>mod </span>'
has  "the name is painted" 'class="tok-F"'
has  "every span is anchorable by its start byte" 'class="tok-D" id="b0">'
has  "the last-commit column is painted" '>C0 seed</span>'
hasnt "the hidden U bytes never reach the page" "cat $REPO"
has  "a SPACED name escapes per segment" '<a href="/cat/a%20b.txt">'

# ==========================================================================
# leg 2 — the ONE generated stylesheet, straight off view/theme.js
# ==========================================================================
page "the stylesheet" "/style.css" 200
hdr  "it is css" "Content-Type: text/css; charset=utf-8"
has  "a slot became a rule" ".tok-F{color:"
has  "the banner band is spelled" ".banner{color:#000000;background:#ffffd7}"
has  "the diff wash is spelled" ".side-in{background:#afffaf}"
has  "the landed token has a :target rule" "pre.body span:target{"
has  "the columns are preserved" "white-space:pre"

# ==========================================================================
# leg 3 — the per-verb pages
# ==========================================================================
page "a subdir list" "/list/sub/" 200
has  "it lists the subdir's file" '<a href="/cat/sub/x.txt">'

page "the log" "/log/" 200
has  "a log row links its commit" '<a href="/commit/'
has  "the sha8 is painted" ">$TIP8</span>"
page "a file's log" "/log/sub/x.txt" 200
has  "the file log carries rows too" '<a href="/commit/'

page "one commit" "/commit/$TIP8" 200
has  "the commit header is painted" 'class="tok-R" id="b0">commit </span>'
has  "its sha is spelled whole" "$TIP"
has  "the tree header links the tree" '<a href="/tree/'
has  "the parent header links the parent" "/commit/$C1"

page "the worktree diff" "/diff/" 200
has  "the diff banner names the file" '<div class="banner">a.txt#L1</div>'
page "one commit's diff" "/diff/$C18" 200
has  "the to-side washes in" 'side-in" id="b0">X1'
has  "the from-side washes out" 'side-rm" id="b2">X0'

page "a file" "/cat/doc.mkd" 200
has  "the source is painted" '<span class="tok-'
has  "a path reference links, resolved" '<a href="/cat/sub/x.txt">'
# A ticket code names no file in this repo, so it resolves to NOTHING — and an
# unresolvable reference is plain painted text, never a link that 404s.
hasnt "a ticket code naming no file is NOT a link" '<a href="/cat/LITE-034'
has  "and the ticket code is still painted" '>LITE-034</span>'
hasnt "NO CommonMark render — no heading element" "<h1"
hasnt "NO CommonMark render — no paragraph element" "<p>"
has  "the markdown source is served verbatim" "Doc"

page "a file at a rev" "/cat/sub/x.txt?$C08" 200
has  "the rev's bytes, not the tip's" ">X0<"
hasnt "and not the tip's bytes" ">X1<"

page "the root tree" "/tree/" 200
has  "a tree row links its blob" '<a href="/blob/'
has  "the mode/type/sha prefix is painted" 'class="tok-D" id="b0">100644 blob   '
page "a subdir tree" "/tree/sub/" 200
has  "the .. row climbs" '<a href="/tree/">'

page "a blob by name" "/blob/$XBLOB" 200
has  "the blob's bytes" "X1"

# ==========================================================================
# leg 3b — REFERENCES AND PERMALINKS, resolved while the page is PAINTED
# (ruling 2026-08-15).  The href in the served bytes is already final: the
# door followed the reference, so it names the landed FILE and, as `#b<byte>`,
# the landed TOKEN.  Nothing resolvable carries no href at all.
# ==========================================================================
page "a page of references" "/cat/ref.c" 200
has  "a file:line ref lands on that line's first token" 'href="/cat/target.c#b63"'
has  "a MOVED permalink lands where its token sits TODAY" 'href="/cat/target.c#b54"'
has  "a DEAD permalink lands where its token STOOD" 'href="/cat/target.c#b37"'
hasnt "a reference that answers nothing is NOT a link" 'href="/cat/nosuch'
has  "and it is still painted as source" '>nosuch.c:3</span>'
# The bug this leg exists for: no raw `file:OFF:HASHLET` may reach a URL.
hasnt "no raw reference reaches a url" 'href="/cat/target.c:'
hasnt "no raw permalink reaches a url" '%3A'
if [ "$(grep -c 'href="/cat/target.c#b' "$WORK/body")" = 3 ]; then
    ok "exactly the three resolvable references linked"
else
    bad "wrong number of resolved links" "$WORK/body"
fi

# Each anchor names a REAL token of the page it points into — the offsets are
# the fixture's own arithmetic, and the ids are the painter's.
page "the reference target" "/cat/target.c" 200
has  "the moved permalink's anchor IS the anchored identifier" 'id="b54">MARK004</span>'
has  "the dead permalink's anchor is the line it stood on" 'id="b37">int</span>'
has  "the file:line anchor is that line's first token" 'id="b63">int</span>'

# ==========================================================================
# leg 4 — the refusals over the wire, and NO write endpoint of any kind
# ==========================================================================
page "no such page" "/nope/x" 404
has  "it says so in plain words" "there is no /nope page here"
page "no such file" "/cat/missing.txt" 404
has  "the verb's own plain words" "cat: there is no missing.txt in the worktree"
page "no such commit" "/commit/deadbeef" 404

method() {   # method <label> <verb> <want-status>
    curl -s -X "$2" -D "$WORK/hdr" -o "$WORK/body" "$BASE/"
    _st=$(head -1 "$WORK/hdr" | tr -d '\r')
    case "$_st" in
        "HTTP/1.1 $3"*) ok "$1: $_st" ;;
        *) bad "$1: '$_st' want $3" "$WORK/hdr" "$WORK/body" ;;
    esac
}
method "POST is not allowed"   POST   405
method "PUT is not allowed"    PUT    405
method "DELETE is not allowed" DELETE 405
has    "the refusal says lite http only reads" "lite http only reads"
# A body offered with the refused method changes nothing and mutates nothing.
curl -s -o /dev/null -X POST --data-binary 'x=1' "$BASE/cat/a.txt"
if [ "$(cat "$REPO/a.txt" | wc -l)" = 2 ] && [ -z "$(g status --porcelain -- doc.mkd)" ]
then ok "a POST body left the worktree alone"
else bad "the worktree moved under a POST"; fi

# HEAD answers the head the GET would answer, its byte length included, and
# sends no body — curl -I reads exactly the head and would stall on a stray one.
curl -s -I -D "$WORK/hdr" -o /dev/null "$BASE/"
HL=$(grep -i '^Content-Length:' "$WORK/hdr" | tr -dc '0-9')
curl -s -D /dev/null -o "$WORK/g.out" "$BASE/"
GL=$(wc -c < "$WORK/g.out" | tr -dc '0-9')
if [ -n "$HL" ] && [ "$HL" = "$GL" ]
then ok "HEAD answers GET's own length ($HL) with no body"
else bad "HEAD length '$HL' vs GET '$GL'" "$WORK/hdr"; fi

# It survived all of that.
if kill -0 "$SRVPID" 2>/dev/null
then ok "the server is still up after every leg"
else bad "the server died" "$WORK/srv.log"; fi
# And it kept an access line per request on the MESSAGE stream, stdout free.
if grep -q "GET /style.css 200" "$WORK/srv.log"
then ok "it logs a line per request to the message stream"
else bad "no access line for /style.css" "$WORK/srv.log"; fi

kill "$SRVPID" 2>/dev/null; SRVPID=""

# ==========================================================================
# leg 5 — the headless half: the URL table both ways, theme -> CSS, the painter
# ==========================================================================
( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$CASE/url.js')" ) \
  > "$WORK/j.out" 2>"$WORK/j.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/j.out" && ! grep -q '^FAIL' "$WORK/j.out"; then
    N=$(grep -c '^ok' "$WORK/j.out"); CHECKS=$((CHECKS + N))
    ok "router/painter leg: $N checks (the URL table both ways, CSS, the spans)"
else
    cat "$WORK/j.out"; head -5 "$WORK/j.err"
    bad "router/painter leg (rc $RC)" "$WORK/j.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/http] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/http] $CHECKS checks, runtime $RT"
exit 0
