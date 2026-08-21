#!/bin/sh
# bee/test/subfold/run.sh — BEE-040: the gitlink subs fold into the FILE tallies
# and the bare staging verbs descend into them.  One nested fixture — parent +
# two submodules (one kept clean) + a grandchild inside the first — carries both
# halves, because either alone lies about the other.
#   leg 1  (JS) the folded un/st counts equal the per-repo sums, the clean sub
#          contributes zeros silently, an uninitialised sub tallies nothing,
#          and a replay with nothing touched answers the very same numbers
#   leg 2  an explicit-path `add` is PINNED to one repo — it never descends
#   leg 3  bare `add` / `rm` / `add +` stage the whole tree, ONE report line
#   leg 4  an all-staged tree is a quiet no-op, no empty-run cascade per sub
#   leg 5  the parent gitlink is bumped ONLY after a commit moved the sub's HEAD
#
# THE GAP THIS REPROS: wtstat tallied the TOP repo only while bare `add` staged
# the top repo only, so a ticket worktree with dirty mounts (fork.js gives every
# gitlink one) showed a clean frame over work no button could reach.
#
# Standalone: `sh bee/test/subfold/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/subfold
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "subfold: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "subfold: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "subfold: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "subfold: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-subfold.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
export HOME="$FAKEHOME"                    # BEE-031: a FIXTURE registry, never the user's
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "subfold: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -60 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
SRC="$WORK/src"; mkdir -p "$SRC"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" SRC_ROOT="$SRC" "$RT" "$@" ); }
echo "subfold: runtime $RT, fixtures $WORK"

#  `protocol.file.allow` is git 2.38's clamp on local submodule URIs — a fixture
#  that adds one by path needs it said out loud.
G() { git -c user.email=t@t -c user.name=T -c protocol.file.allow=always "$@"; }
DATED() { GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' G "$@"; }

# ==========================================================================
# the fixture — proj ⊃ { s1 ⊃ g, s2 }, dirt in proj, s1 and g; s2 kept CLEAN
# ==========================================================================
for r in g s1 s2 proj; do
    mkdir -p "$SRC/$r" || exit 2
    ( cd "$SRC/$r" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
done
( cd "$SRC/g"  && printf 'G0\n' > gg.txt && printf 'G0\n' > gd.txt &&
  git add -A && DATED commit -q -m seed ) || exit 2
( cd "$SRC/s1" && printf 'S0\n' > a.txt && printf 'S0\n' > b.txt &&
  git add -A && DATED commit -q -m seed &&
  G submodule add -q "$SRC/g" g && DATED commit -q -m 'mount g' ) || exit 2
( cd "$SRC/s2" && printf 'T0\n' > t.txt && git add -A && DATED commit -q -m seed ) || exit 2
( cd "$SRC/proj" && printf 'P0\n' > p.txt && printf 'P0\n' > pd.txt &&
  git add -A && DATED commit -q -m seed &&
  G submodule add -q "$SRC/s1" s1 && G submodule add -q "$SRC/s2" s2 &&
  DATED commit -q -m 'mount s1 s2' &&
  G submodule update -q --init --recursive ) || exit 2
#  A CLONE never initialises its mounts: the uninitialised-sub case, free.
G clone -q "$SRC/proj" "$SRC/dead" || exit 2

P="$SRC/proj"
( cd "$P"       && printf 'P1\n' > p.txt && rm pd.txt && printf 'N\n' > n.txt ) || exit 2
( cd "$P/s1"    && printf 'S1\n' > a.txt && printf 'S1\n' > b.txt &&
                  printf 'N\n' > sn.txt ) || exit 2
( cd "$P/s1/g"  && printf 'G1\n' > gg.txt && rm gd.txt ) || exit 2

# ==========================================================================
# leg 1 — the fold, through the REAL view/wtstat.js
# ==========================================================================
( cd "$WORK" && HOME="$FAKEHOME" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/fold.js')" ) \
    > "$WORK/f.out" 2> "$WORK/f.err"; RC=$?
sed 's/^/     /' "$WORK/f.out"
if [ "$RC" != 0 ]; then
    echo "--- fold stderr ---"; cat "$WORK/f.err"
    bad "fold leg exited non-zero (rc $RC)" "$WORK/f.out"
elif grep -q '^FAIL' "$WORK/f.out"; then
    bad "fold leg check(s) failed" "$WORK/f.out"
elif ! grep -q '^DONE' "$WORK/f.out"; then
    bad "fold leg did not finish" "$WORK/f.out"
else
    CHECKS=$((CHECKS + $(grep -c '^ok' "$WORK/f.out")))
    ok "fold leg: the folded tallies, the clean sub, the dead mount, the replay"
fi

# ==========================================================================
# leg 2 — an explicit path is ONE repo's file: no descent
# ==========================================================================
rtin "$P" add p.txt > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l2")" = "add 1 staged" ] && [ ! -s "$WORK/l2e" ]
then ok "\`bee add <path>\` reports its one file"
else bad "the explicit-path report (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi
if [ -z "$(git -C "$P/s1" diff --cached --name-only)" ] &&
   [ -z "$(git -C "$P/s1/g" diff --cached --name-only)" ]
then ok "...and NOT ONE sub was touched — a named file is one repo's file"
else bad "the explicit form descended into the subs"; fi
G -C "$P" reset -q                                   # back to an all-unstaged tree

# ==========================================================================
# leg 3 — the bare verbs descend, one report line for the whole tree
# ==========================================================================
rtin "$P" add > "$WORK/l3" 2>"$WORK/l3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l3")" = "add 4 staged" ] &&
   [ "$(( $(wc -l < "$WORK/l3") ))" = "1" ] && [ ! -s "$WORK/l3e" ]
then ok "bare \`add\` counts across the tree in ONE line — no per-sub cascade"
else bad "the folded add report (rc $RC)" "$WORK/l3" "$WORK/l3e"; fi
if git -C "$P/s1"   diff --cached --name-only | grep -qx 'a.txt' &&
   git -C "$P/s1"   diff --cached --name-only | grep -qx 'b.txt' &&
   git -C "$P/s1/g" diff --cached --name-only | grep -qx 'gg.txt' &&
   git -C "$P"      diff --cached --name-only | grep -qx 'p.txt'
then ok "every repo's modified-tracked class is staged, grandchild included"
else bad "the descent did not stage a sub" "$WORK/l3"; fi
if ! git -C "$P" diff --cached --name-only | grep -qx 's1'
then ok "the parent gitlink is NOT bumped — staging in a sub never moves its HEAD"
else bad "a gitlink was bumped with no commit behind it"; fi

rtin "$P" rm > "$WORK/l4" 2>"$WORK/l4e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l4")" = "rm 2 staged" ] &&
   [ "$(( $(wc -l < "$WORK/l4") ))" = "1" ] &&
   git -C "$P/s1/g" diff --cached --name-only --diff-filter=D | grep -qx 'gd.txt'
