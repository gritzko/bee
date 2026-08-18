#!/bin/sh
# lite/test/logspine/run.sh — LITE-020: `lite log` marks the STRAIGHT CHAIN.
# The spine is the first-parent chain from the walked tip; everything merged in
# off it greys, whole row.  Three legs over two fixture repos:
#   verb   — this script: the CLI contract, git first-parent parity, and the
#            `--plain` byte pins (greying is paint, so the text never moves).
#   spine  — spine.js: the membership marking + the tok32 tags, headless.
#   pty    — pty.js: the REAL UI path, grey rows next to normal ones on a tty.
#
# Standalone: `sh lite/test/logspine/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).  Fixtures live in a mktemp dir
# under ~/tmp and are removed on a green run.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/logspine
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "logspine: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "logspine: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "logspine: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "logspine: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-logspine.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "logspine: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
rt()   { ( cd "$LITE" && HOME="$FAKEHOME" "$RT" "$@" ); }
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# --- the MERGE fixture ----------------------------------------------------
#   c0  a.txt=1                       (root)
#   c1  a.txt=2                       (master)
#   s1  s.txt=1                       (side, off c0)
#   s2  s.txt=2                       (side)
#   M   merge master + side           (first parent c1, second s2)
#   c2  a.txt=3                       (master, the tip)
# The straight chain is c2 -> M -> c1 -> c0; s2 and s1 hang off M's 2nd parent
# and are exactly what must grey.  c0 sits BELOW the merge and stays on-spine.
REPO="$WORK/merge"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf '1\n' > a.txt; git add -A && cm "2020-01-01T00:00:00Z" c0 || exit 1
  printf '2\n' > a.txt; git add -A && cm "2020-01-02T00:00:00Z" c1 || exit 1
  git checkout -q -b side HEAD~1
  printf '1\n' > s.txt; git add -A && cm "2020-01-03T00:00:00Z" s1 || exit 1
  printf '2\n' > s.txt; git add -A && cm "2020-01-04T00:00:00Z" s2 || exit 1
  git checkout -q master
  GIT_AUTHOR_DATE="2020-01-05T00:00:00Z" GIT_COMMITTER_DATE="2020-01-05T00:00:00Z" \
      git merge -q --no-ff -m merge side || exit 1
  printf '3\n' > a.txt; git add -A && cm "2020-01-06T00:00:00Z" c2 || exit 1
) || { echo "logspine: cannot build the merge fixture" >&2; exit 2; }

# --- the LINEAR fixture (no merge at all: nothing may grey) ---------------
LIN="$WORK/linear"
mkdir -p "$LIN"
(
  cd "$LIN" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf '1\n' > f.txt; git add -A && cm "2021-01-01T00:00:00Z" n0 || exit 1
  printf '2\n' > f.txt; git add -A && cm "2021-01-02T00:00:00Z" n1 || exit 1
  printf '3\n' > f.txt; git add -A && cm "2021-01-03T00:00:00Z" n2 || exit 1
) || { echo "logspine: cannot build the linear fixture" >&2; exit 2; }

g() { git -C "$REPO" "$@"; }
C2=$(g rev-parse master)
M=$(g rev-parse master~1)
C1=$(g rev-parse master~1^1)
S2=$(g rev-parse master~1^2)
S1=$(g rev-parse master~1^2^)
C0=$(g rev-parse master~1^1^)
ln -sf "$LITE" "$WORK/jsrc"
echo "logspine: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — the CLI contract and the `--plain` byte pins
# ==========================================================================
# P1: the piped dump is the whole reachable history in git's own date order —
# the LITE-007/013 contract, UNCHANGED by the marking (the spine split decides
# paint, never membership and never order).
rtin "$REPO" log > "$WORK/p1" 2>"$WORK/p1e"; RC=$?
g log --date-order --format='%H' | cut -c1-8 > "$WORK/p1g"
cut -c1-8 "$WORK/p1" > "$WORK/p1q"
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/p1") ))" = "6" ] && cmp -s "$WORK/p1g" "$WORK/p1q"
then ok "the merge log is still the 6 commits in git --date-order order"
else bad "the merge log is still git --date-order (rc $RC)" "$WORK/p1" "$WORK/p1g" "$WORK/p1e"; fi

# P2: `--plain` is byte-identical to the piped dump, on a log that HAS grey
# rows in it — the greying never reaches the text sink.
rtin "$REPO" log --plain > "$WORK/p2" 2>"$WORK/p2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/p1" "$WORK/p2"
then ok "log --plain = the piped rows byte for byte, with grey rows present"
else bad "log --plain = the piped rows (rc $RC)" "$WORK/p1" "$WORK/p2" "$WORK/p2e"; fi

