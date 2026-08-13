#!/bin/sh
# lite/test/index/run.sh — LITE-006: the `quickjab index <repo>` suite.
# Two legs over the LANDED lite tree (main.js, index/index.js, index/refs.js):
#   verb  — this script: the CLI contract over a fixture git repo (a few commits
#           incl. a merge and a rename-free blob move) — the first run's summary,
#           the tracks list (append + dedup), the no-op second run, the gap run
#           after a new commit, a rewritten history (non-ancestor mark -> rewalk,
#           re-puts idempotent) and the `rm -rf .git/be` rebuild.
#   rows  — rows.js: the six ruled record kinds, one file's rev chain as ONE
#           prefix scan, the B2P rows of a shared blob, CPAR edges, the MARK.
#
# Standalone: `sh lite/test/index/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`; quickjab/build-lite/bin/quickjab
# passes the same).  Fixtures live in a mktemp dir under ~/tmp and are removed
# on a green run (kept, with the path printed, when something fails).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/index
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

# --- the runtime ----------------------------------------------------------
RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "index: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "index: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "index: SKIP — no git to build a fixture" >&2; exit 0; }

# --- scratch --------------------------------------------------------------
TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "index: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-index.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "index: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

# The tracks list is $HOME/.config/be/tracks, so the runtime runs under a
# PLANTED home; the jsrc pack cache stays on the real one (XDG_CACHE_HOME).
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
rt() { ( cd "$LITE" && HOME="$FAKEHOME" "$RT" "$@" ); }

# --- the fixture repo -----------------------------------------------------
#   c0  a.txt=1  dir/b.txt=B1          (root)
#   c1  a.txt=2                        (master)
#   c2  dir/b.txt=B2                   (side, off c0)
#   c3  merge master+side              (a.txt from c1, dir/b.txt from c2)
#   c4  moved.txt=2                    (the SAME blob as a.txt at a new path)
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
  git checkout -q -b side HEAD~1
  printf 'B2\n' > dir/b.txt
  git add -A && cm "2020-01-03T00:00:00Z" c2 || exit 1
  git checkout -q master
  GIT_AUTHOR_DATE="2020-01-04T00:00:00Z" GIT_COMMITTER_DATE="2020-01-04T00:00:00Z" \
      git merge -q --no-ff -m c3 side || exit 1
  printf '2\n' > moved.txt
  git add -A && cm "2020-01-05T00:00:00Z" c4 || exit 1
) || { echo "index: cannot build the fixture repo" >&2; exit 2; }

g() { git -C "$REPO" "$@"; }
C0=$(g rev-parse master~2^)                 # the root
C1=$(g rev-parse master~1^1)
C2=$(g rev-parse master~1^2)
C3=$(g rev-parse master~1)
C4=$(g rev-parse master)
B1=$(g rev-parse "$C0:a.txt")
B2=$(g rev-parse "$C4:a.txt")
echo "index: runtime $RT, repo $REPO"

# ==========================================================================
# leg 1 — the CLI contract
# ==========================================================================
# V1: the first run indexes the whole history, ancestors before descendants.
rt index "$REPO" > "$WORK/o1" 2>"$WORK/e1"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 5 commits, 5 revs, [0-9]* rows .* refs/heads/master ' "$WORK/o1"
then ok "first run indexes 5 commits / 5 revs"
else bad "first run indexes 5 commits / 5 revs (rc $RC)" "$WORK/o1" "$WORK/e1"; fi

# V2: the run family landed in the repo's OWN .git/be/.
if [ -d "$REPO/.git/be" ] && ls "$REPO/.git/be" | grep -q '\.lite\.idx$'
then ok "the run family lives in <repo>/.git/be/"
else bad "the run family lives in <repo>/.git/be/" "$WORK/o1"; fi

# V3: the tracks list got the repo's absolute path.
TRK="$FAKEHOME/.config/be/tracks"
if [ -f "$TRK" ] && [ "$(cat "$TRK")" = "$REPO" ]
then ok "tracks lists the repo's absolute path"
else bad "tracks lists the repo's absolute path" "$TRK"; fi

# V4: the second run is a NO-OP (watermark hit) and does not re-append.
rt index "$REPO" > "$WORK/o2" 2>"$WORK/e2"; RC=$?
if [ "$RC" = 0 ] && grep -q "^up to date: refs/heads/master " "$WORK/o2" &&
   [ "$(wc -l < "$TRK")" = "1" ]
