#!/bin/sh
# bee/test/fork/run.sh — BEE-026: `bee fork //repo-TKT-123`, the ticket worktree.
# The work loop gives every ticket its own tree; `git worktree add` alone leaves
# every submodule dir EMPTY, so the verb recurses: each gitlink the parent
# records gets a worktree of its own repo, detached at that commit.
#   leg 1  create — the report line, the branch off HEAD, both submodule levels
#          populated at the recorded commits, a clean `git status`, no registry line
#   leg 2  the name — the LONGEST registry name wins the split, an unknown
#          prefix, a word that is not `//name`-shaped, an existing tree
#   leg 3  an existing branch is CHECKED OUT, not re-created
#   leg 4  a gitlink commit that is not here refuses NAMING the sub and rolls
#          the half-built tree back — no tree, no worktree left registered
#   leg 5  BEE-059: an UNINITIALISED nested gitlink is SKIPPED and tallied, the
#          fork stands; a nested refusal names the sub from the FORK ROOT
#
# Standalone: `sh bee/test/fork/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/fork
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "fork: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "fork: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "fork: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "fork: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-fork.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "fork: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "fork: runtime $RT, fixtures $WORK"

# `bee fork` in the fixture's world: its own HOME (hence its own registry) and
# its own $SRC_ROOT, so nothing of the developer's tree is ever touched.
fork() { ( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" fork "$@" ); }

# --- the fixture ------------------------------------------------------------
# `main` carries `sub`, and `sub` carries `nest` — two levels of gitlink, which
# is what the recursion is for.  `main-journal` shares main's prefix, so the
# split has a longest name to find; `broke` records a gitlink nobody has.
mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
addsub() { git -C "$1" -c protocol.file.allow=always submodule add -q "$2" "$3" &&
           git -C "$1" commit -q -m "add $3"; }

mkrepo "$WORK/nest"
( cd "$WORK/nest" && printf 'the nested one\n' > n.txt && git add -A &&
  git commit -q -m 'nest seed' ) || exit 2
mkrepo "$WORK/sub"
( cd "$WORK/sub" && printf 'the submodule\n' > s.txt && git add -A &&
  git commit -q -m 'sub seed' ) || exit 2
addsub "$WORK/sub" "$WORK/nest" nest >/dev/null 2>&1 ||
  { echo "fork: SKIP — git submodule add failed" >&2; exit 0; }
mkrepo "$WORK/main"
( cd "$WORK/main" && printf 'the main repo\n' > m.txt && git add -A &&
  git commit -q -m 'main seed' ) || exit 2
addsub "$WORK/main" "$WORK/sub" sub >/dev/null 2>&1 || exit 2
git -C "$WORK/main" -c protocol.file.allow=always \
    submodule update -q --init --recursive || exit 2

mkrepo "$WORK/main-journal"
( cd "$WORK/main-journal" && printf 'the dashed name\n' > j.mkd && git add -A &&
  git commit -q -m 'journal seed' ) || exit 2

mkrepo "$WORK/broke"
( cd "$WORK/broke" && printf 'a bad gitlink\n' > b.txt && git add -A &&
  git commit -q -m 'broke seed' ) || exit 2
addsub "$WORK/broke" "$WORK/sub" sub >/dev/null 2>&1 || exit 2
FAKE=dead0000dead0000dead0000dead0000dead0000
git -C "$WORK/broke" update-index --add --cacheinfo 160000,$FAKE,sub || exit 2
git -C "$WORK/broke" commit -q -m 'a gitlink nobody fetched' || exit 2

# BEE-059: `lazy` records `nest`, but a CLONE of lazy never initialises it — the
# quickjs-ng `update = none` shape, an empty dir where a gitlink is.  `deep`
# carries `broke`, whose own nested `sub` IS a repo missing the recorded commit,
# so the refusal has a two-level path to name.
mkrepo "$WORK/lazy"
( cd "$WORK/lazy" && printf 'the lazy parent\n' > l.txt && git add -A &&
  git commit -q -m 'lazy seed' ) || exit 2
addsub "$WORK/lazy" "$WORK/nest" nest >/dev/null 2>&1 || exit 2
mkrepo "$WORK/top"
( cd "$WORK/top" && printf 'the top repo\n' > t.txt && git add -A &&
  git commit -q -m 'top seed' ) || exit 2
addsub "$WORK/top" "$WORK/lazy" lazy >/dev/null 2>&1 || exit 2

mkrepo "$WORK/deep"
( cd "$WORK/deep" && printf 'two levels down\n' > d.txt && git add -A &&
  git commit -q -m 'deep seed' ) || exit 2
addsub "$WORK/deep" "$WORK/broke" broke >/dev/null 2>&1 || exit 2
# the clone lands empty; this init leaves the repo behind and fails on the sha
git -C "$WORK/deep/broke" -c protocol.file.allow=always \
    submodule update --init sub >/dev/null 2>&1
[ -e "$WORK/deep/broke/sub/.git" ] || { echo "fork: SKIP — no nested repo" >&2; exit 0; }

printf '%s\n' "$WORK/main" "$WORK/main-journal" "$WORK/broke" \
    "$WORK/top" "$WORK/deep" > "$REG"
cp "$REG" "$WORK/reg.before"

SUBSHA=$(git -C "$WORK/main" ls-tree HEAD sub | awk '{print $3}')
NESTSHA=$(git -C "$WORK/sub" ls-tree HEAD nest | awk '{print $3}')

# ==========================================================================
# leg 1 — create: the tree, the branch, both submodule levels
# ==========================================================================
fork //main-TKT-123 > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
D="$SRC/main-TKT-123"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l1")" = "$D TKT-123 2 submodules" ]
then ok "\`bee fork //main-TKT-123\` reports the tree, the branch and the count"
else bad "the one report line (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

if [ -f "$D/m.txt" ] && [ "$(git -C "$D" rev-parse --abbrev-ref HEAD)" = TKT-123 ] &&
   [ "$(git -C "$D" rev-parse HEAD)" = "$(git -C "$WORK/main" rev-parse HEAD)" ]
then ok "the tree is checked out on TKT-123, branched off the repo's HEAD"
else bad "the tree and its branch" "$WORK/l1"; fi

if [ -f "$D/sub/s.txt" ] && [ "$(git -C "$D/sub" rev-parse HEAD)" = "$SUBSHA" ]
then ok "the submodule is a POPULATED worktree at the recorded gitlink"
else bad "the submodule worktree"; fi

if [ -f "$D/sub/nest/n.txt" ] &&
   [ "$(git -C "$D/sub/nest" rev-parse HEAD)" = "$NESTSHA" ]
then ok "...and the recursion reached the nested submodule too"
else bad "the nested submodule worktree"; fi

if [ -z "$(git -C "$D" status --porcelain 2>"$WORK/l1s")" ]
then ok "\`git status\` in the new tree is clean — no dirty gitlink"
else bad "a clean status" "$WORK/l1s"; fi

# BEE-009: a linked worktree is not a repo — it indexes through the original.
if cmp -s "$REG" "$WORK/reg.before"
then ok "the new worktree is NOT registered in .config/bee/repos"
else bad "the registry is untouched" "$REG"; fi

# ==========================================================================
# leg 2 — the name: the longest split, and the three refusals
# ==========================================================================
fork //main-journal-BEE-1 > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
J="$SRC/main-journal-BEE-1"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l2")" = "$J BEE-1 0 submodules" ] &&
   [ "$(git -C "$J" rev-parse --abbrev-ref HEAD)" = BEE-1 ]