then ok "bare \`rm\` sweeps the gone class down to the grandchild"
else bad "the folded rm (rc $RC)" "$WORK/l4" "$WORK/l4e"; fi

rtin "$P" add + > "$WORK/l5" 2>"$WORK/l5e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l5")" = "add + 2 staged" ] &&
   [ "$(( $(wc -l < "$WORK/l5") ))" = "1" ] &&
   git -C "$P/s1" diff --cached --name-only | grep -qx 'sn.txt'
then ok "bare \`add +\` sweeps the untracked class too"
else bad "the folded add + (rc $RC)" "$WORK/l5" "$WORK/l5e"; fi

# ==========================================================================
# leg 4 — nothing left anywhere: one quiet line, not one per repo
# ==========================================================================
for _v in 'add:nothing to add' 'add +:nothing to add' 'rm:nothing to rm'; do
    _verb=${_v%%:*}; _say=${_v#*:}
    # shellcheck disable=SC2086
    rtin "$P" $_verb > "$WORK/l6" 2>"$WORK/l6e"; RC=$?
    if [ "$RC" = 0 ] && [ "$(cat "$WORK/l6")" = "$_say" ] &&
       [ "$(( $(wc -l < "$WORK/l6") ))" = "1" ] && [ ! -s "$WORK/l6e" ]
    then ok "\`bee $_verb\` over a swept tree: \"$_say\", ONE line"
    else bad "the empty-class cascade for \`$_verb\` (rc $RC)" "$WORK/l6" "$WORK/l6e"; fi
done

# ==========================================================================
# leg 5 — the gitlink bump: owed only where a commit moved the sub's HEAD
# ==========================================================================
DATED -C "$P/s1/g" commit -q -m 'in the grandchild' || exit 2
rtin "$P" add > "$WORK/l7" 2>"$WORK/l7e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l7")" = "add 1 staged" ] &&
   git -C "$P/s1" diff --cached --name-only | grep -qx 'g'
then ok "a commit in the grandchild bumps ITS parent's gitlink, and only that"
else bad "the grandchild gitlink bump (rc $RC)" "$WORK/l7" "$WORK/l7e"; fi
if ! git -C "$P" diff --cached --name-only | grep -qx 's1'
then ok "...while the top gitlink stays put — s1's own HEAD has not moved"
else bad "the top gitlink was bumped too early"; fi

DATED -C "$P/s1" commit -q -m 'in the sub' || exit 2
rtin "$P" add > "$WORK/l8" 2>"$WORK/l8e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l8")" = "add 1 staged" ] &&
   git -C "$P" diff --cached --name-only | grep -qx 's1'
then ok "and NOW the top gitlink is bumped — the recorded sha and HEAD differ"
else bad "the top gitlink bump (rc $RC)" "$WORK/l8" "$WORK/l8e"; fi
if ! git -C "$P" diff --cached --name-only | grep -qx 's2'
then ok "the clean sub is never bumped and never reported"
else bad "the clean sub was staged"; fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/subfold] $CHECKS checks, runtime $RT"; exit 0
else echo "FAIL [bee/subfold] $FAILED of $CHECKS checks"; exit 1; fi
