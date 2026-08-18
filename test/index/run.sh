#!/bin/sh
# lite/test/index/run.sh — LITE-006: the `quickjab index <repo>` suite.
# Two legs over the LANDED lite tree (main.js, index/index.js, index/refs.js):
#   verb  — this script: the CLI contract over a fixture git repo (a few commits
#           incl. a merge and a rename-free blob move) — the first run's summary,
#           the repo list (append + dedup), the no-op second run, the gap run
#           after a new commit, a rewritten history (non-ancestor mark -> rewalk,
#           re-puts idempotent) and the `rm -rf .git/be` rebuild.
#   rows  — rows.js: the seven ruled record kinds, one file's rev chain as ONE
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

# The repo list is $HOME/.config/bee/repos, so the runtime runs under a
# PLANTED home; the jsrc pack cache stays on the real one (XDG_CACHE_HOME).
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
rt() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" "$@" ); }

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
# LITE-044: 7 revs, not 5 — the 5 file revs plus `dir/`'s own two (c0 seeds it,
# c2 changes b.txt under it), the rows the dir fuse reads.
rt index "$REPO" > "$WORK/o1" 2>"$WORK/e1"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 5 commits, 7 revs, [0-9]* rows .* refs/heads/master ' "$WORK/o1"
then ok "first run indexes 5 commits / 7 revs (5 file, 2 dir)"
else bad "first run indexes 5 commits / 7 revs (rc $RC)" "$WORK/o1" "$WORK/e1"; fi

# V2: the run family landed in the repo's OWN .git/be/.
if [ -d "$REPO/.git/be" ] && ls "$REPO/.git/be" | grep -q '\.lite2\.idx$'
then ok "the run family lives in <repo>/.git/be/"
else bad "the run family lives in <repo>/.git/be/" "$WORK/o1"; fi

# V3: BEE-001 — the repo list got the repo's absolute path.
TRK="$FAKEHOME/.config/bee/repos"
if [ -f "$TRK" ] && [ "$(cat "$TRK")" = "$REPO" ]
then ok "the repo list holds the repo's absolute path"
else bad "the repo list holds the repo's absolute path" "$TRK"; fi

# V4: the second run is a NO-OP (watermark hit) and does not re-append.
rt index "$REPO" > "$WORK/o2" 2>"$WORK/e2"; RC=$?
if [ "$RC" = 0 ] && grep -q "^up to date: refs/heads/master " "$WORK/o2" &&
   [ "$(( $(wc -l < "$TRK") ))" = "1" ]
then ok "second run is a no-op, the repo list dedups"
else bad "second run is a no-op, the repo list dedups (rc $RC)" "$WORK/o2" "$WORK/e2" "$TRK"; fi

# ==========================================================================
# leg 1b — LITE-007: the `log` verb over the SAME index (still c0..c4).
# `log` discovers the repo by climbing from the CWD, so these run INSIDE it;
# the $WORK/jsrc plant keeps an unpacked runtime's require climb satisfied.
# ==========================================================================
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
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/l1") ))" = "5" ] && cmp -s "$WORK/l1g" "$WORK/l1q"
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

# ==========================================================================
# leg 1c — LITE-011: a PARTIAL path resolves against the commit's tree
# ==========================================================================
# R1: `dir/b.txt` named by its BARE filename from the repo root.  `path_hl`
# hashes the WHOLE path, so `b.txt` hashes to a key the index does not hold —
# the FSEG rows + the tree descent are what turn it back into `dir/b.txt`.
rtin "$REPO" log b.txt 2>"$WORK/p1e" | cut -c1-8 > "$WORK/p1"
if cmp -s "$WORK/l4w" "$WORK/p1"
then ok "log <bare filename> resolves to dir/b.txt"
else bad "log <bare filename> resolves to dir/b.txt" "$WORK/l4w" "$WORK/p1" "$WORK/p1e"; fi

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
TRKLINES=$(( $(wc -l < "$TRK") ))
rtin "$CLONE" log > "$WORK/l9" 2>"$WORK/l9e"; RC=$?
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/l9") ))" = "5" ] && [ -d "$CLONE/.git/be" ] &&
   [ "$(( $(wc -l < "$TRK") ))" = "$TRKLINES" ]
then ok "log on a fresh clone indexes implicitly and adds no registry line"
else bad "log on a fresh clone indexes implicitly (rc $RC)" "$WORK/l9" "$WORK/l9e"; fi

