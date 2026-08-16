#!/bin/sh
# lite/test/click/run.sh — what a CLICK opens.  Two legs, both over the REAL UI
# path (a tty.openpty() slave, an SGR mouse press written to the master and read
# back through the pager's own input path, then the pushed view asserted):
#   click.js  a log row's sha8 -> the commit view (its hidden `U` span)
#   refs.js   LITE-015: a file REFERENCE in a viewed file -> the file it names,
#             through the FSEG descent — unique hit, ambiguous chooser, miss.
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

# --- LITE-015: the file-reference fixture ---------------------------------
# `abc/FSW.c` names ONE file, the bare `TCP.c` names TWO, `nosuch/gone.c` none;
# UNCOMMITTED.c sits in the worktree only, so it must not resolve.
REFREPO="$WORK/refs"
mkdir -p "$REFREPO"
(
  cd "$REFREPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src/abc net
  printf 'int FSWMARK;\n' > src/abc/FSW.c
  printf 'int ABCMARK;\n' > src/abc/TCP.c
  printf 'int NETMARK;\n' > net/TCP.c
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 the files a reference can name" || exit 1
  printf 'int NEWMARK;\n' > src/abc/UNCOMMITTED.c
) || { echo "refs: cannot build the fixture repo" >&2; exit 2; }

( cd "$REFREPO" && HOME="$FAKEHOME" LITE_FIX3="$REFREPO" \
  "$RT" --eval "require('$CASE/refs.js')" ) > "$WORK/r.out" 2>"$WORK/r.err"
RC=$?
cat "$WORK/r.out"
if [ "$RC" != 0 ]; then
    FAILED=1
    echo "--- stderr ---"; cat "$WORK/r.err"
    echo "FAIL [lite/refs]" >&2
    exit 1
fi
echo "PASS [lite/refs] runtime $RT"

# --- BEE-008: the ticket-code fixture -------------------------------------
# One repo laid out the [/meta/todo] way, carrying every spelling a ticket
# takes plus the shapes that must NOT resolve: a thin `.mkd` `.md` `.txt`, a
# bare code file, a fat `TKT-005/README.mkd`, two spellings of ONE code (the
# preference order) and two files of the SAME spelling (the chooser).
TKTREPO="$WORK/tickets"
mkdir -p "$TKTREPO"
(
  cd "$TKTREPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p todo/TKT/TKT-005 todo/TKT/TKT-009 todo/OTH
  printf '#   TKT-001: the thin one\n\nl2\nl3\nl4\nl5 THINMARK\n' > todo/TKT/TKT-001.mkd
  printf '#   TKT-002: the .md one\n'                             > todo/TKT/TKT-002.md
  printf 'TKT-003: the .txt one\n'                                > todo/TKT/TKT-003.txt
  printf 'TKT-004: no extension at all\n'                         > todo/TKT/TKT-004
  printf 'TKT-004: the .mkd the bare file must beat\n'            > todo/TKT/TKT-004.mkd
  printf '#   TKT-005: the fat one\n\nFATMARK\n'                  > todo/TKT/TKT-005/README.mkd
  printf 'an attached page\n'                                     > todo/TKT/TKT-005/notes.mkd
  printf '#   TKT-006: the .mkd that wins\n'                      > todo/TKT/TKT-006.mkd
  printf '#   TKT-006: the .md that loses\n'                      > todo/TKT/TKT-006.md
  printf '#   TKT-007: one of two\n'                              > todo/TKT/TKT-007.mkd
  printf '#   TKT-007: the other\n'                               > todo/OTH/TKT-007.mkd
  printf '#   TKT-009: a README.md ticket\n'                      > todo/TKT/TKT-009/README.md
  # BEE-013: the POCKET-PAGE fixture — a wiki laid out the [/meta/wiki] way,
  # so a `/wiki/Page` ref has every spelling to choose between.  `docs/wiki/`
  # is the one that pins SEGMENTS, not a root: it answers `/wiki/Deep` while
  # sitting nowhere near the repo root.
  mkdir -p wiki/Fat meta docs/wiki
  printf '#   Bro\n\nthe pager page BROMARK\n'                    > wiki/Bro.mkd
  printf '#   Nav\n'                                              > wiki/Nav.md
  printf '#   Fat\n\nthe dir-shaped page\n'                       > wiki/Fat/README.mkd
  printf '#   Both: the .mkd that wins\n'                         > wiki/Both.mkd
  printf '#   Both: the .md that loses\n'                         > wiki/Both.md
  printf 'the tickets page\n'                                     > meta/todo.mkd
  printf '#   Deep: not at the root at all\n'                     > docs/wiki/Deep.mkd
  git add -A
  GIT_AUTHOR_DATE="2020-03-01T00:00:00Z" GIT_COMMITTER_DATE="2020-03-01T00:00:00Z" \
    git commit -q -m "t0 every spelling a ticket takes" || exit 1
) || { echo "ticket: cannot build the fixture repo" >&2; exit 2; }

( cd "$TKTREPO" && HOME="$FAKEHOME" \
  "$RT" --eval "require('$CASE/ticket.js')" ) > "$WORK/t.out" 2>"$WORK/t.err"
RC=$?
cat "$WORK/t.out"
if [ "$RC" != 0 ]; then
    FAILED=1
    echo "--- stderr ---"; cat "$WORK/t.err"
    echo "FAIL [bee/ticket]" >&2
    exit 1
fi
echo "PASS [bee/ticket] runtime $RT"

# --- BEE-013: the pocket-page leg, over the SAME fixture repo --------------
( cd "$TKTREPO" && HOME="$FAKEHOME" \
  "$RT" --eval "require('$CASE/page.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"
RC=$?
cat "$WORK/p.out"
if [ "$RC" != 0 ]; then
    FAILED=1
    echo "--- stderr ---"; cat "$WORK/p.err"
    echo "FAIL [bee/page]" >&2
    exit 1
fi
echo "PASS [bee/page] runtime $RT"