then ok "second run is a no-op, tracks dedups"
else bad "second run is a no-op, tracks dedups (rc $RC)" "$WORK/o2" "$WORK/e2" "$TRK"; fi

# ==========================================================================
# leg 1b — LITE-007: the `log` verb over the SAME index (still c0..c4).
# `log` discovers the repo by climbing from the CWD, so these run INSIDE it;
# the $WORK/jsrc plant keeps an unpacked runtime's require climb satisfied.
# ==========================================================================
ln -sf "$LITE" "$WORK/jsrc"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# An unindexed side commit: `log <that hex>` must refuse in plain words, since
# beagle-lite indexes the checked-out branch only.
g checkout -q -b orphan "$C0"
printf 'orphan\n' > "$REPO/orphan.txt"; g add -A
GIT_AUTHOR_DATE="2020-01-08T00:00:00Z" GIT_COMMITTER_DATE="2020-01-08T00:00:00Z" \
    g commit -q -m c-orphan
ORPH=$(g rev-parse orphan)
g checkout -q master

# G1: bare log = the whole reachable history, in `git log --date-order` order.
rtin "$REPO" log > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
g log --date-order --format='%H' | cut -c1-8 > "$WORK/l1g"
cut -c1-8 "$WORK/l1" > "$WORK/l1q"
if [ "$RC" = 0 ] && [ "$(wc -l < "$WORK/l1")" = "5" ] && cmp -s "$WORK/l1g" "$WORK/l1q"
then ok "log = the 5 reachable commits in git --date-order order"
else bad "log = the 5 reachable commits in git --date-order order (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

# G2: the ROW FORMAT is be log's, byte for byte:
#     <sha8> <7-col date> <summary> (<author>)
# The fixture dates are 2020, so the date column is the DDMonYY form; the exact
# day is left to the runtime's TZ, the WIDTH and the surrounding single spaces
# are what this pins.
if grep -q "^$(echo "$C4" | cut -c1-8) [0-9][0-9][A-Z][a-z][a-z]20 c4 (T)\$" "$WORK/l1"
then ok "row format = <sha8> <date7> <summary> (<author>)"
else bad "row format = <sha8> <date7> <summary> (<author>)" "$WORK/l1"; fi

# G3: `log <hex>` = that commit's ancestors, and a 10-char hexlet resolves the
# same log as the full sha.
rtin "$REPO" log "$C1" > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
rtin "$REPO" log "$(echo "$C1" | cut -c1-10)" > "$WORK/l2b" 2>/dev/null
g log --date-order --format='%H' "$C1" | cut -c1-8 > "$WORK/l2g"
cut -c1-8 "$WORK/l2" > "$WORK/l2q"
if [ "$RC" = 0 ] && cmp -s "$WORK/l2g" "$WORK/l2q" && cmp -s "$WORK/l2" "$WORK/l2b"
then ok "log <hex> = that commit's ancestors; a 10-char hexlet is the same log"
else bad "log <hex> = that commit's ancestors (rc $RC)" "$WORK/l2" "$WORK/l2g" "$WORK/l2e"; fi

# G4: `log <path>` = the commits that AMENDED the file.  a.txt was written by
# c0 and c1; the merge took c1's blob, so the merge is NOT a revision of it.
rtin "$REPO" log a.txt | cut -c1-8 > "$WORK/l3"
printf '%s\n%s\n' "$(echo "$C1" | cut -c1-8)" "$(echo "$C0" | cut -c1-8)" > "$WORK/l3w"
if cmp -s "$WORK/l3w" "$WORK/l3"
then ok "log a.txt = c1, c0 (the merge took c1's blob, so it is no revision)"
else bad "log a.txt = c1, c0" "$WORK/l3w" "$WORK/l3"; fi

# G5: a file revised on the SIDE branch, and one that shares another's blob.
rtin "$REPO" log dir/b.txt | cut -c1-8 > "$WORK/l4"
printf '%s\n%s\n' "$(echo "$C2" | cut -c1-8)" "$(echo "$C0" | cut -c1-8)" > "$WORK/l4w"
rtin "$REPO" log moved.txt | cut -c1-8 > "$WORK/l5"
if cmp -s "$WORK/l4w" "$WORK/l4" && [ "$(cat "$WORK/l5")" = "$(echo "$C4" | cut -c1-8)" ]
then ok "log dir/b.txt = c2, c0 (side branch); log moved.txt = c4 (shared blob)"
else bad "log dir/b.txt / moved.txt" "$WORK/l4w" "$WORK/l4" "$WORK/l5"; fi

