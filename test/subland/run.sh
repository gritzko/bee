#!/bin/sh
# bee/test/subland/run.sh — BEE-064: `push` lands at the PARENT tree, so the
# SUBMODULES there must follow the gitlinks the land just moved.
#   leg 1  a fork carrying a sub commit lands: the parent's sub checkout
#          advances to the recorded sha and the report line counts it
#   leg 2  a sub dirty in the PARENT refuses the checkout: the land still
#          stands, the line reads `behind`, the sub keeps its work
#
# THE GAP THIS REPROS: `push`'s landSite leg merged into the parent and returned
# (sync.js:131:_X), so the parent BUILT pre-land sub code under a HEAD recording the
# landed commits until a hand-run `git submodule update` — the board's `+1`
# button walked into it every time (BEE-064:10).
#
# Standalone: `sh bee/test/subland/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)
LITE=$(cd "$CASE/../.." && pwd)

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "subland: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "subland: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "subland: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "subland: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-subland.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME/.config/bee"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
export HOME="$FAKEHOME"                    # BEE-031: a FIXTURE registry, never the user's
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "subland: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
REG="$FAKEHOME/.config/bee/repos"
SRC="$WORK/src"; mkdir -p "$SRC"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" SRC_ROOT="$SRC" "$RT" "$@" ); }
echo "subland: runtime $RT, fixtures $WORK"

#  `protocol.file.allow` is git 2.38's clamp on local submodule URIs; the dates
#  keep every fixture sha reproducible (test/subpull/run.sh:52:3v:G).
G() { git -c user.email=t@t -c user.name=T -c protocol.file.allow=always "$@"; }
DATED() { GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' G "$@"; }
sha() { git -C "$1" rev-parse "${2:-HEAD}"; }

#  parent <name> -> $SRC/<name>, a registered repo carrying an initialised `sub`
#  gitlink — the shape the board's `+1` lands into.
parent() {
    mkdir -p "$SRC/$1-sub" &&
    ( cd "$SRC/$1-sub" && git init -q -b master . && printf 'V0\n' > s.txt &&
      G add -A && DATED commit -q -m 'sub seed' ) >/dev/null &&
    mkdir -p "$SRC/$1" &&
    ( cd "$SRC/$1" && git init -q -b master . && printf 'top\n' > p.txt &&
      G add -A && DATED commit -q -m 'top seed' &&
      G submodule add -q "$SRC/$1-sub" sub && DATED commit -q -m 'mount sub' &&
      G submodule update -q --init --recursive ) >/dev/null &&
    echo "$SRC/$1" >> "$REG"
}

#  A fork carrying one new sub commit and the gitlink bump over it: exactly what
#  the `+1` button pushes.  -> the sub sha the parent will owe.
carry() {
    ( cd "$1/sub" && printf 'V1\n' > s.txt && G add -A &&
      DATED commit -q -m 'sub V1' ) >/dev/null &&
    ( cd "$1" && G add sub && DATED commit -q -m 'BEE-064: bump sub' ) >/dev/null
}

# ==========================================================================
# leg 1 — the land moves the gitlink, so the parent's sub checkout follows
# ==========================================================================
parent one || { echo "subland: no fixture" >&2; exit 2; }
rtin "$SRC/one" fork //one-TKT-064 > /dev/null 2>&1 ||
    { echo "subland: fork failed" >&2; exit 2; }
[ -e "$SRC/one-TKT-064/sub/.git" ] ||
    { echo "subland: SKIP — the fork grew no sub worktree" >&2; exit 0; }
carry "$SRC/one-TKT-064" || { echo "subland: no sub commit" >&2; exit 2; }
NEWSUB=$(sha "$SRC/one-TKT-064/sub"); NEWTOP=$(sha "$SRC/one-TKT-064")

rtin "$SRC/one-TKT-064" push > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(sha "$SRC/one")" = "$NEWTOP" ]
then ok "\`bee push\` lands the fork in the parent tree"
else bad "the land did not move the parent (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

if [ "$(sha "$SRC/one/sub")" = "$NEWSUB" ]
then ok "...and the PARENT's sub checkout follows the gitlink it now records"
else bad "the parent sub stayed at $(sha "$SRC/one/sub"), owed $NEWSUB" "$WORK/l1" "$WORK/l1e"; fi

if grep -qE '^push master [0-9a-f]{4,} 1 sub$' "$WORK/l1"
then ok "...the one report line naming how many subs moved"
else bad "the push report line" "$WORK/l1" "$WORK/l1e"; fi

if [ -z "$(git -C "$SRC/one" status --porcelain)" ]
then ok "...leaving no \`modified: sub\` behind in the parent"
else bad "the parent is dirty after the land: $(git -C "$SRC/one" status --porcelain)"; fi

# ==========================================================================
# leg 2 — a sub dirty AT THE SITE: the land stands, the sub keeps its work
# ==========================================================================
parent two || { echo "subland: no second fixture" >&2; exit 2; }
rtin "$SRC/two" fork //two-TKT-064 > /dev/null 2>&1 ||
    { echo "subland: second fork failed" >&2; exit 2; }
carry "$SRC/two-TKT-064" || { echo "subland: no sub commit" >&2; exit 2; }
NEWTOP=$(sha "$SRC/two-TKT-064")
printf 'MINE\n' > "$SRC/two/sub/s.txt"           # uncommitted work in the PARENT's sub
WAS=$(sha "$SRC/two/sub")

rtin "$SRC/two-TKT-064" push > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(sha "$SRC/two")" = "$NEWTOP" ]
then ok "a dirty parent sub does not stop the land"
else bad "the land refused over a dirty sub (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi

if [ "$(sha "$SRC/two/sub")" = "$WAS" ] && [ "$(cat "$SRC/two/sub/s.txt")" = "MINE" ]
then ok "...the sub keeps its head AND its uncommitted work"
else bad "the dirty sub was moved or clobbered" "$WORK/l2" "$WORK/l2e"; fi

if grep -qE '^push master [0-9a-f]{4,} 1 behind$' "$WORK/l2"
then ok "...and the report line says one sub stayed behind"
else bad "the behind report line" "$WORK/l2" "$WORK/l2e"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/subland] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/subland] $CHECKS checks, runtime $RT"
exit 0
