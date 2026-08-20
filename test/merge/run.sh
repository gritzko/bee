#!/bin/sh
# lite/test/merge/run.sh — LITE-014: the `lite merge` driver + `lite install`.
# Three legs over the landed lite tree (main.js, index/weave.js, merge.js):
#   weave — weave.js: the port itself, headless (trivial shortcuts, conflict
#           spans, re-absorbed equal bytes, over-cap and binary null).
#   verb  — this script, part 1: the driver contract over plain files — the six
#           weave-merge scenarios PORTED FROM be/test/patch (conflict,
#           same-anchor-conflict, stacked-conflict, dirty-overlap,
#           multiedit-line, readd-line): the same file contents and edit
#           scripts, reduced to the three BLOBS a driver is handed, asserting
#           the same merged bytes and a markerless render.
#   git   — this script, part 2: a throwaway repo, `lite install`, and a REAL
#           `git merge` routed through the driver — disjoint edits land clean
#           where stock git conflicts, a genuine overlap leaves git unmerged
#           with markerless woven bytes, a reinstall changes nothing, and an
#           unweavable file (binary / over the 4 MB cap) goes to git merge-file.
#
# Standalone: `sh lite/test/merge/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`) — the GIT leg runs the driver
# through that same binary, so it must be built from THIS tree.  Fixtures live
# in a mktemp dir under ~/tmp, removed on a green run (kept, with the path
# printed, on a red).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/merge
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

# --- the runtime ----------------------------------------------------------
RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "merge: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "merge: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "merge: SKIP — no git to drive a merge" >&2; exit 0; }

