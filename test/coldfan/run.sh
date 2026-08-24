#!/bin/sh
# bee/test/coldfan/run.sh — BEE-065: ANY USE BRINGS THE INDEX UP.  The registry
# fan-out of `bee sym` and `bee lindex` used to open every foreign index
# READ-ONLY and bring NONE of them up, so a repo whose lane was cold — newly
# registered, format-swept, or fed by a plain `git push` — answered silence.
# Legs, all over fixture repos under a FIXTURE HOME:
#   1  a COLD foreign repo answers the FIRST query and gets its `.git/be` built
#   2  the second query no-ops off the mark — not one new run file
#   3  a format-swept foreign lane rebuilds and answers
#   4  an UNWRITABLE `be/` degrades to the read-only open, silently, exit 0
#   5  two processes bringing the same cold repo up at once both survive
#
# THE GAP THIS REPROS: with the read-only fan-out every check of leg 1 printed
# nothing at all, and legs 3-5 had no lane to read either.
#
# Standalone: `sh bee/test/coldfan/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`); the DOG-034 lexer is the one
# recognizer both families have, so this wants a quickjab build.  Fixtures live
# in a mktemp dir under ~/tmp.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/coldfan
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "coldfan: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "coldfan: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "coldfan: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "coldfan: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-coldfan.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; chmod -R u+rwX "$WORK" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "coldfan: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home.  This suite's whole
#  point is that a query WRITES foreign `.git/be` dirs, so the registry it fans
#  out over must be the fixture's and never the user's own.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { AT=$1; shift; ( cd "$AT" && HOME="$FAKEHOME" "$RT" "$@" ); }

mkfix() {
  FIX=$1; shift
  mkdir -p "$FIX"
  ( cd "$FIX" || exit 1
    git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
    export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
    "$@" || exit 1
    git add -A
    GIT_AUTHOR_DATE="2022-03-01T00:00:00Z" GIT_COMMITTER_DATE="2022-03-01T00:00:00Z" \
      git commit -q -m c0 ) || { echo "coldfan: cannot build $FIX" >&2; exit 2; }
}

# --- the fixtures ---------------------------------------------------------
#   A  the LOCAL repo every query runs from; it carries none of the names below
#   B  the COLD one: lib/net/SOCK.c mentions zqWidget, doc/note.mkd names
#      lib/zqtarget.mkd — a SYM carrier and a LINK carrier, neither indexed
#   D  the UNWRITABLE-be one, indexed once and then moved on by plain git
#   E  the CONCURRENCY one, cold until two processes reach for it at once
A="$WORK/A"; B="$WORK/B"; D="$WORK/D"; E="$WORK/E"
fixA() { mkdir -p here; printf 'the local note, naming nothing of theirs\n' > here/local.mkd; }
fixB() {
  mkdir -p lib/net doc lib
  printf 'void useit(void) { zqWidget(3); }\n' > lib/net/SOCK.c
  printf 'the note points at lib/zqtarget.mkd over there\n' > doc/note.mkd
  printf 'the target\n' > lib/zqtarget.mkd
}
fixD() { mkdir -p old; printf 'void old(void) { zqGadget(1); }\n' > old/AAA.c; }
fixE() { mkdir -p par; printf 'void par(void) { zqParallel(2); }\n' > par/RACE.c; }
mkfix "$A" fixA
mkfix "$B" fixB
mkfix "$D" fixD
mkfix "$E" fixE
RA=$(cd "$A" && pwd -P); RB=$(cd "$B" && pwd -P)
RD=$(cd "$D" && pwd -P); RE=$(cd "$E" && pwd -P)
echo "coldfan: runtime $RT, work $WORK"

REG="$FAKEHOME/.config/bee/repos"
mkdir -p "$FAKEHOME/.config/bee"
#  E is held back until leg 5: a fan-out reaches every registered repo, so a
#  line here would have leg 1's queries bring E up long before the race.
printf '%s\n%s\n' "$RB" "$RD" > "$REG"
cp "$REG" "$WORK/reg.was"

