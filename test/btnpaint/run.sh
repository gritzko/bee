#!/bin/sh
# bee/test/btnpaint/run.sh — BEE-035: the button LOOK layer.  A button is 2 cells
# of its tone over a VERY PALE wash of that same tone — never an inversion — and
# BOTH colours ride the face's own hidden `O` (BEE-034's channel), so a button
# needs no tok tag of its own.  This suite pins the look end to end on a
# hand-built row (no view emits a button yet — BEE-041..044):
#   btnpaint.js  the theme tables + the ONE pale() derivation, the golden SGR of
#                a lit / info / disabled / blank face, the html class twin, and
#                that plain and a pipe stay free of SGR and `O` bytes
#
# Standalone: `sh bee/test/btnpaint/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/btnpaint
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "btnpaint: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "btnpaint: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "btnpaint: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-btnpaint.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — never the user's own
#  registry, even though this suite only renders.
export HOME="$FAKEHOME"
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "btnpaint: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do
        [ -f "$f" ] || continue
        echo "--- $f ---"; head -60 "$f"
    done
}

# QJAB-001: under --eval the jsrc pin climbs from the CWD — run from bee/ itself.
echo "btnpaint: runtime $RT"

leg() {                                          # leg <name> <js> <outfile>
    ( cd "$LITE" && "$RT" --eval "require('$CASE/$2')" ) > "$3" 2>"$3.err"; RC=$?
    if [ "$RC" != 0 ]; then
        echo "--- $1 stderr ---"; cat "$3.err"
        bad "$1 leg exited non-zero (rc $RC)" "$3"
    elif grep -q '^FAIL' "$3"; then
        cat "$3"; bad "$1 leg check(s) failed"
    elif ! grep -q '^DONE' "$3"; then
        cat "$3"; bad "$1 leg did not finish"
    else
        N=$(grep -c '^ok' "$3")
        CHECKS=$((CHECKS + N))
        ok "$1 leg: $N checks"
    fi
}

leg "paint" btnpaint.js "$WORK/b.out"

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/btnpaint] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/btnpaint] $CHECKS checks, runtime $RT"
exit 0
