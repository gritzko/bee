#!/bin/sh
# bee/test/status/run.sh — BEE-022: `bee status`, the quad over a plain git
# repo.  THE REPRO: bee had no verb that says what is dirty — `list` shows a
# 3-char marker over one dir, `diff` is worktree-vs-HEAD, and NOTHING ever
# named the upstream.  The quad ([/wiki/Status]) says a path's whole story in
# four chars, one per tree, position authoritative:
#
#   column 1 stands on the FORK POINT, 2..4 on the tip to their left
#   (gritzko 2026-08-18b): upstream vs fork, HEAD vs upstream, index vs
#   HEAD, worktree vs index.  So column 1 says what the UPSTREAM did and
#   a commit only WE made never lights it — the point of that ruling.
#   `.` same   `x` removed   `o` created   `v` advanced   `!` conflicted
#
# The fixture is a CLONE that has diverged from its origin, so every column
# has something to say at once: origin is one commit ahead (a.txt edited,
# up.txt added), the clone one commit origin has not got (b.txt edited,
# gone.txt deleted), with a staged edit, a staged add, a staged remove, an
# unstaged edit, an untracked file and two ignored ones on top.
#
# Standalone: `sh bee/test/status/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/status
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "status: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "status: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "status: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "status: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-status.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "status: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "status: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — an origin, a clone that diverged, and every local state
# ==========================================================================
ORIGIN="$WORK/origin"; mkdir -p "$ORIGIN/sub"
(
  cd "$ORIGIN" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'A0\n' > a.txt
  printf 'B0\n' > b.txt
  printf 'X0\n' > sub/x.txt
  printf 'GONE\n' > gone.txt
  printf 'RM\n' > rm.txt
  printf 'build/\n*.o\n' > .gitignore
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed' || exit 1
  printf 'A1\n' > a.txt                  # upstream-only edit  -> `vv..`
  printf 'UP\n' > up.txt                 # upstream-only add   -> `ox..`
  git add -A
  GIT_AUTHOR_DATE='@1700086400 +0000' GIT_COMMITTER_DATE='@1700086400 +0000' \
    git commit -q -m 'C1 upstream only' || exit 1
) || { echo "status: cannot build the origin" >&2; exit 2; }

REPO="$WORK/work"
git clone -q "$ORIGIN" "$REPO" || { echo "status: cannot clone" >&2; exit 2; }
(
  cd "$REPO" || exit 1
  git config user.email t@t && git config user.name T
  git reset -q --hard HEAD~1             # back to C0: now BEHIND by one
  printf 'B2\n' > b.txt                  # local-only edit     -> `vv..`
  printf 'LOC\n' > loc.txt               # local-only add      -> `xo..`
  git rm -q gone.txt                     # local-only delete   -> `ox..`
  git add -A
  GIT_AUTHOR_DATE='@1700172800 +0000' GIT_COMMITTER_DATE='@1700172800 +0000' \
    git commit -q -m 'C2 local only' || exit 1
  printf 'X9\n' > sub/x.txt; git add sub/x.txt       # staged edit   -> `..v.`
  printf 'N\n'  > n.txt;     git add n.txt           # staged add    -> `..o.`
  git rm -q --cached rm.txt >/dev/null               # staged remove -> `..xo`
  printf 'U\n' > u.txt                               # untracked     -> `...o`
  printf 'A0-dirty\n' >> a.txt                       # unstaged edit -> `vv.v`
  mkdir -p build; printf 'junk\n' > build/j.txt      # ignored: no row
  printf 'obj\n' > o.o                               # ignored: no row
) || { echo "status: cannot build the fixture worktree" >&2; exit 2; }

# ==========================================================================
# leg 1 — the CANON, one row per rung state
# ==========================================================================
rtin "$REPO" status --plain > "$WORK/out" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && [ -s "$WORK/out" ]
then ok "the view emits rows"
else bad "status (rc $RC)" "$WORK/out" "$WORK/err"; fi

for _row in 'vv.v a.txt' '.v.. b.txt' '.x.. gone.txt' '.o.. loc.txt' '..o. n.txt' \
            '..xo rm.txt' '..v. sub/x.txt' '...o u.txt' 'ox.. up.txt'; do
    if grep -qx "$_row" "$WORK/out"
    then ok "row: $_row"
    else bad "missing quad row: $_row" "$WORK/out"; fi
done