# ==========================================================================
# leg 1d — LITE-011: the FSEG rows + the descent, on a fixture built for it
# ==========================================================================
#   c0  README.mkd  src/abc/TCP.c  net/TCP.c  a/b/c/d/e/f/g/deep.c  gone/old.c
#   c1  README.mkd amended, gone/old.c deleted, src/abc/FSW.c added
REPO2="$WORK/repo2"
mkdir -p "$REPO2/src/abc" "$REPO2/net" "$REPO2/a/b/c/d/e/f/g" "$REPO2/gone"
(
  cd "$REPO2" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  printf 'readme\n' > README.mkd
  printf 'src abc tcp\n' > src/abc/TCP.c
  printf 'net tcp\n' > net/TCP.c
  printf 'deep\n' > a/b/c/d/e/f/g/deep.c
  printf 'old\n' > gone/old.c
  git add -A && GIT_AUTHOR_DATE="2021-01-01T00:00:00Z" GIT_COMMITTER_DATE="2021-01-01T00:00:00Z" \
      git commit -q -m d0 || exit 1
  printf 'readme 2\n' > README.mkd
  printf 'fsw\n' > src/abc/FSW.c
  rm -f gone/old.c
  git add -A && GIT_AUTHOR_DATE="2021-01-02T00:00:00Z" GIT_COMMITTER_DATE="2021-01-02T00:00:00Z" \
      git commit -q -m d1 || exit 1
) || { echo "index: cannot build the LITE-011 fixture repo" >&2; exit 2; }
D0=$(git -C "$REPO2" rev-parse master~1)
D1=$(git -C "$REPO2" rev-parse master)

rt index "$REPO2" > "$WORK/q0" 2>"$WORK/q0e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 2 commits, ' "$WORK/q0"
then ok "the LITE-011 fixture indexes"
else bad "the LITE-011 fixture indexes (rc $RC)" "$WORK/q0" "$WORK/q0e"; fi

LITE_FIX2="$REPO2" LITE_EXP2="c0=$D0 c1=$D1" \
    rt --eval "require('$CASE/resolve.js')" > "$WORK/rv.out" 2>"$WORK/rv.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/rv.out" && ! grep -q '^FAIL' "$WORK/rv.out"; then
    N=$(grep -c '^ok' "$WORK/rv.out"); CHECKS=$((CHECKS + N))
    ok "resolve leg: $N checks (FSEG rows / the descent / per-commit answers)"
else
    cat "$WORK/rv.out"; head -5 "$WORK/rv.err"
    bad "resolve leg (rc $RC)" "$WORK/rv.out"
fi

# R2: `log <qualified partial>` = the log of the path it names.
rtin "$REPO2" log abc/TCP.c | cut -c1-8 > "$WORK/q1"
if [ "$(cat "$WORK/q1")" = "$(echo "$D0" | cut -c1-8)" ]
then ok "log abc/TCP.c = the log of src/abc/TCP.c"
else bad "log abc/TCP.c = the log of src/abc/TCP.c" "$WORK/q1"; fi

# R3: an AMBIGUOUS bare filename lists the paths, in plain words.
rtin "$REPO2" log TCP.c > "$WORK/q2" 2>"$WORK/q2e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'names 2 files' "$WORK/q2e" &&
   grep -q '^  net/TCP.c$' "$WORK/q2e" && grep -q '^  src/abc/TCP.c$' "$WORK/q2e"
then ok "an ambiguous bare filename lists both paths"
else bad "an ambiguous bare filename lists both paths (rc $RC)" "$WORK/q2" "$WORK/q2e"; fi

# R4: a path DEEPER than the 6-slot chain, named bare, in `diff`.
printf 'deep changed\n' > "$REPO2/a/b/c/d/e/f/g/deep.c"
rtin "$REPO2" diff --plain deep.c > "$WORK/q3" 2>"$WORK/q3e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^hunk a/b/c/d/e/f/g/deep.c' "$WORK/q3"
then ok "diff <bare, depth 7> names a/b/c/d/e/f/g/deep.c"
else bad "diff <bare, depth 7> names the deep path (rc $RC)" "$WORK/q3" "$WORK/q3e"; fi
git -C "$REPO2" checkout -q -- a/b/c/d/e/f/g/deep.c

