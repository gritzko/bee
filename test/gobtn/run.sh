#!/bin/sh
# bee/test/gobtn/run.sh — BEE-044: the `[go]` button, the ONE creating act on
# the board.  One JS leg (gobtn.js) over a fixture board whose five rows hold
# every case the button tells apart: GET-001 has a resolvable `Rep:` and no
# worktree (a LIVE face minting `fork //alpha-GET-001`), GET-002 no `Rep:` at
# all (pure ┄ leader), GET-003 a `Rep:` no registered repo answers to (a grey
# DEAD face, no spell), GET-004 a worktree already (its two frames instead) and
# GET-005 a closed page (no fork left to offer).  The leg asserts the face+`O`
# pairs, the compact tail placement, plain parity, and — through a real
# pager click — that `fork` MINTS the worktree and the row grows its frames in
# place; git witnesses the tree from outside the runtime under test.
#
# THE GAP THIS REPROS: a ticket could only get its worktree from the shell —
# the board named the repo in `Rep:` and offered no way to fork it.
#
# Standalone: `sh bee/test/gobtn/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/gobtn
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "gobtn: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "gobtn: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "gobtn: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "gobtn: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-gobtn.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home and a FIXTURE
#  $SRC_ROOT — the leg FORKS a worktree, so it may never see the user's own
#  registry or `~/src`.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "gobtn: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "gobtn: runtime $RT, fixtures $WORK"

# The fixture — one registered repo, one topic, five tickets.  The `Rep:` values
# are RELATIVE URIs (`///alpha`), the shape a journal page really carries, so the
# mint is tested on its last name segment and not on a bare word.
mkdir -p "$SRC/alpha/todo/GET" && ( cd "$SRC/alpha" && git init -q -b master . &&
  git config user.email t@t && git config user.name T ) || exit 2
mk() { printf "#   %s: %s\n    Now: %s\n%b" "$1" "$2" "$3" "$4" \
       > "$SRC/alpha/todo/GET/$1.mkd"; }
mk GET-001 "fork me"       OPEN "    Rep: ///alpha\n"
mk GET-002 "bare row"      OPEN ""
mk GET-003 "no such repo"  OPEN "    Rep: ///nosuch\n"
mk GET-004 "forked once"   OPEN "    Rep: ///alpha\n"
mk GET-005 "shut already"  DONE "    Rep: ///alpha\n"
printf 'a\n' > "$SRC/alpha/a.txt"
( cd "$SRC/alpha" && git add -A &&
  GIT_AUTHOR_DATE="@1700000000 +0000" GIT_COMMITTER_DATE="@1700000000 +0000" \
    git -c user.email=t@t -c user.name=T commit -q -m seed ) || exit 2
printf '%s\n' "$SRC/alpha" > "$REG"

# GET-004 already has its tree; nothing else does — GET-001's is what the click
# must mint, so it may not be there beforehand.
git -C "$SRC/alpha" worktree add -q -b GET-004 "$SRC/alpha-GET-004" || exit 2
[ -e "$SRC/alpha-GET-001" ] && { echo "gobtn: fixture already forked" >&2; exit 2; }

# The JS leg (QJAB-001: the --eval script door; requires climb via $WORK/jsrc).
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/gobtn.js')" ) \
    > "$WORK/g.out" 2> "$WORK/g.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- gobtn stderr ---"; cat "$WORK/g.err"
    bad "gobtn leg exited non-zero (rc $RC)" "$WORK/g.out"
elif grep -q '^FAIL' "$WORK/g.out"; then
    cat "$WORK/g.out"; bad "gobtn leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/g.out"; then
    cat "$WORK/g.out"; bad "gobtn leg did not finish"
else
    N=$(grep -c '^ok' "$WORK/g.out")
    CHECKS=$((CHECKS + N))
    ok "gobtn leg: $N checks (live/dead/none, the spell, the width, the click)"
fi

# The click really forked, and git knows the tree — the witness from outside the
# runtime under test.
if [ -d "$SRC/alpha-GET-001" ] &&
   git -C "$SRC/alpha" worktree list | grep -q "alpha-GET-001" &&
   [ "$(git -C "$SRC/alpha-GET-001" rev-parse --abbrev-ref HEAD)" = "GET-001" ]
then ok "the [go] click minted \$SRC_ROOT/alpha-GET-001 on its own branch"
else bad "the click did not fork a worktree" "$WORK/g.out"; fi

# ...and nothing else was forked: a dead face and a bare row mint no spell.
if [ ! -e "$SRC/alpha-GET-002" ] && [ ! -e "$SRC/alpha-GET-003" ] &&
   [ ! -e "$SRC/alpha-GET-005" ] && [ ! -e "$SRC/nosuch-GET-003" ]
then ok "...and no other row's region minted anything"
else bad "a row that offers no button forked anyway"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/gobtn] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/gobtn] $CHECKS checks, runtime $RT"
exit 0
