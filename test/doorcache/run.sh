#!/bin/sh
# bee/test/doorcache/run.sh — BEE-048: the door caches FULLY, per repo, and fsw
# drops it.  Two legs over a fixture of two registered repos:
#   leg 1  this script — the CLI one-shot is unchanged: `bee cat` on a
#          ref-carrying ticket prints the same bytes it always did, twice
#   leg 2  cache.js — the BAR: with a live watcher the second identical page
#          opens no lane, reads no tip and re-resolves no reference, and its
#          bytes are the uncached run's; then the drops — a touch under one
#          repo's worktree drops THAT repo's entries alone, a ref move under
#          `refs/` drops its tip and its lane, a root bump drops everything,
#          and with no watcher nothing is remembered at all
#
# THE GAP THIS REPROS: every reference on a board page re-derived from zero —
# per code per mount the door reopened the lane, re-read the tip and re-ran the
# FSEG resolve, so warm was cold and a resident server paid the CLI's
# open-read-close hygiene 512 times a request.
#
# Standalone: `sh bee/test/doorcache/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/doorcache
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "doorcache: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 ||
             { echo "doorcache: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 ||
    { echo "doorcache: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "doorcache: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-doorcache.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "doorcache: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
echo "doorcache: runtime $RT, fixtures $WORK"

bee() { ( cd "$1" && shift && HOME="$FH" SRC_ROOT="$SRC" "$RT" "$@" ); }

# ==========================================================================
# the fixture — TWO registered repos, so the door has a fan-out to skip.  Only
# beta holds TST-002, so alpha's answer for it is a NEGATIVE one, and the
# ticket body carries a handful of references of every kind the door tells
# apart: a cross-repo code, a local code, a path and a code nobody holds.
# ==========================================================================
mkrepo() {
    mkdir -p "$1/todo/TST" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
seal() {
    ( cd "$1" && git add -A &&
      GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
        git commit -q -m 'seed' ) || exit 2
}
mkrepo "$SRC/alpha"; mkrepo "$SRC/beta"

printf '#   TST-001: the door resolves these\n
    Now: OPEN
    Sev: MED

TST-002 lives in the other repo, TST-004 lives in this one and TST-999 in
none at all; note.mkd and doc/deep/page.mkd are paths, and TST-002 again.
' > "$SRC/alpha/todo/TST/TST-001.mkd"
printf '#   TST-004: the local one\n\n    Now: OPEN\n\nsee TST-001 and TST-002.\n' \
  > "$SRC/alpha/todo/TST/TST-004.mkd"
mkdir -p "$SRC/alpha/doc/deep"
printf 'a page\n' > "$SRC/alpha/doc/deep/page.mkd"
printf 'a note\n' > "$SRC/alpha/note.mkd"
seal "$SRC/alpha"

printf '#   TST-002: the cross-repo one\n\n    Now: OPEN\n\nsee TST-001.\n' \
  > "$SRC/beta/todo/TST/TST-002.mkd"
printf 'b\n' > "$SRC/beta/b.txt"
seal "$SRC/beta"

printf '%s\n%s\n' "$SRC/alpha" "$SRC/beta" > "$REG"

# The lanes must EXIST: a repo with no index answers the anchored legs alone
# (door.js:343 `fresh` is the kernel-clone guard) and never opens one.
bee "$SRC/alpha" index > "$WORK/ia" 2>&1 || { bad "index alpha" "$WORK/ia"; exit 1; }
bee "$SRC/beta"  index > "$WORK/ib" 2>&1 || { bad "index beta"  "$WORK/ib"; exit 1; }

# ==========================================================================
# leg 1 — the CLI one-shot: no watcher, so no cache, so the same bytes twice
# ==========================================================================
bee "$SRC/alpha" cat todo/TST/TST-001.mkd > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
bee "$SRC/alpha" cat todo/TST/TST-001.mkd > "$WORK/c2" 2>"$WORK/c2e"
if [ "$RC" = 0 ] && [ -s "$WORK/c1" ] && cmp -s "$WORK/c1" "$WORK/c2"
then ok "a one-shot CLI read prints the same bytes twice"
else bad "a one-shot CLI read prints the same bytes twice (rc $RC)" \
         "$WORK/c1" "$WORK/c2" "$WORK/c1e"; fi

bee "$SRC/alpha" see TST-002 > "$WORK/s1" 2>"$WORK/s1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'TST-002' "$WORK/s1"
then ok "the cross-repo code resolves from the CLI too"
else bad "the cross-repo code resolves from the CLI (rc $RC)" "$WORK/s1" "$WORK/s1e"; fi

# ==========================================================================
# leg 2 — the cache itself, in the runtime
# ==========================================================================
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/cache.js')" ) \
  > "$WORK/r.out" 2> "$WORK/r.err"
RC=$?
sed 's/^/     /' "$WORK/r.out"
if [ "$RC" = 0 ] && grep -q '^PASS ' "$WORK/r.out"
then ok "cache.js: the warm-page bar and the per-repo drops"
else bad "cache.js: the warm-page bar and the per-repo drops" "$WORK/r.err"; fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/doorcache] $CHECKS shell checks, plus cache.js"; exit 0
else echo "FAIL [bee/doorcache] $FAILED of $CHECKS shell checks"; exit 1; fi
