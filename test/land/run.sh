#!/bin/sh
# test/land/run.sh — BEE-045: `push` onto a LOCAL tracked branch lands from the
# PARENT's side, --ff-only --autostash; behind-or-diverged refuses in words.
#   leg 1  a fork's commit lands: the parent tree fast-forwards, files appear
#   leg 2  a dirty parent still lands (autostash) and keeps its dirt
#   leg 3  parent moved ahead -> push refuses, tells to pull first
set -u
RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "land: no runtime at $RT" >&2; exit 2; } ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "land: no runtime '$RT'" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "land: SKIP — no git" >&2; exit 0; }
TMPROOT="${TMPDIR:-$HOME/tmp}"; mkdir -p "$TMPROOT" || exit 2
WORK=$(mktemp -d "$TMPROOT/bee-land.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$FAILED" = 0 ] && [ "$rc" = 0 ]; then rm -rf "$WORK";
      else echo "land: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT
ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() { CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1)); echo "FAIL $1"; shift
        for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done; }
FH="$WORK/home"; mkdir -p "$FH/.config/bee"
SRC="$WORK/src"; mkdir -p "$SRC/alpha"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FH" SRC_ROOT="$SRC" "$RT" "$@" ); }
G="git -c user.email=t@t -c user.name=t"

( cd "$SRC/alpha" && git init -q -b main . && $G commit -q --allow-empty -m seed )
echo "$SRC/alpha" > "$FH/.config/bee/repos"
rtin "$SRC/alpha" fork //alpha-TKT-001 > /dev/null 2>&1 || { echo "land: fork failed" >&2; exit 1; }

# leg 1+2: a commit in the fork, dirt in the parent, then push -> parent FFs
( cd "$SRC/alpha-TKT-001" && echo work > work.txt && git add work.txt && $G commit -q -m "TKT-001: work" )
echo dirt > "$SRC/alpha/dirt.txt"
( cd "$SRC/alpha" && echo edit >> dirt.txt ) # untracked stays untracked; also dirty-file case below
rtin "$SRC/alpha-TKT-001" push > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^push main ' "$WORK/l1" &&
   [ -f "$SRC/alpha/work.txt" ] && [ -f "$SRC/alpha/dirt.txt" ] &&
   [ "$(git -C "$SRC/alpha" log --format=%s -1)" = "TKT-001: work" ]
then ok "push lands the fork's commit: the parent tree fast-forwarded, dirt kept"
else bad "the ff land (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

# leg 3: the parent moves ahead -> push refuses with the pull hint
( cd "$SRC/alpha" && $G commit -q --allow-empty -m ahead )
rtin "$SRC/alpha-TKT-001" push > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" != 0 ] && grep -q "pull (or merge) first" "$WORK/l2e"
then ok "a moved parent refuses the push and says to pull first"
else bad "the behind refusal (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi

echo "land: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
