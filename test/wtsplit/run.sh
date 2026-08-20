#!/bin/sh
# bee/test/wtsplit/run.sh — BEE-039: the THREE-STATE count model, the un/staged
# split re-derived off the quad rows (view/wtstat.js).  One JS leg (split.js)
# over four fixture worktrees in the four states a staging button cares about —
# unstaged only, wholly staged, mixed, clean — plus the pure checks no fixture
# can build: the 99 clamp, a diverged `A⇄B`, and a quad char the mapping cannot
# class falling to chg.
#
# THE GAP THIS REPROS: wtstat tallied the quad's five COLUMNS, which says WHERE
# a change sits, never whether `add`/`rm` still has work — so no frame slot
# could tell "3 left to stage" from "3 already staged".
#
# Standalone: `sh bee/test/wtsplit/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/wtsplit
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "wtsplit: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "wtsplit: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "wtsplit: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "wtsplit: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-wtsplit.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
export HOME="$FAKEHOME"                    # BEE-031: a FIXTURE registry, never the user's
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "wtsplit: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -60 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FH="$WORK/home"; mkdir -p "$FH/.config/bee"
REG="$FH/.config/bee/repos"
SRC="$WORK/src"; mkdir -p "$SRC"
echo "wtsplit: runtime $RT, fixtures $WORK"

G() { git -c user.email=t@t -c user.name=T "$@"; }

mkdir -p "$SRC/proj" && ( cd "$SRC/proj" && git init -q -b master . &&
  git config user.email t@t && git config user.name T ) || exit 2
( cd "$SRC/proj" &&
  for f in a.txt b.txt c.txt d.txt m1.txt m2.txt; do printf 'S0\n' > "$f"; done &&
  git add -A &&
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    G commit -q -m seed ) || exit 2
printf '%s\n' "$SRC/proj" > "$REG"

for t in EMPTY UN ST MIX; do
    G -C "$SRC/proj" worktree add -q -b "$t" "$SRC/proj-$t" || exit 2
done

# UN — nothing staged: two edits, one on-disk deletion, one untracked add.
( cd "$SRC/proj-UN" && printf 'S1\n' > a.txt && printf 'S1\n' > b.txt &&
  rm c.txt && printf 'NEW\n' > new.txt ) || exit 2
# ST — everything staged: one edit, one removal, three adds.
( cd "$SRC/proj-ST" && printf 'S1\n' > a.txt && rm b.txt &&
  printf 'N\n' > n1.txt && printf 'N\n' > n2.txt && printf 'N\n' > n3.txt &&
  G add -A ) || exit 2
# MIX — one file staged then edited AGAIN, plus a second unstaged edit: the
# unstaged number is what the slot must show while any remains.
( cd "$SRC/proj-MIX" && printf 'S1\n' > m1.txt && G add m1.txt &&
  printf 'S2\n' > m1.txt && printf 'S1\n' > m2.txt ) || exit 2

( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/split.js')" ) \
    > "$WORK/s.out" 2> "$WORK/s.err"; RC=$?
sed 's/^/     /' "$WORK/s.out"
if [ "$RC" != 0 ]; then
    echo "--- split stderr ---"; cat "$WORK/s.err"
    bad "split leg exited non-zero (rc $RC)" "$WORK/s.out"
elif grep -q '^FAIL' "$WORK/s.out"; then
    bad "split leg check(s) failed" "$WORK/s.out"
elif ! grep -q '^DONE' "$WORK/s.out"; then
    bad "split leg did not finish" "$WORK/s.out"
else
    CHECKS=$((CHECKS + $(grep -c '^ok' "$WORK/s.out")))
    ok "split leg: the un/staged split, the frames, the clamp and the fallback"
fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/wtsplit] $CHECKS checks, runtime $RT"; exit 0
else echo "FAIL [bee/wtsplit] $FAILED of $CHECKS checks"; exit 1; fi
