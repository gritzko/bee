#!/bin/sh
# bee/test/wts/run.sh — BEE-027: the ticket worktrees of the board.  Three
# pieces and two legs:
#   leg 1  this script — `bee wts` over a fixture $SRC_ROOT: the naming-
#          convention scan (a match, a name with no dash, a LONGEST dashed
#          registry name, a matching dir with no repo in it), the two frames at
#          be's widths, a frame that MOVES after a worktree edit and is the same
#          bytes after a no-op run
#   leg 2  rev.js — the rev tree and the per-wt memo: an event stamps the wt and
#          every ancestor while a sibling stands still, an ignored dir is never
#          armed, a root bump drops everything, and with no watcher every query
#          is a fresh token, so a one-shot run memoizes nothing
#
# THE GAP THIS REPROS: bee had no notion of "the worktrees of a repo" and no
# process-resident memo of any kind — every view recomputed per call, so the
# [BEE-025] board could not carry a status per ticket at all.
#
# Standalone: `sh bee/test/wts/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/wts
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "wts: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "wts: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "wts: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "wts: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-wts.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "wts: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "wts: runtime $RT, fixtures $WORK"

# The fixture's own world: its own HOME (hence its own registry) and its own
# $SRC_ROOT, so nothing of the developer's tree is ever read or touched.
bee() { ( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" "$@" ); }

# ==========================================================================
# the fixture — two registered repos whose names share a prefix, a worktree
# apiece (two of the first), a no-dash name, and a matching dir with no repo
# ==========================================================================
mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
seed() {
    ( cd "$1" && printf 'build/\n*.o\n' > .gitignore && printf 'S0\n' > a.txt &&
      mkdir -p sub && printf 'X0\n' > sub/x.txt && git add -A &&
      GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
        git commit -q -m 'seed' ) || exit 2
}
mkrepo "$SRC/repo";      seed "$SRC/repo"
mkrepo "$SRC/repo-side"; seed "$SRC/repo-side"
mkrepo "$SRC/repo1";     seed "$SRC/repo1"        # no dash: never a worktree

printf '%s\n%s\n' "$SRC/repo" "$SRC/repo-side" > "$REG"

git -C "$SRC/repo" worktree add -q -b TKT-1 "$SRC/repo-TKT-1" || exit 2
git -C "$SRC/repo" worktree add -q -b TKT-2 "$SRC/repo-TKT-2" || exit 2
# The LONGEST registry name must win the split: this is repo-side's TKT-9, not
# repo's `side-TKT-9` (index/wts.js:24:uR split, fork.js:58's rule backwards).
git -C "$SRC/repo-side" worktree add -q -b TKT-9 "$SRC/repo-side-TKT-9" || exit 2
# A dir named like a worktree but holding no repo at all.
mkdir -p "$SRC/repo-NOGIT/sub" && printf 'not a repo\n' > "$SRC/repo-NOGIT/x.txt"
# The dirs rev.js writes into: both must exist BEFORE it arms the tree, so what
# it measures is a file event, never the dir's own creation.
mkdir -p "$SRC/repo-TKT-1/build" && printf 'O0\n' > "$SRC/repo-TKT-1/build/seed.o"

# ==========================================================================
# leg 1 — the scan and the two frames
# ==========================================================================
bee wts > "$WORK/one" 2> "$WORK/one.err" || { echo "wts: the verb failed" >&2;
    cat "$WORK/one.err" >&2; exit 2; }

[ "$(wc -l < "$WORK/one")" = 3 ] &&
  ok "three worktrees under \$SRC_ROOT" || bad "three worktrees under \$SRC_ROOT" "$WORK/one"

if grep -q '^repo-TKT-1 ' "$WORK/one" && grep -q '^repo-TKT-2 ' "$WORK/one"
then ok "a <name>-<tail> dir holding a repo is a worktree"
else bad "a <name>-<tail> dir holding a repo is a worktree" "$WORK/one"; fi

if grep -q '^repo-side-TKT-9 ' "$WORK/one"
then ok "the longest registry name wins the split"
else bad "the longest registry name wins the split" "$WORK/one"; fi

if grep -q '^repo1 ' "$WORK/one"
then bad "a name with no dash is not a worktree" "$WORK/one"
else ok "a name with no dash is not a worktree"; fi

if grep -q 'repo-NOGIT' "$WORK/one"
then bad "a matching dir with no repo is skipped" "$WORK/one"
else ok "a matching dir with no repo is skipped"; fi

# be's widths (todo.js:721): the file frame 16 cells, the commit frame 13.
if awk '{ i = index($0, "[")
          if (i == 0 || length($0) != i + 29) { bad = 1; next }
          if (substr($0, i, 1) != "[" || substr($0, i + 15, 1) != "]") bad = 1
          if (substr($0, i + 17, 1) != "[" || substr($0, i + 29, 1) != "]") bad = 1 }
        END { exit bad ? 1 : 0 }' "$WORK/one"
then ok "the frames are 16 and 13 cells wide"
else bad "the frames are 16 and 13 cells wide" "$WORK/one"; fi

# A quiet worktree has nothing to count, and its commit frame still names a tip.
if grep -q '^repo-TKT-2 \[ *\] \[ *[0-9a-f][0-9a-f]*\]$' "$WORK/one"
then ok "a quiet worktree counts nothing and names its tip"
else bad "a quiet worktree counts nothing and names its tip" "$WORK/one"; fi

# ==========================================================================
# leg 1b — a no-op run repeats byte for byte; an edit moves exactly one row
# ==========================================================================
bee wts > "$WORK/two" 2> "$WORK/two.err"
if cmp -s "$WORK/one" "$WORK/two"
then ok "a no-op run prints the same bytes"
else bad "a no-op run prints the same bytes" "$WORK/one" "$WORK/two"; fi

printf 'UNTRACKED\n' > "$SRC/repo-TKT-1/new.txt"
bee wts > "$WORK/three" 2> "$WORK/three.err"
if grep -q '^repo-TKT-1 \[ *v1 *\] ' "$WORK/three"
then ok "an edit lights the worktree column of the file frame"
else bad "an edit lights the worktree column of the file frame" "$WORK/three"; fi

if [ "$(grep -c '^repo-TKT-2 ' "$WORK/three")" = 1 ] &&
   [ "$(grep '^repo-TKT-2 ' "$WORK/two")" = "$(grep '^repo-TKT-2 ' "$WORK/three")" ]
then ok "a sibling worktree's row does not move"
else bad "a sibling worktree's row does not move" "$WORK/two" "$WORK/three"; fi

# An ignored file is not a worktree change — the same walk `bee status` prunes.
printf 'JUNK\n' > "$SRC/repo-TKT-1/build/junk.o"
bee wts > "$WORK/four" 2> "$WORK/four.err"
if cmp -s "$WORK/three" "$WORK/four"
then ok "an ignored file changes no frame"
else bad "an ignored file changes no frame" "$WORK/three" "$WORK/four"; fi

# A commit the upstream has not got lights the commit frame's ahead slot.
( cd "$SRC/repo-TKT-2" && printf 'S1\n' > a.txt && git add -A &&
  git -c user.email=t@t -c user.name=T commit -q -m 'ahead by one' ) || exit 2
git -C "$SRC/repo-TKT-2" config branch.TKT-2.remote . || exit 2
git -C "$SRC/repo-TKT-2" config branch.TKT-2.merge refs/heads/master || exit 2
bee wts > "$WORK/five" 2> "$WORK/five.err"
if grep -q '^repo-TKT-2 .* \[o1 *[0-9a-f][0-9a-f]*\]$' "$WORK/five"
then ok "a commit the upstream lacks lights the ahead slot"
else bad "a commit the upstream lacks lights the ahead slot" "$WORK/five"; fi

# ==========================================================================
# leg 2 — the rev tree and the per-wt memo, in the runtime
# ==========================================================================
rm -f "$SRC/repo-TKT-1/new.txt"
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/rev.js')" ) \
  > "$WORK/r.out" 2> "$WORK/r.err"
RC=$?
sed 's/^/     /' "$WORK/r.out"
if [ "$RC" = 0 ] && grep -q '^PASS ' "$WORK/r.out"
then ok "rev.js: the rev tree and the per-wt memo"
else bad "rev.js: the rev tree and the per-wt memo" "$WORK/r.err"; fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/wts] $CHECKS shell checks, plus rev.js"; exit 0
else echo "FAIL [bee/wts] $FAILED of $CHECKS shell checks"; exit 1; fi
