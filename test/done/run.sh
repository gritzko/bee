#!/bin/sh
# bee/test/done/run.sh — BEE-043: `done KEY…` / `dont KEY…`, the two acts that
# CLOSE a ticket.  Two legs over ONE fixture:
#
#   1. the PANEL (panel.js) — every OPEN board row wears the trailing `[ ✓ ✗]`
#      frame, each face its own click zone minting the CONTEXT-LESS `done KEY` /
#      `dont KEY` spell; plain stays chrome-free; a closed row wears none; and a
#      real ` ✓` click flips the page and drops the row in place;
#   2. the VERBS (this script) — the `Now:` flip, the pair ADDED when absent, an
#      already-closed page left byte for byte, a page-less key's `TODONONE`, an
#      odd head reported VISIBLY and skipped, a multi-key loop, and the WORKTREE
#      retirement to `$SRC_ROOT/done/` with git's back-pointers repaired (the
#      fixture worktree carries a fork.js-style submodule worktree and dirt).
#
# [/todo/TODO/TODO-013] is pinned here too: be's `done` re-wrote a legacy [DONE]
# title mark and SPLICED a second, column-0 `Now:` pair beside the indented one.
# GET-011/GET-012 carry that page's exact shape and assert neither can happen.
#
# THE GAP THIS REPROS: bee could not close a ticket at all — no verb wrote a
# meta page, no board button offered one, and a finished ticket's worktree sat
# in $SRC_ROOT forever.
#
# Standalone: `sh bee/test/done/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/done
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "done: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "done: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "done: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "done: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-done.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home and a FIXTURE
#  $SRC_ROOT — this suite EDITS ticket pages and MOVES worktrees, so it may
#  never see the user's own registry, journal or `~/src`.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "done: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
BETA="$SRC/beta"
echo "done: runtime $RT, fixtures $WORK"

