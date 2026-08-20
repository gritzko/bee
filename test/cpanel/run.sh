#!/bin/sh
# bee/test/cpanel/run.sh — BEE-042: the COMMIT PANEL on a board row.  One JS leg
# (cpanel.js) over a fixture board whose five worktrees hold the five states the
# panel tells apart: ahead (`+1` push), behind (`-1` pull, the pair POSITIONAL),
# diverged (ONE `A⇄B` merge over both slots), diverged-then-DETACHED (nothing
# names its tip, so nothing clicks) and staged (the ` ✓` carrying the message the
# row mints off its own head).  The leg asserts the face+`O` pairs and their
# spells, plain parity, and two live clicks; this script witnesses both with git.
#
# THE GAP THIS REPROS: the commit frame was inert text under one region-wide
# `list <wt>/` U, so no board row could push, pull, merge or commit anything.
#
# Standalone: `sh bee/test/cpanel/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/cpanel
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "cpanel: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "cpanel: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "cpanel: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "cpanel: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-cpanel.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — the leg COMMITS in its
#  own throwaway worktree and writes `$HOME/.config/bee/repos`, never the user's.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "cpanel: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "cpanel: runtime $RT, fixtures $WORK"

ci() { GIT_AUTHOR_DATE="@1700000000 +0000" GIT_COMMITTER_DATE="@1700000000 +0000" \
       git -C "$1" commit -q -m "$2"; }
# The UPSTREAM is the repo's own `master` (`branch.<b>.remote = .`, as
# test/wts/run.sh:166:eR does), so the whole fixture is one repo and a `pull` click
# fetches and fast-forwards for real without a network or a second clone.
track() { git -C "$SRC/alpha" config "branch.$1.remote" . &&
          git -C "$SRC/alpha" config "branch.$1.merge" refs/heads/master; }

# The fixture — one repo, one topic, five tickets, each with a worktree of its
# own.  Titles are short, so a golden plain line is the frames and nothing else;
# GET-005's carries an apostrophe, which the ✓ spell must quote around.
mkdir -p "$SRC/alpha/todo/GET" && ( cd "$SRC/alpha" && git init -q -b master . &&
  git config user.email t@t && git config user.name T ) || exit 2
mk() { printf '#   %s: %s\n    Now: OPEN\n' "$1" "$2" > "$SRC/alpha/todo/GET/$1.mkd"; }
mk GET-001 "ahead by one"
mk GET-002 "behind by one"
mk GET-003 "diverged both ways"
mk GET-004 "detached and diverged"
mk GET-005 "it's staged"
printf 'a\n' > "$SRC/alpha/a.txt"
( cd "$SRC/alpha" && git add -A ) || exit 2
ci "$SRC/alpha" seed || exit 2
printf '%s\n' "$SRC/alpha" > "$REG"

# The three worktrees cut off the SEED tip — master moves on below, so each of
# them ends up behind it by one.
for k in GET-002 GET-003 GET-004; do
    git -C "$SRC/alpha" worktree add -q -b "$k" "$SRC/alpha-$k" master || exit 2
    track "$k" || exit 2
done
for k in GET-003 GET-004; do
    printf '%s\n' "$k" > "$SRC/alpha-$k/own.txt"
    ( cd "$SRC/alpha-$k" && git add -A ) || exit 2
    ci "$SRC/alpha-$k" "local work" || exit 2
done
# ...and GET-004 then DETACHES: its head names a branch no more, so no upstream
# answers and the whole pair must go dead however diverged the tips are.
git -C "$SRC/alpha-GET-004" checkout -q --detach || exit 2

# master moves on: everything cut above is now one commit behind it.
printf 'c\n' > "$SRC/alpha/c.txt"
( cd "$SRC/alpha" && git add -A ) || exit 2
ci "$SRC/alpha" "master moves on" || exit 2

# The two worktrees cut off the NEW master tip: one commits (ahead by one), the
# other only STAGES (in sync, its ✓ lit).
for k in GET-001 GET-005; do
    git -C "$SRC/alpha" worktree add -q -b "$k" "$SRC/alpha-$k" master || exit 2
    track "$k" || exit 2
done
printf 'mine\n' > "$SRC/alpha-GET-001/own.txt"
( cd "$SRC/alpha-GET-001" && git add -A ) || exit 2
ci "$SRC/alpha-GET-001" "ahead by one" || exit 2
printf 'edited\n' > "$SRC/alpha-GET-005/a.txt"
git -C "$SRC/alpha-GET-005" add a.txt || exit 2

# The JS leg (QJAB-001: the --eval script door; requires climb via $WORK/jsrc).
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/cpanel.js')" ) \
    > "$WORK/c.out" 2> "$WORK/c.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- cpanel stderr ---"; cat "$WORK/c.err"
    bad "cpanel leg exited non-zero (rc $RC)" "$WORK/c.out"
elif grep -q '^FAIL' "$WORK/c.out"; then
    cat "$WORK/c.out"; bad "cpanel leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/c.out"; then
    cat "$WORK/c.out"; bad "cpanel leg did not finish"
else
    N=$(grep -c '^ok' "$WORK/c.out")
    CHECKS=$((CHECKS + N))
    ok "cpanel leg: $N checks (the five states, the spells, plain parity, the clicks)"
fi

# The two clicks really moved the fixture, and git is the witness — outside the
# runtime under test.
if [ -f "$SRC/alpha-GET-002/c.txt" ] &&
   [ "$(git -C "$SRC/alpha-GET-002" rev-parse HEAD)" = \
     "$(git -C "$SRC/alpha" rev-parse master)" ]
then ok 'the -1 click fast-forwarded alpha-GET-002 onto the upstream tip'
else bad 'the -1 click did not fast-forward alpha-GET-002'; fi

if [ "$(git -C "$SRC/alpha-GET-005" log -1 --format=%s)" = "GET-005: it's staged" ]
then ok "the ✓ click committed the minted 'KEY: <title>' message"
else bad "the ✓ click committed '$(git -C "$SRC/alpha-GET-005" log -1 --format=%s)'"; fi

if [ -z "$(git -C "$SRC/alpha-GET-005" diff --cached --name-only)" ] &&
   [ -z "$(git -C "$SRC/alpha" diff --cached --name-only)" ]
then ok "...leaving nothing staged, and the board's own repo untouched"
else bad "the ✓ click left work staged: $(git -C "$SRC/alpha-GET-005" diff --cached --name-only)"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/cpanel] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/cpanel] $CHECKS checks, runtime $RT"
exit 0