# R5: a partial that names nothing at HEAD is still an EMPTY log, not an error.
rtin "$REPO2" log old.c > "$WORK/q4" 2>"$WORK/q4e"; RC=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/q4" ]
then ok "a partial absent at HEAD is an empty log, not an error"
else bad "a partial absent at HEAD is an empty log (rc $RC)" "$WORK/q4" "$WORK/q4e"; fi

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
    ok "rows leg: $N checks (seven kinds / rev chain / B2P / FSEG / CPAR / MARK)"
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
# climb stops at the first commit the index already holds and only the ONE new
# commit is indexed.  Nothing below it is re-walked and nothing is re-minted.
g reset -q --hard "$C3"
printf '9\n' > "$REPO/a.txt"; g add -A
GIT_AUTHOR_DATE="2020-01-07T00:00:00Z" GIT_COMMITTER_DATE="2020-01-07T00:00:00Z" \
    g commit -q -m c6
rt index "$REPO" > "$WORK/o4" 2>"$WORK/e4"; RC=$?
if [ "$RC" = 0 ] && grep -q '^indexed 1 commits, 1 revs, ' "$WORK/o4"
then ok "a rewritten history walks only what the index lacks"
else bad "a rewritten history walks only what the index lacks (rc $RC)" "$WORK/o4" "$WORK/e4"; fi

# V6b: INTERRUPT-RESUME.  Drop the index's MARK runs only?  There is no such
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
if [ "$RC" = 0 ] && grep -q '^indexed 5 commits, 7 revs, ' "$WORK/o5"
then ok "rm -rf .git/be rebuilds from the ODB"
else bad "rm -rf .git/be rebuilds from the ODB (rc $RC)" "$WORK/o5" "$WORK/e5"; fi

# V8: a path that is no repository is refused in plain words.
rt index "$WORK/nosuch" > "$WORK/o6" 2>"$WORK/e6"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/o6" ] && grep -qi 'repositor' "$WORK/e6"
then ok "a non-repository arg is refused in plain words"
else bad "a non-repository arg is refused in plain words (rc $RC)" "$WORK/o6" "$WORK/e6"; fi

# ==========================================================================
# leg 3 — LITE-028: a catch-up reads the NEW work, not the whole index
# ==========================================================================
# A synthetic history big enough for the asymmetry to be unmistakable: 1000
# commits over 40 files, built by fast-import (a second, not a minute).  The
# index is brought up at 500 commits and again at 1000, and a ONE-commit
# catch-up is measured over each — the rows READ must not grow with the index.
REPO3="$WORK/repo3"
mkdir -p "$REPO3"
LAZY=yes
(
  cd "$REPO3" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  i=0
  while [ "$i" -lt 1000 ]; do
      echo "commit refs/heads/master"
      echo "mark :$((i + 1))"
      echo "committer T <t@t> $((1600000000 + i)) +0000"
      echo "data <<EOM"
      echo "c$i"
      echo "EOM"
      [ "$i" -gt 0 ] && echo "from :$i"
      echo "M 100644 inline dir$((i % 8))/file$((i % 40)).txt"
      echo "data <<EOB"
      echo "body $i"
      echo "EOB"
      i=$((i + 1))
  done | git fast-import --quiet
) || LAZY=no
if [ "$LAZY" != yes ]; then
    echo "index: SKIP the LITE-028 leg — git fast-import built no fixture" >&2
else
g3() { git -C "$REPO3" "$@"; }
lz() { LITE_FIX="$REPO3" LITE_MODE="$1" rt --eval "require('$CASE/lazy.js')"; }
nm() { sed -n "s/.*$2=\([0-9]*\).*/\1/p" "$1"; }

# `reset --hard` moves the BRANCH, so the whole history is pinned by a tag and
# every step names its commit through that.
g3 tag -f full master
g3 reset -q --hard full~500 && lz index > "$WORK/z0" 2>&1       # index: 500 commits
g3 reset -q --hard full~499
lz meas > "$WORK/z1" 2>"$WORK/z1e"; RC=$?
g3 reset -q --hard full && lz index >> "$WORK/z0" 2>&1          # index: 1000 commits
printf 'tail\n' > "$REPO3/dir0/file0.txt"; g3 add -A
GIT_AUTHOR_DATE="2021-06-01T00:00:00Z" GIT_COMMITTER_DATE="2021-06-01T00:00:00Z" \
    g3 commit -q -m tail
