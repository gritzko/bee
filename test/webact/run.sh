#!/bin/sh
# bee/test/webact/run.sh — BEE-047: the board's write buttons over http.  The
# TUI's `O` spells (done/dont, the wtstat panel counts) must click identically
# in a browser: the SAME act.js table, reached by POST alone, behind ONE global
# read-only switch.  Three legs over one fixture board, in this order:
#
#   1  --ro     — the page paints NO form and POST is refused 405
#   2  acts on  — the page paints forms, and stripped of them it is BYTE
#                 IDENTICAL to leg 1's page (the hard regression bar)
#   3  the acts — a same-origin POST really stages a file (git witnesses it),
#                 the report line reaches the redirected page, and a
#                 cross-origin POST, a VIEW word and an oversize body are refused
#
# The headless half (the views-vs-verbs map as DATA) is test/webact/map.js.
#
# THE GAP THIS REPROS: every write face went dead in the web page — its spell
# named an act.js writer, not a ROUTE view, so html.js:192 painted it plain.
#
# Standalone: `sh bee/test/webact/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture servers bind.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/webact
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "webact: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "webact: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git  >/dev/null 2>&1 || { echo "webact: SKIP — no git to build a fixture" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "webact: SKIP — no curl to drive the server" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "webact: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-webact.XXXXXX") || exit 2
WORK=$(cd "$WORK" && pwd -P)
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME/.config/bee"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home and a FIXTURE
#  $SRC_ROOT — this leg STAGES files, so it may never see the user's own tree.
export HOME="$FAKEHOME"
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "webact: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
REG="$FAKEHOME/.config/bee/repos"
SRC="$WORK/src"; mkdir -p "$SRC"
PORT="${LITEPORT:-18047}"
echo "webact: runtime $RT, fixtures $WORK, port $PORT"

# ==========================================================================
# the fixture — one registered repo, one OPEN ticket, and its worktree carrying
# ONE unstaged edit, so the board row wears a lit `~1` chg button (the `add`
# spell) beside the ticket panel's ✓/✗.
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
WT="$SRC/alpha-GET-001"
[ "$(git -C "$WT" status --porcelain)" = " M a.txt" ] ||
  { echo "webact: the fixture worktree is not dirty" >&2; exit 2; }

BASE="http://127.0.0.1:$PORT"
up() {   # up <label> [flag...] — one server over the fixture board
    ( cd "$SRC/alpha"; exec env HOME="$FAKEHOME" SRC_ROOT="$SRC" \
        "$RT" http --port "$PORT" "$@" ) > "$WORK/srv.log" 2>&1 &
    SRVPID=$!
    N=0
    while [ "$N" -lt 100 ]; do
        curl -s -o /dev/null "$BASE/" && break
        grep -qi "in use" "$WORK/srv.log" && break
        N=$((N + 1)); sleep 0.1
    done
    if grep -qi "in use" "$WORK/srv.log"; then
        echo "webact: SKIP — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
        SRVPID=""; exit 0
    fi
    [ "$N" -lt 100 ] || { bad "the server never answered on $PORT" "$WORK/srv.log"; exit 1; }
}
down() { [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null; SRVPID=""; sleep 0.3; }
has()   { if grep -qF "$2" "$WORK/body"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/body"; fi; }
hasnt() { if grep -qF "$2" "$WORK/body"; then bad "$1 — '$2' is there" "$WORK/body"; else ok "$1"; fi; }
status() {   # status <label> <want>
    _st=$(head -1 "$WORK/hdr" | tr -d '\r')
    case "$_st" in "HTTP/1.1 $2"*) ok "$1: $_st" ;;
                   *) bad "$1: '$_st' want $2" "$WORK/hdr" "$WORK/body" ;; esac
}
post() {   # post <spell> [curl arg...] — a same-origin act unless told otherwise
    _s=$1; shift
    curl -s -D "$WORK/hdr" -o "$WORK/body" -X POST --data-urlencode "s=$_s" \
         -H "Referer: $BASE/alpha/todo" "$@" "$BASE/alpha/act"
}

# ==========================================================================
# leg 1 — `--ro`: the LOCKED server.  No button looks live and no write lands.
# ==========================================================================
up --ro
curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE/alpha/todo"
status "the locked board" 200
has   "the board is there" "GET-001"
hasnt "no face is a form"  "<form"
hasnt "and no spell reaches the page" 'name="s"'
cp "$WORK/body" "$WORK/ro.html"
post "//alpha-GET-001 add"
status "a POST is refused when locked" 405
has   "in the words the refusal always used" "only reads; POST is not allowed"
if [ "$(git -C "$WT" status --porcelain)" = " M a.txt" ]
then ok "the locked server staged nothing"
else bad "a --ro POST moved the worktree"; fi
down