# G6: a path relative to a SUBDIRECTORY resolves against the worktree root, and
# an unknown path is simply an empty log (git says nothing either).
rtin "$REPO/dir" log b.txt | cut -c1-8 > "$WORK/l6"
rtin "$REPO" log nosuch/file.txt > "$WORK/l7" 2>"$WORK/l7e"; RC=$?
if cmp -s "$WORK/l4w" "$WORK/l6" && [ "$RC" = 0 ] && [ ! -s "$WORK/l7" ]
then ok "a path is root-relative from any subdir; an unknown path = empty log"
else bad "subdir path / unknown path (rc $RC)" "$WORK/l6" "$WORK/l7" "$WORK/l7e"; fi

# G7: a commit outside the indexed branch is refused IN PLAIN WORDS, never
# answered with a one-row log that is silently wrong.
rtin "$REPO" log "$ORPH" > "$WORK/l8" 2>"$WORK/l8e"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/l8" ] && grep -q 'not in the history of' "$WORK/l8e"
then ok "a commit off the indexed branch is refused in plain words"
else bad "a commit off the indexed branch is refused in plain words (rc $RC)" "$WORK/l8" "$WORK/l8e"; fi

# G7b: the TTY rendering — a log is a HUNK painted by the same view machinery
# a file arg goes through, and `--plain` still yields the bare rows.
LITE_FIX="$REPO" rt --eval "require('$CASE/logcolor.js')" > "$WORK/lc.out" 2>"$WORK/lc.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/lc.out" && ! grep -q '^FAIL' "$WORK/lc.out"; then
    N=$(grep -c '^ok' "$WORK/lc.out"); CHECKS=$((CHECKS + N))
    ok "log colour leg: $N checks (hunk + tok32 spans + the be-log palette)"
else
    cat "$WORK/lc.out"; head -5 "$WORK/lc.err"
    bad "log colour leg (rc $RC)" "$WORK/lc.out"
fi

# G7bb: the REAL UI path — the same hunk on an actual pty through the shipped
# Pager.  Skip-guarded on the tty binding, like the pager suite's pty leg.
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$(rt --eval "require('$WORK/ttyprobe.js')" 2>/dev/null || echo err)
if [ "$HAS" != "yes" ]; then
    echo "index: SKIP log pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    LITE_FIX="$REPO" rt --eval "require('$CASE/logpty.js')" > "$WORK/lt.out" 2>"$WORK/lt.err"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/lt.out" && ! grep -q '^FAIL' "$WORK/lt.out"; then
        N=$(grep -c '^ok' "$WORK/lt.out"); CHECKS=$((CHECKS + N))
        ok "log pty leg: $N checks (banner band / painted rows / status bar)"
    else
        cat "$WORK/lt.out"; head -5 "$WORK/lt.err"
        bad "log pty leg (rc $RC)" "$WORK/lt.out"
    fi
fi

# G7c: `--plain` after the verb is accepted and is byte-identical to the piped
# dump (the tests and every `| grep` ride that path).
rtin "$REPO" log --plain > "$WORK/lp" 2>"$WORK/lpe"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/l1" "$WORK/lp"
then ok "log --plain = the piped rows, byte for byte"
else bad "log --plain = the piped rows (rc $RC)" "$WORK/l1" "$WORK/lp" "$WORK/lpe"; fi

# G8: LAZINESS — a FRESH clone has no .git/be at all; `log` alone must index it
# implicitly, answer, and write NOTHING else (no tracks line for the clone).
CLONE="$WORK/clone"
git clone -q --no-local "$REPO" "$CLONE" 2>/dev/null
rm -rf "$CLONE/.git/be"
TRKLINES=$(wc -l < "$TRK")
rtin "$CLONE" log > "$WORK/l9" 2>"$WORK/l9e"; RC=$?
if [ "$RC" = 0 ] && [ "$(wc -l < "$WORK/l9")" = "5" ] && [ -d "$CLONE/.git/be" ] &&
   [ "$(wc -l < "$TRK")" = "$TRKLINES" ]
then ok "log on a fresh clone indexes implicitly and adds no tracks line"
else bad "log on a fresh clone indexes implicitly (rc $RC)" "$WORK/l9" "$WORK/l9e"; fi