bee() { ( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" "$@" ); }
gitq() { D=$1; shift; GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t \
         GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
         GIT_AUTHOR_DATE="@1700000000 +0000" GIT_COMMITTER_DATE="@1700000000 +0000" \
         git -C "$D" "$@"; }

# ---------------------------------------------------------------------------
# the fixture: one meta repo with a todo/ tree, one submodule, one ticket wt
# ---------------------------------------------------------------------------
mkdir -p "$SRC/sub" && git -C "$SRC/sub" init -q -b master . || exit 2
printf 's\n' > "$SRC/sub/s.txt"
gitq "$SRC/sub" add -A && gitq "$SRC/sub" commit -q -m sub || exit 2

mkdir -p "$BETA/todo/GET" && git -C "$BETA" init -q -b master . || exit 2
mk() { printf '#   %s: %s\n    Now: OPEN\n    Sev: HIGH\n' "$1" "$2" \
       > "$BETA/todo/GET/$1.mkd"; }
mk GET-001 "flip me"
#  A page with NO meta block at all: the pair must be ADDED under the header.
printf '#   GET-002: pairless\n\nnothing but prose here.\n' > "$BETA/todo/GET/GET-002.mkd"
#  Already closed: `done` must not touch a byte of it.
printf '#   GET-003: already shut\n    Now: DONE\n' > "$BETA/todo/GET/GET-003.mkd"
#  An ODD head — the title names no ticket, so the verb reports and skips.
printf '##  Miscellany\n    Now: OPEN\n\nan odd page.\n' > "$BETA/todo/GET/GET-004.mkd"
#  [/todo/TODO/TODO-013]'s exact page shape: header, a BLANK line, then the
#  four-space block whose first pair is `Now: OPEN`.  be's `done` spliced a
#  SECOND pair at column 0 here and re-wrote the legacy `[DONE]` title mark.
printf '#   GET-011: the TODO-013 shape\n\n    Now: OPEN\n    Sev: CRIT\n\nbody.\n' \
  > "$BETA/todo/GET/GET-011.mkd"
cp "$BETA/todo/GET/GET-011.mkd" "$BETA/todo/GET/GET-012.mkd"
sed '1s/.*/#   GET-012: the TODO-013 shape, shelved/' "$BETA/todo/GET/GET-012.mkd" \
    > "$BETA/todo/GET/GET-012.tmp" && mv "$BETA/todo/GET/GET-012.tmp" "$BETA/todo/GET/GET-012.mkd"
mk GET-005 "has a worktree"
mk GET-007 "one of two"
mk GET-008 "two of two"
mk GET-009 "clicked shut"
git -C "$BETA" -c protocol.file.allow=always submodule add -q "$SRC/sub" sub 2>/dev/null || exit 2
gitq "$BETA" add -A && gitq "$BETA" commit -q -m seed || exit 2
printf '%s\n' "$BETA" > "$REG"
bee index "$BETA" > "$WORK/ix" 2>&1 || { bad "index the fixture board" "$WORK/ix"; exit 1; }

# GET-005's worktree, fork.js-style: the top tree, then a worktree of the SUB's
# own repo at the gitlink (fork.js:84 grow) — and dirt, which the move must keep.
gitq "$BETA" worktree add -q -b GET-005 "$SRC/beta-GET-005" master || exit 2
SUBSHA=$(gitq "$SRC/sub" rev-parse HEAD)
gitq "$BETA/sub" worktree add -q --detach "$SRC/beta-GET-005/sub" "$SUBSHA" || exit 2
printf 'work in progress\n' > "$SRC/beta-GET-005/wip.txt"
printf 'sub dirt\n' > "$SRC/beta-GET-005/sub/wip.txt"

# A SECOND registered board, submodule-LESS: its key resolves through the
# registered-repo fan-out (the run stands in no repo at all), and git itself is
# allowed to move its worktree — the other leg of the retirement.
GAMMA="$SRC/gamma"
mkdir -p "$GAMMA/todo/GET" && git -C "$GAMMA" init -q -b master . || exit 2
printf '#   GET-010: the other board\n    Now: OPEN\n' > "$GAMMA/todo/GET/GET-010.mkd"
gitq "$GAMMA" add -A && gitq "$GAMMA" commit -q -m seed || exit 2
printf '%s\n' "$GAMMA" >> "$REG"
bee index "$GAMMA" > "$WORK/ix2" 2>&1 || { bad "index the second board" "$WORK/ix2"; exit 1; }
gitq "$GAMMA" worktree add -q -b GET-010 "$SRC/gamma-GET-010" master || exit 2
printf 'wip\n' > "$SRC/gamma-GET-010/wip.txt"

# ===========================================================================
# leg 1 — the PANEL and the click (headless, over the real hunks)
# ===========================================================================
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/panel.js')" ) \
    > "$WORK/p.out" 2> "$WORK/p.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- panel stderr ---"; cat "$WORK/p.err"
    bad "panel leg exited non-zero (rc $RC)" "$WORK/p.out"
elif grep -q '^FAIL' "$WORK/p.out"; then
    cat "$WORK/p.out"; bad "panel leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/p.out"; then
    cat "$WORK/p.out"; bad "panel leg did not finish"
else
    N=$(grep -c '^ok' "$WORK/p.out")
    CHECKS=$((CHECKS + N))
    ok "panel leg: $N checks (the frame, the spells, plain parity, the click)"
fi

# ...and the click really wrote the page — git is the witness, outside the
# runtime under test.
if grep -q '^    Now: DONE$' "$BETA/todo/GET/GET-009.mkd"
then ok "the done-button click flipped GET-009's own page to DONE"
else bad "the click did not flip GET-009" "$BETA/todo/GET/GET-009.mkd"; fi

# ===========================================================================
# leg 2 — the verbs
# ===========================================================================
# --- the flip, in place, nothing else moved --------------------------------
bee done GET-001 > "$WORK/d1" 2> "$WORK/d1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'GET-001' "$WORK/d1" && grep -q 'flip me' "$WORK/d1"
then ok "done GET-001 answers ONE confirmation row (key + title)"
else bad "done GET-001 (rc $RC)" "$WORK/d1" "$WORK/d1e"; fi

if [ "$(cat "$BETA/todo/GET/GET-001.mkd")" = "$(printf '#   GET-001: flip me\n    Now: DONE\n    Sev: HIGH')" ]
then ok "...the head's Now: pair reads DONE, in place, at its own indent"
else bad "the GET-001 flip is not a head-scoped line edit" "$BETA/todo/GET/GET-001.mkd"; fi

# The verb NEVER commits: the meta tree is left dirty for the user to land.
if [ -n "$(gitq "$BETA" status --porcelain)" ] &&
   [ "$(gitq "$BETA" rev-list --count HEAD)" = 1 ]
then ok "...and nothing was committed — the edit waits for the user"
else bad "the verb committed the meta tree"; fi

# --- the pair is ADDED when the page carries none --------------------------
N2=$(( $(wc -l < "$BETA/todo/GET/GET-002.mkd") ))
bee dont GET-002 > "$WORK/d2" 2> "$WORK/d2e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'GET-002' "$WORK/d2"
then ok "dont GET-002 answers its row"
else bad "dont GET-002 (rc $RC)" "$WORK/d2" "$WORK/d2e"; fi
if [ "$(sed -n 2p "$BETA/todo/GET/GET-002.mkd")" = "    Now: DONT" ] &&
   [ "$(( $(wc -l < "$BETA/todo/GET/GET-002.mkd") ))" = "$((N2 + 1))" ] &&
   [ "$(grep -c 'Now:' "$BETA/todo/GET/GET-002.mkd")" = 1 ] &&
   grep -q 'nothing but prose here' "$BETA/todo/GET/GET-002.mkd"
then ok "...ONE line added at the four-space house indent, the body untouched"
else bad "the pair was not added under the header" "$BETA/todo/GET/GET-002.mkd"; fi

# --- [/todo/TODO/TODO-013]: no legacy mark, no second pair -----------------
# One status statement per page: the pair, INSIDE the block, at the block's own
# indent — and the title left exactly as its author wrote it.
for k in GET-011 GET-012; do
    L0=$(head -1 "$BETA/todo/GET/$k.mkd")
    N0=$(( $(wc -l < "$BETA/todo/GET/$k.mkd") ))
    case $k in GET-011) V=done; M=DONE ;; *) V=dont; M=DONT ;; esac
    bee $V $k > "$WORK/t13.$k" 2> "$WORK/t13e.$k"; RC=$?
    F="$BETA/todo/GET/$k.mkd"
    if [ "$RC" = 0 ] && [ "$(head -1 "$F")" = "$L0" ]
    then ok "$V $k leaves the TITLE byte for byte — no legacy [$M] mark"
    else bad "$V wrote a title mark (rc $RC)" "$F" "$WORK/t13e.$k"; fi
    if [ "$(sed -n 3p "$F")" = "    Now: $M" ] && [ "$(sed -n 2p "$F")" = "" ]
    then ok "...rewriting the pair IN PLACE, under the blank line, at its own indent"
    else bad "the pair was not rewritten in place" "$F"; fi
    if [ "$(( $(wc -l < "$F") ))" = "$N0" ]
    then ok "...splicing NO line anywhere — the page is the same length"
    else bad "a line was spliced into the page" "$F"; fi
    if [ "$(grep -c 'Now:' "$F")" = 1 ] && [ "$(grep -c '^Now:' "$F")" = 0 ]
    then ok "...and exactly ONE Now: is left, never a column-0 twin"
    else bad "the page states its status twice" "$F"; fi
