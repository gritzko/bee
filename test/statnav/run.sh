#!/bin/sh
# bee/test/statnav/run.sh — BEE-046: a status row's FILE NAME is a click
# target, and what it opens is the FILE.
#
# THE GAP THIS REPROS: the rows carried `cat`/`diff` navs, but `diff` is a
# QUESTION about change — it answers NOTHING for a row whose worktree matches
# HEAD (a staged add, a locally committed file), so those clicks died, and it
# is the wrong contract for a name that must always open the file.  `dog
# <path>` (view/dog.js) is the whole worktree file with its wt-vs-HEAD spans
# under the one diff dog, falling back to the plain bytes when there is
# nothing to dog.
#
# Two legs over one fixture, one file per row class:
#   nav  — nav.js: the `U` on the NAME token (read by the pager's own
#          `_targetAt`), the verb per class, the doged whole-file target
#          (both sides of a real merge conflict included), the http twin;
#   cli  — this script: `bee dog <path>` typed, and its plain parity — no
#          SGR, the whole file, an unchanged path byte for byte.
#
# Standalone: `sh bee/test/statnav/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/statnav
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "statnav: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "statnav: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "statnav: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "statnav: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-statnav.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "statnav: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `index` writes
#  `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                # TEST-005:8 unpacked-runtime climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "statnav: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — ONE file per row class, the conflict a REAL failed merge
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  export GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000'
  printf 'c1\nc2\n'          > clean.txt        # untouched: no row at all
  printf 'm1\nm2\nm3\nm9\n'  > mod.txt          # -> `...v` unstaged edit
  printf 's1\ns2\n'          > st.txt           # -> `..v.` staged edit
  printf 'd1\nd2\n'          > del.txt          # -> `...x` deleted in the wt
  printf 'k1\nk2\nk3\n'      > con.txt          # -> the conflict, below
  git add -A && git commit -q -m 'C0 seed' || exit 1
  git checkout -q -b side
  printf 'k1\nSIDE\nk3\n' > con.txt
  git commit -q -am 'C1 side' || exit 1
  git checkout -q master
  printf 'k1\nMINE\nk3\n' > con.txt
  git commit -q -am 'C2 mine' || exit 1
  git merge -q side >/dev/null 2>&1            # CONFLICT: con.txt is `!`
  [ -f .git/MERGE_HEAD ] || exit 1
  printf 'm1\nMODIFIED\nm3\nm9\n' > mod.txt
  printf 's1\nSTAGED\n' > st.txt; git add st.txt
  rm -f del.txt
  printf 'brand new\n' > add.txt; git add add.txt   # -> `..o.` no HEAD side
  printf 'untracked\n' > new.txt                    # -> `...o`
) || { echo "statnav: cannot build the fixture repo" >&2; exit 2; }

rtin "$REPO" index . > "$WORK/ix" 2>&1 || { bad "index the fixture" "$WORK/ix"; exit 1; }

# ==========================================================================
# leg 1 — the navs, the targets and the http twin (headless, over the hunks)
# ==========================================================================
( cd "$LITE" && HOME="$FAKEHOME" BEE_FIX="$REPO" "$RT" --eval "require('$CASE/nav.js')" ) \
    > "$WORK/n.out" 2> "$WORK/n.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/n.out" && ! grep -q '^FAIL' "$WORK/n.out"; then
    N=$(grep -c '^ok' "$WORK/n.out"); CHECKS=$((CHECKS + N))
    ok "nav leg: $N checks (the name's U, the verb per class, the doged target)"
else
    cat "$WORK/n.out"; head -5 "$WORK/n.err"
    bad "nav leg (rc $RC)"
fi

# ==========================================================================
# leg 2 — the verb TYPED, and its plain parity
# ==========================================================================
rtin "$REPO" dog mod.txt --plain > "$WORK/w1" 2>"$WORK/w1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'MODIFIED' "$WORK/w1" && grep -q 'm9' "$WORK/w1" &&
   ! grep -q 'cannot open' "$WORK/w1e"
then ok "\`bee dog <path>\` is typable and shows the file's own bytes"
else bad "dog mod.txt (rc $RC)" "$WORK/w1" "$WORK/w1e"; fi

if ! grep -q "$(printf '\033')" "$WORK/w1"
then ok "...and a pipe gets no SGR at all"
else bad "the plain leg leaked escapes" "$WORK/w1"; fi

# An unchanged path has nothing to dog: the answer is the file, byte for byte.
rtin "$REPO" dog clean.txt --plain > "$WORK/w2" 2>"$WORK/w2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/w2" "$REPO/clean.txt"
then ok "an UNCHANGED path answers the file byte for byte — never an empty page"
else bad "dog clean.txt (rc $RC)" "$WORK/w2" "$WORK/w2e"; fi

# The conflict, typed: both sides and the markers are the file, so they show.
rtin "$REPO" dog con.txt --plain > "$WORK/w3" 2>"$WORK/w3e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'MINE' "$WORK/w3" && grep -q 'SIDE' "$WORK/w3" &&
   grep -q '<<<<<<<' "$WORK/w3"
then ok "a conflicted file doges with its markers and both sides visible"
else bad "dog con.txt (rc $RC)" "$WORK/w3" "$WORK/w3e"; fi

# A directory and a missing path are refused IN WORDS, never a silent empty.
rtin "$REPO" dog nosuch.txt --plain > "$WORK/w4" 2>"$WORK/w4e"; RC=$?
if [ "$RC" != 0 ] && grep -q 'dog' "$WORK/w4e"
then ok "a path that is not there is refused in plain words"
else bad "dog nosuch.txt (rc $RC)" "$WORK/w4" "$WORK/w4e"; fi

# The status view itself still writes the greppable canon — the navs are hidden.
rtin "$REPO" status --plain > "$WORK/s1" 2>"$WORK/s1e"; RC=$?
if [ "$RC" = 0 ] && ! grep -q 'dog ' "$WORK/s1" && ! grep -q 'cat ' "$WORK/s1"
then ok "the status rows keep their canon — a nav takes no column"
else bad "a nav leaked into the plain rows (rc $RC)" "$WORK/s1" "$WORK/s1e"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/statnav] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/statnav] $CHECKS checks, runtime $RT"
exit 0