# WHO ADDED IT: a file the UPSTREAM added is `ox` — created since the fork,
# missing from HEAD — while one WE added leaves column 1 alone and reads `.o`.
# That asymmetry is the fork-point ruling's whole payload.
if grep -qx 'ox.. up.txt' "$WORK/out" && grep -qx '.o.. loc.txt' "$WORK/out"
then ok "column 1 names the upstream's own doing, never ours"
else bad "direction reading" "$WORK/out"; fi

# The ignore machinery — a build tree is not the output.
for _p in 'build/j.txt' 'o\.o'; do
    if ! grep -q "$_p" "$WORK/out"
    then ok "an ignored path has no row: $_p"
    else bad "ignored path listed: $_p" "$WORK/out"; fi
done
if ! grep -q '\.git/' "$WORK/out"
then ok "and neither does anything under .git"
else bad ".git listed" "$WORK/out"; fi
# A quiet path is no row at all — the all-`.` drop.
if ! grep -q ' sub/$' "$WORK/out" && ! grep -q '\.gitignore' "$WORK/out"
then ok "an unchanged path gets no row"
else bad "an unchanged path got a row" "$WORK/out"; fi

# THE CONTRACT: piped output is the bare ASCII canon, no colour, no glyph.
if [ "$(grep -cE '^[.xov!]{4} ' "$WORK/out")" = "$(($(( $(wc -l < "$WORK/out") )) - 1))" ]
then ok "every row but the summary is a bare 4-char quad"
else bad "the plain canon leaked" "$WORK/out"; fi
if ! grep -q "$(printf '\033')" "$WORK/out"
then ok "...with no escape byte anywhere in it"
else bad "escape bytes in plain output" "$WORK/out"; fi

# The commit rows: the same vocabulary one level up.
if grep -q '^\.o\.\. [0-9a-f]\{8\} C2 local only' "$WORK/out"
then ok "a local unposted commit is \`.o..\`"
else bad "no ahead commit row" "$WORK/out"; fi
if grep -q '^o\.\.\. [0-9a-f]\{8\} C1 upstream only' "$WORK/out"
then ok "an unabsorbed upstream commit is \`o...\`"
else bad "no behind commit row" "$WORK/out"; fi

# The summary line: the branch, its upstream, the per-column tallies.
if tail -1 "$WORK/out" | grep -q '^master\.\.\.origin/master	.*upstream.*head.*stage.*wt'
then ok "the summary names the branch, the upstream and the tallies"
else bad "summary line" "$WORK/out"; fi

# ==========================================================================
# leg 2 — the tty path: glyphs and cell colours, ONLY there
# ==========================================================================
rtin "$REPO" status --color > "$WORK/col" 2>"$WORK/colerr"; RC=$?
if [ "$RC" = 0 ] && grep -q '↑' "$WORK/col" && grep -q '●' "$WORK/col"
then ok "a coloured run substitutes the BRO-030 glyphs"
else bad "no tty glyphs (rc $RC)" "$WORK/col" "$WORK/colerr"; fi
# The quad owns FOUR slots (ruling 2026-08-18): I/J/K/V, never a borrowed
# syntax or status tag, so 208 here is the worktree column's ORANGE and no
# repaint of `list`'s brown del marker can reach it.
if grep -q "$(printf '\033')\[38;5;208m↑" "$WORK/col"
then ok "...and paints the worktree cell in its own orange"
else bad "no per-column cell paint" "$WORK/col"; fi

# ==========================================================================
# leg 3 — the DEGENERATE ROOTS ([/wiki/Status])
# ==========================================================================
rtin "$ORIGIN" status --plain > "$WORK/noup" 2>"$WORK/nouperr"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 "$WORK/noup")" = "$(printf 'master\tclean')" ]
then ok "no upstream: the 1st column is blank and the tree reads clean"
else bad "no-upstream run (rc $RC)" "$WORK/noup" "$WORK/nouperr"; fi

( cd "$REPO" && git checkout -q --detach HEAD ) || exit 2
rtin "$REPO" status --plain > "$WORK/det" 2>"$WORK/deterr"; RC=$?
if [ "$RC" = 0 ] && ! grep -qE '^[vox]' "$WORK/det" && grep -q '^HEAD	' "$WORK/det"
then ok "detached: track = the pin, so no column-1 char and no commit rows"
else bad "detached run (rc $RC)" "$WORK/det" "$WORK/deterr"; fi
( cd "$REPO" && git checkout -q master ) || exit 2

