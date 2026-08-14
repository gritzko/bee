#!/bin/sh
# lite/test/now/run.sh — LITE-019: `lite now`, the ron60 clock verb.  Two legs
# of one verb, both CLI-only (no pager view, nothing in the VERBS door):
#
#   `lite now`          the CURRENT stamp as RON64 text, ALL ten digits — no
#                       DeNorm strip, the tail two digits ARE the ms
#   `lite now <word>`   that word (1..10 RON64 chars, a short one LEFT-aligned)
#                       as `20YY-MM-DDThh:mm:ss.mmm`
#
# This file is the CLI leg — the bytes on stdout, the exit code, the refusal in
# plain words on stderr.  now.js is the converter leg, over the hand-computed
# fixtures.  No repository is needed: the verb reads the clock, not a tree.
#
# Standalone: `sh lite/test/now/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/now
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "now: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "now: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "now: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-now.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "now: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
lite() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" now "$@" ); }
echo "now: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — `lite now`: ten RON64 digits, one line, and it is TODAY
# ==========================================================================
lite > "$WORK/n.out" 2>"$WORK/n.err"; RC=$?
W=$(cat "$WORK/n.out")
if [ "$RC" = 0 ] && [ "$(wc -l < "$WORK/n.out")" = 1 ]
then ok "bare \`now\` prints ONE line, rc 0"
else bad "bare now (rc $RC)" "$WORK/n.out" "$WORK/n.err"; fi
# All TEN digits: a DeNorm strip would eat the (usually zero-ish) ms tail.
if printf '%s' "$W" | grep -qE '^[0-9A-Z_a-z~]{10}$'
then ok "it is ten RON64 digits, no DeNorm strip: $W"
else bad "not ten RON64 digits: '$W'" ; fi
# The stamp is the CLOCK's: yy + the month DIGIT + dd, straight off `date`,
# so this leg never asks the code under test what today is.
RON64='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~'
MON=$(date +%m); MON=${MON#0}
MD=$(printf '%s' "$RON64" | cut -c$((MON + 1)))
PFX="$(date +%y)$MD$(date +%d)"
case "$W" in
    "$PFX"*) ok "its first five digits are today: $PFX" ;;
    *)       bad "stamp '$W' does not start with today's '$PFX'" ;;
esac
# The roundtrip, through ron itself (decode -> encode -> the same ten digits).
RT_OUT=$( cd "$WORK" && "$RT" --eval \
  "io.log(ron.encode(ron.decode('$W')).padStart(10,'0')+'\n')" 2>&1 )
if [ "$RT_OUT" = "$W" ]
then ok "it survives a decode -> encode roundtrip"
else bad "roundtrip: got '$RT_OUT' want '$W'"; fi

# ==========================================================================
# leg 2 — `lite now <word>`: the fixed fixtures, hand-computed from the layout
# [y/10][y%10][mon][dd/10][dd%10][hh][mm][ss][ms/64][ms%64] (A=10, N=23, Q=26,
# a=37, w=59, ~=63), and the SHORT word left-aligned onto the same date.
# ==========================================================================
conv() {   # conv <word> <want-iso>
    lite "$1" > "$WORK/c.out" 2>"$WORK/c.err"; _rc=$?
    _got=$(cat "$WORK/c.out")
    if [ "$_rc" = 0 ] && [ "$_got" = "$2" ] && [ "$(wc -l < "$WORK/c.out")" = 1 ]
    then ok "$1 -> $2"
    else bad "$1 -> '$_got' want '$2' (rc $_rc)" "$WORK/c.err"; fi
}
conv 26814AoQDh 2026-08-14T10:51:26.876
conv 10C31Nww~~ 2010-12-31T23:59:59.999
conv 2681200000 2026-08-12T00:00:00.000
conv 26812       2026-08-12T00:00:00.000    # the SHORT word, left-aligned
conv 26814Ao     2026-08-14T10:51:00.000    # a DENORMALIZED stamp reads whole
conv 26812000F~  2026-08-12T00:00:00.999    # 1023 ms: valid, clamped on display
# `--plain` is a no-op here — the output is already plain.
lite --plain 26812 > "$WORK/p.out" 2>&1
if [ "$(cat "$WORK/p.out")" = "2026-08-12T00:00:00.000" ]
then ok "--plain is a no-op"
else bad "--plain changed the output" "$WORK/p.out"; fi

# ==========================================================================
# leg 3 — the refusals: plain words on stderr, nothing on stdout, non-zero rc
# ==========================================================================
refuse() {   # refuse <label> <word>
    lite "$2" > "$WORK/r.out" 2>"$WORK/r.err"; _rc=$?
    if [ "$_rc" != 0 ] && [ ! -s "$WORK/r.out" ] &&
       grep -q "not a ron60 timestamp" "$WORK/r.err"
    then ok "refused in plain words: $1"
    else bad "$1 (rc $_rc)" "$WORK/r.out" "$WORK/r.err"; fi
}
refuse "a non-RON64 char"     "26-12"
refuse "an eleven-digit word" "26814AoQDh0"
refuse "month 13"             "26D1400000"
refuse "hour 24"              "26814O0000"
refuse "a word that is a word" "hello"

# ==========================================================================
# leg 4 — the converter itself (now.js), headless over main.js's exports
# ==========================================================================
( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$CASE/now.js')" ) \
  > "$WORK/j.out" 2>"$WORK/j.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/j.out" && ! grep -q '^FAIL' "$WORK/j.out"; then
    N=$(grep -c '^ok' "$WORK/j.out"); CHECKS=$((CHECKS + N))
    ok "converter leg: $N checks (the layout, the short word, ms clamp, refusals)"
else
    cat "$WORK/j.out"; head -5 "$WORK/j.err"
    bad "converter leg (rc $RC)" "$WORK/j.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/now] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/now] $CHECKS checks, runtime $RT"
exit 0
