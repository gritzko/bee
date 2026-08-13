#!/bin/sh
# lite/test/click/run.sh — a log row's sha8 is a CLICK-TARGET into the commit
# view.  One leg (click.js): the log hunk's hidden `U` span, the shared
# openTarget door, and the REAL UI path — a tty.openpty() slave, an SGR mouse
# press written to the master and read back through the pager's own input path,
# then the pushed commit view asserted.
#
# Standalone: `sh lite/test/click/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`; a quickjab built with
# -DJAB_JSRC=<this tree> -DQUICKJAB_JSRC_PACK=ON passes the same).  The fixture
# lives in a mktemp dir under ~/tmp, removed on a green run.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/click
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "click: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "click: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "click: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "click: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-click.XXXXXX") || exit 2
FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "click: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

# The fixture: three commits, the last one changing a file, dropping one and
# adding one — so the clicked commit view has files of every kind under it.
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf 'one\ntwo\n' > a.txt; printf 'B\n' > b.txt
  git add -A && cm "2020-01-01T00:00:00Z" "c0 the root" || exit 1
  printf 'one\ntwo\nthree\n' > a.txt
  git add -A && cm "2020-01-02T00:00:00Z" "c1 grow a.txt" || exit 1
  printf 'one\ntwo\nthree\nfour\n' > a.txt; git rm -q b.txt; printf 'C\n' > c.txt
  git add -A && cm "2020-01-03T00:00:00Z" "c2 change a, drop b, add c" || exit 1
) || { echo "click: cannot build the fixture repo" >&2; exit 2; }

echo "click: runtime $RT, repo $REPO"

# The pty leg needs a controlling-terminal-free openpty; the suite runs INSIDE
# the repo, since the verbs climb to it from the CWD.
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb

( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" \
  "$RT" --eval "require('$CASE/click.js')" ) > "$WORK/c.out" 2>"$WORK/c.err"
RC=$?
cat "$WORK/c.out"
if [ "$RC" != 0 ]; then
    FAILED=1
    echo "--- stderr ---"; cat "$WORK/c.err"
    echo "FAIL [lite/click]" >&2
    exit 1
fi
echo "PASS [lite/click] runtime $RT"