done

# --- idempotent: an already-closed page is not rewritten at all ------------
cp "$BETA/todo/GET/GET-003.mkd" "$WORK/g3.before"
bee done GET-003 > "$WORK/d3" 2> "$WORK/d3e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'already closed' "$WORK/d3" &&
   cmp -s "$WORK/g3.before" "$BETA/todo/GET/GET-003.mkd"
then ok "an already-closed page answers '(already closed)' and keeps every byte"
else bad "the already-closed leg (rc $RC)" "$WORK/d3" "$WORK/d3e"; fi

# --- an odd head is reported VISIBLY and skipped (be BE-040 r2) ------------
cp "$BETA/todo/GET/GET-004.mkd" "$WORK/g4.before"
bee done GET-004 > "$WORK/d4" 2> "$WORK/d4e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'odd head, skipped' "$WORK/d4"
then ok "an odd head is a VISIBLE report row, never a silent log"
else bad "the odd head did not report on the ROW stream (rc $RC)" "$WORK/d4" "$WORK/d4e"; fi
if cmp -s "$WORK/g4.before" "$BETA/todo/GET/GET-004.mkd"
then ok "...and that page is left byte for byte, its Now: pair included"
else bad "the odd-head page was rewritten" "$BETA/todo/GET/GET-004.mkd"; fi

# --- a key with no page ----------------------------------------------------
bee done GET-006 > "$WORK/d6" 2> "$WORK/d6e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'done: GET-006: TODONONE' "$WORK/d6e"
then ok "a key with no page is one TODONONE line and a non-zero exit"
else bad "the page-less key (rc $RC)" "$WORK/d6" "$WORK/d6e"; fi

# --- multi-key: the verb LOOPS --------------------------------------------
bee done GET-007 GET-008 > "$WORK/d7" 2> "$WORK/d7e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'GET-007' "$WORK/d7" && grep -q 'GET-008' "$WORK/d7" &&
   grep -q '^    Now: DONE$' "$BETA/todo/GET/GET-007.mkd" &&
   grep -q '^    Now: DONE$' "$BETA/todo/GET/GET-008.mkd"
then ok "done KEY KEY closes both and answers a row for each"
else bad "the multi-key loop (rc $RC)" "$WORK/d7" "$WORK/d7e"; fi

