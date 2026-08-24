#!/bin/sh
# bee/test/kv/run.sh — BEE-024: the `kv` lane, the KEYED kv64 family beside
# `*.lite3.idx` in `<gitdir>/be/`.  Legs over the landed bee tree:
#   verb  — this script: `bee index` fills the lane and says so on its ONE
#           summary line; a rerun re-lexes nothing and writes not one byte; an
#           edited file re-lexes; a vanished pair and a deleted file are
#           TOMBSTONED; a YAML preamble indexes under its own kind; two
#           worktrees of one repo share the lane and never each other's blocks;
#           and neither sweep eats the other family's runs.
#   rows  — rows.js: the ruled bit layout (key path_hl:40|key_code:20|kind:4,
#           val vkind:4|payload:60), the verbatim vs hashed key codes, the
#           literal-or-hash payload, `find`'s clauses, the path-hash collision
#           detector and the crash-mid-sweep re-lex.
#
# THE GAP THIS REPROS: every lite3 row is a FACT about a blob or a commit, so
# bee had no record that could CHANGE value — `Now: OPEN` flipping to `DONE`
# was unsayable, and the BEE-025 board had nothing to ask.  The kv lane is
# keyed, so a re-put overwrites and a row is a mutable cell.
#
# Standalone: `sh bee/test/kv/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/kv
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "kv: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "kv: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "kv: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "kv: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-kv.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "kv: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "kv: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — a ticket tree, a YAML-preamble page, a page with no meta at
# all, an untracked ticket and a source file no candidate set may take
# ==========================================================================
REPO="$WORK/repo"
mkdir -p "$REPO/todo" "$REPO/doc" "$REPO/src"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf '#   AAA-001: the first\n\n    Now: OPEN\n    Sev: HIGH\n    Who: gritzko\n\nbody\n' \
    > todo/AAA-001.mkd
  printf '#   AAA-002: the second\n\n    Now: DONE\n    Due: 2026-08-19\n\nbody\n' \
    > todo/AAA-002.mkd
  printf -- '---\ntitle: hello\nstatus: open\nnest:\n  deep: no\n---\n\n#   A page\n\ntext\n' \
    > doc/front.md
  printf '#   Plain\n\nno meta pairs at all\n' > doc/plain.mkd
  printf 'int x;\n' > src/x.c
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed' || exit 1
) || { echo "kv: cannot build the fixture repo" >&2; exit 2; }
#  The UNTRACKED candidate: on disk, in no tree and in no stage.
printf '#   AAA-003: the untracked\n\n    Now: OPEN\n    Who: nobody\n' > "$REPO/todo/AAA-003.mkd"
g() { git -C "$REPO" "$@"; }

