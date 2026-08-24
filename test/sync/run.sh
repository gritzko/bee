#!/bin/sh
# bee/test/sync/run.sh — BEE-037: `commit`, `push`, `pull`, `merge`.
# THE REPRO: bee could stage (BEE-036) but not move history, so every panel
# button past the FILE frame had no verb to spend a click on.  Each verb is one
# honest git sequence: git's words, git's exit status, one report line of ours.
#   leg 1  `commit 'msg'` commits; nothing staged refuses in GIT's words, and
#          the word `commit` still opens view/commit.js when it names a rev
#   leg 2  `push` reaches the tracked upstream; a non-FF rejection passes
#          through untouched, non-zero
#   leg 3  `pull` fast-forwards a behind-only clone, autostashing a dirty wt;
#          a DIVERGED pair fails loud (--ff-only) with the edits back in place
#   leg 4  `merge` integrates the diverged pair through the weave driver; a
#          conflicting merge ABORTS and restores the worktree byte for byte
#   leg 5  the one case autostash cannot undo: the merge lands, the REAPPLY
#          conflicts, git keeps the stash — bee degrades loud, nothing lost
#
# Standalone: `sh bee/test/sync/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/sync
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "sync: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "sync: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "sync: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "sync: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-sync.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "sync: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — nothing here ever
#  writes the developer's own `$HOME/.config/bee/repos`.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                # TEST-005:8 unpacked-runtime climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "sync: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — a BARE origin and two clones of it, which is the only shape
# that can manufacture ahead, behind, diverged and dirty-diverged for real
# ==========================================================================
# pair <name> -> $WORK/<name>/{origin.git,A,B}, seeded and both clones tracking.
pair() {
    P="$WORK/$1"; mkdir -p "$P"
    (
      cd "$P" || exit 1
      git init -q --bare -b master origin.git || exit 1
      git clone -q origin.git A 2>/dev/null; git clone -q origin.git B 2>/dev/null
      for d in A B; do
        cd "$P/$d" || exit 1
        git config user.email t@t && git config user.name T || exit 1
      done
      cd "$P/A" || exit 1
      printf 'l1\nl2\nl3\n' > c.txt          # the file both sides will touch
      printf 'x\n'          > d.txt          # a quiet neighbour
      git add . || exit 1
      GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
        git commit -q -m 'seed' || exit 1
      git push -q -u origin master || exit 1
      cd "$P/B" || exit 1
      git fetch -q && git checkout -q -B master origin/master &&
        git branch -q --set-upstream-to=origin/master origin/master >/dev/null 2>&1
      git branch -q --set-upstream-to=origin/master >/dev/null 2>&1
      exit 0
    ) || { echo "sync: cannot build the $1 fixture" >&2; exit 2; }
}

# theirs <repo> <text> — a commit on that clone, pushed: the OTHER side's work.
theirs() {
    ( cd "$1" && printf 'l1\n%s\nl3\n' "$2" > c.txt &&
      GIT_AUTHOR_DATE='@1700000100 +0000' GIT_COMMITTER_DATE='@1700000100 +0000' \
        git commit -qam "theirs $2" && git push -q ) ||
    { echo "sync: cannot push from $1" >&2; exit 2; }
}

# ==========================================================================
# leg 1 — `commit`: the write, the refusal, and the VIEW that shares the word
# ==========================================================================
pair one
ONE="$WORK/one/A"
printf 'l1\nMINE\nl3\n' > "$ONE/c.txt"

# nothing staged yet: git's own refusal, non-zero, no report line of ours.
rtin "$ONE" commit 'BEE-037: nothing here' > "$WORK/c0" 2>"$WORK/c0e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'no changes added to commit' "$WORK/c0" &&
   ! grep -q '^commit ' "$WORK/c0"
then ok "\`bee commit\` with nothing staged refuses in GIT's own words, non-zero"
else bad "the nothing-staged refusal (rc $RC)" "$WORK/c0" "$WORK/c0e"; fi

rtin "$ONE" add > /dev/null 2>&1
rtin "$ONE" commit 'BEE-037: the first line' > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
SHA=$(git -C "$ONE" rev-parse --short HEAD)
if [ "$RC" = 0 ] && [ "$(cat "$WORK/c1")" = "commit $SHA" ] && [ ! -s "$WORK/c1e" ]
then ok "\`bee commit 'msg'\` writes the commit and reports its abbreviated sha"
else bad "the commit report line (rc $RC)" "$WORK/c1" "$WORK/c1e"; fi

if [ "$(git -C "$ONE" log -1 --format=%s)" = "BEE-037: the first line" ]
then ok "...and the message reaches git verbatim, one commit made"
else bad "the message reached git" "$WORK/c1"; fi

