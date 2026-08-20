#!/bin/sh
# bee/test/http/repo.sh — BEE-003: the REPO is an axis of the TARGET.  The repro
# and the pin: two registered repos, one of them carrying a SUBMODULE, one
# server, and every check is about crossing the boundary.
#
# What it pins:
#   * a cross-repo reference RESOLVES — `abc/TCP.c` read in the bee-side repo
#     names `lib/abc/TCP.c` of the registered `quick` repo (through the parent,
#     ruling 5) and renders as `<a href="/quick/cat/lib/abc/TCP.c">` (BEE-028);
#   * the URL CARRIES the repo (ruling 2) — `/<repo>/[<verb>/]<path>` serves
#     EVERY registered repo, and a bare repo-less URL 301s to the prefixed form;
#   * serving needs NO lane: a registered but unindexed repo still serves;
#   * a miss REFUSES IN WORDS, naming what was searched (ruling 3);
#   * several hits land in the chooser, each row naming its repo (ruling 4);
#   * the pager's door opens the other tree from the resolved target, so a
#     cross-tree hop is an ordinary push and backspace an ordinary pop.
#
# BEFORE BEE-003 every one of those fails: the reference gets no href at all
# (`door.js resolvePartial` asks `io.cwd()`'s repo and nothing else), and
# `/quick/...` 404s (`http.js` chdirs into ONE repo and serves that alone).
#
# Standalone: `sh bee/test/http/repo.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/http
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "repo: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "repo: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git  >/dev/null 2>&1 || { echo "repo: SKIP — no git to build a fixture" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "repo: SKIP — no curl to drive the server" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "repo: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-repo.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "repo: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
PORT="${LITEPORT:-18038}"
BASE="http://127.0.0.1:$PORT"
echo "repo: runtime $RT, fixtures $WORK, port $PORT"

# ==========================================================================
# the fixtures — three repos, the registry's own shape
#   abc/    a plain repo, TCP.c at its ROOT
#   quick/  registers it as the submodule `lib/abc` (the quickjab -> dog -> abc
#           shape, one level: the partial `abc/TCP.c` spans the mount boundary)
#   home/   the SERVED repo: a page referencing `abc/TCP.c` and `q.txt`
#   plain/  registered and NEVER indexed — serving must not need a lane
# ==========================================================================
mkrepo() {   # mkrepo <dir>
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
mkrepo "$WORK/abc"
( cd "$WORK/abc" && printf 'int TCP;\nint UDP;\n' > TCP.c && git add -A &&
  git commit -q -m 'abc seed' ) || exit 2

mkrepo "$WORK/quick"
( cd "$WORK/quick" && printf 'Q0\n' > q.txt && git add -A && git commit -q -m 'quick seed' &&
  git -c protocol.file.allow=always submodule add -q ../abc lib/abc &&
  git commit -q -m 'quick takes lib/abc' ) || exit 2

mkrepo "$WORK/home"
mkdir -p "$WORK/home/sub" "$WORK/home/other"
( cd "$WORK/home" && printf 'H0\n' > h.txt &&
  printf 'a local one\n' > q.txt &&
  printf 'NEAR-SUB\n' > sub/near.txt && printf 'NEAR-OTHER\n' > other/near.txt &&
  printf '//  near: near.txt\n' > sub/note.c &&
  printf '//  cross: abc/TCP.c\n//  same:  q.txt\n//  miss:  nosuch/gone.c\nint here;\n' > ref.c &&
  git add -A && git commit -q -m 'home seed' ) || exit 2

mkrepo "$WORK/plain"
( cd "$WORK/plain" && printf 'P0\n' > p.txt && git add -A && git commit -q -m 'plain seed' ) || exit 2

# `bee install` is the ONE registration point (BEE-001) and it recurses into
# submodules (BEE-006), so the lanes below are its doing, not this test's.
for R in quick home; do
    ( cd "$WORK/$R" && HOME="$FAKEHOME" "$RT" install ) > "$WORK/i.$R" 2>&1 ||
      { bad "install $R" "$WORK/i.$R"; exit 1; }
done
# `plain` is REGISTERED BY HAND, with no lane of any kind: serving a repo must
# not require indexing it.
printf '%s\n' "$WORK/plain" >> "$FAKEHOME/.config/bee/repos"
if [ -d "$WORK/plain/.git/be" ]; then bad "plain must have NO lane"; fi
if grep -q "$WORK/quick/lib/abc" "$FAKEHOME/.config/bee/repos"
then ok "install registered the submodule too (BEE-006)"
else ok "the submodule rides its parent's registry line"; fi

# ==========================================================================
# up it goes — served FROM the home repo, so every other repo is a cross-repo one
# ==========================================================================
# BEE-023:27 the `$SRC_ROOT` leg: a FORK of a registered repo (`<name>-<tail>`,
# BEE-026) is served by name; anything else under `$SRC_ROOT` is not a mount.
SRC="$WORK/src"; mkdir -p "$SRC"
( cd "$WORK/home" && git worktree add -q "$SRC/home-TKT-1" -b TKT-1 ) || exit 2
mkrepo "$SRC/nope-TKT-2"
( cd "$SRC/nope-TKT-2" && printf 'N0\n' > n.txt && git add -A && git commit -q -m 'n' ) || exit 2
mkrepo "$SRC/home-.hid"
( cd "$SRC/home-.hid" && printf 'HID\n' > s.txt && git add -A && git commit -q -m 's' ) || exit 2
mkrepo "$SRC/.env"
( cd "$SRC/.env" && printf 'SECRET\n' > e.txt && git add -A && git commit -q -m 'e' ) || exit 2

( cd "$WORK/home"; exec env HOME="$FAKEHOME" SRC_ROOT="$SRC" "$RT" http --port "$PORT" ) \
  > "$WORK/srv.log" 2>&1 &
SRVPID=$!
N=0
while [ "$N" -lt 100 ]; do
    grep -qi "in use" "$WORK/srv.log" && break
    curl -s -o /dev/null "$BASE/home/" && break
    N=$((N + 1)); sleep 0.1
done
if grep -qi "in use" "$WORK/srv.log"; then
    echo "repo: SKIP — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
    SRVPID=""; exit 0
fi
if [ "$N" -lt 100 ]; then ok "the listener came up on $PORT"
else bad "the server never answered on $PORT" "$WORK/srv.log"; exit 1; fi

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
# leg 1 — THE REPRO: a cross-repo reference resolves and links
# ==========================================================================
page "the page of references" "/home/cat/ref.c" 200
has  "the cross-repo ref links INTO the other repo" 'href="/quick/cat/lib/abc/TCP.c"'
has  "a same-named local file still wins locally" 'href="/home/cat/q.txt"'
hasnt "and it does NOT point at the other repo's q.txt" 'href="/quick/cat/q.txt"'
hasnt "a reference no repo holds is not a link" 'href="/home/cat/nosuch'
has  "and it is still painted as source" '>nosuch/gone.c</span>'

# ==========================================================================
# leg 2 — the URL carries the repo (ruling 2), every registered repo served
# ==========================================================================
page "the other repo's file" "/quick/cat/lib/abc/TCP.c" 200
has  "it serves the SUBMODULE's own bytes" '>TCP</span>'
page "the other repo's root" "/quick/" 200
has  "the root list links its own file" 'href="/quick/cat/q.txt"'
# BEE-028: the verb-less path form is a typed convenience — it converges on
# the spelled form (a file under `cat`, a dir under `list`), never served as is.
curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE/quick/lib/abc/TCP.c"
hdr "a verb-less file URL 301s to its cat form" "Location: /quick/cat/lib/abc/TCP.c"
curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE/quick/lib/abc/"
hdr "a verb-less dir URL 301s to its list form" "Location: /quick/list/lib/abc/"
page "the submodule's own list" "/quick/list/lib/abc/" 200
has  "the sub lists its file THROUGH the parent (ruling 5)" 'href="/quick/cat/lib/abc/TCP.c"'
page "the submodule's log" "/quick/log/lib/abc/TCP.c" 200
has  "the log rows are the SUB's" "abc seed"

# a registered repo with NO lane still serves its files
page "an unindexed registered repo" "/plain/cat/p.txt" 200
has  "its bytes come out all the same" "P0"

# a bare repo-less URL 301s to the prefixed form — it never keeps working silently
curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE/cat/ref.c"
ST=$(head -1 "$WORK/hdr" | tr -d '\r')
case "$ST" in
    "HTTP/1.1 301"*) ok "a bare URL 301s: $ST" ;;
    *) bad "a bare URL must 301, got '$ST'" "$WORK/hdr" ;;
