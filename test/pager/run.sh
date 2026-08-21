#!/bin/sh
# lite/test/pager/run.sh — LITE-004: the beagle-lite file-pager test suite.
# Three legs over the LANDED lite tree (render/*, pager.js, door.js):
#   plain  — this script: `<rt> --plain <path>` byte checks + the exit discipline
#            (banner + verbatim bytes, trailing NL iff missing, dir listing,
#            miss → stderr + non-zero, no args → usage, mixed batch → exit 0).
#   color  — color.js: buildFileHunk toks on .js/.c, a painted row carries SGR
#            and closes with ESC[0m, a .txt yields no toks and no paint.
#   pty    — pty.js: the REAL UI path over a tty.openpty() slave — frame 0 (body,
#            banner band, inverse status bar), j/G/g scroll, a dir view + Enter
#            follow, `-` back, `q` quit, and run()'s raw/ALT/finally lifecycle.
#
# Standalone: `sh lite/test/pager/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`; quickjab/build-lite/bin/quickjab
# passes the same).  Fixtures live in a mktemp dir under ~/tmp and are removed
# on a green run (kept, with the path printed, when something fails).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/pager
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

# --- the runtime ----------------------------------------------------------
RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "pager: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;  # legs cd around
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "pager: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

# --- scratch --------------------------------------------------------------
TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "pager: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-pager.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "pager: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
# bad DESC [FILE...] — a FAIL line plus every named file dumped ESCAPED (od -c),
# so a frame's control bytes are readable in the log.
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do
        [ -f "$f" ] || continue
        echo "--- $f (od -c) ---"; od -c "$f" | head -60
    done
}

# --- the tty binding guard (be/test/bro/pager/run.sh ttyprobe pattern) -----
# QJAB-001: a PACKED runtime RENDERS a .js argv — every JS leg goes through the
# sanctioned script door instead: `--eval "require('<abs>')"` (jab has it too).
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.raw === "function" &&
           typeof tty.cook === "function" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function" && typeof tty.size === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$("$RT" --eval "require('$WORK/ttyprobe.js')" 2>/dev/null || echo err)

# --- fixtures -------------------------------------------------------------
FIX="$WORK/fix"
mkdir -p "$FIX/sub"
printf 'AAAA\nBBBB\nCCCC\nDDDD\nEEEE\nFFFF\nGGGG\nHHHH\nIIII\nJJJJ\n' > "$FIX/doc.txt"
printf 'plain prose, no lexer for this extension\nsecond line\n'       > "$FIX/note.txt"
printf 'no newline at end'                                             > "$FIX/nonl.txt"
: > "$FIX/empty.txt"
printf '//  a comment line\nfunction f(a) { return a + 1; }\n'         > "$FIX/code.js"
printf '/*  a comment */\nint main(void) { return 0; }\n'              > "$FIX/code.c"
printf 'no extension, so no lexer at all\n'                            > "$FIX/plainfile"
printf 'deep\n'                                                        > "$FIX/sub/deep.txt"
# a line WIDER than the 40-col pty: no-wrap hides TAIL, `w` brings it back.
printf 'HEAD%s TAIL\nSHORT\n' "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" > "$FIX/sub/long.txt"
# QJAB-001: under --eval there is no main script, so the jsrc pin climbs from
# the CWD — plant lite at the fixture PARENT ($FIX itself must stay listable).
ln -s "$LITE" "$WORK/jsrc"

echo "pager: runtime $RT, fixtures $FIX"

# ==========================================================================
# leg 1 — the PLAIN dump (cwd must be lite/: the runtime resolves main.js by
# scanning up from the CWD, so a fixture-dir cwd would find $HOME/jsrc instead).
# Every path arg is therefore ABSOLUTE.
# ==========================================================================
rt_plain() { ( cd "$LITE" && "$RT" "$@" ); }

# LITE-018: bare (no path arg) INSIDE a git repo is `index` + `list`, so the
# usage throw is an OUTSIDE-a-repo story — P8 runs from a non-repo dir, the way
# test/first does, with the jsrc symlink the runtime resolves through.
NOWHERE="$WORK/nowhere"; mkdir -p "$NOWHERE"
if ( cd "$NOWHERE" && git rev-parse --show-toplevel ) >/dev/null 2>&1
then NOREPO=0; echo "pager: $NOWHERE is inside a git repo — P8 skips" >&2
else NOREPO=1; fi