lz meas > "$WORK/z2" 2>"$WORK/z2e"; RC2=$?

R1=$(nm "$WORK/z1" reads); L1=$(nm "$WORK/z1" index)
R2=$(nm "$WORK/z2" reads); L2=$(nm "$WORK/z2" index)
C1=$(nm "$WORK/z1" commits); C2=$(nm "$WORK/z2" commits)

# Z1: both catch-ups are one commit, and the index really did double.
if [ "$RC" = 0 ] && [ "$RC2" = 0 ] && [ "$C1" = 1 ] && [ "$C2" = 1 ] &&
   [ "$L2" -gt "$((L1 * 3 / 2))" ]
then ok "the fixture catches up one commit over an index that doubled ($L1 -> $L2 rows)"
else bad "the LITE-028 fixture (rc $RC/$RC2)" "$WORK/z1" "$WORK/z1e" "$WORK/z2" "$WORK/z2e"; fi

# Z2: THE REPRO.  Reading the index to index one commit is the bug; before the
# fix `reads` was the whole index (L + a few) both times.
if [ "$R1" -lt "$((L1 / 4))" ] && [ "$R2" -lt "$((L2 / 4))" ]
then ok "a one-commit catch-up reads a fraction of the index ($R1/$L1, $R2/$L2 rows)"
else bad "a one-commit catch-up reads a fraction of the index ($R1/$L1, $R2/$L2 rows)" \
         "$WORK/z1" "$WORK/z2"; fi

# Z3: what it DOES read is the touched file's own chain — 1 of the 40 files, so
# ~index/40 revs at 3-4 rows each.  The old full pass read L+2 rows both times.
E1=$((500 / 40 * 4 + 16)); E2=$((1000 / 40 * 4 + 16))
if [ "$R1" -le "$E1" ] && [ "$R2" -le "$E2" ]
then ok "what it reads is the file's own chain, not the index ($R1<=$E1, $R2<=$E2)"
else bad "what it reads is the file's own chain ($R1 of $E1, $R2 of $E2)" \
         "$WORK/z1" "$WORK/z2"; fi

# Z4: the rows the lazy state wrote are a WHOLE index — every path's rev chain
# dense from 0, no path with two revs of one commit.
lz check > "$WORK/z3" 2>"$WORK/z3e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/z3" && ! grep -q '^FAIL' "$WORK/z3"; then
    N=$(grep -c '^ok' "$WORK/z3"); CHECKS=$((CHECKS + N))
    ok "lazy-state leg: $N checks (dense rev chains, one rev per path per commit)"
else
    cat "$WORK/z3"; head -5 "$WORK/z3e"
    bad "lazy-state leg (rc $RC)" "$WORK/z3"
fi
fi

# ==========================================================================
# leg 4 — BEE-001: `install` IS the bring-up (wire + register + index + lindex)
# ==========================================================================
# A home of its own, so the registry it writes is the only thing in it.
REPO4="$WORK/repo4"; FH4="$WORK/home4"; mkdir -p "$REPO4" "$FH4"
(
  cd "$REPO4" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'see README.mkd\n' > a.mkd; printf 'readme\n' > README.mkd
  git add -A && GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t \
      GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
      GIT_AUTHOR_DATE="2022-01-01T00:00:00Z" GIT_COMMITTER_DATE="2022-01-01T00:00:00Z" \
      git commit -q -m i0 || exit 1
) || { echo "index: cannot build the BEE-001 fixture repo" >&2; exit 2; }
rt4() { ( cd "$REPO4" && HOME="$FH4" "$RT" "$@" ); }
REG="$FH4/.config/bee/repos"

# B1: install registers the path AND leaves an index behind.
rt4 install > "$WORK/b1" 2>"$WORK/b1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^installed' "$WORK/b1" &&
   [ -f "$REG" ] && [ "$(cat "$REG")" = "$REPO4" ] &&
   ls "$REPO4/.git/be" 2>/dev/null | grep -q '\.lite2\.idx$'
then ok "install registers the path in .config/bee/repos and leaves an index"
else bad "install registers + indexes (rc $RC)" "$WORK/b1" "$WORK/b1e" "$REG"; fi