esac
hdr "and it names the prefixed form" "Location: /home/cat/ref.c"
curl -s -D "$WORK/hdr" -o /dev/null "$BASE/"
hdr "the bare root 301s to the served repo" "Location: /home/"

# a name no repo answers to is a PATH of the served repo, so it 301s like any
# other bare URL and then 404s there — never a silent read of a same-named file.
curl -s -L -D "$WORK/hdr" -o "$WORK/body" "$BASE/nope/x.txt"
ST=$(grep -c '^HTTP/1.1 404' "$WORK/hdr")
if [ "$ST" -ge 1 ]; then ok "an unknown first segment ends in a 404"
else bad "an unknown first segment must 404 after the 301" "$WORK/hdr"; fi

# ==========================================================================
# leg 2b — BEE-023: `$SRC_ROOT` forks by name, and only those
# ==========================================================================
page "a fork of a registered repo serves by its name" "/home-TKT-1/cat/h.txt" 200
has  "...and it is the fork's own tree" "H0"
page "the fork's list opens" "/home-TKT-1/" 200
has  "...linked under its own name" 'href="/home-TKT-1/'
# not a fork of anything registered: a bare URL, so 301 to the served repo, then 404
curl -s -L -D "$WORK/hdr" -o "$WORK/body" "$BASE/nope-TKT-2/cat/n.txt"
if grep -q '^HTTP/1.1 404' "$WORK/hdr" && ! grep -qF "N0" "$WORK/body"
then ok "an unregistered prefix under \$SRC_ROOT is no mount"
else bad "an unregistered prefix must not serve" "$WORK/hdr" "$WORK/body"; fi
curl -s -L -D "$WORK/hdr" -o "$WORK/body" "$BASE/home-.hid/cat/s.txt"
if ! grep -qF "HID" "$WORK/body"; then ok "a dot-led tail is no fork"
else bad "a dot-led tail must not serve" "$WORK/hdr" "$WORK/body"; fi
curl -s -L -D "$WORK/hdr" -o "$WORK/body" "$BASE/.env/cat/e.txt"
if ! grep -qF "SECRET" "$WORK/body"; then ok "a dotfile name is no fork"
else bad "a dotfile name must not serve" "$WORK/hdr" "$WORK/body"; fi
curl -s -L -D "$WORK/hdr" -o "$WORK/body" "$BASE/home-TKT-1%2F..%2F.env/cat/e.txt"
if ! grep -qF "SECRET" "$WORK/body"; then ok "an escaped slash in the name is no fork"
else bad "a slashed name must not serve" "$WORK/hdr" "$WORK/body"; fi
curl -s -L --path-as-is -D "$WORK/hdr" -o "$WORK/body" "$BASE/home-TKT-1/cat/../../.env/e.txt"
if ! grep -qF "SECRET" "$WORK/body"; then ok "a fork page cannot climb out of its tree"
else bad "dot-dot must not climb out of a fork" "$WORK/hdr" "$WORK/body"; fi

# ==========================================================================
# leg 3 — the door itself: the resolution ORDER, the refusal, the chooser
# ==========================================================================
( cd "$WORK/home" && HOME="$FAKEHOME" BEE_WORK="$WORK" \
  "$RT" --eval "require('$CASE/repo.js')" ) > "$WORK/j.out" 2>"$WORK/j.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/j.out" && ! grep -q '^FAIL' "$WORK/j.out"; then
    N=$(grep -c '^ok' "$WORK/j.out"); CHECKS=$((CHECKS + N))
    ok "door leg: $N checks (the order, the refusal, the chooser, the hop)"
else
    cat "$WORK/j.out"; head -20 "$WORK/j.err"
    bad "door leg (rc $RC)" "$WORK/j.out"
fi

kill "$SRVPID" 2>/dev/null; SRVPID=""

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/http-repo] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/http-repo] $CHECKS checks, runtime $RT"
exit 0