# P1: a plain file — `§ <path>\n` then the bytes verbatim.
{ printf '§ %s\n' "$FIX/doc.txt"; cat "$FIX/doc.txt"; } > "$WORK/want"
rt_plain --plain "$FIX/doc.txt" > "$WORK/got" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/want" "$WORK/got"
then ok "plain file = banner + bytes"
else bad "plain file = banner + bytes (rc $RC)" "$WORK/want" "$WORK/got" "$WORK/err"; fi

# P2: a file with NO trailing newline — plainHunk appends exactly one.
{ printf '§ %s\n' "$FIX/nonl.txt"; cat "$FIX/nonl.txt"; printf '\n'; } > "$WORK/want"
rt_plain --plain "$FIX/nonl.txt" > "$WORK/got" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/want" "$WORK/got"
then ok "plain no-trailing-NL file gets one NL"
else bad "plain no-trailing-NL file gets one NL (rc $RC)" "$WORK/want" "$WORK/got" "$WORK/err"; fi

# P3: an EMPTY file — the banner alone, exit 0 (plainHunk returns the head only).
printf '§ %s\n' "$FIX/empty.txt" > "$WORK/want"
rt_plain --plain "$FIX/empty.txt" > "$WORK/got" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/want" "$WORK/got"
then ok "plain empty file = banner only, exit 0"
else bad "plain empty file = banner only, exit 0 (rc $RC)" "$WORK/want" "$WORK/got" "$WORK/err"; fi

# P4: two args — both hunks, IN ARG ORDER, one stream.
{ printf '§ %s\n' "$FIX/doc.txt"; cat "$FIX/doc.txt";
  printf '§ %s\n' "$FIX/note.txt"; cat "$FIX/note.txt"; } > "$WORK/want"
rt_plain --plain "$FIX/doc.txt" "$FIX/note.txt" > "$WORK/got" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/want" "$WORK/got"
then ok "plain two args concatenate in arg order"
else bad "plain two args concatenate in arg order (rc $RC)" "$WORK/want" "$WORK/got" "$WORK/err"; fi

# P5: a DIR arg lists its entries (readdir order is filesystem-dependent — sort
# the entry run before comparing; dirs keep their trailing '/').
printf 'code.c\ncode.js\ndoc.txt\nempty.txt\nnonl.txt\nnote.txt\nplainfile\nsub/\n' > "$WORK/want"
rt_plain --plain "$FIX" > "$WORK/raw" 2>"$WORK/err"; RC=$?
head -1 "$WORK/raw" > "$WORK/head"
tail -n +2 "$WORK/raw" | LC_ALL=C sort > "$WORK/got"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/head")" = "§ $FIX" ] && cmp -s "$WORK/want" "$WORK/got"
then ok "plain dir arg lists the entries"
else bad "plain dir arg lists the entries (rc $RC)" "$WORK/want" "$WORK/raw" "$WORK/err"; fi

# P6: a TRAILING SLASH is kept in the banner (the uri is the arg verbatim; only
# the fs ops see bro.fsPath).
rt_plain --plain "$FIX/" > "$WORK/raw" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && [ "$(head -1 "$WORK/raw")" = "§ $FIX/" ]
then ok "plain dir arg keeps its trailing slash in the banner"
else bad "plain dir arg keeps its trailing slash in the banner (rc $RC)" "$WORK/raw" "$WORK/err"; fi

# P7: a MISS — the plain-words stderr line, NOTHING on stdout, non-zero exit.
rt_plain --plain "$FIX/nosuch.txt" > "$WORK/got" 2>"$WORK/err"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/got" ] && grep -q "^cannot open $FIX/nosuch.txt\$" "$WORK/err"
then ok "plain miss = stderr line + empty stdout + non-zero"
else bad "plain miss = stderr line + empty stdout + non-zero (rc $RC)" "$WORK/got" "$WORK/err"; fi

