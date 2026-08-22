#!/bin/sh
# bee/test/cited/run.sh — BEE-057: `bee cited <path>` is the mirror of `bee
# cite` — the file with every INCOMING reference quoted under the line it
# lands on.
#
# The backlink rows name SUSPECTS and no more (INDEXES.mkd, "The suspects
# contract"); this leg drives the half that turns them into an answer.  The
# page comes through whole, a quote is cut over the CARRIER and banded with
# it, an anchorless ref opens above the file, and a suspect that points at a
# same-named file elsewhere adds nothing at all.
#
# Standalone: `sh bee/test/cited/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/cited
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "cited: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "cited: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "cited: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "cited: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-cited.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "cited: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# --- the fixture ----------------------------------------------------------
# `src/A.c` is the TARGET: 40 numbered 16-byte lines, so a landing is
# arithmetic the test can state.  Four carriers point at it — an anchored one,
# an anchored one inside a block comment, one whose citing line is a screenful
# and one naming it with no anchor at all — and `other/note.mkd` names its OWN
# neighbour `A.c`, which keys the same row and must add nothing.
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src other
  i=1
  : > src/A.c
  while [ "$i" -le 40 ]; do printf 'int AAAMARK%03d;\n' "$i" >> src/A.c; i=$((i + 1)); done
  i=1
  : > other/A.c
  while [ "$i" -le 5 ]; do printf 'int BBBMARK%03d;\n' "$i" >> other/A.c; i=$((i + 1)); done
  cat > doc.mkd <<'DOC'
#   DOCHEAD the citing page
DOCUP the line just above the first citation
DOCONE the marker sits at src/A.c:20 and that is the one to read.
DOCDN1 one line below it
DOCDN2 two lines below it
DOCFAR three below, out of the window
DOCPAD one
DOCPAD two
DOCDEAD a line no file has, src/A.c:9000, adds nothing.
DOCPAD three
DOCMERGEUP the line above the pair
DOCMERGEA cites src/A.c:30 here.
DOCMERGEB cites src/A.c:30 again, right below.
DOCMERGEDN1 one below the pair
DOCMERGEDN2 two below the pair
DOCMERGEFAR out of the union
DOCEND
DOC
  #  BEE-050:48 the citation sits INSIDE a block comment, so the quote is cut
  #  in mid-comment: re-lexing that window alone would paint its head as code.
  cat > note.js <<'NOTE'
/*  a block comment that opens here
    and cites src/A.c:5 halfway down
    and STILL RUNS as a comment past the citing line
    all the way to here */
var NOTECODE = 1;
NOTE
  #  BEE-050:30 the solo cap is cut over the CARRIER here: the citing line runs
  #  past 128 symbols, so LONGUP and LONGDN must not come along with it.
  LONG=$(awk 'BEGIN{ s="LONGMARK cites src/A.c:12 and then runs on"
                     while (length(s) < 200) s = s " and on and on and on"
                     print s }')
  printf 'LONGUP the line above\n%s\nLONGDN the line below\n' "$LONG" > long.mkd
  cat > bare.mkd <<'BARE'
BAREUP the line just above
BAREONE the whole file src/A.c is named here, with no line at all.
BAREDN1 one below
BAREDN2 two below
BAREFAR three below, out of the window
BARE
  #  BEE-057: a ticket page is cited BY CODE, and the indexer keys that ref on
  #  the code alone — no parents — so a query keyed on the PATH meets no row.
  mkdir -p todo/TKT
  cat > todo/TKT/TKT-001.mkd <<'TKT'
#   TKT-001: the ticket a page cites by its code
TKTUP the line above the landing
TKTHREE the line the code lands on
TKTDN1 one below
TKTDN2 two below
TKT
  cat > tkt.js <<'TKTJS'
