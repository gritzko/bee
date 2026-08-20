#!/bin/sh
# lite/test/land/run.sh — LITE-029: a followed ref selects the TOKEN, not just
# the line.  One leg over the REAL UI path (a tty.openpty() slave, SGR mouse
# presses and a `:` bar typed through the pager's own input, then the pushed
# view's frame bytes asserted — the token wash must sit on the target token):
#   pty.js  `:line:col`, a permalink, the wrapped line, the gap/EOL fallbacks.
#
# Standalone: `sh lite/test/land/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`; the DOG-034 lexer is what fuses
# `path:line:col` into ONE `F` token, so the click leg wants a quickjab build).
# The fixture lives in a mktemp dir under ~/tmp, removed on a green run.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/land
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "land: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "land: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "land: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "land: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-land.XXXXXX") || exit 2
FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "land: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

# The fixture: FIXED-WIDTH lines, 16 bytes each (`int FSWMARK007;\n`), so both a
# blob byte OFFSET and a line:col are arithmetic the test can state.
#   r0  40 numbered lines + ONE 260-byte line       — the permalink's anchor
#   r1  5 lines PREPENDED                           — the anchored line moves +5
# The long line is the WRAP leg: at 100 columns its `WIDE009` token (col 109)
# is off-screen no-wrap and sits on the SECOND display row once `W` wraps.
REPO="$WORK/land"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src/abc
  i=1
  : > src/abc/FSW.c
  while [ "$i" -le 40 ]; do
      printf 'int FSWMARK%03d;\n' "$i" >> src/abc/FSW.c
      i=$((i + 1))
  done
  i=1
  while [ "$i" -le 20 ]; do
      printf 'int WIDE%03d; ' "$i" >> src/abc/FSW.c
      i=$((i + 1))
  done
  printf '\n' >> src/abc/FSW.c
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 forty numbered lines and one wide one" || exit 1

  # a file whose OWN text carries a ref: landing on it must select a FOLLOWABLE
  # token, so Enter opens what the landed token names.
  printf '/* see src/abc/FSW.c:25:7 here */\n' > src/note.c
  i=1
  : > src/abc/head.tmp
  while [ "$i" -le 5 ]; do
      printf 'int TOPMARK%03d;\n' "$i" >> src/abc/head.tmp
      i=$((i + 1))
  done
  cat src/abc/FSW.c >> src/abc/head.tmp
  mv src/abc/head.tmp src/abc/FSW.c
  git add -A
  GIT_AUTHOR_DATE="2020-03-01T00:00:00Z" GIT_COMMITTER_DATE="2020-03-01T00:00:00Z" \
    git commit -q -m "r1 five lines prepended, everything moves down" || exit 1
) || { echo "land: cannot build the fixture repo" >&2; exit 2; }

R0=$(cd "$REPO" && git rev-list --max-parents=0 HEAD) || exit 2
B0=$(cd "$REPO" && git rev-parse "$R0:src/abc/FSW.c") || exit 2

echo "land: runtime $RT, repo $REPO, r0 $R0"

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb

( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_R0="$R0" LITE_B0="$B0" \
  "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"
RC=$?
cat "$WORK/p.out"
if [ "$RC" != 0 ]; then
    FAILED=1
    echo "--- stderr ---"; cat "$WORK/p.err"
    echo "FAIL [lite/land]" >&2
    exit 1
fi
echo "PASS [lite/land] runtime $RT"