# B1b: BEE-007 — install is still the FULL bring-up: `a.mkd` names README.mkd,
# so the LINK half ran too, off the one `index` call install now makes.
LITE_FIX="$REPO4" rt --eval "require('$CASE/links.js')" > "$WORK/b1l" 2>"$WORK/b1le"
if grep -q '^links=[1-9][0-9]* marks=1$' "$WORK/b1l"
then ok "install brings BOTH halves up ($(cat "$WORK/b1l"))"
else bad "install brings both halves up" "$WORK/b1l" "$WORK/b1le" "$WORK/b1"; fi

# B2: a second install says so and adds NO second line.
rt4 install > "$WORK/b2" 2>"$WORK/b2e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^already installed' "$WORK/b2" &&
   [ "$(( $(wc -l < "$REG") ))" = "1" ]
then ok "a second install adds no second line"
else bad "a second install adds no second line (rc $RC)" "$WORK/b2" "$WORK/b2e" "$REG"; fi

# B3: a LINKED WORKTREE is refused — identity is the path, and a worktree is a
# second path over one history.  The registry is left as it was.
WT4="$WORK/wt4"
if git -C "$REPO4" worktree add -q "$WT4" -b wt4 >/dev/null 2>&1; then
    ( cd "$WT4" && HOME="$FH4" "$RT" install ) > "$WORK/b3" 2>"$WORK/b3e"; RC=$?
    if [ "$RC" != 0 ] && [ ! -s "$WORK/b3" ] && grep -q 'worktree' "$WORK/b3e" &&
       [ "$(( $(wc -l < "$REG") ))" = "1" ]
    then ok "install refuses a linked worktree in plain words"
    else bad "install refuses a linked worktree (rc $RC)" "$WORK/b3" "$WORK/b3e" "$REG"; fi
else
    echo "index: SKIP the linked-worktree leg — git worktree add failed" >&2
fi

# B4: LITE-026 — a repo with NO COMMITS still installs; there is just nothing
# to index yet, and its path is registered all the same.
NEW4="$WORK/new4"; mkdir -p "$NEW4"
( cd "$NEW4" && git init -q -b master . ) || exit 2
( cd "$NEW4" && HOME="$FH4" "$RT" install ) > "$WORK/b4" 2>"$WORK/b4e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^installed' "$WORK/b4" && grep -q "^$NEW4\$" "$REG"
then ok "a repo with no commits installs; nothing to index yet"
else bad "install on a commitless repo (rc $RC)" "$WORK/b4" "$WORK/b4e" "$REG"; fi

# B5: the ONE-TIME seed — a pre-existing `.config/be/tracks` carries over into
# the new file, deduped, and the old file is never read again.
FH5="$WORK/home5"; mkdir -p "$FH5/.config/be"
printf '%s\n%s\n%s\n' "/old/one" "/old/two" "/old/one" > "$FH5/.config/be/tracks"
( cd "$REPO4" && HOME="$FH5" "$RT" install ) > "$WORK/b5" 2>"$WORK/b5e"; RC=$?
REG5="$FH5/.config/bee/repos"
printf '%s\n%s\n%s\n' "/old/one" "/old/two" "$REPO4" > "$WORK/b5w"
if [ "$RC" = 0 ] && cmp -s "$WORK/b5w" "$REG5"
then ok "a pre-existing .config/be/tracks seeds .config/bee/repos once"
else bad "the one-time seed from .config/be/tracks (rc $RC)" "$WORK/b5" "$WORK/b5e" "$REG5"; fi

# ...and once seeded, the old file is out of the picture: a line added to it
# after the seed never shows up in the new one.
printf '/old/three\n' >> "$FH5/.config/be/tracks"
( cd "$REPO2" && HOME="$FH5" "$RT" install ) > "$WORK/b6" 2>"$WORK/b6e"; RC=$?
if [ "$RC" = 0 ] && ! grep -q '^/old/three$' "$REG5" && grep -q "^$REPO2\$" "$REG5"
then ok "the retired tracks file is never read again"
else bad "the retired tracks file is never read again (rc $RC)" "$WORK/b6" "$WORK/b6e" "$REG5"; fi

