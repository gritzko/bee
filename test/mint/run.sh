#!/bin/sh
# bee/test/mint/run.sh — BEE-016: `bee mint <file>...` upgrades the TRANSIENT
# `file:line(:col)` refs of the files it is NAMED to `file:OFF:HASHLET`
# permalinks, in the WORKING copy alone.  The hook only ever sees a commit in
# flight ([BEE-015]), so refs that landed transient are reachable no other way.
#
# The fixture COMMITS its refs with no hook installed — which is exactly the
# backlog state — then mints them after the fact.  This leg drives the CLI for
# what only the CLI can say (exit codes, the report, git's own view of the
# index) and hands the byte-level assertions to mint.js.
#
# Standalone: `sh bee/test/mint/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`); the DOG-034 lexer is what fuses a
# `path:line:col` ref into ONE `F` token, so this wants a quickjab build.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/mint
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "mint: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "mint: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "mint: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "mint: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-mint.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "mint: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# --- the fixture ----------------------------------------------------------
# FIXED-WIDTH lines, 16 bytes each (`int AAAMARK007;\n`), so a blob BYTE OFFSET
# is arithmetic the test states without asking the code under test.
#   src/A.c   the anchor everything aims at
#   src/B.c   an anchor the worktree DIRTIES after the commit
#   src/C.c + net/C.c   twins, so a bare `C.c` names two files at once
#   doc/page.mkd   seven ref shapes, COMMITTED TRANSIENT (no hook installed)
#   doc/other.mkd  a transient ref in a file the mint is never given
#   doc/x.mkd -> doc/y.mkd -> src/A.c   the chain: y's own rewrite moves the
#                  line x names, so x is right only if y minted FIRST
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src net doc
  numbered() {                                   # $1 = mark prefix, $2 = out file
    i=1
    : > "$2"
    while [ "$i" -le 40 ]; do
        printf 'int %s%03d;\n' "$1" "$i" >> "$2"
        i=$((i + 1))
    done
  }
  numbered AAAMARK src/A.c
  numbered BBBMARK src/B.c
  numbered CCCMARK src/C.c
  cp src/C.c net/C.c
  cat > doc/page.mkd <<'EOF'
