#!/bin/sh
# bee/test/ospell/run.sh — BEE-034: the `O` CLICK CHANNEL.  A button is a visible
# face plus a hidden `O` token spelling `#<bg><fg> <verb args>`; this suite pins
# the channel end to end, on a hand-built fixture hunk (no view emits one yet):
#   ospell.js  the prefix shed, `_spellAt` beside `_targetAt`, the plain bytes
#              free of `O`, and html.js turning the face into the action
#   pty.js     over a real tty.openpty(): `l` hops a button, Enter and a click
#              run its spell, a look-only button falls through to the row
#
# Standalone: `sh bee/test/ospell/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).  The fixture repo lives in a
# mktemp dir under ~/tmp, removed on a green run (kept, path printed, on a fail).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/ospell
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "ospell: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "ospell: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "ospell: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "ospell: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-ospell.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "ospell: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do
        [ -f "$f" ] || continue
        echo "--- $f ---"; head -60 "$f"
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

# The two files the fixture's spells name — the spells are VERB LINES (`cat x`),
# so they need a repo the verbs can climb to.
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'the file a button opens\n' > one.txt
  printf 'the file a ROW opens\n'    > two.txt
  git add -A
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  GIT_AUTHOR_DATE="2020-01-01T00:00:00Z" GIT_COMMITTER_DATE="2020-01-01T00:00:00Z" \
    git commit -q -m "o0 the two files a spell can name" || exit 1
) || { echo "ospell: cannot build the fixture repo" >&2; exit 2; }
# QJAB-001: under --eval the jsrc pin climbs from the CWD — plant bee above it.
ln -s "$LITE" "$WORK/jsrc"

echo "ospell: runtime $RT, repo $REPO"

leg() {                                          # leg <name> <js> <outfile>
    ( cd "$REPO" && "$RT" --eval "require('$CASE/$2')" ) > "$3" 2>"$3.err"; RC=$?
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

leg "spell" ospell.js "$WORK/s.out"

if [ "$HAS" != "yes" ]; then
    echo "ospell: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    leg "pty" pty.js "$WORK/p.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/ospell] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/ospell] $CHECKS checks, runtime $RT"
exit 0