# ==========================================================================
# leg 5 — BEE-006: a SUBMODULE is an ordinary repo (install/index recurse)
# ==========================================================================
#   SUB   s.txt=s1 (s0), s.txt=s2 (s1)
#   PAR   p.txt (p0), + html -> SUB at s0 (p1), gitlink bumped to s1 (p2)
SUB="$WORK/sub"; PAR="$WORK/par"; FH6="$WORK/home6"; mkdir -p "$SUB" "$PAR" "$FH6"
SUBOK=yes
(
  set -e
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cd "$SUB"; git init -q -b master .
  printf 's1\n' > s.txt; git add -A
  GIT_AUTHOR_DATE="2022-03-01T00:00:00Z" GIT_COMMITTER_DATE="2022-03-01T00:00:00Z" \
      git commit -q -m s0
  cd "$PAR"; git init -q -b master .
  printf 'p\n' > p.txt; git add -A
  GIT_AUTHOR_DATE="2022-03-02T00:00:00Z" GIT_COMMITTER_DATE="2022-03-02T00:00:00Z" \
      git commit -q -m p0
  git -c protocol.file.allow=always submodule add -q "$SUB" html
  git add -A
  GIT_AUTHOR_DATE="2022-03-03T00:00:00Z" GIT_COMMITTER_DATE="2022-03-03T00:00:00Z" \
      git commit -q -m "add html sub"
  cd "$SUB"; printf 's2\n' > s.txt
  GIT_AUTHOR_DATE="2022-03-04T00:00:00Z" GIT_COMMITTER_DATE="2022-03-04T00:00:00Z" \
      git commit -qam s1
  cd "$PAR/html"; git fetch -q origin master; git checkout -q FETCH_HEAD
  cd "$PAR"
  GIT_AUTHOR_DATE="2022-03-05T00:00:00Z" GIT_COMMITTER_DATE="2022-03-05T00:00:00Z" \
      git commit -qam "bump html"
) >/dev/null 2>&1 || SUBOK=no
if [ "$SUBOK" != yes ]; then
    echo "index: SKIP the BEE-006 leg — git built no submodule fixture" >&2
else
rtp() { ( cd "$PAR" && HOME="$FH6" "$RT" "$@" ); }
REG6="$FH6/.config/bee/repos"

# S1: install takes the sub — registered, its own index, counted in the line.
rtp install > "$WORK/s1" 2>"$WORK/s1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'took 1 submodule' "$WORK/s1" &&
   grep -q "^$PAR\$" "$REG6" && grep -q "^$PAR/html\$" "$REG6" &&
   ls "$PAR/.git/modules/html/be" 2>/dev/null | grep -q '\.lite2\.idx$'
then ok "install registers the submodule and leaves it an index of its own"
else bad "install takes the submodule (rc $RC)" "$WORK/s1" "$WORK/s1e" "$REG6"; fi

# S2: THE REPRO — `list` in the parent attributes the `html/` row off the dir
# revs the gitlink bumps mint (a blank summary is the bug).
rtp list --plain > "$WORK/s2" 2>"$WORK/s2e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^dir html/  *bump html  *[0-9]*[smhdy]$' "$WORK/s2"
then ok "list attributes the submodule row (last commit + age)"
else bad "list attributes the submodule row (rc $RC)" "$WORK/s2" "$WORK/s2e"; fi

# S3: a second install adds no second line for either repo.
rtp install > "$WORK/s3" 2>"$WORK/s3e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^already installed' "$WORK/s3" &&
   [ "$(( $(wc -l < "$REG6") ))" = "2" ]
then ok "a second install adds no duplicate line for parent or sub"
else bad "a second install duplicates nothing (rc $RC)" "$WORK/s3" "$WORK/s3e" "$REG6"; fi

# S4: BEE-001's linked-worktree refusal must NOT trip on a sub: its `.git` is a
# GITFILE into <parent gitdir>/modules/<name> and carries no `commondir`.
FH7="$WORK/home7"; mkdir -p "$FH7"
( cd "$PAR/html" && HOME="$FH7" "$RT" install ) > "$WORK/s4" 2>"$WORK/s4e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^installed' "$WORK/s4" &&
   [ ! -e "$PAR/.git/modules/html/commondir" ] &&
   [ "$(cat "$FH7/.config/bee/repos")" = "$PAR/html" ]
then ok "a submodule installs on its own — no commondir, so no worktree refusal"
else bad "a submodule is no linked worktree (rc $RC)" "$WORK/s4" "$WORK/s4e"; fi

