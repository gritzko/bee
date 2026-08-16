#!/bin/sh
# bee/test/see/run.sh — BEE-017: `bee see <ref>...` prints the chunk each
# reference names, two lines of context each way, one hunk per ref.
#
# `door.js` seatOf has resolved every reference shape there is since [LITE-034],
# but only a pager click and http ever reached it — from argv a permalink fell
# through to the filesystem leg and answered `cannot open`.  This leg drives the
# CLI, because the CLI is precisely what was missing.
#
# Standalone: `sh bee/test/see/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/see
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "see: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "see: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "see: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "see: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-see.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "see: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
# 40 numbered 16-byte lines (`int AAAMARK007;\n`) so the WINDOW is arithmetic
# the test states: `src/A.c:20` with two lines of context is exactly lines
# 18..22, which is `AAAMARK018` through `AAAMARK022` and nothing else.
# A ticket pocket rides along, so a CODE resolves as well as a path, and two
# files share a basename so `C.c` is the ambiguity the chooser answers.
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src net todo/TKT
  numbered() {
    i=1
    : > "$2"
    while [ "$i" -le 40 ]; do
        printf 'int %s%03d;\n' "$1" "$i" >> "$2"
        i=$((i + 1))
    done
  }
  numbered AAAMARK src/A.c
  numbered CCCMARK src/C.c
  cp src/C.c net/C.c
  numbered TKTMARK todo/TKT/TKT-001.mkd
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 the anchored files" || exit 1
) || { echo "see: cannot build the fixture repo" >&2; exit 2; }
rtin "$REPO" install > "$WORK/i1" 2>"$WORK/i1e" || true

# --- a plain line reference -----------------------------------------------
rtin "$REPO" see --plain src/A.c:20 > "$WORK/s1" 2>"$WORK/s1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(grep -c 'AAAMARK' "$WORK/s1")" = 5 ] &&
   grep -q 'AAAMARK018' "$WORK/s1" && grep -q 'AAAMARK020' "$WORK/s1" &&
   grep -q 'AAAMARK022' "$WORK/s1" && ! grep -q 'AAAMARK017' "$WORK/s1" &&
   ! grep -q 'AAAMARK023' "$WORK/s1"
then ok "a line ref prints the landed line and TWO of context each way"
else bad "see src/A.c:20 (rc $RC)" "$WORK/s1" "$WORK/s1e"; fi

# The band names the LANDING, and it is itself a reference.  seatOf spells a
# landing in the AMBIENT repo relative and one anywhere else absolute, which is
# the distinction a reader wants: a bare path means here, a full path elsewhere.
if grep -qx "hunk src/A.c:20" "$WORK/s1"
then ok "...under a band naming where it landed, clickable as a ref"
else bad "the band is not the landing" "$WORK/s1"; fi

# --- a batch: one hunk per ref, in the order given -------------------------
rtin "$REPO" see --plain src/A.c:5 src/A.c:30 > "$WORK/s2" 2>"$WORK/s2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(grep -c '^hunk ' "$WORK/s2")" = 2 ] &&
   [ "$(grep -n 'AAAMARK005' "$WORK/s2" | cut -d: -f1)" -lt \
     "$(grep -n 'AAAMARK030' "$WORK/s2" | cut -d: -f1)" ]
then ok "a BATCH of refs is a batch of hunks, in the order given"
else bad "batch (rc $RC)" "$WORK/s2" "$WORK/s2e"; fi

# --- the context width is settable ----------------------------------------
rtin "$REPO" see --plain -C0 src/A.c:20 > "$WORK/s3" 2>"$WORK/s3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(grep -c 'AAAMARK' "$WORK/s3")" = 1 ] &&
   grep -q 'AAAMARK020' "$WORK/s3"
then ok "-C0 is the landed line alone"
else bad "-C0 (rc $RC)" "$WORK/s3" "$WORK/s3e"; fi

rtin "$REPO" see --plain -C4 src/A.c:20 > "$WORK/s4" 2>"$WORK/s4e"; RC=$?
if [ "$RC" = 0 ] && [ "$(grep -c 'AAAMARK' "$WORK/s4")" = 9 ] &&
   grep -q 'AAAMARK016' "$WORK/s4" && grep -q 'AAAMARK024' "$WORK/s4"
then ok "...and -C4 is nine lines"
else bad "-C4 (rc $RC)" "$WORK/s4" "$WORK/s4e"; fi

# --- the window CLAMPS at both ends of the file ----------------------------
rtin "$REPO" see --plain src/A.c:1 src/A.c:40 > "$WORK/s5" 2>"$WORK/s5e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'AAAMARK001' "$WORK/s5" && grep -q 'AAAMARK003' "$WORK/s5" &&
   grep -q 'AAAMARK038' "$WORK/s5" && grep -q 'AAAMARK040' "$WORK/s5"
then ok "the window clamps at the first and last line, never runs off"
else bad "clamping (rc $RC)" "$WORK/s5" "$WORK/s5e"; fi

