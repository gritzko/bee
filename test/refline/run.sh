#!/bin/sh
# lite/test/refline/run.sh — LITE-024: a `file.c:12:4` reference lands ON the
# line.  One leg over the REAL UI path (a tty.openpty() slave, SGR mouse presses
# and a `:` bar typed through the pager's own input path, then the pushed view's
# frame and status bar asserted):
#   pty.js  the door sheds the tail, the pager scrolls the line into view.
#
# Standalone: `sh lite/test/refline/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`; a quickjab built with
# -DJAB_JSRC=<this tree> -DQUICKJAB_JSRC_PACK=ON passes the same).  The fixture
# lives in a mktemp dir under ~/tmp, removed on a green run.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/refline
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "refline: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "refline: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "refline: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "refline: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-refline.XXXXXX") || exit 2
FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "refline: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

# The fixture: `abc/FSW.c` names ONE file, the bare `TCP.c` names TWO.  Every
# file is 40 numbered lines, so a landing on line 12 (or 5) is a real scroll.
REPO="$WORK/refs"
mkdir -p "$REPO"
numbered() {                                     # $1 = mark prefix, $2 = out file
  i=1
  : > "$2"
  while [ "$i" -le 40 ]; do
    printf 'int %s%d;\n' "$1" "$i" >> "$2"
    i=$((i + 1))
  done
}
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src/abc net
  numbered FSWMARK src/abc/FSW.c
  numbered ABCMARK src/abc/TCP.c
  numbered NETMARK net/TCP.c
  # the REAL-lexer leg: a .c comment the tokenizer itself fuses into one `F`.
  printf '/* see abc/FSW.c:12:4 here */\n' > src/see.c
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 the files a suffixed reference can name" || exit 1
) || { echo "refline: cannot build the fixture repo" >&2; exit 2; }

# LITE-024: the NO-GIT fixture — a plain dir, the ref resolves by the fs walk.
NOGIT="$WORK/plain"
mkdir -p "$NOGIT/deep"
numbered LOGMARK "$NOGIT/deep/log0.js"
printf '/* see log0.js:20 here */\n' > "$NOGIT/note.c"

echo "refline: runtime $RT, repo $REPO"

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb

( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_NOGIT="$NOGIT" \
  "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"
RC=$?
cat "$WORK/p.out"
if [ "$RC" != 0 ]; then
    FAILED=1
    echo "--- stderr ---"; cat "$WORK/p.err"
    echo "FAIL [lite/refline]" >&2
    exit 1
fi
echo "PASS [lite/refline] runtime $RT"