//  TKTCARRYUP the line just above
//  the ticket TKT-001:3 rules it so
//  TKTCARRYDN1 one below
//  TKTCARRYDN2 two below
var TKTFAR = 1;
TKTJS
  #  The false suspect: `A.c` keys the very row `src/A.c` queries, and yet it
  #  names the file next door.  Only OPENING the suspect can tell the two apart.
  cat > other/note.mkd <<'FALSE'
FALSEONE the A.c:2 next door is another file entirely.
FALSE
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 the cited file and the pages that point at it" || exit 1
) || { echo "cited: cannot build the fixture repo" >&2; exit 2; }
rtin "$REPO" install > "$WORK/i1" 2>"$WORK/i1e" || true
#  LITE-033: the LINK rows are the grep this view narrows; `bee index` is the
#  one bring-up of both halves (BEE-007), so the suspects are there to open.
rtin "$REPO" index > "$WORK/i2" 2>"$WORK/i2e" || true

# --- the suspects really are suspects, false one included -----------------
rtin "$REPO" lindex src/A.c > "$WORK/s1" 2>"$WORK/s1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'doc.mkd' "$WORK/s1" && grep -q 'other/note.mkd' "$WORK/s1"
then ok "the backlink rows name every carrier, the false one among them"
else bad "lindex src/A.c (rc $RC)" "$WORK/s1" "$WORK/s1e"; fi

rtin "$REPO" cited --plain src/A.c > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
[ "$RC" = 0 ] || bad "cited src/A.c (rc $RC)" "$WORK/c1" "$WORK/c1e"

# --- the page comes through WHOLE and in order ----------------------------
if [ "$(grep -c '^int AAAMARK' "$WORK/c1")" = 40 ] &&
   [ "$(grep -n 'AAAMARK001' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'AAAMARK040' "$WORK/c1" | cut -d: -f1)" ]
then ok "the target comes through whole, its own lines in their own order"
else bad "the page is not the file" "$WORK/c1"; fi

# --- the quote is cut over the CARRIER, 1 up and 2 down -------------------
if grep -q 'DOCUP' "$WORK/c1" && grep -q 'DOCONE' "$WORK/c1" &&
   grep -q 'DOCDN1' "$WORK/c1" && grep -q 'DOCDN2' "$WORK/c1" &&
   ! grep -q 'DOCHEAD' "$WORK/c1" && ! grep -q 'DOCFAR' "$WORK/c1"
then ok "the quote is the CITING line, one above it and two below"
else bad "the window over the carrier is not 1+2" "$WORK/c1"; fi

# --- ...and it sits UNDER the line it lands on ----------------------------
if [ "$(grep -n 'AAAMARK020' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'DOCONE' "$WORK/c1" | cut -d: -f1)" ] &&
   [ "$(grep -n 'DOCONE' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'AAAMARK021' "$WORK/c1" | cut -d: -f1)" ]
then ok "...and it sits under the line it lands on, before the next one"
else bad "the quote is not under its landing" "$WORK/c1"; fi

# --- the band names the carrier, not the target ---------------------------
if [ "$(grep -c '^§ /.*/doc\.mkd:3$' "$WORK/c1")" = 1 ] &&
   [ "$(grep -c '^§ /.*/note\.js:2$' "$WORK/c1")" = 1 ]
then ok "each quote is banded with the carrier's own path and line"
else bad "the band does not name the carrier" "$WORK/c1"; fi

# --- carriers open in LANDING order, not in suspect order -----------------
# `note.js` lands on line 5 and `doc.mkd` on 20, though `doc.mkd` is the
# earlier suspect: the page is the target's, so the target's lines rule.
if [ "$(grep -n 'NOTEHEAD\|a block comment that opens here' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'DOCONE' "$WORK/c1" | cut -d: -f1)" ]
then ok "the quotes open in the order of the lines they land on"
else bad "the landing order is not kept" "$WORK/c1"; fi