# ==========================================================================
# leg 2 — the ROWS (over the index the first run wrote)
# ==========================================================================
LITE_FIX="$REPO" \
LITE_EXP="c0=$C0 c1=$C1 c2=$C2 c3=$C3 c4=$C4 b1=$B1 b2=$B2" \
    rt --eval "require('$CASE/rows.js')" > "$WORK/r.out" 2>"$WORK/r.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- rows stderr ---"; cat "$WORK/r.err"
    bad "rows leg exited non-zero (rc $RC)" "$WORK/r.out"
elif grep -q '^FAIL' "$WORK/r.out"; then
    cat "$WORK/r.out"; bad "rows leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/r.out"; then
    cat "$WORK/r.out"; bad "rows leg did not finish"
else
    N=$(grep -c '^ok' "$WORK/r.out")
    CHECKS=$((CHECKS + N))
    ok "rows leg: $N checks (six kinds / rev chain / B2P / CPAR / MARK)"
fi

# ==========================================================================
# leg 1 continued — the GAP and the REWALK
# ==========================================================================
# V5: a new commit -> only the gap above the mark is indexed.
printf '3\n' > "$REPO/a.txt"; g add -A
GIT_AUTHOR_DATE="2020-01-06T00:00:00Z" GIT_COMMITTER_DATE="2020-01-06T00:00:00Z" \
    g commit -q -m c5
rt index "$REPO" > "$WORK/o3" 2>"$WORK/e3"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 1 commits, 1 revs, ' "$WORK/o3"
then ok "gap run indexes only the new commit"
else bad "gap run indexes only the new commit (rc $RC)" "$WORK/o3" "$WORK/e3"; fi

# V6: a REWRITTEN history — the mark names a commit that is no longer an
# ancestor, so the fast no-op misses; but PRESENCE is the walk boundary, so the
# climb stops at the first commit the lane already holds and only the ONE new
# commit is indexed.  Nothing below it is re-walked and nothing is re-minted.
g reset -q --hard "$C3"
printf '9\n' > "$REPO/a.txt"; g add -A
GIT_AUTHOR_DATE="2020-01-07T00:00:00Z" GIT_COMMITTER_DATE="2020-01-07T00:00:00Z" \
    g commit -q -m c6
rt index "$REPO" > "$WORK/o4" 2>"$WORK/e4"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 1 commits, 1 revs, ' "$WORK/o4"
then ok "a rewritten history walks only what the lane lacks"
else bad "a rewritten history walks only what the lane lacks (rc $RC)" "$WORK/o4" "$WORK/e4"; fi

# V6b: INTERRUPT-RESUME.  Drop the lane's MARK runs only?  There is no such
# surgery — instead simulate the crash the ruling cares about: index a fixture
# from scratch with the walk stopped part-way (the runtime is killed), then
# rerun.  `resume.js` does exactly that in-process: it indexes with an injected
# fault after N commits, reopens, and indexes again.
LITE_FIX="$REPO" rt --eval "require('$CASE/resume.js')" > "$WORK/rs.out" 2>"$WORK/rs.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/rs.out" && ! grep -q '^FAIL' "$WORK/rs.out"; then
    N=$(grep -c '^ok' "$WORK/rs.out"); CHECKS=$((CHECKS + N))
    ok "resume leg: $N checks (an interrupted index keeps its progress)"
else
    cat "$WORK/rs.out"; head -5 "$WORK/rs.err"
    bad "resume leg (rc $RC)" "$WORK/rs.out"
fi

# V7: `.git/be` is DERIVED — rm -rf it and the next run rebuilds it whole.
rm -rf "$REPO/.git/be"
rt index "$REPO" > "$WORK/o5" 2>"$WORK/e5"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 5 commits, 5 revs, ' "$WORK/o5"
then ok "rm -rf .git/be rebuilds from the ODB"
else bad "rm -rf .git/be rebuilds from the ODB (rc $RC)" "$WORK/o5" "$WORK/e5"; fi

# V8: a path that is no repository is refused in plain words.
rt index "$WORK/nosuch" > "$WORK/o6" 2>"$WORK/e6"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/o6" ] && grep -qi 'repositor' "$WORK/e6"
then ok "a non-repository arg is refused in plain words"
else bad "a non-repository arg is refused in plain words (rc $RC)" "$WORK/o6" "$WORK/e6"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/index] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/index] $CHECKS checks, runtime $RT"
exit 0
