#!/bin/sh
# bee/test/actspell/run.sh — BEE-038: the MUTATION CLICK.  A button's `O` spell
# may name a WRITER verb (act.js's table) instead of a view; clicking one must
# run it and refresh the current view in place — no result page, scroll kept —
# while a view spell keeps push-nav.  Two legs, a fixture repo each (the first
# leg stages, so the second must start clean):
#   actspell.js  the table incl. the `commit`/`merge` SHAPE split, then clicks:
#                the writer lands, the refusal talks, the view spell pushes,
#                the `:` bar does what the click does
#   pty.js       over a real tty.openpty(): Enter on a button stages and the
#                screen stays the board; a click on a view spell still navs
#
# Standalone: `sh bee/test/actspell/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).  The fixture repos live in a
# mktemp dir under ~/tmp, removed on a green run (kept, path printed, on a fail).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/actspell
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "actspell: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "actspell: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "actspell: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "actspell: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-actspell.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — the staging verbs
#  write nothing there, but `index` would, and never to the user's registry.
export HOME="$FAKEHOME"
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "actspell: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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

# A repo with two committed-then-edited files: `add <one>` has something to
# stage, and no branch here tracks an upstream, so `push` refuses without a
# byte moved — the refusal leg needs exactly that.
mkrepo() {
    mkdir -p "$1" || return 1
    (
      cd "$1" || exit 1
      git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
      printf 'the file a button stages\n' > one.txt
      printf 'the file a ROW opens\n'    > two.txt
      git add -A
      GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
      GIT_AUTHOR_DATE="2020-01-01T00:00:00Z" GIT_COMMITTER_DATE="2020-01-01T00:00:00Z" \
        git commit -q -m "a0 the two files a spell can name" || exit 1
      printf 'an edit for the button to stage\n' >> one.txt
      printf 'an edit for the bar to stage\n'    >> two.txt
    ) || return 1
}
mkrepo "$WORK/head" || { echo "actspell: cannot build the fixture repo" >&2; exit 2; }
mkrepo "$WORK/pty"  || { echo "actspell: cannot build the fixture repo" >&2; exit 2; }
# QJAB-001: under --eval the jsrc pin climbs from the CWD — plant bee above it.
ln -s "$LITE" "$WORK/jsrc"

echo "actspell: runtime $RT, repos $WORK/{head,pty}"

leg() {                                          # leg <name> <js> <repo> <outfile>
    ( cd "$3" && "$RT" --eval "require('$CASE/$2')" ) > "$4" 2>"$4.err"; RC=$?
    if [ "$RC" != 0 ]; then
        echo "--- $1 stderr ---"; cat "$4.err"
        bad "$1 leg exited non-zero (rc $RC)" "$4"
    elif grep -q '^FAIL' "$4"; then
        cat "$4"; bad "$1 leg check(s) failed"
    elif ! grep -q '^DONE' "$4"; then
        cat "$4"; bad "$1 leg did not finish"
    else
        N=$(grep -c '^ok' "$4")
        CHECKS=$((CHECKS + N))
        ok "$1 leg: $N checks"
    fi
}

leg "click" actspell.js "$WORK/head" "$WORK/c.out"

if [ "$HAS" != "yes" ]; then
    echo "actspell: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    leg "pty" pty.js "$WORK/pty" "$WORK/p.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/actspell] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/actspell] $CHECKS checks, runtime $RT"
exit 0