# --- scratch --------------------------------------------------------------
TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "merge: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-merge.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "merge: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
rt()   { ( cd "$LITE" && HOME="$FAKEHOME" "$RT" "$@" ); }
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "merge: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — the weave port itself (headless)
# ==========================================================================
ln -sf "$LITE" "$WORK/jsrc"
( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$CASE/weave.js')" ) \
    > "$WORK/w.out" 2>"$WORK/w.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/w.out" && ! grep -q '^FAIL' "$WORK/w.out"; then
    N=$(grep -c '^ok' "$WORK/w.out"); CHECKS=$((CHECKS + N))
    ok "weave leg: $N checks (shortcuts / spans / re-absorption / null)"
else
    cat "$WORK/w.out"; head -5 "$WORK/w.err"
    bad "weave leg (rc $RC)" "$WORK/w.out"
fi

# ==========================================================================
# leg 2 — the DRIVER CONTRACT over three files, the be/test/patch scenarios
# ==========================================================================
# One case: write the three blobs, run the driver, compare bytes + exit code.
#   case <name> <base> <ours> <theirs> <want-rc> <want-bytes>
D="$WORK/blobs"; mkdir -p "$D"
case_() {
    _n=$1; printf "$2" > "$D/b"; printf "$3" > "$D/o"; printf "$4" > "$D/t"
    _rc=$5; _want=$6
    cp "$D/o" "$D/out"
    rtin "$D" merge b o t -o out -p f.txt > "$D/so" 2>"$D/se"; _got=$?
    printf "$_want" > "$D/want"
    if [ "$_got" = "$_rc" ] && cmp -s "$D/want" "$D/out"; then
        ok "$_n (rc $_got)"
    else
        bad "$_n: rc $_got want $_rc" "$D/want" "$D/out" "$D/se"
    fi
    # DIS-080: never, in any case, a fence marker.
    if grep -q '<<<<<<<\|>>>>>>>\|^=======$' "$D/out" 2>/dev/null
    then bad "$_n wrote conflict fences" "$D/out"; else ok "$_n is markerless"; fi
}

# be/test/patch/conflict — both sides rewrite the SAME line differently.
# be's golden reads `YX` (its RGA tie-break runs on the real commit shas); the
# driver's three blobs fold under FIXED synthetic ids, so the side order is
# theirs-first here.  Both sides present, markerless, non-zero — that is the
# ruled behaviour; the ORDER is a function of the ids, not of the merge.
case_ 'conflict' 'a\nb\nc\n' 'a\nY\nc\n' 'a\nX\nc\n' 1 'a\nXY\nc\n'

# be/test/patch/same-anchor-conflict — each side edits the same anchor over TWO
# commits; a driver sees only the endpoints (O2 / X2), which is the same clash.
case_ 'same-anchor-conflict' 'a\nb\nc\n' 'a\nO2\nc\n' 'a\nX2\nc\n' 1 'a\nX2O2\nc\n'

# be/test/patch/dirty-overlap — an uncommitted ours edit that collides with
# theirs on the same line: both sides survive, byte for byte as be's golden.
case_ 'dirty-overlap' '1\n2\n3\n4\n' '1\n2\nOURS\n4\n' '1\n2\nTHEIRS\n4\n' 1 '1\n2\nTHEIRSOURS\n4\n'

# be/test/patch/multiedit-line — theirs converges line 1 on a3 over three
# commits, ours edits a disjoint line: a CLEAN merge, be's golden bytes.
case_ 'multiedit-line' 'a\nb\nc\n' 'a\nb\nC\n' 'a3\nb\nc\n' 0 'a3\nb\nC\n'

# be/test/patch/readd-line — theirs adds X, deletes it, re-adds it (net: X is
# back), ours edits a disjoint line: CLEAN, be's golden bytes.
case_ 'readd-line' 'a\nb\nc\n' 'A\nb\nc\n' 'a\nb\nX\nc\n' 0 'A\nb\nX\nc\n'

# be/test/patch/stacked-conflict — TWO runs over the SAME conflicted line.  Run
# 1's markerless output must fold again as ordinary content (the case fences
# broke): run 2 weaves Z in and all three sides survive.
S="$WORK/stack"; mkdir -p "$S"
printf 'a\nb\nc\n' > "$S/b"; printf 'a\nY\nc\n' > "$S/o"; printf 'a\nX\nc\n' > "$S/t1"
printf 'a\nZ\nc\n' > "$S/t2"
cp "$S/o" "$S/f"
rtin "$S" merge b f t1 -p f.txt > "$S/o1" 2>"$S/e1"; R1=$?
cp "$S/f" "$S/f2"
rtin "$S" merge b f2 t2 -p f.txt > "$S/o2" 2>"$S/e2"; R2=$?
printf 'a\nZXY\nc\n' > "$S/want"
if [ "$R1" = 1 ] && [ "$R2" = 1 ] && cmp -s "$S/want" "$S/f2" &&
   ! grep -q '<<<<' "$S/f" && ! grep -q '<<<<' "$S/f2"
then ok "stacked-conflict: run 2 re-weaves run 1's markerless bytes ($R1/$R2)"
else bad "stacked-conflict (rc $R1/$R2)" "$S/want" "$S/f2" "$S/e2"; fi

# The default output is OURS (the driver contract): no -o at all.
if cmp -s "$S/want" "$S/f2" && ! cmp -s "$S/o" "$S/f"
then ok "the merged bytes default over <ours>, no -o needed"
else bad "default out = ours" "$S/f"; fi

# -o writes ELSEWHERE and leaves ours untouched.
A="$WORK/argv"; mkdir -p "$A"
printf 'a\nb\nc\n' > "$A/b"; printf 'a\nb\nC\n' > "$A/o"; printf 'A\nb\nc\n' > "$A/t"
cp "$A/o" "$A/okeep"
rtin "$A" merge b o t -o elsewhere -p f.txt > "$A/so" 2>"$A/se"; RC=$?
printf 'A\nb\nC\n' > "$A/want"
if [ "$RC" = 0 ] && cmp -s "$A/want" "$A/elsewhere" && cmp -s "$A/okeep" "$A/o"
then ok "-o <out> writes there and leaves <ours> alone"
else bad "-o <out> (rc $RC)" "$A/want" "$A/elsewhere" "$A/se"; fi

# A clean merge says NOTHING on stdout (git wants a quiet driver).
if [ ! -s "$A/so" ]
then ok "a clean merge prints nothing"
else bad "a clean merge is quiet" "$A/so"; fi

# Wrong arity is refused in plain words, and nothing is written.
rtin "$A" merge b o > "$A/u1" 2>"$A/u1e"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$A/u1" ] && grep -q 'three files' "$A/u1e"
then ok "two files instead of three is refused in plain words"
else bad "arity refusal (rc $RC)" "$A/u1" "$A/u1e"; fi

rtin "$A" merge b o t -o > "$A/u2" 2>"$A/u2e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'needs a file name' "$A/u2e"
then ok "a dangling -o is refused in plain words"
else bad "dangling -o (rc $RC)" "$A/u2e"; fi

rtin "$A" merge nosuch o t > "$A/u3" 2>"$A/u3e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'cannot read the base file' "$A/u3e"
then ok "a missing input file is refused in plain words"
else bad "missing input (rc $RC)" "$A/u3e"; fi

# ==========================================================================
# leg 3 — a REAL git merge through the installed driver
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'the quick brown fox\njumps over\nthe lazy dog\n' > f.txt
  printf 'keep\n' > other.txt
  git add -A && git commit -q -m base
) || { echo "merge: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
BASESHA=$(g rev-parse master)

# I1: install writes both halves — the driver into .git/config, the pattern
# into .git/info/attributes (never a tracked file: git ignores driver commands
# from those).
rtin "$REPO" install > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
DRV=$(g config --get merge.bee.driver 2>/dev/null || echo "")
NAM=$(g config --get merge.bee.name 2>/dev/null || echo "")
if [ "$RC" = 0 ] && [ -n "$NAM" ] &&
   [ "$DRV" = "$RT merge %O %A %B -o %A -p %P" ] &&
   grep -qx '\* merge=bee' "$REPO/.git/info/attributes"
then ok "install: the driver in .git/config, the pattern in .git/info/attributes"
else bad "install (rc $RC) driver='$DRV'" "$WORK/i1" "$WORK/i1e" "$REPO/.git/info/attributes"; fi

# I2: the second run is a NO-OP — one attributes line, the same config, and it
# says so instead of appending a duplicate.
cp "$REPO/.git/config" "$WORK/cfg1"; cp "$REPO/.git/info/attributes" "$WORK/att1"
rtin "$REPO" install > "$WORK/i2" 2>"$WORK/i2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/cfg1" "$REPO/.git/config" &&
   cmp -s "$WORK/att1" "$REPO/.git/info/attributes" &&
   [ "$(grep -c 'merge=bee' "$REPO/.git/info/attributes")" = 1 ] &&
   grep -q 'already installed' "$WORK/i2"
then ok "install twice changes nothing (no duplicate attribute line)"
else bad "reinstall no-op (rc $RC)" "$WORK/i2" "$WORK/i2e" "$REPO/.git/info/attributes"; fi

# G1: THE selling point — two branches edit DIFFERENT WORDS of the SAME line.
# Stock git conflicts on exactly these three blobs; through the driver the
# merge lands clean and commits itself.
g checkout -q -b feat
printf 'the quick brown dog\njumps over\nthe lazy dog\n' > "$REPO/f.txt"
g commit -qam theirs
THEIRS=$(g rev-parse feat)
g checkout -q master
printf 'the slow brown fox\njumps over\nthe lazy dog\n' > "$REPO/f.txt"
g commit -qam ours

# the stock-git control: same three blobs, git's own text merge CONFLICTS.
g cat-file blob "$BASESHA:f.txt" > "$WORK/sb"
g cat-file blob "master:f.txt"   > "$WORK/so"
g cat-file blob "$THEIRS:f.txt"  > "$WORK/st"
git merge-file -q "$WORK/so" "$WORK/sb" "$WORK/st" >/dev/null 2>&1; SRC=$?
if [ "$SRC" != 0 ] && grep -q '<<<<' "$WORK/so"
then ok "control: stock git conflicts on these very blobs"
else bad "the control case must conflict under stock git (rc $SRC)" "$WORK/so"; fi

g merge feat > "$WORK/m1" 2>"$WORK/m1e"; RC=$?
printf 'the slow brown dog\njumps over\nthe lazy dog\n' > "$WORK/wm1"
if [ "$RC" = 0 ] && cmp -s "$WORK/wm1" "$REPO/f.txt" &&
   [ -z "$(g status --short)" ] && [ "$(g rev-list --count HEAD)" -ge 4 ]
then ok "git merge: disjoint word edits merge CLEAN where stock git conflicts"
else bad "clean git merge (rc $RC)" "$WORK/wm1" "$REPO/f.txt" "$WORK/m1" "$WORK/m1e"; fi

# G2: a GENUINE overlap — both sides rewrite the same word.  git must end up
# UNMERGED with all three stages recorded, and the worktree bytes must carry
# both sides MARKERLESS (DIS-080: `git mergetool` finds no fences by design).
g checkout -q -b feat2
printf 'the quick brown cat\njumps over\nthe lazy dog\n' > "$REPO/f.txt"
g commit -qam theirs2
g checkout -q master
printf 'the quick brown owl\njumps over\nthe lazy dog\n' > "$REPO/f.txt"
g commit -qam ours2
g merge feat2 > "$WORK/m2" 2>"$WORK/m2e"; RC=$?
UN=$(( $(g ls-files -u f.txt | wc -l) ))
if [ "$RC" != 0 ] && [ "$UN" = 3 ] &&
   g status --short | grep -q '^UU f.txt' &&
   grep -q 'cat' "$REPO/f.txt" && grep -q 'owl' "$REPO/f.txt" &&
   ! grep -q '<<<<<<<\|>>>>>>>' "$REPO/f.txt"
then ok "git merge: a real overlap leaves git unmerged, bytes woven markerless"
else bad "conflicted git merge (rc $RC, stages $UN)" "$REPO/f.txt" "$WORK/m2" "$WORK/m2e"; fi
g merge --abort 2>/dev/null

# G3: a BINARY file never reaches the weave — the driver hands it to git's own
# merge, which refuses it LOUDLY (non-zero), and never silently takes ours.
BIN="$WORK/bin"; mkdir -p "$BIN"
printf 'AA\000ZZ\n' > "$BIN/b"; printf 'AB\000ZZ\n' > "$BIN/o"; printf 'AA\000ZY\n' > "$BIN/t"
cp "$BIN/o" "$BIN/out"
rtin "$BIN" merge b o t -o out -p x.bin > "$BIN/so" 2>"$BIN/se"; RC=$?
if [ "$RC" != 0 ] && grep -q 'git merge-file' "$BIN/se"
then ok "a binary file falls back to git merge-file and refuses loudly"
else bad "binary fallback (rc $RC)" "$BIN/se" "$BIN/so"; fi

# G4: OVER THE 4 MB CAP — not weavable either, but perfectly mergeable as text,
# so the fallback must produce GIT's merged result (not ours, not a refusal).
BIG="$WORK/big"; mkdir -p "$BIG"
( i=0; while [ $i -lt 140000 ]; do echo "line $i padding padding padding"; i=$((i+1)); done ) > "$BIG/b"
[ "$(( $(wc -c < "$BIG/b") ))" -gt 4194304 ] || { echo "merge: over-cap fixture too small" >&2; exit 2; }
{ echo "OURS HEAD"; cat "$BIG/b"; } > "$BIG/o"
{ cat "$BIG/b"; echo "THEIRS TAIL"; } > "$BIG/t"
cp "$BIG/o" "$BIG/out"
rtin "$BIG" merge b o t -o out -p big.txt > "$BIG/so" 2>"$BIG/se"; RC=$?
{ echo "OURS HEAD"; cat "$BIG/b"; echo "THEIRS TAIL"; } > "$BIG/want"
if [ "$RC" = 0 ] && cmp -s "$BIG/want" "$BIG/out"
then ok "an over-cap file falls back to git merge-file and takes ITS result"
else bad "over-cap fallback (rc $RC)" "$BIG/se" "$BIG/so"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/merge] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/merge] $CHECKS checks, runtime $RT"
exit 0