# --- the WORKTREE retirement ----------------------------------------------
bee done GET-005 > "$WORK/d5" 2> "$WORK/d5e"; RC=$?
DEST="$SRC/done/beta-GET-005"
if [ "$RC" = 0 ] && grep -q 'mov ' "$WORK/d5" && [ -d "$DEST" ] &&
   [ ! -e "$SRC/beta-GET-005" ]
then ok "done GET-005 RETIRES its worktree to \$SRC_ROOT/done/"
else bad "the worktree did not move (rc $RC)" "$WORK/d5" "$WORK/d5e"; fi

if grep -q '^    Now: DONE$' "$BETA/todo/GET/GET-005.mkd"
then ok "...with the page flipped alongside it"
else bad "the wt-owning page did not flip" "$BETA/todo/GET/GET-005.mkd"; fi

# Nothing is ever deleted: dirty work rode along, top tree and sub alike.
if [ "$(cat "$DEST/wip.txt" 2>/dev/null)" = "work in progress" ] &&
   [ "$(cat "$DEST/sub/wip.txt" 2>/dev/null)" = "sub dirt" ]
then ok "...a DIRTY tree preserved whole, submodule dirt included"
else bad "the move lost uncommitted work"; fi

# The REPAIR is the point: git must know the worktree at its new address, from
# both ends, and the sub worktree the same way through its own repo.
if git -C "$DEST" status --porcelain > "$WORK/st" 2>"$WORK/ste"
then ok "git -C <moved> status still works"
else bad "the moved worktree is broken" "$WORK/ste"; fi
if gitq "$BETA" worktree list | grep -q "$DEST" &&
   ! gitq "$BETA" worktree list | grep -q 'prunable'
then ok "...and the MAIN repo names the new path — worktree repair ran"
else bad "the main repo still points at the old path" ; fi
if git -C "$DEST/sub" status --porcelain > "$WORK/sst" 2>"$WORK/sste" &&
   gitq "$BETA/sub" worktree list | grep -q "$DEST/sub" &&
   ! gitq "$BETA/sub" worktree list | grep -q 'prunable'
then ok "...the per-gitlink sub worktree repaired through its OWN repo (fork.js:84)"
else bad "the sub worktree was not repaired" "$WORK/sste"; fi

# --- the OTHER board: the fan-out finds the page, git itself moves the wt ---
bee done GET-010 > "$WORK/d10" 2> "$WORK/d10e"; RC=$?
DEST2="$SRC/done/gamma-GET-010"
if [ "$RC" = 0 ] && grep -q '^    Now: DONE$' "$GAMMA/todo/GET/GET-010.mkd"
then ok "a key with no local repo resolves through the registered-repo scan"
else bad "the second board's page did not flip (rc $RC)" "$WORK/d10" "$WORK/d10e"; fi
if [ -d "$DEST2" ] && [ ! -e "$SRC/gamma-GET-010" ] &&
   [ "$(cat "$DEST2/wip.txt" 2>/dev/null)" = "wip" ] &&
   git -C "$DEST2" status --porcelain > "$WORK/st2" 2>&1 &&
   gitq "$GAMMA" worktree list | grep -q "$DEST2"
then ok "...and a submodule-LESS worktree rides git worktree move itself"
else bad "the git-native move leg" "$WORK/d10" "$WORK/d10e" "$WORK/st2"; fi

# --- the done root never lists as a ticket worktree ------------------------
bee wts > "$WORK/w1" 2>"$WORK/w1e"; RC=$?
if [ "$RC" = 0 ] && ! grep -q 'GET-005\|GET-010' "$WORK/w1"
then ok "the retired worktree is no ticket wt any more (wts.scan skips done/)"
else bad "a retired worktree still lists (rc $RC)" "$WORK/w1" "$WORK/w1e"; fi

# --- the board drops every closed row --------------------------------------
bee todo --plain GET > "$WORK/b1" 2>"$WORK/b1e"; RC=$?
if [ "$RC" = 0 ] && ! grep -q 'GET-001\|GET-002\|GET-005\|GET-007\|GET-008\|GET-009\|GET-011\|GET-012' "$WORK/b1"
then ok "the board drops every closed row — the open filter reads Now:"
else bad "a closed ticket still boards (rc $RC)" "$WORK/b1" "$WORK/b1e"; fi
if grep -q 'GET-004' "$WORK/b1"
then ok "...while the skipped odd-head page still boards, untouched"
else bad "the odd-head page vanished from the board" "$WORK/b1"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/done] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/done] $CHECKS checks, runtime $RT"
exit 0
