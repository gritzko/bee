#!/bin/sh
# bee/test/substat/run.sh — STATUS-023: a content-dirty submodule SHOWS in the
# status listing, on every surface, with a click target that resolves.
#   leg 1  the listing — a row per changed file inside a live mount, the path
#          mount-qualified, nested mounts recursing, the ignore chain honoured
#          inside the sub, a clean mount silent, the advanced `v` gitlink row
#          still there beside the dirty content rows
#   leg 2  (JS) href.js — the nav each row carries, the http URL it builds and
#          routes back to, the pager's own click target, and the `bee wts`
#          tally agreeing with the listing over the same tree
#   leg 3  the mounts that must stay SILENT: uninitialised (a fresh clone,
#          BEE-040) and unreadable (a `.git` leg pointing nowhere)
#
# THE GAP THIS REPROS: view/status.js:110:7E wtSha asked a gitlink for the SUB's
# own HEAD sha, and uncommitted content never moves a head — so only an
# advanced sub ever differed from the recorded sha and a sub full of edits
# compared clean, listing nothing, while view/wtstat.js:110:4I foldSubs descended
# the same mounts and tallied every one of those files.
#
# Standalone: `sh bee/test/substat/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/substat
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "substat: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "substat: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "substat: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "substat: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-substat.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
export HOME="$FAKEHOME"                    # BEE-031: a FIXTURE registry, never the user's
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "substat: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
#  The require climb: an unbundled runtime reads its JS off THIS tree, so the
#  link must stand before the first run, not before the JS leg alone.
ln -sf "$LITE" "$WORK/jsrc"
SRC="$WORK/src"; mkdir -p "$SRC"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "substat: runtime $RT, fixtures $WORK"

