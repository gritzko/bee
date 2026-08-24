#!/bin/sh
# bee/test/cts/run.sh — BEE-033: the `CTS` row (kind 8), commit -> author date,
# and the index-only blob -> date fold it buys.  Legs over the landed bee tree:
#   verb  — this script: a cold `bee index` mints ONE row per walked commit and
#           a warm rerun writes not one byte more.
#   rows  — rows.js: `commitTs` equals `readCommit(...).ats` for every indexed
#           commit (the AUTHOR time, not the committer one), `blobTs` folds a
#           shared blob down to its OLDEST carrier, and a commit the walk never
#           entered answers `null` rather than a date it cannot know.
#
# THE GAP THIS REPROS: every "when" ended in an ODB object read, though the
# bring-up walk parses each commit's times anyway for the topo tiebreak and
# then throws them away.
#
# Standalone: `sh bee/test/cts/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/cts
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "cts: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "cts: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "cts: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "cts: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-cts.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "cts: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "cts: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — three commits, one of them with the author and the committer
# time DELIBERATELY apart, and one blob carried by two paths
# ==========================================================================
#   c0  a.txt=1  dir/b.txt=B1   author 2020-01-01, committer 2020-06-01
#   c1  a.txt=2                 2020-01-02
#   c2  moved.txt=2             2020-01-05  (the SAME blob as a.txt at c1)
#   orphan  off the indexed branch, so the walk never enters it
REPO="$WORK/repo"
mkdir -p "$REPO/dir"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$2" git commit -q -m "$3"; }
  printf '1\n' > a.txt; printf 'B1\n' > dir/b.txt
  git add -A && cm "2020-01-01T00:00:00Z" "2020-06-01T00:00:00Z" c0 || exit 1
  printf '2\n' > a.txt
  git add -A && cm "2020-01-02T00:00:00Z" "2020-01-02T00:00:00Z" c1 || exit 1
  printf '2\n' > moved.txt
  git add -A && cm "2020-01-05T00:00:00Z" "2020-01-05T00:00:00Z" c2 || exit 1
  git checkout -q -b orphan master~2
  printf 'o\n' > o.txt
  git add -A && cm "2020-02-02T00:00:00Z" "2020-02-02T00:00:00Z" c-orphan || exit 1
  git checkout -q master
) || { echo "cts: cannot build the fixture repo" >&2; exit 2; }

g() { git -C "$REPO" "$@"; }
C0=$(g rev-parse master~2); C1=$(g rev-parse master~1); C2=$(g rev-parse master)
ORPH=$(g rev-parse orphan)
B1=$(g rev-parse "$C0:dir/b.txt"); B2=$(g rev-parse "$C2:moved.txt")
litebytes() { cat "$REPO"/.git/be/*.lite3.idx 2>/dev/null | wc -c | tr -d ' '; }

# ==========================================================================
# leg 1 — the COLD MINT and the WARM no-op
# ==========================================================================
# T1: the cold run walks the three master commits.
rtin "$REPO" index > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 3 commits, ' "$WORK/i1"
then ok "the cold run indexes the 3 commits of master"
else bad "the cold run indexes the 3 commits of master (rc $RC)" "$WORK/i1" "$WORK/i1e"; fi

# T2..: the rows themselves, over the very index that run wrote.
LITE_FIX="$REPO" \
LITE_EXP="c0=$C0 c1=$C1 c2=$C2 orph=$ORPH b1=$B1 b2=$B2" \
    rt --eval "require('$CASE/rows.js')" > "$WORK/r.out" 2>"$WORK/r.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- rows stderr ---"; cat "$WORK/r.err"
    bad "rows leg exited non-zero (rc $RC)" "$WORK/r.out"
elif grep -q '^FAIL' "$WORK/r.out"; then
    cat "$WORK/r.out"; bad "rows leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/r.out"; then
    cat "$WORK/r.out"; bad "rows leg did not finish"
else
    N=$(grep -c '^ok' "$WORK/r.out"); CHECKS=$((CHECKS + N))
    ok "rows leg: $N checks (one row per commit / ats / blobTs / the null miss)"
fi

# T3: a WARM rerun is the mark no-op — it writes not one byte more.
BEFORE=$(litebytes)
rtin "$REPO" index > "$WORK/i2" 2>"$WORK/i2e"; RC=$?
AFTER=$(litebytes)
if [ "$RC" = 0 ] && grep -q '^up to date: ' "$WORK/i2" && [ "$BEFORE" = "$AFTER" ]
then ok "a warm rerun mints no second CTS row ($BEFORE bytes, unchanged)"
else bad "a warm rerun writes nothing (rc $RC, $BEFORE -> $AFTER)" "$WORK/i2" "$WORK/i2e"; fi

# T4: `rm -rf .git/be` and the rows come back — the lane is derived, so the
# row is minted by the rebuild and never by a repair on a read path.
rm -rf "$REPO/.git/be"
rtin "$REPO" log > "$WORK/i3" 2>"$WORK/i3e"; RC=$?
LITE_FIX="$REPO" LITE_EXP="c0=$C0 c1=$C1 c2=$C2 orph=$ORPH b1=$B1 b2=$B2" \
    rt --eval "require('$CASE/rows.js')" > "$WORK/r2.out" 2>"$WORK/r2.err"; RC2=$?
if [ "$RC" = 0 ] && [ "$RC2" = 0 ] && grep -q '^DONE' "$WORK/r2.out" &&
   ! grep -q '^FAIL' "$WORK/r2.out"
then ok "rm -rf .git/be rebuilds the CTS rows whole"
else cat "$WORK/r2.out"; bad "rm -rf .git/be rebuilds the CTS rows (rc $RC/$RC2)" \
         "$WORK/i3e" "$WORK/r2.err"; fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/cts] $CHECKS checks, runtime $RT"
else echo "FAIL [bee/cts] $FAILED of $CHECKS checks failed"; exit 1; fi
