#!/bin/sh
# bee/test/elastic/run.sh — BEE-030: the elastic `B` field (be's BRO-036 port).
# One JS leg (board.js) over a fixture board: at a REAL no-wrap width a todo
# row's title …-cuts when the line overflows and ┄-pads when it falls short, so
# the [BEE-027] frames column stays visible and flush right; soft-wrap and the
# unclamped (piped) index carry no elastic at all; the flush-right frames carry
# no region nav of their own ([BEE-042] retired it); the html page wears the flex
# `.row`/`.els` twin.
#
# THE GAP THIS REPROS: the board tagged its title `S`, so a long title pushed
# the worktree frames off a narrow screen and short titles left them ragged.
#
# Standalone: `sh bee/test/elastic/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/elastic
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "elastic: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "elastic: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "elastic: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "elastic: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-elastic.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "elastic: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FH="$WORK/home"; mkdir -p "$FH/.config/bee"
REG="$FH/.config/bee/repos"
SRC="$WORK/src"; mkdir -p "$SRC"
echo "elastic: runtime $RT, fixtures $WORK"

# The fixture — one repo, one topic: a LONG title (the …-cut case), a short one
# (the pad case), a bare-key title (the zero-width B case), two forked
# worktrees so two rows carry the flush-right frames column.
mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}

mkrepo "$SRC/alpha"
mkdir -p "$SRC/alpha/todo/GET"
cat > "$SRC/alpha/todo/GET/GET-001.mkd" <<'EOF'
#   GET-001: a very long ticket title that certainly overflows a narrow no-wrap viewport by a wide margin
    Now: OPEN
EOF
cat > "$SRC/alpha/todo/GET/GET-002.mkd" <<'EOF'
#   GET-002: tiny
    Now: OPEN
EOF
cat > "$SRC/alpha/todo/GET/GET-003.mkd" <<'EOF'
#   GET-003
    Now: OPEN
EOF
( cd "$SRC/alpha" && git add -A &&
  GIT_AUTHOR_DATE="@1700000000 +0000" GIT_COMMITTER_DATE="@1700000000 +0000" \
    git -c user.email=t@t -c user.name=T commit -q -m seed ) || exit 2
printf '%s\n' "$SRC/alpha" > "$REG"

git -C "$SRC/alpha" worktree add -q -b GET-001 "$SRC/alpha-GET-001" || exit 2
git -C "$SRC/alpha" worktree add -q -b GET-003 "$SRC/alpha-GET-003" || exit 2

# The JS leg (QJAB-001: the --eval script door; requires climb via $WORK/jsrc).
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/board.js')" ) \
    > "$WORK/b.out" 2> "$WORK/b.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- board stderr ---"; cat "$WORK/b.err"
    bad "board leg exited non-zero (rc $RC)" "$WORK/b.out"
elif grep -q '^FAIL' "$WORK/b.out"; then
    cat "$WORK/b.out"; bad "board leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/b.out"; then
    cat "$WORK/b.out"; bad "board leg did not finish"
else
    grep -c '^ok' "$WORK/b.out" > "$WORK/n"
    CHECKS=$((CHECKS + $(cat "$WORK/n")))
    ok "board leg: $(cat "$WORK/n") checks (cut/pad/click/html/no-pipe-leak)"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/elastic] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/elastic] $CHECKS checks, runtime $RT"
exit 0