#  `protocol.file.allow` is git 2.38's clamp on local submodule URIs — a fixture
#  that adds one by path needs it said out loud.
G() { git -c user.email=t@t -c user.name=T -c protocol.file.allow=always "$@"; }
DATED() { GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' G "$@"; }

# ==========================================================================
# the fixture — proj ⊃ { dog ⊃ abc, quiet }, the ticket's own shape: dirt in
# the parent root, dirt inside the sub, dirt inside the NESTED sub, one mount
# kept clean, and the sub also ADVANCED so both states meet on one gitlink
# ==========================================================================
for r in abc dog quiet proj; do
    mkdir -p "$SRC/$r" || exit 2
    ( cd "$SRC/$r" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
done
( cd "$SRC/abc" && printf 'N0\n' > nest.c && G add -A && DATED commit -q -m seed ) || exit 2
( cd "$SRC/dog" && printf 'W0\n' > WHIFF.h && printf 'A0\n' > adv.txt &&
  printf 'build/\n' > .gitignore && G add -A && DATED commit -q -m seed &&
  G submodule add -q "$SRC/abc" abc && DATED commit -q -m 'mount abc' ) || exit 2
( cd "$SRC/quiet" && printf 'Q0\n' > q.txt && G add -A && DATED commit -q -m seed ) || exit 2
( cd "$SRC/proj" && printf 'P0\n' > pack.c && G add -A && DATED commit -q -m seed &&
  G submodule add -q "$SRC/dog" dog && G submodule add -q "$SRC/quiet" quiet &&
  DATED commit -q -m 'mount dog quiet' &&
  G submodule update -q --init --recursive ) || exit 2

PROJ="$SRC/proj"
#  The ADVANCED half first, so the edits below stay uncommitted.
( cd "$PROJ/dog" && printf 'A1\n' > adv.txt && DATED commit -q -am 'adv' ) || exit 2
printf 'P1\n' > "$PROJ/pack.c"                        # the parent root file
printf 'W1\n' > "$PROJ/dog/WHIFF.h"                   # dirt inside the sub
printf 'N1\n' > "$PROJ/dog/abc/nest.c"                # dirt inside the NESTED sub
printf 'U\n'  > "$PROJ/dog/new.txt"                   # untracked inside the sub
mkdir -p "$PROJ/dog/build" && printf 'o\n' > "$PROJ/dog/build/j.o"  # ignored there

# ==========================================================================
# leg 1 — the listing
# ==========================================================================
rtin "$PROJ" status --plain > "$WORK/out" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && [ -s "$WORK/out" ]
then ok "the view emits rows"
else bad "status (rc $RC)" "$WORK/out" "$WORK/err"; fi

# THE REPRO: before the fix only `pack.c` and the advanced gitlink were here.
for _row in '...v pack.c' '...v dog/WHIFF.h' '...v dog/abc/nest.c' \
            '...o dog/new.txt' '.v.. dog/adv.txt'; do
    if grep -qx "$_row" "$WORK/out"
    then ok "row: $_row"
    else bad "missing quad row: $_row" "$WORK/out"; fi
done

if grep -qx '...v dog' "$WORK/out"
then ok "the advanced gitlink keeps its own row beside the dirty content rows"
else bad "the advanced \`v\` row went missing" "$WORK/out"; fi

if ! grep -q 'build/j\.o' "$WORK/out"
then ok "an ignored path INSIDE the sub is no row — the igno chain rides along"
else bad "the sub's .gitignore was not honoured" "$WORK/out"; fi
if ! grep -q ' quiet' "$WORK/out"
then ok "a CLEAN mount contributes nothing at all"
else bad "a clean mount emitted a row" "$WORK/out"; fi
if ! grep -q '\.git/' "$WORK/out"
then ok "...and neither does anything under a sub's .git"
else bad ".git listed" "$WORK/out"; fi

# The rows are still the bare greppable canon: a mount-qualified path is a PATH.
if [ "$(grep -cE '^[.xov!]{4} ' "$WORK/out")" = "$(( $(wc -l < "$WORK/out") - 1 ))" ]
then ok "every row but the summary is a bare 4-char quad"
else bad "the plain canon leaked" "$WORK/out"; fi

# The summary tallies the WHOLE tree, mounts included — 5 wt rows, 1 head row.
if tail -1 "$WORK/out" | grep -q '^master	1 head, 5 wt$'
then ok "the summary counts the mounts' rows too"
else bad "summary line" "$WORK/out"; fi

# ==========================================================================
# leg 2 — the navs, the http hrefs, the pager target and the wts tally
# ==========================================================================
( cd "$LITE" && HOME="$FAKEHOME" BEE_FIX="$PROJ" "$RT" --eval "require('$CASE/href.js')" ) \
    > "$WORK/h.out" 2> "$WORK/h.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/h.out" && ! grep -q '^FAIL' "$WORK/h.out"; then
    N=$(grep -c '^ok' "$WORK/h.out"); CHECKS=$((CHECKS + N))
    ok "href leg: $N checks (the navs, the URLs, the click target, the tally)"
else
    cat "$WORK/h.out"; head -20 "$WORK/h.err"
    bad "href leg (rc $RC)"
fi

# ==========================================================================
# leg 3 — the mounts that stay SILENT
# ==========================================================================
# A fresh clone never initialises its mounts: BEE-040's uninitialised sub.
CLONE="$WORK/clone"
git clone -q "$PROJ" "$CLONE" >/dev/null 2>&1 || { echo "substat: cannot clone" >&2; exit 2; }
rtin "$CLONE" status --plain > "$WORK/cl" 2>"$WORK/cle"; RC=$?
if [ "$RC" = 0 ] && ! grep -q 'dog/' "$WORK/cl"
then ok "an uninitialised mount reads unchanged — no rows, no error"
else bad "uninitialised mount (rc $RC)" "$WORK/cl" "$WORK/cle"; fi

# An unreadable sub emits nothing and never errors the view (BEE-040).
mv "$PROJ/dog/.git" "$PROJ/dog/.git-away" &&
  printf 'gitdir: %s\n' "$WORK/nowhere" > "$PROJ/dog/.git" || exit 2
rtin "$PROJ" status --plain > "$WORK/br" 2>"$WORK/bre"; RC=$?
if [ "$RC" = 0 ] && grep -qx '...v pack.c' "$WORK/br" && ! grep -q 'dog/WHIFF' "$WORK/br"
then ok "an unreadable mount emits nothing and the rest of the view still paints"
else bad "unreadable mount (rc $RC)" "$WORK/br" "$WORK/bre"; fi
rm -f "$PROJ/dog/.git" && mv "$PROJ/dog/.git-away" "$PROJ/dog/.git" || exit 2

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/substat] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/substat] $CHECKS checks, runtime $RT"
exit 0
