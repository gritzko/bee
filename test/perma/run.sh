#!/bin/sh
# lite/test/perma/run.sh — LITE-025: a PERMALINK `file.c:4p:0d` follows to the
# line the named commit anchored, wherever later commits pushed it.  One leg
# over the REAL UI path (a tty.openpty() slave, SGR mouse presses and a `:` bar
# typed through the pager's own input path, then the pushed view's frame and
# status bar asserted):
#   pty.js  the door routes the permalink, the resolver walks, the pager lands.
#
# Standalone: `sh lite/test/perma/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`; the DOG-034 lexer is what fuses
# both anchor segments into ONE `F` token, so the click leg wants a quickjab
# build).  The fixture lives in a mktemp dir under ~/tmp, removed on a green run.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/perma
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "perma: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "perma: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "perma: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "perma: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-perma.XXXXXX") || exit 2
FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "perma: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

# The fixture: FIXED-WIDTH lines, 16 bytes each (`int FSWMARK007;\n`), so a blob
# BYTE OFFSET is arithmetic the test can state without minting anything.
#   r0  40 original lines                      — the commit a permalink names
#   r1  5 lines PREPENDED                      — every anchored line moves +5
#   r2  original line 7 DELETED                — the tombed leg
#   r3/r4  src/abc/TCP.c leaves its r0 blob and reverts to it — earliest match
#   wt  net/TCP.c edited, NOT committed        — the worktree-blob tier
REPO="$WORK/perma"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src/abc net
  numbered() {                                   # $1 = mark prefix, $2 = out file
    i=1
    : > "$2"
    while [ "$i" -le 40 ]; do
        printf 'int %s%03d;\n' "$1" "$i" >> "$2"
        i=$((i + 1))
    done
  }
  numbered FSWMARK src/abc/FSW.c
  #  the bare `TCP.c` names TWO files, byte-identical here — ONE blob id, so a
  #  blob-form anchor answers for both and the chooser stands.
  numbered TCPMARK src/abc/TCP.c
  cp src/abc/TCP.c net/TCP.c
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 forty anchored lines" || exit 1

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

  grep -v 'FSWMARK007' src/abc/FSW.c > src/abc/head.tmp
  mv src/abc/head.tmp src/abc/FSW.c
  git add -A
  GIT_AUTHOR_DATE="2020-04-01T00:00:00Z" GIT_COMMITTER_DATE="2020-04-01T00:00:00Z" \
    git commit -q -m "r2 the seventh anchored line is gone" || exit 1

  #  r3/r4 make src/abc/TCP.c leave its r0 blob and COME BACK to it, so that one
  #  blob id answers at two points of the path's history — earliest must win.
  printf 'int EDITMARK01;\n' > src/abc/head.tmp
  cat src/abc/TCP.c >> src/abc/head.tmp
  mv src/abc/head.tmp src/abc/TCP.c
  git add -A
  GIT_AUTHOR_DATE="2020-05-01T00:00:00Z" GIT_COMMITTER_DATE="2020-05-01T00:00:00Z" \
    git commit -q -m "r3 TCP.c leaves its first version" || exit 1

  numbered TCPMARK src/abc/TCP.c
  git add -A
  GIT_AUTHOR_DATE="2020-06-01T00:00:00Z" GIT_COMMITTER_DATE="2020-06-01T00:00:00Z" \
    git commit -q -m "r4 TCP.c is reverted to its first version" || exit 1

  #  UNCOMMITTED: net/TCP.c gains three lines nothing has ever recorded, so its
  #  working blob id exists in no commit — the worktree tier of the switch.
  i=1
  : > net/head.tmp
  while [ "$i" -le 3 ]; do
      printf 'int WRKMARK%03d;\n' "$i" >> net/head.tmp
      i=$((i + 1))
  done
  cat net/TCP.c >> net/head.tmp
  mv net/head.tmp net/TCP.c
) || { echo "perma: cannot build the fixture repo" >&2; exit 2; }

R0=$(cd "$REPO" && git rev-list --max-parents=0 HEAD) || exit 2
R2=$(cd "$REPO" && git rev-list --max-count=1 --skip=2 HEAD) || exit 2
R1=$(cd "$REPO" && git rev-list --max-count=1 --skip=3 HEAD) || exit 2
#  the BLOB ids the blob-form anchors name: r0's FSW.c, and the worktree-only
#  net/TCP.c that no commit carries.
B0=$(cd "$REPO" && git rev-parse "$R0:src/abc/FSW.c") || exit 2
BT=$(cd "$REPO" && git rev-parse "$R0:src/abc/TCP.c") || exit 2
BW=$(cd "$REPO" && git hash-object net/TCP.c) || exit 2

echo "perma: runtime $RT, repo $REPO, r0 $R0"

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb

( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" \
  LITE_R0="$R0" LITE_R1="$R1" LITE_R2="$R2" LITE_B0="$B0" LITE_BT="$BT" LITE_BW="$BW" \
  "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"
RC=$?
cat "$WORK/p.out"
if [ "$RC" != 0 ]; then
    FAILED=1
    echo "--- stderr ---"; cat "$WORK/p.err"
    echo "FAIL [lite/perma]" >&2
    exit 1
fi
echo "PASS [lite/perma] runtime $RT"
