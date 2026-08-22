#!/bin/sh
# bee/test/subpull/run.sh — BEE-037 revised: `pull` moves the SUBMODULES too.
# Three legs over bare origins and their clones: a gitlink the upstream bumped
# reaches the sub's own checkout (fetching the commit it has never seen), a sub
# carrying uncommitted work is left alone and SAID so, and a grandchild follows
# the same descent as its parent.
#
# THE GAP THIS REPROS: the merge moved the gitlink in HEAD and nothing moved the
# checkout under it, so every sub read "new commits" until a hand-run
# `git submodule update` — the stale-test-module trap (QJAB-007's worktree).
#
# Standalone: `sh bee/test/subpull/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)
LITE=$(cd "$CASE/../.." && pwd)

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "subpull: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "subpull: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "subpull: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "subpull: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-subpull.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
export HOME="$FAKEHOME"                    # BEE-031: a FIXTURE registry, never the user's
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "subpull: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
SRC="$WORK/src"; mkdir -p "$SRC"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "subpull: runtime $RT, fixtures $WORK"

#  `protocol.file.allow` is git 2.38's clamp on local submodule URIs (test/
#  subfold/run.sh:57:hs); the dates keep every fixture sha reproducible.
G() { git -c user.email=t@t -c user.name=T -c protocol.file.allow=always "$@"; }
DATED() { GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' G "$@"; }
sha() { git -C "$1" rev-parse "${2:-HEAD}"; }

#  born <name> <file> -> $SRC/<name>.git, a bare origin with one commit in it.
born() {
    mkdir -p "$SRC/$1-seed" &&
    ( cd "$SRC/$1-seed" && git init -q -b master . && printf 'V0\n' > "$2" &&
      G add -A && DATED commit -q -m seed ) >/dev/null &&
    git init -q --bare "$SRC/$1.git" &&
    ( cd "$SRC/$1-seed" && G remote add origin "$SRC/$1.git" &&
      G push -q origin master ) >/dev/null
}
#  mounted <name> <child.git> <at> — the bare origin <name>.git grows a gitlink.
mounted() {
    ( cd "$SRC/$1-seed" && G submodule add -q "$2" "$3" &&
      DATED commit -q -m "mount $3" && G push -q origin master ) >/dev/null
}
#  cloned <origin> <dest> — a clone with its submodules checked out, tracking.
cloned() {
    ( cd "$SRC" && G clone -q "$SRC/$1.git" "$2" &&
      cd "$SRC/$2" && G submodule update -q --init --recursive ) >/dev/null
}

# ==========================================================================
# leg 1 — the upstream bumps a gitlink; our clone's sub must follow
# ==========================================================================
born leaf l.txt && born sub s.txt && born top p.txt &&
mounted sub "$SRC/leaf.git" leaf && mounted top "$SRC/sub.git" sub ||
    { echo "subpull: no fixture" >&2; exit 2; }
cloned top A && cloned top B || { echo "subpull: no clones" >&2; exit 2; }

#  THEIRS: a commit in the sub, pushed, and the gitlink bumped over it.
( cd "$SRC/A/sub" && printf 'V1\n' > s.txt && G add -A && DATED commit -q -m "sub V1" &&
  G push -q origin HEAD:master ) >/dev/null || exit 2
( cd "$SRC/A" && G add sub && DATED commit -q -m "bump sub" &&
  G push -q origin master ) >/dev/null || exit 2
NEWSUB=$(sha "$SRC/A/sub"); NEWTOP=$(sha "$SRC/A")

rtin "$SRC/B" pull > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(sha "$SRC/B")" = "$NEWTOP" ]
then ok "\`bee pull\` fast-forwards the top"
else bad "the top did not move (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

if [ "$(sha "$SRC/B/sub")" = "$NEWSUB" ]
then ok "...and the SUB's checkout follows the gitlink it recorded"
else bad "the sub stayed at $(sha "$SRC/B/sub"), owed $NEWSUB" "$WORK/l1" "$WORK/l1e"; fi

if grep -qE '^pull origin/master [0-9a-f]{4,} 1 sub$' "$WORK/l1"
then ok "...the one report line naming how many subs moved"
else bad "the pull report line" "$WORK/l1" "$WORK/l1e"; fi

if [ -z "$(git -C "$SRC/B" status --porcelain)" ]
then ok "...leaving no \`modified: sub\` behind"
else bad "the top is dirty after the pull: $(git -C "$SRC/B" status --porcelain)"; fi

# ==========================================================================
# leg 2 — a sub carrying work is NOT clobbered, and the line says so
# ==========================================================================
cloned top C || exit 2
( cd "$SRC/A/sub" && printf 'V2\n' > s.txt && G add -A && DATED commit -q -m "sub V2" &&
  G push -q origin HEAD:master ) >/dev/null || exit 2
( cd "$SRC/A" && G add sub && DATED commit -q -m "bump sub again" &&
  G push -q origin master ) >/dev/null || exit 2
printf 'MINE\n' > "$SRC/C/sub/s.txt"           # uncommitted work in the sub
WAS=$(sha "$SRC/C/sub")

rtin "$SRC/C" pull > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(sha "$SRC/C")" = "$(sha "$SRC/A")" ]
then ok "a dirty sub does not stop the top from fast-forwarding"
else bad "the top did not move past a dirty sub (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi

if [ "$(sha "$SRC/C/sub")" = "$WAS" ] && [ "$(cat "$SRC/C/sub/s.txt")" = "MINE" ]
then ok "...the sub keeps its head AND its uncommitted work"
else bad "the dirty sub was moved or clobbered" "$WORK/l2" "$WORK/l2e"; fi

if grep -qE '^pull origin/master [0-9a-f]{4,} 1 behind$' "$WORK/l2"
then ok "...and the report line says one sub stayed behind"
else bad "the behind report line" "$WORK/l2" "$WORK/l2e"; fi

# ==========================================================================
# leg 3 — the descent is depth-first: a GRANDCHILD follows too
# ==========================================================================
cloned top D || exit 2
( cd "$SRC/A/sub/leaf" && printf 'W1\n' > l.txt && G add -A && DATED commit -q -m "leaf W1" &&
  G push -q origin HEAD:master ) >/dev/null || exit 2
( cd "$SRC/A/sub" && G add leaf && DATED commit -q -m "bump leaf" &&
  G push -q origin HEAD:master ) >/dev/null || exit 2
( cd "$SRC/A" && G add sub && DATED commit -q -m "bump sub for leaf" &&
  G push -q origin master ) >/dev/null || exit 2
NEWLEAF=$(sha "$SRC/A/sub/leaf")

rtin "$SRC/D" pull > "$WORK/l3" 2>"$WORK/l3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(sha "$SRC/D/sub/leaf")" = "$NEWLEAF" ]
then ok "the grandchild follows the same descent (rc $RC)"
else bad "the grandchild stayed at $(sha "$SRC/D/sub/leaf"), owed $NEWLEAF" "$WORK/l3" "$WORK/l3e"; fi

if grep -qE '^pull origin/master [0-9a-f]{4,} 2 subs$' "$WORK/l3"
then ok "...and both moved levels are counted in the one line"
else bad "the two-level report line" "$WORK/l3" "$WORK/l3e"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/subpull] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/subpull] $CHECKS checks, runtime $RT"
exit 0