then ok "the LONGEST registry name wins the split — main-journal, not main"
else bad "the longest-prefix split (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi

fork //main-TKT-123 > "$WORK/l3" 2>"$WORK/l3e"; RC=$?
if [ "$RC" != 0 ] && grep -q "//main-TKT-123: exists" "$WORK/l3e"
then ok "a tree that is already there is refused, not overwritten"
else bad "the exists refusal (rc $RC)" "$WORK/l3" "$WORK/l3e"; fi

fork //nosuch-TKT-1 > "$WORK/l4" 2>"$WORK/l4e"; RC=$?
if [ "$RC" != 0 ] && grep -q "no registered repo names it" "$WORK/l4e" &&
   [ ! -e "$SRC/nosuch-TKT-1" ]
then ok "a word no registry name prefixes is refused in words"
else bad "the unknown-prefix refusal (rc $RC)" "$WORK/l4" "$WORK/l4e"; fi

fork main-TKT-1 > "$WORK/l5" 2>"$WORK/l5e"; RC=$?
if [ "$RC" != 0 ] && grep -q "not a //name" "$WORK/l5e"
then ok "a word that is not \`//name\`-shaped is refused"
else bad "the shape refusal (rc $RC)" "$WORK/l5" "$WORK/l5e"; fi

# ==========================================================================
# leg 3 — an EXISTING branch is checked out, never re-created
# ==========================================================================
git -C "$WORK/main" branch OLD-7 >/dev/null 2>&1 || exit 2
OLDSHA=$(git -C "$WORK/main" rev-parse OLD-7)
fork //main-OLD-7 > "$WORK/l6" 2>"$WORK/l6e"; RC=$?
O="$SRC/main-OLD-7"
if [ "$RC" = 0 ] && [ "$(git -C "$O" rev-parse --abbrev-ref HEAD)" = OLD-7 ] &&
   [ "$(git -C "$O" rev-parse HEAD)" = "$OLDSHA" ] && [ -f "$O/sub/s.txt" ]