# P8: NO args OUTSIDE a repo — the usage line on stderr, non-zero exit.
if [ "$NOREPO" = 1 ]; then
( cd "$NOWHERE" && "$RT" --plain ) > "$WORK/got" 2>"$WORK/err"; RC=$?
if [ "$RC" != 0 ] && grep -q '^Usage: bee \[--plain|--color|--html\] <path>\.\.\.$' "$WORK/err"
then ok "plain no args = usage on stderr + non-zero"
else bad "plain no args = usage on stderr + non-zero (rc $RC)" "$WORK/got" "$WORK/err"; fi
fi

# P9: a MIXED batch — the miss is reported, what opened is dumped, exit 0.
{ printf '§ %s\n' "$FIX/doc.txt"; cat "$FIX/doc.txt"; } > "$WORK/want"
rt_plain --plain "$FIX/nosuch.txt" "$FIX/doc.txt" > "$WORK/got" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/want" "$WORK/got" &&
   grep -q "^cannot open $FIX/nosuch.txt\$" "$WORK/err"
then ok "plain mixed batch dumps the hit, reports the miss, exits 0"
else bad "plain mixed batch dumps the hit, reports the miss, exits 0 (rc $RC)" "$WORK/want" "$WORK/got" "$WORK/err"; fi

# P10: PIPED without --plain is the same dump (isatty(1) is false).  The first
# arg must NOT be a .js file — both runtimes take an existing .js first word as
# THE SCRIPT (LITE-003 Blockers), which would run main.js with no args instead.
rt_plain "$FIX/doc.txt" > "$WORK/got2" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/got" "$WORK/got2"
then ok "piped without --plain dumps plain too"
else bad "piped without --plain dumps plain too (rc $RC)" "$WORK/got" "$WORK/got2" "$WORK/err"; fi

# ==========================================================================
# leg 2 — the COLOUR pieces (toks + SGR).  cwd = the fixture dir so the hunk
# uris stay short; requires resolve via the $WORK/jsrc -> lite plant (QJAB-001:
# the --eval door pins from the cwd climb, and packed bundles win anyway).
# ==========================================================================
( cd "$FIX" && "$RT" --eval "require('$CASE/color.js')" ) > "$WORK/c.out" 2>"$WORK/c.err"; RC=$?
if [ "$RC" != 0 ]; then
    echo "--- color stderr ---"; cat "$WORK/c.err"
    bad "colour leg exited non-zero (rc $RC)" "$WORK/c.out"
elif grep -q '^FAIL' "$WORK/c.out"; then
    cat "$WORK/c.out"; bad "colour leg check(s) failed"
elif ! grep -q '^DONE' "$WORK/c.out"; then
    cat "$WORK/c.out"; bad "colour leg did not finish"
else
    grep -c '^ok' "$WORK/c.out" > "$WORK/n"
    CHECKS=$((CHECKS + $(cat "$WORK/n")))
    ok "colour leg: $(cat "$WORK/n") checks (toks + SGR)"
fi

# ==========================================================================
# leg 3 — the INTERACTIVE pty cycle over the real Pager.  Skip-guarded on the
# tty binding (the pager is blocked without it).
# ==========================================================================
if [ "$HAS" != "yes" ]; then
    echo "pager: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    ( cd "$FIX" && "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"; RC=$?
    if [ "$RC" != 0 ]; then
        echo "--- pty stderr ---"; cat "$WORK/p.err"
        bad "pty leg exited non-zero (rc $RC)" "$WORK/p.out"
    elif grep -q '^FAIL' "$WORK/p.out"; then
        cat "$WORK/p.out"; bad "pty leg check(s) failed"
    elif ! grep -q '^DONE' "$WORK/p.out"; then
        cat "$WORK/p.out"; bad "pty leg did not finish"
    else
        grep -c '^ok' "$WORK/p.out" > "$WORK/n"
        CHECKS=$((CHECKS + $(cat "$WORK/n")))
        ok "pty leg: $(cat "$WORK/n") checks (frame0/scroll/follow/back/quit/run)"
    fi
    grep '^skip' "$WORK/p.out" 2>/dev/null
fi
grep '^skip' "$WORK/c.out" 2>/dev/null

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/pager] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/pager] $CHECKS checks, runtime $RT"
exit 0