# --- a TICKET CODE is a reference like any other ---------------------------
rtin "$REPO" see --plain TKT-001:20 > "$WORK/s6" 2>"$WORK/s6e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'TKTMARK020' "$WORK/s6" &&
   [ "$(grep -c 'TKTMARK' "$WORK/s6")" = 5 ]
then ok "a TICKET CODE resolves — see adds no resolver, it asks seatOf"
else bad "ticket code (rc $RC)" "$WORK/s6" "$WORK/s6e"; fi

# --- a PERMALINK, the shape that had no CLI entry point at all -------------
# `bee mint` makes one, and `see` is what reads it back.
printf 'ref src/A.c:20 here\n' > "$REPO/doc.mkd"
mkdir -p "$REPO/x" 2>/dev/null || true
( cd "$REPO" && git add doc.mkd ) || exit 2
rtin "$REPO" mint doc.mkd > "$WORK/m1" 2>"$WORK/m1e" || true
PERMA=$(sed -n 's/^ref \(.*\) here$/\1/p' "$REPO/doc.mkd")
rtin "$REPO" see --plain "$PERMA" > "$WORK/s7" 2>"$WORK/s7e"; RC=$?
if [ "$RC" = 0 ] && [ -n "$PERMA" ] && grep -q 'AAAMARK020' "$WORK/s7" &&
   [ "$(grep -c 'AAAMARK' "$WORK/s7")" = 5 ]
then ok "a PERMALINK reads back from the CLI — the whole point ($PERMA)"
else bad "permalink (rc $RC) perma='$PERMA'" "$WORK/s7" "$WORK/s7e" "$WORK/m1"; fi

# --- ANOTHER REGISTERED REPO answers, and says so in the band --------------
# The fan-out is the door's ([BEE-003]) and `see` inherits it whole; the band
# goes ABSOLUTE, which is how a reader tells a landing next door from one here.
OTHER="$WORK/other"
mkdir -p "$OTHER"
(
  cd "$OTHER" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p todo/OTH
  i=1
  : > todo/OTH/OTH-001.mkd
  while [ "$i" -le 40 ]; do
      printf 'int OTHMARK%03d;\n' "$i" >> todo/OTH/OTH-001.mkd
      i=$((i + 1))
  done
  git add -A
  GIT_AUTHOR_DATE="2020-03-01T00:00:00Z" GIT_COMMITTER_DATE="2020-03-01T00:00:00Z" \
    git commit -q -m "o0 the other repo" || exit 1
) || { echo "see: cannot build the second repo" >&2; exit 2; }
rtin "$OTHER" install > "$WORK/i2" 2>"$WORK/i2e" || true

rtin "$REPO" see --plain OTH-001:20 > "$WORK/sx" 2>"$WORK/sxe"; RC=$?
if [ "$RC" = 0 ] && grep -q 'OTHMARK020' "$WORK/sx" &&
   [ "$(grep -c 'OTHMARK' "$WORK/sx")" = 5 ] &&
   grep -qx "hunk $OTHER/todo/OTH/OTH-001.mkd:20" "$WORK/sx"
then ok "a ref into ANOTHER registered repo answers, banded with its full path"
else bad "cross-repo (rc $RC)" "$WORK/sx" "$WORK/sxe"; fi

# --- a miss gets BEE-003's words, and never stops the batch ----------------
rtin "$REPO" see --plain no/such/file.c:3 src/A.c:20 > "$WORK/s8" 2>"$WORK/s8e"; RC=$?
if grep -q 'no registered repo holds' "$WORK/s8" && grep -q 'AAAMARK020' "$WORK/s8"
then ok "a MISS says which repos were searched, and the batch carries on"
else bad "miss (rc $RC)" "$WORK/s8" "$WORK/s8e"; fi

# --- an AMBIGUITY is the door's own chooser -------------------------------
rtin "$REPO" see --plain C.c:5 > "$WORK/s9" 2>"$WORK/s9e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'src/C.c' "$WORK/s9" && grep -q 'net/C.c' "$WORK/s9"
then ok "an AMBIGUOUS ref shows the door's chooser, both files named"
else bad "chooser (rc $RC)" "$WORK/s9" "$WORK/s9e"; fi

# --- no args --------------------------------------------------------------
rtin "$REPO" see --plain > "$WORK/s0" 2>"$WORK/s0e"; RC=$?
if [ "$RC" != 0 ] && grep -qi 'see' "$WORK/s0e"
then ok "bare \`bee see\` says what it wants"
else bad "bare see (rc $RC)" "$WORK/s0" "$WORK/s0e"; fi

# --- the assertions -------------------------------------------------------
( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" \
  "$RT" --eval "require('$CASE/see.js')" ) > "$WORK/j.out" 2>"$WORK/j.err"
RC=$?
cat "$WORK/j.out"
if [ "$RC" != 0 ]; then
    FAILED=$((FAILED + 1))
    echo "--- stderr ---"; cat "$WORK/j.err"
fi

if [ "$FAILED" = 0 ]; then
    echo "PASS [bee/see] $CHECKS shell checks, plus see.js"
else
    echo "FAIL [bee/see] $FAILED bad" >&2
    exit 1
fi
