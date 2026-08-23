#!/bin/sh
# bee/test/submount/run.sh — CODE-044: the fan-out's submodule map follows the
# repo.  One leg:
#   leg 1  live.js — with a live watcher, a submodule added under a resident
#          process is in `mounts()` without a restart and a removed one is gone;
#          with no watcher the run memoizes for its lifetime, exactly as before
#
# THE GAP THIS REPROS: index/mount.js `SUBS` was a process-lifetime memo with no
# witness, while every neighbouring cache (TIPS, LANES) keys on the BEE-048 fsw
# rev — so a submodule registered after the first `mounts()` stayed invisible to
# a running `bee http` or pager until it was restarted.
#
# Standalone: `sh bee/test/submount/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/submount
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "submount: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 ||
             { echo "submount: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 ||
    { echo "submount: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "submount: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-submount.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — nothing here ever
#  writes the user's own `~/.config/bee/repos`.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "submount: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FH="$WORK/home"; mkdir -p "$FH/.config/bee"
REG="$FH/.config/bee/repos"
SRC="$WORK/src"; mkdir -p "$SRC"
echo "submount: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — one REGISTERED repo and one unregistered repo beside it, the
# submodule-to-be.  live.js mounts the second under the first while it runs.
# ==========================================================================
mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T &&
      printf 'x\n' > x.txt && git add -A &&
      GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
        git commit -q -m seed ) || exit 2
}
mkrepo "$SRC/parent"; mkrepo "$SRC/kid"
printf '%s\n' "$SRC/parent" > "$REG"

( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" \
    GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    "$RT" --eval "require('$CASE/live.js')" ) > "$WORK/r.out" 2> "$WORK/r.err"
RC=$?
sed 's/^/     /' "$WORK/r.out"
if [ "$RC" = 0 ] && grep -q '^PASS ' "$WORK/r.out"
then ok "live.js: the mount map follows the repo under a live watcher"
else bad "live.js: the mount map follows the repo under a live watcher" "$WORK/r.err"; fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/submount] $CHECKS shell checks, plus live.js"; exit 0
else echo "FAIL [bee/submount] $FAILED of $CHECKS shell checks"; exit 1; fi
