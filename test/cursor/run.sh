#!/bin/sh
# lite/test/cursor/run.sh — LITE-023: the pager's ACTIVE LINE + ACTIVE TOKEN.
# One leg, pty.js, over a real tty.openpty() slave: j/k move the wash, l/h hop
# the followable tokens cross-row, Enter opens what the active token names,
# a/d walk the view stack back and forward, a scroll leaves the cursor alone
# until it walks off-screen, and the displaced keys (`?` help, `W` wrap) work.
#
# Standalone: `sh lite/test/cursor/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).  Fixtures live in a mktemp dir
# under ~/tmp, removed on a green run (kept, path printed, on a failure).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/cursor
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "cursor: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "cursor: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "cursor: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-cursor.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "cursor: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do
        [ -f "$f" ] || continue
        echo "--- $f (od -c) ---"; od -c "$f" | head -60
    done
}

# --- the tty binding guard (LITE-004 ttyprobe pattern) --------------------
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.raw === "function" &&
           typeof tty.cook === "function" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function" && typeof tty.size === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$("$RT" --eval "require('$WORK/ttyprobe.js')" 2>/dev/null || echo err)

# --- fixtures: 14 entries, more than the 9-row viewport -------------------
FIX="$WORK/fix"
mkdir -p "$FIX"
i=1
while [ "$i" -le 14 ]; do
    printf 'row %02d line one\nrow %02d line two\n' "$i" "$i" > "$FIX/f$(printf '%02d' $i).txt"
    i=$((i + 1))
done
# QJAB-001: under --eval there is no main script, so the jsrc pin climbs from
# the CWD — plant lite at the fixture PARENT ($FIX itself must stay listable).
ln -s "$LITE" "$WORK/jsrc"

echo "cursor: runtime $RT, fixtures $FIX"

if [ "$HAS" != "yes" ]; then
    echo "cursor: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    ( cd "$FIX" && "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"; RC=$?
    if [ "$RC" != 0 ]; then
        echo "--- pty stderr ---"; cat "$WORK/p.err"
        bad "cursor leg exited non-zero (rc $RC)" "$WORK/p.out"
    elif grep -q '^FAIL' "$WORK/p.out"; then
        cat "$WORK/p.out"; bad "cursor leg check(s) failed"
    elif ! grep -q '^DONE' "$WORK/p.out"; then
        cat "$WORK/p.out"; bad "cursor leg did not finish"
    else
        grep -c '^ok' "$WORK/p.out" > "$WORK/n"
        CHECKS=$((CHECKS + $(cat "$WORK/n")))
        ok "cursor leg: $(cat "$WORK/n") checks (wash, token hops, Enter, a/d, clamp)"
    fi
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/cursor] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/cursor] $CHECKS checks, runtime $RT"
exit 0