# The word `commit` is a VIEW too (view/commit.js): a rev never holds a space,
# so the two never collide — `bee commit <sha>` still reads.
rtin "$ONE" commit --plain "$SHA" > "$WORK/c2" 2>"$WORK/c2e"; RC=$?
if [ "$RC" = 0 ] && grep -q "^tree " "$WORK/c2"
then ok "\`bee commit <rev>\` still opens the READING view, unshadowed"
else bad "the commit view survives the verb (rc $RC)" "$WORK/c2" "$WORK/c2e"; fi

# ==========================================================================
# leg 2 — `push`: the tracked upstream, and a non-FF rejection untouched
# ==========================================================================
rtin "$ONE" push > "$WORK/p1" 2>"$WORK/p1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/p1")" = "push origin/master $SHA" ]
then ok "\`bee push\` reaches @{u} and names the branch and the commit"
else bad "the push report line (rc $RC)" "$WORK/p1" "$WORK/p1e"; fi

if [ "$(git -C "$WORK/one/origin.git" rev-parse --short master)" = "$SHA" ]
then ok "...and the bare origin really moved"
else bad "origin moved"; fi

# B's clone is now BEHIND and commits anyway -> its push is a non-FF.
pair two
theirs "$WORK/two/B" THEIRS                      # origin ahead of A
TWO="$WORK/two/A"
printf 'l1\nMINE\nl3\n' > "$TWO/c.txt"
rtin "$TWO" add > /dev/null 2>&1
rtin "$TWO" commit 'BEE-037: mine' > /dev/null 2>&1        # A and origin diverge
rtin "$TWO" push > "$WORK/p2" 2>"$WORK/p2e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'rejected' "$WORK/p2e" &&
   grep -q 'failed to push some refs' "$WORK/p2e" && ! grep -q '^push ' "$WORK/p2"
then ok "a non-FF rejection reaches stderr in GIT's words, exit non-zero"
else bad "the non-FF push refusal (rc $RC)" "$WORK/p2" "$WORK/p2e"; fi

# ==========================================================================
# leg 3 — `pull`: the ff-only ladder, dirty worktree autostashed
# ==========================================================================
pair three
theirs "$WORK/three/B" THEIRS
THREE="$WORK/three/A"
printf 'DIRTY\n' > "$THREE/d.txt"                # a dirty wt the FF must survive
D_SUM=$(md5sum < "$THREE/d.txt")
rtin "$THREE" pull > "$WORK/u1" 2>"$WORK/u1e"; RC=$?
TIP=$(git -C "$THREE" rev-parse --short HEAD)
# git says "Created autostash: <sha>" on the same stdout, and bee never eats a
# word of git's — so the report line is the LAST one, not the only one.
if [ "$RC" = 0 ] && [ "$(tail -1 "$WORK/u1")" = "pull origin/master $TIP" ]
then ok "\`bee pull\` fast-forwards a behind-only clone, one report line"
else bad "the pull report line (rc $RC)" "$WORK/u1" "$WORK/u1e"; fi

if grep -qx 'THEIRS' "$THREE/c.txt" && [ "$D_SUM" = "$(md5sum < "$THREE/d.txt")" ] &&
   [ -z "$(git -C "$THREE" rev-parse --verify --quiet refs/stash)" ]
then ok "...the upstream is in, the dirty edit is back, no stash left behind"
else bad "the autostash round trip" "$THREE/c.txt" "$THREE/d.txt"; fi

# A DIVERGED pair is not a fast-forward: --ff-only makes it fail LOUD.
pair four
theirs "$WORK/four/B" THEIRS
FOUR="$WORK/four/A"
printf 'l1\nMINE\nl3\n' > "$FOUR/c.txt"
rtin "$FOUR" add > /dev/null 2>&1
rtin "$FOUR" commit 'BEE-037: mine' > /dev/null 2>&1
printf 'DIRTY\n' > "$FOUR/d.txt"
BEFORE=$(git -C "$FOUR" rev-parse HEAD)
rtin "$FOUR" pull > "$WORK/u2" 2>"$WORK/u2e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Not possible to fast-forward' "$WORK/u2e" &&
   ! grep -q '^pull ' "$WORK/u2"
then ok "\`bee pull\` on a DIVERGED pair fails loud — no merge commit is woven"
else bad "the ff-only refusal (rc $RC)" "$WORK/u2" "$WORK/u2e"; fi

if [ "$(git -C "$FOUR" rev-parse HEAD)" = "$BEFORE" ] &&
   [ "$(cat "$FOUR/d.txt")" = "DIRTY" ] &&
   [ -z "$(git -C "$FOUR" rev-parse --verify --quiet refs/stash)" ]
then ok "...and the refusal left HEAD, the dirty edit and the stash untouched"
else bad "the ff-only refusal is a no-op" "$FOUR/d.txt"; fi

