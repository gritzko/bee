#!/bin/sh
# test/escinj/run.sh — CODE-039: TERMINAL ESCAPE INJECTION.  Commit subjects,
# author names and filenames are attacker-controlled text that the ansi sink
# writes to a terminal verbatim; a crafted one repaints or spoofs the screen.
# This suite pins that the sink neutralises every C0/DEL byte on the way in
# while the renderer's OWN SGR still paints, in `log` and in `list` alike, and
# that the colour banner fills its band by COLUMNS (a UTF-8 uri under-filled it).
#
# Standalone: `sh test/escinj/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # test/escinj
LITE=$(cd "$CASE/../.." && pwd)                  # the tree

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "escinj: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "escinj: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "escinj: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "escinj: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-escinj.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "escinj: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -20 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
export HOME="$FAKEHOME"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "escinj: runtime $RT, fixtures $WORK"

ESC=$(printf '\033')
BEL=$(printf '\007')
has()   { if grep -q -- "$2" "$WORK/$1"; then ok "$3"; else bad "$3" "$WORK/$1"; fi; }
hasnt() { if grep -q -- "$2" "$WORK/$1"; then bad "$3" "$WORK/$1"; else ok "$3"; fi; }

# ==========================================================================
# the fixture — one commit whose SUBJECT and AUTHOR NAME both carry raw ESC
# sequences and a BEL, which is exactly what a hostile push looks like.
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO"
SUBJ=$(printf 'oops\033[31mRED\033[0m\007 done')
WHO=$(printf 'Ev\033[7mil')
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name "$WHO" || exit 1
  printf 'hello\n' > a.txt
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m "$SUBJ" || exit 1
) || { echo "escinj: cannot build the fixture repo" >&2; exit 2; }

# ==========================================================================
# leg 1 — the ansi sink: log and list
# ==========================================================================
for V in log list; do
    rtin "$REPO" "$V" --color > "$WORK/$V.out" 2> "$WORK/$V.err"
    has   "$V.out" 'oops' "$V --color still shows the subject text"
    hasnt "$V.out" "${ESC}\[31m" "$V --color: the injected fg SGR is neutralised"
    hasnt "$V.out" "${ESC}\[7m"  "$V --color: the injected reverse SGR is neutralised"
    hasnt "$V.out" "$BEL"        "$V --color: the BEL never reaches the terminal"
    has   "$V.out" '?\[31mRED'   "$V --color: the escape prints inert, one column each"
    has   "$V.out" "${ESC}\[38;5;" "$V --color: the renderer's own paint is untouched"
done
# the author column is the log's own; the list has none
has log.out 'Ev?\[7mil' "log --color: the author name is neutralised too"

# ==========================================================================
# leg 2 — the headless sink: paintRow, emitBody and the banner band
# ==========================================================================
( cd "$LITE" && HOME="$FAKEHOME" \
  "$RT" --eval "require('$CASE/banner.js')" ) > "$WORK/b.out" 2>"$WORK/b.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/b.out" && ! grep -q '^FAIL' "$WORK/b.out"; then
    N=$(grep -c '^ok' "$WORK/b.out"); CHECKS=$((CHECKS + N))
    ok "headless leg: $N checks (the byte sink + the banner band)"
else
    cat "$WORK/b.out"; head -5 "$WORK/b.err"
    bad "headless leg (rc $RC)" "$WORK/b.out"
fi

if [ "$FAILED" = 0 ]; then echo "PASS [lite/escinj] $CHECKS checks, runtime $RT"; exit 0
else echo "FAIL [lite/escinj] $FAILED of $CHECKS checks failed"; exit 1; fi