# S5: an UNINITIALISED sub (a plain clone) is skipped IN WORDS, and the parent's
# own run succeeds all the same.
CL6="$WORK/parclone"; FH8="$WORK/home8"; mkdir -p "$FH8"
git clone -q --no-local "$PAR" "$CL6" 2>/dev/null
( cd "$CL6" && HOME="$FH8" "$RT" install ) > "$WORK/s5" 2>"$WORK/s5e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'skipped html (not initialised)' "$WORK/s5" &&
   [ "$(cat "$FH8/.config/bee/repos")" = "$CL6" ]
then ok "an uninitialised submodule is skipped in words, not a failure"
else bad "an uninitialised submodule is skipped (rc $RC)" "$WORK/s5" "$WORK/s5e"; fi

# S6: the rows leg — the recursion with the registry OFF, and what the parent's
# index holds about the gitlink (REV-CMMT only).
FH9="$WORK/home9"
LITE_FIX="$PAR" LITE_SUB=html LITE_HOME="$FH9" \
    rt --eval "require('$CASE/subs.js')" > "$WORK/s6" 2>"$WORK/s6e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/s6" && ! grep -q '^FAIL' "$WORK/s6"; then
    N=$(grep -c '^ok' "$WORK/s6"); CHECKS=$((CHECKS + N))
    ok "submodule rows leg: $N checks (the walk / track:false / REV-CMMT only)"
else
    cat "$WORK/s6"; head -5 "$WORK/s6e"
    bad "submodule rows leg (rc $RC)" "$WORK/s6"
fi

# S7: the GUARDS — a sub whose worktree is a symlink OUT of the parent is never
# followed, and a second gitlink resolving to a repo already taken is a cycle.
# Both gitlinks are COMMITTED first; only then are the worktrees swapped for
# symlinks, or the commit would record a symlink blob instead of the gitlink.
( cd "$PAR" &&
  git -c protocol.file.allow=always submodule add -q "$SUB" two &&
  git -c protocol.file.allow=always submodule add -q "$SUB" out &&
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  GIT_AUTHOR_DATE="2022-03-06T00:00:00Z" GIT_COMMITTER_DATE="2022-03-06T00:00:00Z" \
  git commit -qam "add two and out" ) >/dev/null 2>&1
rm -rf "$PAR/two" "$PAR/out"
ln -s "$PAR/html" "$PAR/two"; ln -s "$SUB" "$PAR/out"
rtp index > "$WORK/s7" 2>"$WORK/s7e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'skipped two (a cycle' "$WORK/s7" &&
   grep -q 'skipped out (no worktree of the parent' "$WORK/s7" &&
   ! grep -q "^$SUB\$" "$REG6"