# Two tips that never met are NO special case: the ladder has no root to miss,
# so an unrelated history renders as an all-`ox`/`xo` quad instead of a refusal.
ORPH="$WORK/orph"
git clone -q "$ORIGIN" "$ORPH" >/dev/null 2>&1 || exit 2
(
  cd "$ORPH" || exit 1
  git config user.email t@t && git config user.name T
  git checkout -q --orphan fresh && git rm -q -rf . >/dev/null 2>&1
  printf 'Z\n' > z.txt && git add z.txt && git commit -q -m 'unrelated root'
  H=$(git rev-parse HEAD) && git checkout -q master && git reset -q --hard "$H"
) || { echo "status: cannot build the orphan fixture" >&2; exit 2; }
rtin "$ORPH" status --plain > "$WORK/orp.out" 2>"$WORK/orp.err"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'ox.. up.txt' "$WORK/orp.out" &&
   grep -qx '.o.. z.txt' "$WORK/orp.out"
then ok "no fork at all still RENDERS — an empty root, never a refusal"
else bad "unrelated-histories run (rc $RC)" "$WORK/orp.out" "$WORK/orp.err"; fi

# ==========================================================================
# leg 4 — a CONFLICT is the index's stage slots, read and never deduced
# ==========================================================================
CNF="$WORK/cnf"
git clone -q "$ORIGIN" "$CNF" >/dev/null 2>&1 || exit 2
(
  cd "$CNF" || exit 1
  git config user.email t@t && git config user.name T
  git checkout -q -b other HEAD~1 && printf 'OTHER\n' > a.txt &&
  git commit -q -am other && git checkout -q master
  git merge other >/dev/null 2>&1
  exit 0
) || exit 2
rtin "$CNF" status --plain > "$WORK/cnf.out" 2>"$WORK/cnf.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^...! a\.txt$' "$WORK/cnf.out"
then ok "a conflicted path spells the worktree char \`!\`"
else bad "conflict row (rc $RC)" "$WORK/cnf.out" "$WORK/cnf.err"; fi
if tail -1 "$WORK/cnf.out" | grep -q '1 con'
then ok "...and is tallied under \`con\`"
else bad "conflict tally" "$WORK/cnf.out"; fi

# ==========================================================================
# leg 5 — the READ-ONLY contract: a run changes nothing git owns
# ==========================================================================
BEFORE=$(cd "$REPO" && git status --porcelain && git rev-parse HEAD &&
         ls -l .git/index | tr -s ' ' | cut -d' ' -f5)
rtin "$REPO" status --plain > /dev/null 2>&1
AFTER=$(cd "$REPO" && git status --porcelain && git rev-parse HEAD &&
        ls -l .git/index | tr -s ' ' | cut -d' ' -f5)
if [ "$BEFORE" = "$AFTER" ]
then ok "a run leaves the index, HEAD and the worktree exactly as they were"
else bad "the view is not read-only"; fi

# ==========================================================================
# leg 6 — the pure MODEL, headless (view/quad.js)
# ==========================================================================
ln -sf "$LITE" "$WORK/jsrc"
( cd "$LITE" && HOME="$FAKEHOME" "$RT" --eval "require('$CASE/quad.js')" ) \
    > "$WORK/q.out" 2>"$WORK/q.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/q.out" && ! grep -q '^FAIL' "$WORK/q.out"; then
    N=$(grep -c '^ok' "$WORK/q.out"); CHECKS=$((CHECKS + N))
    ok "model leg: $N checks (the canon, the drop, the counts, the commit rows)"
else
    cat "$WORK/q.out"; head -5 "$WORK/q.err"
    bad "model leg (rc $RC)" "$WORK/q.out"
fi

# ==========================================================================
# leg 7 — the STAGE column with and WITHOUT its [GIT-032] reader
# ==========================================================================
( cd "$LITE" && HOME="$FAKEHOME" BEE_FIX="$REPO" \
  "$RT" --eval "if (typeof dog === 'undefined' || !dog.readIndex) { io.log('SKIP no dog.readIndex\n'); }
                else require('$CASE/stage.js');" ) > "$WORK/s.out" 2>"$WORK/s.err"; RC=$?
if grep -q '^SKIP' "$WORK/s.out"; then
    echo "skip stage leg — this runtime has no GIT-032 dog.readIndex"
elif [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/s.out" && ! grep -q '^FAIL' "$WORK/s.out"; then
    N=$(grep -c '^ok' "$WORK/s.out"); CHECKS=$((CHECKS + N))
    ok "stage leg: $N checks (the column, and the run that has no reader for it)"
else
    cat "$WORK/s.out"; head -5 "$WORK/s.err"
    bad "stage leg (rc $RC)" "$WORK/s.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/status] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/status] $CHECKS checks, runtime $RT"
exit 0