then ok "an existing branch is CHECKED OUT where it stands, subs and all"
else bad "the branch-exists case (rc $RC)" "$WORK/l6" "$WORK/l6e"; fi

# ==========================================================================
# leg 4 — a gitlink nobody fetched: refuse by name, roll the tree back
# ==========================================================================
fork //broke-TKT-5 > "$WORK/l7" 2>"$WORK/l7e"; RC=$?
if [ "$RC" != 0 ] && grep -q "submodule sub" "$WORK/l7e" &&
   grep -q "dead0000" "$WORK/l7e"
then ok "a gitlink commit that is not here refuses, NAMING the submodule"
else bad "the missing-gitlink refusal (rc $RC)" "$WORK/l7" "$WORK/l7e"; fi

if [ ! -e "$SRC/broke-TKT-5" ] &&
   ! git -C "$WORK/broke" worktree list | grep -q broke-TKT-5
then ok "...and the half-built tree is rolled back, worktree list and all"
else bad "the rollback" "$WORK/l7e"; fi

# ==========================================================================
# leg 5 — BEE-059: an uninitialised gitlink is skipped, not fatal
# ==========================================================================
fork //top-TKT-9 > "$WORK/l8" 2>"$WORK/l8e"; RC=$?
T="$SRC/top-TKT-9"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l8")" = "$T TKT-9 1 submodule, 1 skipped" ]
then ok "an uninitialised nested gitlink is SKIPPED and the count says so"
else bad "the skip tally (rc $RC)" "$WORK/l8" "$WORK/l8e"; fi

if [ -f "$T/t.txt" ] && [ -f "$T/lazy/l.txt" ] &&
   [ "$(git -C "$T/lazy" rev-parse HEAD)" = \
     "$(git -C "$WORK/top" ls-tree HEAD lazy | awk '{print $3}')" ]
then ok "...the tree stands and the LIVE submodule is populated all the same"
else bad "the tree past a skipped sub" "$WORK/l8" "$WORK/l8e"; fi

if [ -d "$T/lazy/nest" ] && [ -z "$(ls -A "$T/lazy/nest")" ]
then ok "...and the skipped sub is an EMPTY dir, exactly as the source has it"
else bad "the skipped submodule dir"; fi

# BEE-026:44:uM does not move: a repo IS there, its recorded commit is not.
fork //deep-TKT-7 > "$WORK/l9" 2>"$WORK/l9e"; RC=$?
if [ "$RC" != 0 ] && grep -q "submodule broke/sub" "$WORK/l9e" &&
   grep -q "dead0000" "$WORK/l9e"
then ok "an unfetched NESTED gitlink refuses, named from the fork root"
else bad "the nested refusal (rc $RC)" "$WORK/l9" "$WORK/l9e"; fi

if [ ! -e "$SRC/deep-TKT-7" ] &&
   ! git -C "$WORK/deep" worktree list | grep -q deep-TKT-7 &&
   ! git -C "$WORK/broke" worktree list | grep -q deep-TKT-7
then ok "...and that refusal still rolls the whole half-built tree back"
else bad "the nested rollback" "$WORK/l9e"; fi

echo "fork: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