# ==========================================================================
# leg 2 — acts ON (the default), and the BYTE-IDENTICAL bar: the page differs
# from the locked one by the write FORMS and by nothing else at all.
# ==========================================================================
up
curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE/alpha/todo"
status "the live board" 200
has "the panel's chg count posts its spell" \
    '<input type="hidden" name="s" value="//alpha-GET-001 add">'
has "the ticket panel posts done" '<input type="hidden" name="s" value="done GET-001">'
has "and dont"                    '<input type="hidden" name="s" value="dont GET-001">'
has "the form is self-contained and POSTs to the repo's act" \
    '<form class="act" method="post" action="/alpha/act">'
hasnt "no write spell ever becomes an href" 'href="/alpha/act'
hasnt "and none rides a GET"                'href="/alpha/todo/done'
#  The face inside the button is the very span the locked page painted.
sed -e 's|<form class="act[a-z ]*" method="post" action="/alpha/act"><input type="hidden" name="s" value="[^"]*"><button type="submit">||g' \
    -e 's|</button></form>||g' "$WORK/body" > "$WORK/stripped.html"
if cmp -s "$WORK/stripped.html" "$WORK/ro.html"
then ok "stripped of its forms the live page is BYTE-IDENTICAL to the locked one"
else bad "the live page moved a byte outside the forms" "$WORK/stripped.html"
     diff "$WORK/ro.html" "$WORK/stripped.html" | head -10; fi

# ==========================================================================
# leg 3 — the acts themselves
# ==========================================================================
# A cross-origin form POST reaches 127.0.0.1 with no CORS to stop it.
post "//alpha-GET-001 add" -H "Origin: http://evil.example"
status "a cross-origin act is refused" 403
has "it says so" "SAME-ORIGIN"
if [ "$(git -C "$WT" status --porcelain)" = " M a.txt" ]
then ok "and it staged nothing"
else bad "a cross-origin POST moved the worktree"; fi

# A VIEW word is no writer, and the map is what says so.
post "status //alpha"
status "a view word is refused" 403
has "it names the spell" "status //alpha is no writer"

# The body is capped in the ONE transport spot: oversize is 413, not a hang.
( printf 's='; i=0; while [ "$i" -lt 500 ]; do printf 'xxxxxxxxxxxxxxxxxxxx'; i=$((i + 1)); done ) \
  > "$WORK/big"
curl -s -D "$WORK/hdr" -o "$WORK/body" -X POST --data-binary "@$WORK/big" \
     -H "Referer: $BASE/alpha/todo" "$BASE/alpha/act"
status "an oversize act body is refused" 413

# A POST anywhere else is refused exactly as it always was.
curl -s -D "$WORK/hdr" -o "$WORK/body" -X POST --data-binary 'x=1' "$BASE/alpha/cat/a.txt"
status "a POST off the act URL" 405
has "in the old words" "bee http only reads"

# ...and the live one: the panel's `add` really stages, git witnessing it.
post "//alpha-GET-001 add"
status "the act answers 303 back to the page" 303
if grep -qi "^Location: $BASE/alpha/todo" "$WORK/hdr"
then ok "the redirect names the page it was clicked from"
else bad "no Location back to the board" "$WORK/hdr"; fi
if [ "$(git -C "$WT" status --porcelain)" = "M  a.txt" ]
then ok "the click STAGED the edit — git says so from outside the runtime"
else bad "the act did not stage: $(git -C "$WT" status --porcelain)" "$WORK/body"; fi

# The act's one report line reaches the user, on the page the 303 sent it to.
curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE/alpha/todo"
status "the redirected page" 200
has   "it carries the act's own report line" "add 1 staged"
hasnt "the panel's add button is spent with the edit" \
      '<input type="hidden" name="s" value="//alpha-GET-001 add">'
curl -s -o "$WORK/body" "$BASE/alpha/todo"
hasnt "and the report line is spent once" "add 1 staged"
down

# ==========================================================================
# leg 4 — the headless half: the map as DATA, and the endpoint's two leaves
# ==========================================================================
( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$CASE/map.js')" ) \
  > "$WORK/m.out" 2> "$WORK/m.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/m.out" && ! grep -q '^FAIL' "$WORK/m.out"; then
    N=$(grep -c '^ok' "$WORK/m.out"); CHECKS=$((CHECKS + N))
    ok "map leg: $N checks (the views-vs-verbs map, the act URL, the form field)"
else
    cat "$WORK/m.out"; head -5 "$WORK/m.err"
    bad "map leg (rc $RC)" "$WORK/m.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/webact] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/webact] $CHECKS checks, runtime $RT"
exit 0
