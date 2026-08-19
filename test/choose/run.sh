#!/bin/sh
# bee/test/choose/run.sh — BEE-011 + BEE-012: a generic name is a CHOICE.
# `main.js` answers in more than one registered repo, so `door.seatOf` hands
# back the {rels} chooser.  The pager has shown that list since [LITE-015];
# http folded it to "" beside a MISS and painted the reference dead.
#   leg 1  the door — the ambiguity, and the PROJECT-PREFIXED spelling that
#          resolves it (`alpha/main.js`), in pick.js
#   leg 2  http — the ambiguous ref gets a `/choose/` href, that page lists one
#          linked row per candidate naming its repo, and a MISS stays plain
#
# Standalone: `sh bee/test/choose/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/choose
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "choose: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "choose: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "choose: SKIP — no git to build a fixture" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "choose: SKIP — no curl to drive the server" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "choose: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-choose.XXXXXX") || exit 2
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
SRV=""
trap 'rc=$?; [ -n "$SRV" ] && kill "$SRV" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "choose: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FH="$WORK/home"; mkdir -p "$FH"
ALPHA="$WORK/alpha"; BETA="$WORK/beta"; READER="$WORK/reader"
PORT="${LITEPORT:-18035}"
BASE="http://127.0.0.1:$PORT"
echo "choose: runtime $RT, fixtures $WORK, port $PORT"

# --- the fixture: two repos carrying the same generic names, plus a reader --
mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
mkrepo "$ALPHA"
( cd "$ALPHA" && mkdir -p render mark &&
  printf 'ALPHAMAIN\n'  > main.js &&
  printf 'ALPHAREND\n'  > render/html.js &&
  printf 'ALPHAMARK\n'  > mark/html.js &&
  git add -A && git commit -q -m 'alpha seed' ) || exit 2
mkrepo "$BETA"
( cd "$BETA" && printf 'BETAMAIN\n' > main.js &&
  git add -A && git commit -q -m 'beta seed' ) || exit 2
mkrepo "$READER"
# The page naming them.  `nosuch.js` is the MISS that must stay plain text.
( cd "$READER" && printf 'it names main.js and alpha/main.js and nosuch.js\n' > page.mkd &&
  git add -A && git commit -q -m 'reader seed' ) || exit 2
for R in "$ALPHA" "$BETA" "$READER"; do
    ( cd "$R" && HOME="$FH" "$RT" install ) > "$WORK/i" 2>&1 ||
      { bad "install $R" "$WORK/i"; exit 1; }
done

# ==========================================================================
# leg 1 — the door: the ambiguity and the project-prefixed spelling
# ==========================================================================
( cd "$READER" && HOME="$FH" BEE_ALPHA="$ALPHA" BEE_BETA="$BETA" \
  "$RT" --eval "require('$CASE/pick.js')" ) > "$WORK/d" 2>"$WORK/de"
RC=$?
sed 's/^/     /' "$WORK/d"
N=$(grep -c '^ok' "$WORK/d" 2>/dev/null || echo 0)
if [ "$RC" = 0 ] && grep -q '^PASS' "$WORK/d"
then ok "the door: $N checks"; CHECKS=$((CHECKS + N - 1))
else bad "the door leg (rc $RC)" "$WORK/de"; fi

# ==========================================================================
# leg 2 — http: the chooser page
# ==========================================================================
( cd "$READER"; exec env HOME="$FH" "$RT" http --port "$PORT" ) \
    > "$WORK/srv.log" 2>&1 &
SRV=$!
N=0
while [ "$N" -lt 100 ]; do
    curl -s -o /dev/null "$BASE/" && break
    kill -0 "$SRV" 2>/dev/null || break
    N=$((N + 1)); sleep 0.1
done
if [ "$N" -lt 100 ]; then ok "the listener came up on $PORT"
else bad "the server never answered on $PORT" "$WORK/srv.log"; exit 1; fi

curl -s -o "$WORK/page" "$BASE/reader/cat/page.mkd"
if grep -q 'href="/reader/choose/main.js"' "$WORK/page"
then ok "an ambiguous reference gets a chooser href"
else bad "the ambiguous ref must link to the chooser" "$WORK/page"; fi

# BEE-011 through the same door: the prefixed ref names ONE file, so it goes
# straight there and never to the chooser.
if grep -q 'href="/alpha/cat/main.js"' "$WORK/page"
then ok "...while the project-prefixed one links straight to the file"
else bad "the prefixed ref must link to its file" "$WORK/page"; fi

# The MISS is the case that must NOT change: no href at all, plain paint.
if ! grep -q 'choose/nosuch.js' "$WORK/page"
then ok "...and a miss is still plain painted text, not a chooser"
else bad "a miss must not reach the chooser" "$WORK/page"; fi

curl -s -D "$WORK/hdr" -o "$WORK/pick" "$BASE/reader/choose/main.js"
if head -1 "$WORK/hdr" | grep -q ' 200 '
then ok "the chooser page answers 200"
else bad "the chooser page must answer" "$WORK/hdr" "$WORK/pick"; fi

if grep -q 'href="/alpha/cat/main.js"' "$WORK/pick" &&
   grep -q 'href="/beta/cat/main.js"' "$WORK/pick"
then ok "...listing BOTH candidates, each a link to its own page"
else bad "the chooser must list every candidate" "$WORK/pick"; fi

if grep -q '>alpha/main.js<' "$WORK/pick" && grep -q '>beta/main.js<' "$WORK/pick"
then ok "...each row naming the REPO it came from"
else bad "a chooser row names its repo" "$WORK/pick"; fi

curl -s -D "$WORK/hdr" -o /dev/null "$BASE/reader/choose/nosuch.js"
if head -1 "$WORK/hdr" | grep -q ' 404 '
then ok "a chooser for a name nothing answers is a 404"
else bad "the chooser must 404 on a miss" "$WORK/hdr"; fi

# ==========================================================================
if [ "$FAILED" = 0 ]; then
    echo "PASS [bee/choose] $CHECKS checks, runtime $RT"
else
    echo "FAIL [bee/choose] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