# ==========================================================================
# leg 4 — `merge`: the diverged pair integrated, and the ABORT that restores
# ==========================================================================
pair five
theirs "$WORK/five/B" THEIRS                     # theirs touches c.txt line 2
FIVE="$WORK/five/A"
printf 'l1\nl2\nl3\nMINE\n' > "$FIVE/c.txt"      # ours touches line 4 — no clash
rtin "$FIVE" add > /dev/null 2>&1
rtin "$FIVE" commit 'BEE-037: mine' > /dev/null 2>&1
printf 'DIRTY\n' > "$FIVE/d.txt"                 # dirty-diverged: the autostash
rtin "$FIVE" merge > "$WORK/m1" 2>"$WORK/m1e"; RC=$?
TIP=$(git -C "$FIVE" rev-parse --short HEAD)
if [ "$RC" = 0 ] && [ "$(tail -1 "$WORK/m1")" = "merge origin/master $TIP" ]
then ok "\`bee merge\` integrates a DIRTY diverged pair, one report line"
else bad "the merge report line (rc $RC)" "$WORK/m1" "$WORK/m1e"; fi

if [ -n "$(git -C "$FIVE" rev-parse -q --verify HEAD^2)" ] &&
   grep -qx 'THEIRS' "$FIVE/c.txt" && grep -qx 'MINE' "$FIVE/c.txt" &&
   [ "$(cat "$FIVE/d.txt")" = "DIRTY" ]
then ok "...a real merge commit, both sides in the file, the dirty edit back"
else bad "the merge landed both sides" "$FIVE/c.txt" "$FIVE/d.txt"; fi

# The CONFLICTING merge, through bee's own weave driver: the verb aborts, and
# `--autostash`'s abort is what puts the dirty edit back byte for byte.
pair six
SIX="$WORK/six/A"
rtin "$SIX" install > /dev/null 2>&1             # the weave merge driver, LITE-014
theirs "$WORK/six/B" THEIRS
printf 'l1\nMINE\nl3\n' > "$SIX/c.txt"           # the SAME line as theirs
rtin "$SIX" add > /dev/null 2>&1
rtin "$SIX" commit 'BEE-037: mine' > /dev/null 2>&1
printf 'DIRTY\n' > "$SIX/d.txt"
BEFORE=$(git -C "$SIX" rev-parse HEAD)
SUM=$(cat "$SIX/c.txt" "$SIX/d.txt" | md5sum)
rtin "$SIX" merge > "$WORK/m2" 2>"$WORK/m2e"; RC=$?
# The weave driver speaks on the same stderr, so BEE's own report is the one
# `bee: merge` line — that is what "ONE line" means here.
if [ "$RC" != 0 ] && [ "$(grep -c 'bee: merge' "$WORK/m2e")" = 1 ] &&
   grep -q 'did not integrate' "$WORK/m2e" && ! grep -q '^merge ' "$WORK/m2"
then ok "a conflicting merge reports ONE line and exits non-zero"
else bad "the conflict report (rc $RC)" "$WORK/m2" "$WORK/m2e"; fi

if [ "$(git -C "$SIX" rev-parse HEAD)" = "$BEFORE" ] &&
   [ "$SUM" = "$(cat "$SIX/c.txt" "$SIX/d.txt" | md5sum)" ] &&
   [ -z "$(git -C "$SIX" rev-parse --verify --quiet refs/stash)" ] &&
   [ ! -e "$SIX/.git/MERGE_HEAD" ]
then ok "...and the abort restored the worktree BYTE for byte, no stash stranded"
else bad "the abort restores the worktree" "$SIX/c.txt" "$SIX/d.txt"; fi

# ==========================================================================
# leg 5 — the one path autostash cannot undo: the merge lands, the REAPPLY
# conflicts, git keeps the stash and says so.  Degrade LOUD, lose nothing.
# ==========================================================================
pair seven
theirs "$WORK/seven/B" THEIRS                    # behind-only: the merge WILL land
SEVEN="$WORK/seven/A"
printf 'l1\nOURS\nl3\n' > "$SEVEN/c.txt"         # uncommitted, on the same line
rtin "$SEVEN" merge > "$WORK/m3" 2>"$WORK/m3e"; RC=$?
if [ "$RC" != 0 ] && [ "$(grep -c 'bee: merge' "$WORK/m3e")" = 1 ] &&
   grep -q 'safe in the stash' "$WORK/m3e" && ! grep -q '^merge ' "$WORK/m3"
then ok "a conflicting autostash REAPPLY is loud and non-zero, merge or not"
else bad "the reapply-conflict report (rc $RC)" "$WORK/m3" "$WORK/m3e"; fi

if [ "$(git -C "$SEVEN" rev-parse HEAD)" = "$(git -C "$SEVEN" rev-parse origin/master)" ] &&
   [ -n "$(git -C "$SEVEN" rev-parse --verify --quiet refs/stash)" ] &&
   git -C "$SEVEN" stash show -p stash@{0} 2>/dev/null | grep -q 'OURS'
then ok "...the merge is in and the edits are SAFE in the stash — nothing lost"
else bad "the reapply conflict loses nothing"; fi

echo "sync: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
