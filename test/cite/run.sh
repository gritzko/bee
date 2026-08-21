#!/bin/sh
# bee/test/cite/run.sh — BEE-050: `bee cite <path>` is the file with every
# anchored reference on it already quoted, one line above and two below.
#
# `bee see` reads ONE reference, retyped by hand ([BEE-017]); reading a page
# whose comments cite ten of them meant ten trips.  This leg drives the page:
# the file comes through whole and in order, each citation sits under the line
# that named it, and a miss, a bare name or a repeat adds nothing at all.
#
# Standalone: `sh bee/test/cite/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/cite
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "cite: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "cite: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "cite: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "cite: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-cite.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "cite: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
# 40 numbered 16-byte lines in src/A.c, so a window is arithmetic the test can
# state: `src/A.c:20` with 1 above and 2 below is exactly AAAMARK019..022.
# `doc.mkd` cites it, cites it AGAIN, cites a line no file has, and names it
# bare — the four answers this view owes, on four separate lines.
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src
  i=1
  : > src/A.c
  while [ "$i" -le 40 ]; do printf 'int AAAMARK%03d;\n' "$i" >> src/A.c; i=$((i + 1)); done
  cat > doc.mkd <<'DOC'
#   DOCHEAD the citing page

DOCONE the marker sits at src/A.c:20 and that is the one to read.
DOCTWO the very same src/A.c:20 again, which must not repeat.
DOCTHREE a line no file has, nowhere/ZZZ.c:9000, adds nothing.
DOCFOUR a bare src/A.c names a file, not a place in one.
DOCFIVE the head of it, src/A.c:1, clamps at the first line.
DOCEND
DOC
  #  BEE-050:48 the citation sits INSIDE a block comment, so the cut lands in
  #  mid-comment: re-lexing that segment alone would paint its head as code.
  cat > note.js <<'NOTE'
/*  a block comment that opens here
    and cites src/A.c:30 halfway down
    and STILL RUNS as a comment past the citing line
    all the way to here */
var code = 1;
NOTE
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 the cited file and its citing page" || exit 1
) || { echo "cite: cannot build the fixture repo" >&2; exit 2; }
rtin "$REPO" install > "$WORK/i1" 2>"$WORK/i1e" || true

# --- the page comes through WHOLE and in order ----------------------------
rtin "$REPO" cite --plain doc.mkd > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(grep -c '^DOC\|^#   DOCHEAD' "$WORK/c1")" = 7 ] &&
   [ "$(grep -n 'DOCONE' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'DOCEND' "$WORK/c1" | cut -d: -f1)" ]
then ok "the page comes through whole, its own lines in their own order"
else bad "cite doc.mkd (rc $RC)" "$WORK/c1" "$WORK/c1e"; fi

# --- the window: ONE line above, TWO below --------------------------------
if grep -q 'AAAMARK019' "$WORK/c1" && grep -q 'AAAMARK020' "$WORK/c1" &&
   grep -q 'AAAMARK021' "$WORK/c1" && grep -q 'AAAMARK022' "$WORK/c1" &&
   ! grep -q 'AAAMARK018' "$WORK/c1" && ! grep -q 'AAAMARK023' "$WORK/c1"
then ok "the quote is one line above the landing and two below it"
else bad "the window is not 1+2" "$WORK/c1"; fi

# --- it sits UNDER the line that named it ---------------------------------
if [ "$(grep -n 'DOCONE' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'AAAMARK020' "$WORK/c1" | cut -d: -f1)" ] &&
   [ "$(grep -n 'AAAMARK020' "$WORK/c1" | cut -d: -f1)" -lt \
     "$(grep -n 'DOCTWO' "$WORK/c1" | cut -d: -f1)" ]
then ok "...and it sits under the citing line, before the next one"
else bad "the quote is not under its own line" "$WORK/c1"; fi

# --- a target named twice is quoted ONCE ----------------------------------
if [ "$(grep -c 'AAAMARK020' "$WORK/c1")" = 1 ]
then ok "a target named twice is quoted at its FIRST mention only"
else bad "the repeat was quoted again" "$WORK/c1"; fi

# --- a miss and a bare name add NOTHING -----------------------------------
# Two bands, no more: the AAAMARK020 window and the AAAMARK001 one.  A dead
# line and a bare filename must leave their lines exactly as they were.
if [ "$(grep -c '^hunk ' "$WORK/c1")" = 2 ] && ! grep -q 'ZZZ.c' "$WORK/c1e"
then ok "a dead reference and a bare filename add nothing at all"
else bad "a miss or a bare name was quoted" "$WORK/c1" "$WORK/c1e"; fi

# --- the window CLAMPS at the head of the file ----------------------------
if grep -q 'AAAMARK001' "$WORK/c1" && grep -q 'AAAMARK003' "$WORK/c1" &&
   ! grep -q 'AAAMARK004' "$WORK/c1"
then ok "the window clamps at the first line, never runs off the front"
else bad "clamping at line 1" "$WORK/c1"; fi

# --- a page with NO reference on it is exactly `cat` -----------------------
rtin "$REPO" cite --plain src/A.c > "$WORK/c2" 2>"$WORK/c2e"; RC=$?
rtin "$REPO" cat  --plain src/A.c > "$WORK/c3" 2>"$WORK/c3e"
if [ "$RC" = 0 ] && cmp -s "$WORK/c2" "$WORK/c3"
then ok "a file with nothing to quote answers byte for byte as \`cat\` does"
else bad "cite != cat on a reference-free file (rc $RC)" "$WORK/c2" "$WORK/c2e"; fi

# --- a PERMALINK is a reference like any other ----------------------------
# `bee mint` upgrades `src/A.c:20` in place; cite must still land on line 20.
rtin "$REPO" mint doc.mkd > "$WORK/m1" 2>"$WORK/m1e" || true
if grep -q 'src/A.c:20:' "$REPO/doc.mkd"; then
    rtin "$REPO" cite --plain doc.mkd > "$WORK/c4" 2>"$WORK/c4e"; RC=$?
    if [ "$RC" = 0 ] && grep -q 'AAAMARK020' "$WORK/c4" &&
       [ "$(grep -c 'AAAMARK020' "$WORK/c4")" = 1 ]
    then ok "a MINTED permalink quotes the same line, still once"
    else bad "the permalink did not quote (rc $RC)" "$WORK/c4" "$WORK/c4e"; fi
else
    ok "SKIP the permalink leg — mint left doc.mkd unminted"
fi

# --- a bad argument says what it wants ------------------------------------
rtin "$REPO" cite --plain nosuch.mkd > "$WORK/c5" 2>"$WORK/c5e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'cite' "$WORK/c5e"
then ok "a path the worktree has not got is refused in plain words"
else bad "cite nosuch.mkd (rc $RC)" "$WORK/c5" "$WORK/c5e"; fi

# --- the assertions -------------------------------------------------------
( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" \
  "$RT" --eval "require('$CASE/cite.js')" ) > "$WORK/j.out" 2>"$WORK/j.err"
RC=$?
cat "$WORK/j.out"
if [ "$RC" != 0 ]; then
    FAILED=$((FAILED + 1))
    echo "--- stderr ---"; cat "$WORK/j.err"
fi

if [ "$FAILED" = 0 ]; then
    echo "PASS [bee/cite] $CHECKS shell checks, plus cite.js"
else
    echo "FAIL [bee/cite] $FAILED bad" >&2
    exit 1
fi