# --- two citing lines under ONE landing merge into one quote --------------
# BEE-050:36 doc.mkd:12 wants 11..14 and doc.mkd:13 wants 12..15; quoted side
# by side they would repeat three lines, so they open as 11..15 once.
if [ "$(grep -c '^§ /.*/doc\.mkd:1[23]$' "$WORK/c1")" = 1 ] &&
   [ "$(grep -c 'DOCMERGEA' "$WORK/c1")" = 1 ] &&
   [ "$(grep -c 'DOCMERGEB' "$WORK/c1")" = 1 ] &&
   grep -q 'DOCMERGEUP' "$WORK/c1" && grep -q 'DOCMERGEDN2' "$WORK/c1" &&
   ! grep -q 'DOCMERGEFAR' "$WORK/c1"
then ok "two citing lines under one landing open as a single quote"
else bad "the touching pair was quoted twice" "$WORK/c1"; fi

# --- an anchorless ref opens ABOVE the file -------------------------------
if grep -q 'BAREONE' "$WORK/c1" &&
   [ "$(grep -n 'BAREONE' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'AAAMARK001' "$WORK/c1" | cut -d: -f1)" ] &&
   grep -q 'BAREUP' "$WORK/c1" && ! grep -q 'BAREFAR' "$WORK/c1"
then ok "a ref with no anchor lands on no line and opens above the file"
else bad "the anchorless ref is misplaced" "$WORK/c1"; fi

# --- a citing line past 128 symbols is quoted ALONE -----------------------
if grep -q 'LONGMARK' "$WORK/c1" &&
   ! grep -q 'LONGUP' "$WORK/c1" && ! grep -q 'LONGDN' "$WORK/c1"
then ok "a citing line past 128 symbols is quoted with no context at all"
else bad "the long citing line brought its neighbours" "$WORK/c1"; fi

# --- a dead landing and a FALSE SUSPECT add nothing -----------------------
# `src/A.c:9000` names a line the target has not got; `other/note.mkd` really
# points at `other/A.c`, which only opening the suspect could ever say.
if ! grep -q 'DOCDEAD' "$WORK/c1" && ! grep -q 'FALSEONE' "$WORK/c1" &&
   ! grep -q 'BBBMARK' "$WORK/c1"
then ok "a dead landing and a false suspect both add nothing at all"
else bad "a miss or a false suspect was quoted" "$WORK/c1"; fi

# --- ...and the same suspect DOES answer for the file it names ------------
rtin "$REPO" cited --plain other/A.c > "$WORK/c2" 2>"$WORK/c2e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'FALSEONE' "$WORK/c2" && grep -q 'BBBMARK002' "$WORK/c2" &&
   ! grep -q 'AAAMARK' "$WORK/c2"
then ok "...while the file it truly names quotes it, on the line it lands on"
else bad "cited other/A.c (rc $RC)" "$WORK/c2" "$WORK/c2e"; fi

# --- a ticket page is cited BY CODE, which no path query ever finds -------
# `bee lindex` on the path meets no row; the view asks a second time with the
# bare code, so the carrier that wrote `TKT-001:3` still opens on line 3.
rtin "$REPO" lindex todo/TKT/TKT-001.mkd > "$WORK/t1" 2>"$WORK/t1e"
rtin "$REPO" lindex TKT-001              > "$WORK/t2" 2>"$WORK/t2e"
if ! grep -q 'tkt.js' "$WORK/t1" && grep -q 'tkt.js' "$WORK/t2"
then ok "the path query misses the ticket-code row that the code query holds"
else bad "the ticket-code row is not where BEE-057 says" "$WORK/t1" "$WORK/t2"; fi

