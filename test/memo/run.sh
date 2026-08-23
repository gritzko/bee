#!/bin/sh
# bee/test/memo/run.sh — CODE-034: the ODB reader's per-repo memos are bounded.
# One leg over the landed bee tree:
#   memo — memo.js: `readCommit` fed 2*TREE_CACHE_MAX+1 distinct names leaves
#          the `commits` memo under the cap, the way `trees` and `subs` already
#          were, and the tip still reads back memoized afterwards.
#
# THE GAP THIS REPROS: `r.commits` grew without a cap, and since BEE-048 the
# ctx outlives the request, so a resident `bee http` held one parsed commit
# record per commit ever touched for the life of the process.
#
# Standalone: `sh bee/test/memo/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/memo
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "memo: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "memo: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "memo: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "memo: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-memo.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "memo: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home, never the user's own
#  `$HOME/.config/bee/repos`.
export HOME="$FAKEHOME"
rt()   { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" "$@" ); }
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "memo: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — three linear commits, the tip's subject `c2`
# ==========================================================================
REPO="$WORK/repo"
mkdir -p "$REPO/dir"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf '1\n' > a.txt; printf 'B1\n' > dir/b.txt
  git add -A && cm "2020-01-01T00:00:00Z" c0 || exit 1
  printf '2\n' > a.txt
  git add -A && cm "2020-01-02T00:00:00Z" c1 || exit 1
  printf '3\n' > a.txt
  git add -A && cm "2020-01-03T00:00:00Z" c2 || exit 1
) || { echo "memo: cannot build the fixture repo" >&2; exit 2; }

HEAD=$(git -C "$REPO" rev-parse master)

# ==========================================================================
# T1: the memo leg itself
# ==========================================================================
LITE_FIX="$REPO" LITE_HEAD="$HEAD" \
    rt --eval "require('$CASE/memo.js')" > "$WORK/m.out" 2>"$WORK/m.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- memo stderr ---"; cat "$WORK/m.err"
    bad "memo leg exited non-zero (rc $RC)" "$WORK/m.out"
elif grep -q '^FAIL' "$WORK/m.out"; then
    cat "$WORK/m.out"; bad "memo leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/m.out"; then
    cat "$WORK/m.out"; bad "memo leg did not finish"
else
    N=$(grep -c '^ok' "$WORK/m.out"); CHECKS=$((CHECKS + N))
    ok "memo leg: $N checks (the cap, the siblings, the hits it keeps)"
fi

# ==========================================================================
# T2: the walk the memo exists for is unchanged
# ==========================================================================
rtin "$REPO" index > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 3 commits, ' "$WORK/i1"
then ok "the commit walk still indexes the 3 commits"
else bad "the commit walk still indexes the 3 commits (rc $RC)" "$WORK/i1" "$WORK/i1e"; fi

rtin "$REPO" log 0 > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'c2' "$WORK/l1" && grep -q 'c1' "$WORK/l1" &&
   grep -q 'c0' "$WORK/l1"
then ok "the log still walks the whole history"
else bad "the log still walks the whole history (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/memo] $CHECKS checks, runtime $RT"
else echo "FAIL [bee/memo] $FAILED of $CHECKS checks failed"; exit 1; fi