runs()  { ls "$1"/.git/be 2>/dev/null | sort; }
bytes() { cat "$1"/.git/be/* 2>/dev/null | wc -c | tr -d ' '; }

# D carries a real lane from the start; leg 4 is what moves it on behind bee's
# back, so the legs before it leave D warm and say nothing about it.
rtin "$D" index > "$WORK/di" 2>"$WORK/die" || { echo "coldfan: cannot index D" >&2; exit 2; }
cp "$REG" "$WORK/reg.was"                        # `bee index` tracks; leg 1 diffs from here

# ==========================================================================
# leg 1 — a COLD registered repo answers the FIRST query
# ==========================================================================
BHEAD=$(git -C "$B" rev-parse HEAD)
[ -d "$B/.git/be" ] && { echo "coldfan: B is not cold" >&2; exit 2; }

# C1: THE REPRO — B has no index at all and the SYM fan-out still answers.
rtin "$A" sym zqWidget > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/c1")" = "$RB/lib/net/SOCK.c" ]
then ok "the first sym query brings a COLD registered repo up and answers"
else bad "the first sym query answers off a cold repo (rc $RC)" "$WORK/c1" "$WORK/c1e"; fi

# C2: and it BUILT that repo's lane — `<gitdir>/be` with a run of the live format.
if [ -d "$B/.git/be" ] && ls "$B"/.git/be/*.lite3.idx >/dev/null 2>&1
then ok "the query wrote the foreign <gitdir>/be lane"
else bad "the query wrote the foreign lane"; runs "$B"; fi

# C3: the LINK fan-out is up too — the same pass minted B's LINK rows.
rtin "$A" lindex lib/zqtarget.mkd > "$WORK/c3" 2>"$WORK/c3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/c3")" = "$RB/doc/note.mkd" ]
then ok "the lindex fan-out answers off the brought-up foreign rows"
else bad "the lindex fan-out answers off a cold repo (rc $RC)" "$WORK/c3" "$WORK/c3e"; fi

# C4: `track: false` — the bring-up registers nothing, so the registry file is
# byte-identical, and the WORKTREE and refs of B are untouched.
if cmp -s "$WORK/reg.was" "$REG" && [ -z "$(git -C "$B" status --porcelain)" ] &&
   [ "$(git -C "$B" rev-parse HEAD)" = "$BHEAD" ]
then ok "the bring-up writes only .git/be: no registry line, no tree, no ref"
else bad "the bring-up writes only .git/be" "$REG" "$WORK/reg.was"; fi

# C5: a CAPTURED run stays byte-identical on stderr — the progress line naming
# the repo is tty-only, index/index.js:388:eI's law.
if [ ! -s "$WORK/c1e" ] && [ ! -s "$WORK/c3e" ]
then ok "a piped run says nothing on stderr (the progress line is tty-only)"
else bad "a piped run says nothing on stderr" "$WORK/c1e" "$WORK/c3e"; fi

# ==========================================================================
# leg 2 — the SECOND query no-ops off the mark
# ==========================================================================
runs "$B" > "$WORK/b.runs1"; BB=$(bytes "$B")
rtin "$A" sym zqWidget > "$WORK/c6" 2>"$WORK/c6e"; RC=$?
runs "$B" > "$WORK/b.runs2"; BA=$(bytes "$B")
if [ "$RC" = 0 ] && [ "$(cat "$WORK/c6")" = "$RB/lib/net/SOCK.c" ] &&
   cmp -s "$WORK/b.runs1" "$WORK/b.runs2" && [ "$BB" = "$BA" ]
then ok "the second query no-ops off the mark — no new run file ($BB bytes)"
else bad "the second query writes nothing (rc $RC, $BB -> $BA)" \
         "$WORK/b.runs1" "$WORK/b.runs2" "$WORK/c6" "$WORK/c6e"; fi

# ==========================================================================
# leg 3 — a SWEPT-FORMAT foreign lane rebuilds on use
# ==========================================================================
# The extension is the format: B keeps only a retired `.lite2.idx`, which is
# exactly what the BEE-063 bump left behind in every registered repo.
rm -rf "$B/.git/be"; mkdir -p "$B/.git/be"
printf 'PRE-BEE-063 INDEX\n' > "$B/.git/be/0000000000.lite2.idx"
rtin "$A" sym zqWidget > "$WORK/c7" 2>"$WORK/c7e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/c7")" = "$RB/lib/net/SOCK.c" ] &&
   [ ! -f "$B/.git/be/0000000000.lite2.idx" ]
then ok "a swept-format foreign lane is rebuilt and answers on the first query"
else bad "a swept-format foreign lane rebuilds (rc $RC)" "$WORK/c7" "$WORK/c7e"; fi

# ==========================================================================
# leg 4 — an UNWRITABLE `be/` degrades to the read-only open, in silence
# ==========================================================================
# The commit lands by plain git, the way BEE-065:11's evidence did, so D's lane
# knows old/AAA.c and not new/BBB.c.  With `be/` shut for writing the bring-up
# cannot land, so the ladder falls back to the rows already there: fewer
# suspects, never an error and never a wrong one.
mkdir -p "$D/new"
printf 'void fresh(void) { zqGadget(9); }\n' > "$D/new/BBB.c"
( cd "$D" && git add -A &&
  GIT_AUTHOR_DATE="2022-03-02T00:00:00Z" GIT_COMMITTER_DATE="2022-03-02T00:00:00Z" \
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  git commit -q -m c1 ) || exit 2
runs "$D" > "$WORK/d.runs1"
chmod 0555 "$D/.git/be"
rtin "$A" sym zqGadget > "$WORK/c8" 2>"$WORK/c8e"; RC=$?
runs "$D" > "$WORK/d.runs2"
chmod 0755 "$D/.git/be"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/c8")" = "$RD/old/AAA.c" ] && [ ! -s "$WORK/c8e" ] &&
   cmp -s "$WORK/d.runs1" "$WORK/d.runs2"
then ok "an unwritable be/ degrades to the read-only open, exit 0, no new run"
else bad "an unwritable be/ degrades read-only (rc $RC)" "$WORK/c8" "$WORK/c8e" \
         "$WORK/d.runs1" "$WORK/d.runs2"; fi

# C9: and with `be/` open again the very next query brings D up and finds both.
rtin "$A" sym zqGadget > "$WORK/c9" 2>"$WORK/c9e"; RC=$?
printf '%s/new/BBB.c\n%s/old/AAA.c\n' "$RD" "$RD" > "$WORK/c9w"
if [ "$RC" = 0 ] && cmp -s "$WORK/c9w" "$WORK/c9"
then ok "the next query over a writable be/ brings D up to its new tip"
else bad "the next query brings D up (rc $RC)" "$WORK/c9w" "$WORK/c9" "$WORK/c9e"; fi

# ==========================================================================
# leg 5 — CONCURRENT double bring-up
# ==========================================================================
# DOG-046's parallel claim holds for READERS and not for two writers: two cold
# bring-ups of one repo lose a process to a SIGBUS in the native wh128 writer
# about a third of the time.  That predates BEE-065 — two plain `bee index` runs
# at 5c1ac56 race the same way — and is gritzko's to rule on; what this leg pins
# is what the fan-out itself owes: the race never costs the ANSWER.
printf '%s\n' "$RE" >> "$REG"
[ -d "$E/.git/be" ] && { echo "coldfan: E is not cold" >&2; exit 2; }
( rtin "$A" sym zqParallel > "$WORK/p1" 2>"$WORK/p1e"; echo $? > "$WORK/p1rc" ) &
( rtin "$A" sym zqParallel > "$WORK/p2" 2>"$WORK/p2e"; echo $? > "$WORK/p2rc" ) &
wait
R1=$(cat "$WORK/p1rc"); R2=$(cat "$WORK/p2rc")
if { [ "$R1" = 0 ] && [ "$(cat "$WORK/p1")" = "$RE/par/RACE.c" ]; } ||
   { [ "$R2" = 0 ] && [ "$(cat "$WORK/p2")" = "$RE/par/RACE.c" ]; }
then ok "a concurrent double bring-up still answers ($R1/$R2)"
else bad "a concurrent double bring-up still answers ($R1/$R2)" "$WORK/p1" "$WORK/p1e" \
         "$WORK/p2" "$WORK/p2e"; fi

# C11: and the lane the race left is never torn — the next query reads it whole,
# so a lost process costs a retry and never the index.
rtin "$A" sym zqParallel > "$WORK/p3" 2>"$WORK/p3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/p3")" = "$RE/par/RACE.c" ]
then ok "the raced lane reads back whole"
else bad "the raced lane reads back whole (rc $RC)" "$WORK/p3" "$WORK/p3e"; fi

# C12: and two queries over a WARM foreign lane are pure readers — DOG-046's
# actual claim, and the case every fan-out after the first one is.
( rtin "$A" sym zqParallel > "$WORK/p4" 2>"$WORK/p4e"; echo $? > "$WORK/p4rc" ) &
( rtin "$A" sym zqParallel > "$WORK/p5" 2>"$WORK/p5e"; echo $? > "$WORK/p5rc" ) &
wait
R4=$(cat "$WORK/p4rc"); R5=$(cat "$WORK/p5rc")
if [ "$R4" = 0 ] && [ "$R5" = 0 ] &&
   [ "$(cat "$WORK/p4")" = "$RE/par/RACE.c" ] && [ "$(cat "$WORK/p5")" = "$RE/par/RACE.c" ]
then ok "two concurrent readers of a warm foreign lane both answer"
else bad "two concurrent readers both answer ($R4/$R5)" "$WORK/p4" "$WORK/p4e" \
         "$WORK/p5" "$WORK/p5e"; fi

# ==========================================================================
# leg 6 — the PROGRESS LINE (note.js, with the tty gate forced open)
# ==========================================================================
# F is cold and never registered: this leg drives `upForeign` directly, so the
# line it owes can be read off stderr without a pty.
F="$WORK/F"
fixF() { mkdir -p slow; printf 'void slow(void) { zqSlow(1); }\n' > slow/CCC.c; }
mkfix "$F" fixF
RF=$(cd "$F" && pwd -P)
LITE_FIX="$F" rtin "$A" --eval "require('$CASE/note.js')" \
    > "$WORK/n.out" 2>"$WORK/n.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/n.out" && ! grep -q '^FAIL' "$WORK/n.out" &&
   [ "$(grep -c "^indexing $RF\$" "$WORK/n.err")" = 1 ]; then
    N=$(grep -c '^ok' "$WORK/n.out"); CHECKS=$((CHECKS + N))
    ok "the walked repo names itself once on stderr, the no-op says nothing"
else
    bad "the progress line names the repo being walked (rc $RC)" "$WORK/n.out" "$WORK/n.err"
fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/coldfan] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/coldfan] $CHECKS checks, runtime $RT"
exit 0