then ok "a cycle and an out-of-worktree sub are skipped, in words"
else bad "the recursion guards (rc $RC)" "$WORK/s7" "$WORK/s7e" "$REG6"; fi
fi
# ==========================================================================
# leg 6 — BEE-007: ONE bring-up verb, TWO marks
# ==========================================================================
# THE GAP THIS REPROS: `bee index` used to run the commit walk alone, so the
# LINK rows only ever appeared if you also ran `bee lindex`.  The risk of the
# fold is the other way round — a READ VIEW must still not lex a blob.
REPO5="$WORK/repo5"; mkdir -p "$REPO5"
mkfold() {
  mkdir -p "$1/doc" "$1/src/abc"
  (
    cd "$1" || exit 1
    git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
    printf 'the guide points at src/abc/TCP.c\n' > doc/guide.mkd
    printf 'int tcp;\n' > src/abc/TCP.c
    git add -A && GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t \
        GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
        GIT_AUTHOR_DATE="2022-02-02T00:00:00Z" GIT_COMMITTER_DATE="2022-02-02T00:00:00Z" \
        git commit -q -m f0 || exit 1
  )
}
mkfold "$REPO5" || { echo "index: cannot build the BEE-007 fixture" >&2; exit 2; }
rt5() { ( cd "$REPO5" && HOME="$FAKEHOME" "$RT" "$@" ); }
probe() { LITE_FIX="$1" rt --eval "require('$CASE/links.js')"; }
bytes5() { cat "$1"/.git/be/* 2>/dev/null | wc -c | tr -d ' '; }

# F1: ONE summary line, BOTH halves on it.
rt5 index > "$WORK/f1" 2>"$WORK/f1e"; RC=$?
if [ "$RC" = 0 ] &&
   grep -q '^indexed 1 commits, [0-9]* revs, [0-9]* rows — scanned [0-9]* files, [0-9]* links, [0-9]* rows — refs/heads/master ' "$WORK/f1"
then ok "one summary line covers the commit walk AND the link scan"
else bad "one summary line covers both halves (rc $RC)" "$WORK/f1" "$WORK/f1e"; fi

# F2: THE REPRO — the LINK rows are there with no `lindex` run at all.
probe "$REPO5" > "$WORK/f2" 2>"$WORK/f2e"
if grep -q '^links=[1-9][0-9]* marks=1$' "$WORK/f2"
then ok "\`bee index\` alone left LINK rows and the lindex mark ($(cat "$WORK/f2"))"
else bad "bee index left LINK rows" "$WORK/f2" "$WORK/f2e" "$WORK/f1"; fi

# F3: BOTH marks hit on the second run — it writes nothing and says so, in the
# ruled no-op words (no half-done phrase on the line).
B5=$(bytes5 "$REPO5")
rt5 index > "$WORK/f3" 2>"$WORK/f3e"; RC=$?
A5=$(bytes5 "$REPO5")
if [ "$RC" = 0 ] && grep -q '^up to date: refs/heads/master ' "$WORK/f3" &&
   ! grep -q 'scanned' "$WORK/f3" && [ "$B5" = "$A5" ]
then ok "a second \`bee index\` writes nothing and says up to date ($B5 bytes)"
else bad "the second index is the two-mark no-op (rc $RC, $B5 -> $A5)" "$WORK/f3" "$WORK/f3e"; fi

# F4: `lindex` is the QUERY form and still works — bare (its own mark hits, so
# it is the no-op) and with a target.
rt5 lindex > "$WORK/f4" 2>"$WORK/f4e"; RC=$?
rt5 lindex src/abc/TCP.c > "$WORK/f5" 2>"$WORK/f5e"; RC2=$?
R5=$(cd "$REPO5" && pwd -P)
if [ "$RC" = 0 ] && grep -q '^up to date: links at refs/heads/master ' "$WORK/f4" &&
   [ "$RC2" = 0 ] && [ "$(cat "$WORK/f5")" = "$R5/doc/guide.mkd" ]
then ok "\`bee lindex\` still answers bare and with a target"
else bad "lindex bare + target (rc $RC/$RC2)" "$WORK/f4" "$WORK/f4e" "$WORK/f5" "$WORK/f5e"; fi

# F5: THE REGRESSION THIS FOLD RISKS — a READ VIEW calls `bringUp`, the COMMIT
# half alone, so it lexes no blob and mints NO LINK row (and no lindex mark).
REPO6="$WORK/repo6"; mkdir -p "$REPO6"
mkfold "$REPO6" || { echo "index: cannot build the BEE-007 read-view fixture" >&2; exit 2; }
rt6() { ( cd "$REPO6" && HOME="$FAKEHOME" "$RT" "$@" ); }
rt6 list --plain > "$WORK/f6" 2>"$WORK/f6e"; RC=$?
rt6 log --plain > "$WORK/f7" 2>"$WORK/f7e"; RC2=$?
probe "$REPO6" > "$WORK/f8" 2>"$WORK/f8e"
if [ "$RC" = 0 ] && [ -s "$WORK/f6" ] && [ "$RC2" = 0 ] && [ -s "$WORK/f7" ] &&
   [ "$(cat "$WORK/f8")" = "links=0 marks=0" ]
then ok "a read view brings the index up and mints NO link row"
else bad "a read view mints no link row (rc $RC/$RC2)" "$WORK/f8" "$WORK/f6e" "$WORK/f7e"; fi

# ...and the very next `bee index` over that index runs the link half alone.
rt6 index > "$WORK/f9" 2>"$WORK/f9e"; RC=$?
probe "$REPO6" > "$WORK/fa" 2>"$WORK/fae"
if [ "$RC" = 0 ] && grep -q '^up to date: refs/heads/master .* — scanned [0-9]* files, ' "$WORK/f9" &&
   grep -q '^links=[1-9][0-9]* marks=1$' "$WORK/fa"
then ok "...and the next \`bee index\` runs the link half alone, off its own mark"
else bad "the link half catches up alone (rc $RC)" "$WORK/f9" "$WORK/f9e" "$WORK/fa"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/index] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/index] $CHECKS checks, runtime $RT"
exit 0