the page itself
see src/A.c:20 for the anchor
col src/A.c:20:5 with a column
gone no/such/file.c:3 resolves to nothing
past src/A.c:999 is off the end
self doc/page.mkd:1 names this very file
many C.c:5 names two files at once
dirt src/B.c:10 has uncommitted edits
EOF
  printf 'other src/A.c:30 stays transient\n' > doc/other.mkd
  printf 'the X page\nxref doc/y.mkd:3 there\n' > doc/x.mkd
  printf 'the Y page\nyref src/A.c:9 here\nthe Y tail\n' > doc/y.mkd
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 the refs, committed transient" || exit 1
) || { echo "mint: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }

# The backlog state, pinned: nothing minted at commit time, because no hook ran.
if g show "HEAD:doc/page.mkd" | grep -q 'see src/A.c:20 for the anchor'
then ok "the fixture COMMITS its refs transient — the hook never saw them"
else bad "the fixture is not in the backlog state"; g show "HEAD:doc/page.mkd"; fi

# `install` REGISTERS the repo (the door's fan-out reads that list) and indexes
# it.  It plants the hook too, which never runs here: mint commits nothing.
rtin "$REPO" install > "$WORK/i1" 2>"$WORK/i1e" || true

# src/B.c goes DIRTY and stays uncommitted: a ref into it must be REFUSED, not
# anchored to bytes the reader will never see.
printf 'int BBBMARK041;\n' >> "$REPO/src/B.c"

B_A=$(g rev-parse "HEAD:src/A.c") || exit 2

# --- bare `bee mint` is USAGE, never a whole-tree sweep --------------------
cp "$REPO/doc/page.mkd" "$WORK/page.r0"
rtin "$REPO" mint > "$WORK/u1" 2>"$WORK/u1e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Usage' "$WORK/u1e" &&
   cmp -s "$WORK/page.r0" "$REPO/doc/page.mkd"
then ok "bare \`bee mint\` is usage and rewrites nothing"
else bad "bare mint (rc $RC)" "$WORK/u1" "$WORK/u1e"; fi

# --- --dry-run says everything and writes nothing --------------------------
rtin "$REPO" mint --dry-run doc/page.mkd > "$WORK/d1" 2>"$WORK/d1e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/page.r0" "$REPO/doc/page.mkd" &&
   grep -q 'doc/page.mkd' "$WORK/d1" && grep -q '2 reference' "$WORK/d1"
then ok "--dry-run reports the two mintable refs and writes not a byte"
else bad "dry run (rc $RC)" "$WORK/d1" "$WORK/d1e"; fi

# --- the mint itself -------------------------------------------------------
rtin "$REPO" mint doc/page.mkd doc/x.mkd doc/y.mkd > "$WORK/m1" 2>"$WORK/m1e"; RC=$?
cat "$WORK/m1"
if [ "$RC" = 0 ]; then ok "the mint runs clean over three files"
else bad "mint (rc $RC)" "$WORK/m1" "$WORK/m1e"; fi

# Every refusal is SAID, one line per ref — the conversation a hook cannot have.
if grep -q 'no/such/file.c' "$WORK/m1" && grep -q 'C.c' "$WORK/m1" &&
   grep -q 'src/B.c' "$WORK/m1" && grep -q 'src/A.c:999\|line 999' "$WORK/m1"
then ok "...naming every ref it left alone, and why"
else bad "the report is silent about a refusal" "$WORK/m1"; fi

# THE WORKING FILE IS THE ONLY THING WRITTEN: nothing joined the index.
if [ -z "$(g diff --cached --name-only)" ]
then ok "...and staged NOTHING — the index is the hook's half, not the verb's"
else bad "mint staged files behind the author's back"; g diff --cached --name-only; fi

if [ "$(g status --porcelain | grep -c '^ M')" = 4 ]
then ok "...leaving doc/page.mkd, doc/x.mkd, doc/y.mkd and src/B.c modified, unstaged"
else bad "the worktree is not what mint should have left"; g status --porcelain; fi

# A file the mint was NEVER GIVEN keeps its transient ref, untouched.
if grep -qx 'other src/A.c:30 stays transient' "$REPO/doc/other.mkd"
then ok "...a file not on the list is not touched at all"
else bad "an unlisted file was rewritten" "$REPO/doc/other.mkd"; fi

# --- idempotence -----------------------------------------------------------
cp "$REPO/doc/page.mkd" "$WORK/page.m1"
rtin "$REPO" mint doc/page.mkd > "$WORK/m2" 2>"$WORK/m2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/page.m1" "$REPO/doc/page.mkd"
then ok "a second mint rewrites nothing — a minted ref is no longer transient"
else bad "mint is not idempotent (rc $RC)" "$WORK/m2" "$WORK/m2e"; fi

# --- arguments that are not files ------------------------------------------
rtin "$REPO" mint doc > "$WORK/a1" 2>"$WORK/a1e"; RC=$?
if grep -q 'doc' "$WORK/a1e" && grep -qi 'director' "$WORK/a1e"
then ok "a DIRECTORY argument is reported and skipped, never walked"
else bad "directory argument (rc $RC)" "$WORK/a1" "$WORK/a1e"; fi

rtin "$REPO" mint /etc/hosts > "$WORK/a2" 2>"$WORK/a2e"; RC=$?
if grep -qi 'outside' "$WORK/a2e"
then ok "...and a path outside the repo says so"
else bad "outside-the-repo argument (rc $RC)" "$WORK/a2" "$WORK/a2e"; fi

# --- the assertions --------------------------------------------------------
( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_BA="$B_A" \
  "$RT" --eval "require('$CASE/mint.js')" ) > "$WORK/j.out" 2>"$WORK/j.err"
RC=$?
cat "$WORK/j.out"
if [ "$RC" != 0 ]; then
    FAILED=$((FAILED + 1))
    echo "--- stderr ---"; cat "$WORK/j.err"
fi

if [ "$FAILED" = 0 ]; then
    echo "PASS [bee/mint] $CHECKS shell checks, plus mint.js"
else
    echo "FAIL [bee/mint] $FAILED bad" >&2
    exit 1
fi
