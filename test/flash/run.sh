#!/bin/sh
# bee/test/flash/run.sh — BEE-055: the act's report line is a NOTIFICATION
# BUBBLE, not a pseudo hunk header.  The 303-landed page overlays `.flash`
# (fixed, translucent, its own [x]) over an undisturbed layout; an act's
# REFUSAL rides the same bubble; HTML answers `Cache-Control: no-store`, so
# a spent flash never replays from the browser's cache.
#
# THE GAP THIS REPROS: BEE-047 painted the report as a `.banner` hunk — it
# read as page content, shifted the flow, and reappeared from the bfcache.
#
# Standalone: `sh bee/test/flash/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/flash
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "flash: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "flash: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git  >/dev/null 2>&1 || { echo "flash: SKIP — no git to build a fixture" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "flash: SKIP — no curl to drive the server" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "flash: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-flash.XXXXXX") || exit 2
WORK=$(cd "$WORK" && pwd -P)
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME/.config/bee"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
export HOME="$FAKEHOME"
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "flash: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
REG="$FAKEHOME/.config/bee/repos"
SRC="$WORK/src"; mkdir -p "$SRC"
PORT="${LITEPORT:-18055}"
echo "flash: runtime $RT, fixtures $WORK, port $PORT"

# ==========================================================================
# the fixture — one registered repo, one OPEN ticket, its worktree carrying
# ONE unstaged edit: `add` gives a real report, `done GET-999` a refusal.
# ==========================================================================
mkdir -p "$SRC/alpha/todo/GET" && ( cd "$SRC/alpha" && git init -q -b master . &&
  git config user.email t@t && git config user.name T ) || exit 2
printf '#   GET-001: click me\n    Now: OPEN\n    Rep: ///alpha\n' \
  > "$SRC/alpha/todo/GET/GET-001.mkd"
printf 'a\n' > "$SRC/alpha/a.txt"
( cd "$SRC/alpha" && git add -A &&
  GIT_AUTHOR_DATE="@1700000000 +0000" GIT_COMMITTER_DATE="@1700000000 +0000" \
    git -c user.email=t@t -c user.name=T commit -q -m seed ) || exit 2
printf '%s\n' "$SRC/alpha" > "$REG"
git -C "$SRC/alpha" worktree add -q -b GET-001 "$SRC/alpha-GET-001" || exit 2
printf 'edited\n' >> "$SRC/alpha-GET-001/a.txt"

BASE="http://127.0.0.1:$PORT"
( cd "$SRC/alpha"; exec env HOME="$FAKEHOME" SRC_ROOT="$SRC" \
    "$RT" http --port "$PORT" ) > "$WORK/srv.log" 2>&1 &
SRVPID=$!
N=0
while [ "$N" -lt 100 ]; do
    curl -s -o /dev/null "$BASE/" && break
    grep -qi "in use" "$WORK/srv.log" && break
    N=$((N + 1)); sleep 0.1
done
if grep -qi "in use" "$WORK/srv.log"; then
    echo "flash: SKIP — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
    SRVPID=""; exit 0
fi
[ "$N" -lt 100 ] || { bad "the server never answered on $PORT" "$WORK/srv.log"; exit 1; }

has()   { if grep -qF "$2" "$WORK/body"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/body"; fi; }
hasnt() { if grep -qF "$2" "$WORK/body"; then bad "$1 — '$2' is there" "$WORK/body"; else ok "$1"; fi; }
post() {   # post <spell> — a same-origin act
    curl -s -D "$WORK/hdr" -o "$WORK/body" -X POST --data-urlencode "s=$1" \
         -H "Referer: $BASE/alpha/todo" "$BASE/alpha/act"
}

# ==========================================================================
# leg 1 — the report is a BUBBLE: `.flash` overlay with its [x], and the page
# body is what it was before the act — no pseudo hunk pushed the layout down.
# ==========================================================================
post "//alpha-GET-001 add"
curl -s -D "$WORK/hdr" -o "$WORK/landed" "$BASE/alpha/todo"
cp "$WORK/landed" "$WORK/body"
has   "the report line reaches the landed page" "add 1 staged"
has   "and rides the .flash bubble"             '<div class="flash">'
has   "which carries its own close button"      'class="x"'
hasnt "no pseudo hunk header carries a report"  '<div class="hunk"><div class="banner">add 1 staged'
if grep -qi '^Cache-Control: no-store' "$WORK/hdr"
then ok "the page answers Cache-Control: no-store"
else bad "no no-store on the HTML page" "$WORK/hdr"; fi
curl -s -o "$WORK/body" "$BASE/alpha/todo"
hasnt "and the bubble is spent once" "add 1 staged"
#  The bubble OVERLAYS: minus its own div, the landed page is the spent one.
sed -e 's|<div class="flash">.*</button></div>||' "$WORK/landed" > "$WORK/shaved"
if cmp -s "$WORK/shaved" "$WORK/body"
then ok "shaved of the bubble the landed page is BYTE-IDENTICAL to the spent one"
else bad "the flash moved a byte outside its own div" "$WORK/shaved"
     diff "$WORK/body" "$WORK/shaved" | head -10; fi

# ==========================================================================
# leg 2 — an act's REFUSAL lands in the same bubble.
# ==========================================================================
post "done GET-999"
curl -s -o "$WORK/body" "$BASE/alpha/todo"
has "the refusal rides the .flash bubble" '<div class="flash">'
has "and names its miss"                  "TODONONE"

# ==========================================================================
# leg 3 — the stylesheet: the bubble is a fixed, translucent overlay.
# ==========================================================================
curl -s -o "$WORK/body" "$BASE/style.css"
has "the bubble is out of the flow" ".flash{position:fixed"
if grep -F ".flash" "$WORK/body" | grep -q "opacity"
then ok "and somewhat transparent"
else bad "no opacity on .flash" "$WORK/body"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/flash] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/flash] $CHECKS checks, runtime $RT"
exit 0