# P3: the same for the `<hex>` form (a merge hex: its log carries grey rows)
# and for the `<path>` form (file revisions, which never grey at all).
rtin "$REPO" log "$M" > "$WORK/p3" 2>/dev/null
rtin "$REPO" log --plain "$M" > "$WORK/p3p" 2>"$WORK/p3e"; RC=$?
rtin "$REPO" log s.txt > "$WORK/p4" 2>/dev/null
rtin "$REPO" log --plain s.txt > "$WORK/p4p" 2>"$WORK/p4e"
if [ "$RC" = 0 ] && cmp -s "$WORK/p3" "$WORK/p3p" && cmp -s "$WORK/p4" "$WORK/p4p" &&
   [ "$(( $(wc -l < "$WORK/p3") ))" = "5" ] && [ "$(( $(wc -l < "$WORK/p4") ))" = "2" ]
then ok "log --plain = the piped rows for the <hex> and <path> forms too"
else bad "log --plain for <hex> / <path> (rc $RC)" "$WORK/p3" "$WORK/p3p" "$WORK/p4" "$WORK/p4p" "$WORK/p3e"; fi

# P4: a GREY row's plain bytes carry no marker of any kind — the four columns
# and nothing else, exactly the shape a spine row has.  s2 is row 3.
if sed -n '3p' "$WORK/p1" | grep -q "^$(echo "$S2" | cut -c1-8) [0-9][0-9][A-Z][a-z][a-z]20 s2 (T)\$" &&
   sed -n '1p' "$WORK/p1" | grep -q "^$(echo "$C2" | cut -c1-8) [0-9][0-9][A-Z][a-z][a-z]20 c2 (T)\$"
then ok "a grey row's plain bytes are the same 4 columns a spine row has"
else bad "a grey row's plain bytes carry no marker" "$WORK/p1"; fi

# P5: the LINEAR fixture — nothing to grey, and `--plain` unchanged there too.
rtin "$LIN" log > "$WORK/p5" 2>/dev/null
rtin "$LIN" log --plain > "$WORK/p5p" 2>"$WORK/p5e"; RC=$?
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/p5") ))" = "3" ] && cmp -s "$WORK/p5" "$WORK/p5p"
then ok "a linear history logs 3 rows, --plain identical"
else bad "a linear history logs 3 rows (rc $RC)" "$WORK/p5" "$WORK/p5p" "$WORK/p5e"; fi

# P6: THE SPINE IS GIT'S FIRST-PARENT LINE.  spine.js owns the marking; this
# pins the SET against `git log --first-parent`, so a wrong parent ordinal is
# caught by git itself and not only by our own expectation.
g log --first-parent --format='%H' | cut -c1-8 | sort > "$WORK/p6g"
LITE_FIX="$REPO" LITE_FIX_LIN="$LIN" \
LITE_EXP="c0=$C0 c1=$C1 s1=$S1 s2=$S2 m=$M c2=$C2" \
    rt --eval "require('$CASE/spinelist.js')" 2>"$WORK/p6e" | sort > "$WORK/p6q"
if cmp -s "$WORK/p6g" "$WORK/p6q"
then ok "the marked spine IS git log --first-parent, sha for sha"
else bad "the marked spine IS git log --first-parent" "$WORK/p6g" "$WORK/p6q" "$WORK/p6e"; fi

# ==========================================================================
# leg 2 — the marking and the tok32 tags (headless)
# ==========================================================================
LITE_FIX="$REPO" LITE_FIX_LIN="$LIN" \
LITE_EXP="c0=$C0 c1=$C1 s1=$S1 s2=$S2 m=$M c2=$C2" \
    rt --eval "require('$CASE/spine.js')" > "$WORK/s.out" 2>"$WORK/s.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/s.out" && ! grep -q '^FAIL' "$WORK/s.out"; then
    N=$(grep -c '^ok' "$WORK/s.out"); CHECKS=$((CHECKS + N))
    ok "spine leg: $N checks (membership / TAG_Q / order / cap / path / paint-only)"
else
    cat "$WORK/s.out"; head -5 "$WORK/s.err"
    bad "spine leg (rc $RC)" "$WORK/s.out"
fi

# ==========================================================================
# leg 3 — the REAL UI path: grey side rows next to normal spine rows on a pty
# ==========================================================================
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$(rt --eval "require('$WORK/ttyprobe.js')" 2>/dev/null || echo err)
if [ "$HAS" != "yes" ]; then
    echo "logspine: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    LITE_FIX="$REPO" rt --eval "require('$CASE/pty.js')" > "$WORK/t.out" 2>"$WORK/t.err"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/t.out" && ! grep -q '^FAIL' "$WORK/t.out"; then
        N=$(grep -c '^ok' "$WORK/t.out"); CHECKS=$((CHECKS + N))
        ok "pty leg: $N checks (grey Q rows beside cyan spine rows, on a real tty)"
    else
        cat "$WORK/t.out"; head -5 "$WORK/t.err"
        bad "pty leg (rc $RC)" "$WORK/t.out"
    fi
fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/logspine] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/logspine] $CHECKS checks, runtime $RT"
exit 0