rtin "$REPO" cited --plain todo/TKT/TKT-001.mkd > "$WORK/t3" 2>"$WORK/t3e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'TKTCARRYUP' "$WORK/t3" && ! grep -q 'TKTFAR' "$WORK/t3" &&
   [ "$(grep -c '^§ /.*/tkt\.js:2$' "$WORK/t3")" = 1 ] &&
   [ "$(grep -n 'TKTHREE' "$WORK/t3" | cut -d: -f1)" -lt \
     "$(grep -n 'TKTCARRYUP' "$WORK/t3" | cut -d: -f1)" ] &&
   [ "$(grep -n 'TKTCARRYUP' "$WORK/t3" | cut -d: -f1)" -lt \
     "$(grep -n 'TKTDN1' "$WORK/t3" | cut -d: -f1)" ]
then ok "...so a ticket-code carrier opens under the line its code lands on"
else bad "cited todo/TKT/TKT-001.mkd (rc $RC)" "$WORK/t3" "$WORK/t3e"; fi

# --- a page never cites ITSELF (gritzko, 2026-08-22) ----------------------
# The ticket names its own code in its title, so the rows make it a carrier of
# itself; that is no backlink, and the target is dropped before it is read.
if ! grep -q '^§ /.*/TKT-001\.mkd' "$WORK/t3" &&
   [ "$(grep -c 'TKTHREE' "$WORK/t3")" = 1 ]
then ok "a page never quotes itself, whatever its own title spells"
else bad "the ticket quoted its own title back at itself" "$WORK/t3"; fi

# --- a file nothing points at is exactly `cat` ----------------------------
rtin "$REPO" cited --plain doc.mkd > "$WORK/c3" 2>"$WORK/c3e"; RC=$?
rtin "$REPO" cat   --plain doc.mkd > "$WORK/c4" 2>"$WORK/c4e"
if [ "$RC" = 0 ] && cmp -s "$WORK/c3" "$WORK/c4"
then ok "a file nothing points at answers byte for byte as \`cat\` does"
else bad "cited != cat on a file with no backlink (rc $RC)" "$WORK/c3" "$WORK/c3e"; fi

# --- a rev is refused in plain words --------------------------------------
# The LINK rows are scanned off the TIP alone, so there is no rev at which
# this page could honestly be answered.
rtin "$REPO" cited --plain 'src/A.c?master' > "$WORK/c5" 2>"$WORK/c5e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'tip' "$WORK/c5e"
then ok "a \`?<rev>\` is refused in words — the backlinks index the tip"
else bad "cited src/A.c?master (rc $RC)" "$WORK/c5" "$WORK/c5e"; fi

# --- an ABSOLUTE target opens in ITS OWN repo -----------------------------
# Every band prints its carrier absolute, so the reader feeds one straight
# back — from wherever he stands; $WORK is outside the fixture repo entirely.
rtin "$WORK" cited --plain "$REPO/src/A.c" > "$WORK/c7" 2>"$WORK/c7e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'AAAMARK020' "$WORK/c7" && grep -q 'DOCONE' "$WORK/c7"
then ok "an absolute path opens in its own repo, whatever the cwd is"
else bad "cited $REPO/src/A.c from outside it (rc $RC)" "$WORK/c7" "$WORK/c7e"; fi

# --- a bad argument says what it wants ------------------------------------
rtin "$REPO" cited --plain nosuch.mkd > "$WORK/c6" 2>"$WORK/c6e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'cited' "$WORK/c6e"
then ok "a path the worktree has not got is refused in plain words"
else bad "cited nosuch.mkd (rc $RC)" "$WORK/c6" "$WORK/c6e"; fi

# --- the assertions -------------------------------------------------------
( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" \
  "$RT" --eval "require('$CASE/cited.js')" ) > "$WORK/j.out" 2>"$WORK/j.err"
RC=$?
cat "$WORK/j.out"
if [ "$RC" != 0 ]; then
    FAILED=$((FAILED + 1))
    echo "--- stderr ---"; cat "$WORK/j.err"
fi

if [ "$FAILED" = 0 ]; then
    echo "PASS [bee/cited] $CHECKS shell checks, plus cited.js"
else
    echo "FAIL [bee/cited] $FAILED bad" >&2
    exit 1
fi