kvbytes()   { cat "$REPO"/.git/be/*.kv.idx 2>/dev/null | wc -c | tr -d ' '; }
kvruns()    { ( cd "$REPO"/.git/be && ls *.kv.idx 2>/dev/null ); }
litebytes() { cat "$REPO"/.git/be/*.lite3.idx 2>/dev/null | wc -c | tr -d ' '; }
# One `find` over the fixture, one absolute path per line.
qry() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" KV_ARGS="$*" \
        "$RT" --eval "require('$CASE/find.js')" ); }

# ==========================================================================
# leg 1 — the COLD FILL and the summary line
# ==========================================================================
# K1: `bee index` runs the sweep and says what the lane holds: FIVE candidates
# (four tracked `.md`/`.mkd` plus the untracked one), and src/x.c is not one.
rtin "$REPO" index > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
if [ "$RC" = 0 ] && grep -q ' — kv: 5 files, 9 pairs$' "$WORK/i1"
then ok "the cold run fills the lane: 5 files, 9 pairs, on the one summary line"
else bad "the cold run fills the lane (rc $RC)" "$WORK/i1" "$WORK/i1e"; fi

# K2: the lane is a family of its OWN, beside the wh128 one, in the gitdir.
if ls "$REPO"/.git/be/*.kv.idx >/dev/null 2>&1 && ls "$REPO"/.git/be/*.lite3.idx >/dev/null 2>&1
then ok "the .kv.idx family sits beside .lite3.idx in <gitdir>/be"
else bad "the .kv.idx family sits beside .lite3.idx" ; ls -l "$REPO"/.git/be; fi

# K3: the answers are off the rows — a meta pair, an intersection, a YAML key.
qry "$REPO" 'Now=OPEN' > "$WORK/q1" 2>"$WORK/q1e"; RC=$?
printf '%s/todo/AAA-001.mkd\n%s/todo/AAA-003.mkd\n' "$REPO" "$REPO" > "$WORK/q1w"
if [ "$RC" = 0 ] && cmp -s "$WORK/q1w" "$WORK/q1"
then ok "find Now=OPEN = the two open tickets"
else bad "find Now=OPEN (rc $RC)" "$WORK/q1w" "$WORK/q1" "$WORK/q1e"; fi

qry "$REPO" 'Now=OPEN' 'Who=gritzko' > "$WORK/q2" 2>"$WORK/q2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q2")" = "$REPO/todo/AAA-001.mkd" ]
then ok "two clauses intersect on path_hl"
else bad "two clauses intersect (rc $RC)" "$WORK/q2" "$WORK/q2e"; fi

qry "$REPO" 'yaml:status=open' > "$WORK/q3" 2>"$WORK/q3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q3")" = "$REPO/doc/front.md" ]
then ok "a YAML preamble key answers under its own kind"
else bad "a YAML preamble key answers (rc $RC)" "$WORK/q3" "$WORK/q3e"; fi

# K4: the `Due:` normalizer makes a ron60 date, so a PREFIX is a range.
qry "$REPO" 'Due~26819' > "$WORK/q4" 2>"$WORK/q4e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q4")" = "$REPO/todo/AAA-002.mkd" ]
then ok "Due: is a ron60 date, so a prefix is a range"
else bad "Due: prefix range (rc $RC)" "$WORK/q4" "$WORK/q4e"; fi

# ==========================================================================
# leg 2 — the WARM run writes NOTHING
# ==========================================================================
# K5: nothing moved, so the mark stands, no value is re-put and not one byte
# lands in the family.
BEFORE=$(kvbytes)
rtin "$REPO" index > "$WORK/i2" 2>"$WORK/i2e"; RC=$?
AFTER=$(kvbytes)
if [ "$RC" = 0 ] && [ "$BEFORE" = "$AFTER" ] && grep -q ' — kv: 5 files, 9 pairs' "$WORK/i2"
then ok "a warm run re-puts nothing and writes no byte ($BEFORE bytes)"
else bad "a warm run writes nothing (rc $RC, $BEFORE -> $AFTER)" "$WORK/i2" "$WORK/i2e"; fi

# ==========================================================================
# leg 3 — an EDITED file re-lexes and the cell OVERWRITES
# ==========================================================================
# K6: `Now: OPEN` flips to `DONE` in place — the thing lite3 cannot say.
printf '#   AAA-001: the first\n\n    Now: DONE\n    Sev: HIGH\n    Who: gritzko\n\nbody\n' \
  > "$REPO/todo/AAA-001.mkd"
rtin "$REPO" index > "$WORK/i3" 2>"$WORK/i3e"; RC=$?
qry "$REPO" 'Now=OPEN' > "$WORK/q5" 2>"$WORK/q5e"
qry "$REPO" 'Now=DONE' > "$WORK/q6" 2>"$WORK/q6e"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q5")" = "$REPO/todo/AAA-003.mkd" ] &&
   printf '%s/todo/AAA-001.mkd\n%s/todo/AAA-002.mkd\n' "$REPO" "$REPO" | cmp -s - "$WORK/q6"
then ok "an edited pair re-lexes and the cell overwrites in place"
else bad "an edited pair overwrites (rc $RC)" "$WORK/q5" "$WORK/q6" "$WORK/i3e"; fi

# ==========================================================================
# leg 4 — a VANISHED pair is TOMBSTONED
# ==========================================================================
# K7: `Who:` is gone from the file, so its cell must stop answering — there is
# no confirming read left with the value in the row.
printf '#   AAA-001: the first\n\n    Now: DONE\n    Sev: HIGH\n\nbody\n' \
  > "$REPO/todo/AAA-001.mkd"
rtin "$REPO" index > "$WORK/i4" 2>"$WORK/i4e"; RC=$?
qry "$REPO" 'Who' > "$WORK/q7" 2>"$WORK/q7e"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q7")" = "$REPO/todo/AAA-003.mkd" ]
then ok "a vanished pair is tombstoned and stops answering"
else bad "a vanished pair is tombstoned (rc $RC)" "$WORK/q7" "$WORK/q7e" "$WORK/i4"; fi

# ==========================================================================
# leg 5 — a DELETED file's whole block dies
# ==========================================================================
# K8: the file is gone from disk AND from the stage, so this worktree's block
# for it is tombstoned whole and the file count drops.
g rm -q todo/AAA-002.mkd
rtin "$REPO" index > "$WORK/i5" 2>"$WORK/i5e"; RC=$?
qry "$REPO" 'Due' > "$WORK/q8" 2>"$WORK/q8e"
if [ "$RC" = 0 ] && grep -q ' — kv: 4 files, [0-9]* pairs$' "$WORK/i5" && [ ! -s "$WORK/q8" ]
then ok "a deleted file's whole block is tombstoned"
else bad "a deleted file's block is tombstoned (rc $RC)" "$WORK/i5" "$WORK/i5e" "$WORK/q8"; fi

# ==========================================================================
# leg 6 — TWO WORKTREES of one repo share the lane, never a block
# ==========================================================================
# K9: a linked worktree keys its blocks by the WORKTREE-QUALIFIED path and its
# mark by its own code, so wt2's sweep neither tombstones nor marks the main
# worktree's files — and both write into the ONE common `<gitdir>/be`.
WT2="$WORK/wt2"
g worktree add -q -b b2 "$WT2" >/dev/null 2>&1 || \
  { echo "kv: cannot add a worktree" >&2; exit 2; }
printf '#   AAA-001: the first\n\n    Now: DONT\n    Sev: LOW\n\nbody\n' \
  > "$WT2/todo/AAA-001.mkd"
rm -f "$WT2/todo/AAA-003.mkd"
rtin "$WT2" index > "$WORK/i6" 2>"$WORK/i6e"; RC=$?
qry "$WT2" 'Now=DONT' > "$WORK/q9" 2>"$WORK/q9e"
qry "$REPO" 'Now=DONE' > "$WORK/q10" 2>"$WORK/q10e"
if [ "$RC" = 0 ] && [ ! -d "$WT2/.git" ] &&
   [ "$(cat "$WORK/q9")" = "$WT2/todo/AAA-001.mkd" ] &&
   [ "$(cat "$WORK/q10")" = "$REPO/todo/AAA-001.mkd" ]
then ok "two worktrees share one lane and keep their own blocks"
else bad "two worktrees share one lane (rc $RC)" "$WORK/i6" "$WORK/i6e" \
         "$WORK/q9" "$WORK/q10"; fi

# K10: and the runs all live in the ORIGINAL's gitdir, one family for both.
if [ ! -d "$WT2/.git/be" ] && ls "$REPO"/.git/be/*.kv.idx >/dev/null 2>&1
then ok "the shared lane lives in the common gitdir alone"
else bad "the shared lane lives in the common gitdir"; ls -l "$WT2/.git" 2>&1 | head -3; fi

# ==========================================================================
# leg 7 — neither sweep eats the other family's runs
# ==========================================================================
# K11: THE BLOCKER (BEE-024:118) — `sweep` unlinked anything whose ext was not
# the current one, so the first `bee index` after this lane landed would have
# eaten the kv runs.  A stale format is still swept; both live ones survive.
printf 'PRE-BEE-002 INDEX\n' > "$REPO/.git/be/0000000000.lite.idx"
KB=$(kvbytes); LB=$(litebytes); KN=$(kvruns)
rtin "$REPO" index > "$WORK/i7" 2>"$WORK/i7e"; RC=$?
rtin "$REPO" lindex > "$WORK/i8" 2>"$WORK/i8e"; RC2=$?
KA=$(kvbytes); LA=$(litebytes)
#  The run NAMES too, not just the byte count: a swept-then-rebuilt lane would
#  hold the same rows under a fresh ron64 seqno.
if [ "$RC" = 0 ] && [ "$RC2" = 0 ] && [ ! -f "$REPO/.git/be/0000000000.lite.idx" ] &&
   [ "$KB" = "$KA" ] && [ "$LB" = "$LA" ] && [ "$KN" = "$(kvruns)" ]
then ok "the one sweep spares BOTH exts and still unlinks a retired one"
else bad "the sweep spares both exts (rc $RC/$RC2, kv $KB->$KA, lite $LB->$LA)" \
         "$WORK/i7" "$WORK/i7e" "$WORK/i8e"; fi

# K12: and the reverse — a kv query opens its own family and leaves lite3 alone.
LB=$(litebytes)
qry "$REPO" 'Now=DONE' > "$WORK/q11" 2>"$WORK/q11e"; RC=$?
LA=$(litebytes)
if [ "$RC" = 0 ] && [ "$LB" = "$LA" ] && [ -s "$WORK/q11" ]
then ok "a kv query does not eat the lite3 runs"
else bad "a kv query does not eat the lite3 runs (rc $RC, $LB -> $LA)" "$WORK/q11e"; fi

# ==========================================================================
# leg 8 — the ROWS (the bit layout, the collision detector, the crash re-lex)
# ==========================================================================
KV_FIX="$REPO" rtin "$REPO" --eval "require('$CASE/rows.js')" \
    > "$WORK/r.out" 2>"$WORK/r.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/r.out" && ! grep -q '^FAIL' "$WORK/r.out"; then
    N=$(grep -c '^ok' "$WORK/r.out"); CHECKS=$((CHECKS + N))
    ok "rows leg: $N checks (the layout, the codes, the collision, the crash)"
else
    cat "$WORK/r.out"; head -20 "$WORK/r.err"
    bad "rows leg (rc $RC)" "$WORK/r.out"
fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/kv] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/kv] $CHECKS checks, runtime $RT"
exit 0
