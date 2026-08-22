#!/bin/sh
# bee/test/fpanel/run.sh — BEE-041: the FILE PANEL on a board row.  One JS leg
# (fpanel.js) over a fixture board whose two worktrees hold the two states the
# panel tells apart: GET-001 has a modified, a gone and an untracked file (three
# LIT class buttons), GET-002 has its one change wholly staged (an INFO count,
# no click).  The leg asserts the face+`O` pairs and their spells, that the
# plain bytes are the pre-button golden, and — through a real pager click — that
# `~n` stages the ROW's worktree and the slot flips to info in place.
#
# THE GAP THIS REPROS: the frames were inert text under one region-wide
# `list <wt>/` U, so nothing on a board row could stage anything.
#
# Standalone: `sh bee/test/fpanel/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/fpanel
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "fpanel: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "fpanel: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "fpanel: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "fpanel: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-fpanel.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — the leg STAGES in its
#  own throwaway worktree and writes `$HOME/.config/bee/repos`, never the user's.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "fpanel: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "fpanel: runtime $RT, fixtures $WORK"

# The fixture — one repo, one topic, two tickets, each with a worktree of its
# own: the whole board is two rows and the titles are short, so the golden plain
# line is the frames and nothing else.
mkdir -p "$SRC/alpha/todo/GET" && ( cd "$SRC/alpha" && git init -q -b master . &&
  git config user.email t@t && git config user.name T ) || exit 2
cat > "$SRC/alpha/todo/GET/GET-001.mkd" <<'EOF'
#   GET-001: dirty tree
    Now: OPEN
EOF
cat > "$SRC/alpha/todo/GET/GET-002.mkd" <<'EOF'
#   GET-002: all staged
    Now: OPEN
EOF
cat > "$SRC/alpha/todo/GET/GET-003.mkd" <<'EOF'
#   GET-003: mixed class
    Now: OPEN
EOF
printf 'a\n' > "$SRC/alpha/a.txt"
printf 'b\n' > "$SRC/alpha/b.txt"
( cd "$SRC/alpha" && git add -A &&
  GIT_AUTHOR_DATE="@1700000000 +0000" GIT_COMMITTER_DATE="@1700000000 +0000" \
    git -c user.email=t@t -c user.name=T commit -q -m seed ) || exit 2
printf '%s\n' "$SRC/alpha" > "$REG"

git -C "$SRC/alpha" worktree add -q -b GET-001 "$SRC/alpha-GET-001" || exit 2
git -C "$SRC/alpha" worktree add -q -b GET-002 "$SRC/alpha-GET-002" || exit 2
git -C "$SRC/alpha" worktree add -q -b GET-003 "$SRC/alpha-GET-003" || exit 2
# GET-001: one of each unstaged class — modified, gone, untracked.
printf 'edited\n' > "$SRC/alpha-GET-001/a.txt"
rm "$SRC/alpha-GET-001/b.txt"
printf 'new\n' > "$SRC/alpha-GET-001/c.txt"
# GET-002: the one change WHOLLY staged — nothing left for a button to do.
printf 'edited\n' > "$SRC/alpha-GET-002/a.txt"
git -C "$SRC/alpha-GET-002" add a.txt || exit 2
# BEE-039 revised: GET-003 splits ONE class over both axes — a.txt staged, b.txt not.
printf 'edited\n' > "$SRC/alpha-GET-003/a.txt"
git -C "$SRC/alpha-GET-003" add a.txt || exit 2
printf 'edited\n' > "$SRC/alpha-GET-003/b.txt"

# The JS leg (QJAB-001: the --eval script door; requires climb via $WORK/jsrc).
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/fpanel.js')" ) \
    > "$WORK/f.out" 2> "$WORK/f.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- fpanel stderr ---"; cat "$WORK/f.err"
    bad "fpanel leg exited non-zero (rc $RC)" "$WORK/f.out"
elif grep -q '^FAIL' "$WORK/f.out"; then
    cat "$WORK/f.out"; bad "fpanel leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/f.out"; then
    cat "$WORK/f.out"; bad "fpanel leg did not finish"
else
    N=$(grep -c '^ok' "$WORK/f.out")
    CHECKS=$((CHECKS + N))
    ok "fpanel leg: $N checks (lit/info/blank, the spells, plain parity, the click)"
fi

# The click really staged in the ROW's worktree, and nowhere else — git's own
# word for it, outside the runtime under test.
if [ "$(git -C "$SRC/alpha-GET-001" diff --cached --name-only)" = "a.txt" ]; then
    ok "the clicked button staged a.txt in alpha-GET-001"
else
    bad "the click staged '$(git -C "$SRC/alpha-GET-001" diff --cached --name-only)' in alpha-GET-001"
fi
if [ -z "$(git -C "$SRC/alpha" diff --cached --name-only)" ]; then
    ok "...and the board's own repo was left alone"
else
    bad "the click staged in the BOARD's repo: $(git -C "$SRC/alpha" diff --cached --name-only)"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/fpanel] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/fpanel] $CHECKS checks, runtime $RT"
exit 0
