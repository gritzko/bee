#!/bin/sh
# lite/test/first/run.sh — LITE-018: the SEAMLESS FIRST RUN.  Bare `lite` (zero
# args, no verb) inside a git repo indexes the repo and opens the LITE-017 list
# view of its root; outside a repo it is the old no-arg behaviour, byte for
# byte.  What this pins:
#
#   * a FRESH repo: one bare run builds `.git/be/` from nothing AND prints the
#     fused board — the same rows `lite list` prints, byte for byte;
#   * the run is the `index` half too: the repo joins the repo list, and a
#     following `lite index` says "up to date" (the LITE-006 watermark marker);
#   * a SECOND bare run is that watermark no-op — the run family does not grow
#     and the rows are unchanged;
#   * a new commit is picked up by the next bare run (the bring-up is live);
#   * `lite list` alone still writes NO repo-list row (the read-verb contract);
#   * outside a repo, bare `lite` and bare `lite --plain` are today's usage
#     throw, and a PATH arg anywhere is still the unconfined filesystem pager.
#
# The fixture is test/list/run.sh's own, so the row bytes asserted here are the
# LITE-017 ones, not a new shape.
#
# Standalone: `sh lite/test/first/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/first
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "first: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "first: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "first: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "first: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-first.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "first: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
ln -sf "$LITE" "$WORK/jsrc"
echo "first: runtime $RT, fixtures $WORK"

# The bare run must be able to answer "no repo here" — if this scratch dir sits
# inside somebody's repo the non-repo legs are meaningless, so they skip.
NOWHERE="$WORK/nowhere"; mkdir -p "$NOWHERE"
if ( cd "$NOWHERE" && git rev-parse --show-toplevel ) >/dev/null 2>&1
then NOREPO=0; echo "first: $NOWHERE is inside a git repo — the non-repo legs skip" >&2
else NOREPO=1; fi

# ==========================================================================
# the fixture — test/list/run.sh's, so the rows are the LITE-017 rows
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO/sub" "$REPO/old"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'A0\n' > a.txt
  printf 'X0\n' > sub/x.txt
  printf 'OLD\n' > old/o.txt
  printf 'GONE\n' > gone.txt
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed a and sub' || exit 1
  printf 'B1\n' > b.txt
  git add -A
  GIT_AUTHOR_DATE='@1700086400 +0000' GIT_COMMITTER_DATE='@1700086400 +0000' \
    git commit -q -m 'C1 add b' || exit 1
  printf 'X2\n' > sub/x.txt
  git add -A
  GIT_AUTHOR_DATE='@1700172800 +0000' GIT_COMMITTER_DATE='@1700172800 +0000' \
    git commit -q -m 'C2 edit sub' || exit 1
  printf 'A0-dirty\n' >> a.txt          # uncommitted -> a.txt reads `mod`
  rm -f gone.txt                        # tracked, gone from the wt -> `del`
  printf 'UNTRACKED\n' > u.txt          # no row at all (lite has no ignores)
) || { echo "first: cannot build the fixture repo" >&2; exit 2; }

# A SECOND repo, never touched by any verb here — the JS leg's own first run.
FRESH="$WORK/fresh"; mkdir -p "$FRESH/d"
(
  cd "$FRESH" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'F\n' > f.txt
  printf 'G\n' > d/g.txt              # a DIR row too — the other fuse
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'F0 fresh seed' || exit 1
) || { echo "first: cannot build the fresh repo" >&2; exit 2; }

TRK="$FAKEHOME/.config/bee/repos"

# ==========================================================================
# leg 1 — the FIRST bare run: it indexes, and it shows the board
# ==========================================================================
[ -d "$REPO/.git/be" ] && { echo "first: fixture already indexed" >&2; exit 2; }
rtin "$REPO" > "$WORK/o1" 2>"$WORK/e1"; RC=$?
if [ "$RC" = 0 ] && [ -s "$WORK/o1" ]
then ok "bare \`lite\` in a git repo emits the board"
else bad "bare run (rc $RC)" "$WORK/o1" "$WORK/e1"; fi

# It INDEXED — the LITE-006 run family is in the repo's own .git/be/.
if [ -d "$REPO/.git/be" ] && ls "$REPO/.git/be" | grep -q '\.lite\.idx$'
then ok "...having built the index from scratch in <repo>/.git/be/"
else bad "the bare run built no index" "$WORK/o1" "$WORK/e1"; fi

# ...and the rows are the LITE-017 rows, fused, marker column and all.
for _row in 'mod a.txt' 'eq  b.txt' 'dir old/' 'dir sub/' 'del gone.txt'; do
    if grep -q "^$_row " "$WORK/o1"
    then ok "row: $_row"
    else bad "missing entry row: $_row" "$WORK/o1"; fi
done
if grep -q '^mod a.txt .*C0 seed a and sub' "$WORK/o1" &&
   grep -q '^eq  b.txt .*C1 add b' "$WORK/o1" &&
   grep -q '^dir sub/ .*C2 edit sub' "$WORK/o1"
then ok "...fused on the FIRST run — no starved summaries"
else bad "the first run's rows are not fused" "$WORK/o1"; fi
if [ "$(grep -cE '[0-9]+[smhdy]$' "$WORK/o1")" = "$(wc -l < "$WORK/o1")" ]
then ok "...and every row carries its rel-age column"
else bad "rel-age column" "$WORK/o1"; fi

# Byte parity with the verb it stands for: bare `lite` IS `lite list`.
rtin "$REPO" list --plain > "$WORK/l1" 2>"$WORK/l1e"
if cmp -s "$WORK/o1" "$WORK/l1"
then ok "bare \`lite\` is \`lite list\` to the byte"
else bad "bare run != lite list" "$WORK/o1" "$WORK/l1" "$WORK/l1e"; fi

# The `index` half: the repo is on the repo list, and the index is MARKED —
# `lite index` finds nothing to do, which is LITE-006's own up-to-date marker.
if [ -f "$TRK" ] && [ "$(cat "$TRK")" = "$REPO" ]
then ok "the bare run tracked the repo (the \`index\` half of it)"
else bad "the repo list after the bare run" "$TRK"; fi
rtin "$REPO" index > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^up to date: refs/heads/master ' "$WORK/i1"
then ok "...and left the index MARKED: \`lite index\` says up to date"
else bad "the bare run left an unmarked index (rc $RC)" "$WORK/i1" "$WORK/i1e"; fi

# ==========================================================================
# leg 2 — the SECOND bare run: the watermark no-op
# ==========================================================================
ls "$REPO/.git/be" | sort > "$WORK/fam1"
rtin "$REPO" > "$WORK/o2" 2>"$WORK/e2"; RC=$?
ls "$REPO/.git/be" | sort > "$WORK/fam2"
if [ "$RC" = 0 ] && cmp -s "$WORK/fam1" "$WORK/fam2"
then ok "the second bare run is the watermark no-op — the run family did not grow"
else bad "the second run reindexed (rc $RC)" "$WORK/fam1" "$WORK/fam2" "$WORK/e2"; fi
# The rows are the same ones (the rel-age column may tick, so compare the head).
cut -c1-40 "$WORK/o1" > "$WORK/h1"; cut -c1-40 "$WORK/o2" > "$WORK/h2"
if cmp -s "$WORK/h1" "$WORK/h2"
then ok "...and shows the same board"
else bad "the second run's board differs" "$WORK/o1" "$WORK/o2"; fi
# It did not re-append to the repo list either (LITE-006 dedups on read).
if [ "$(wc -l < "$TRK")" = "1" ]
then ok "...and the repo list dedups"
else bad "the repo list re-appended" "$TRK"; fi

# ==========================================================================
# leg 3 — the bring-up is LIVE: a new commit lands on the next bare run
# ==========================================================================
printf 'C3\n' > "$REPO/c.txt"
git -C "$REPO" add -A >/dev/null 2>&1
GIT_AUTHOR_DATE='@1700259200 +0000' GIT_COMMITTER_DATE='@1700259200 +0000' \
    git -C "$REPO" commit -q -m 'C3 add c' || { echo "first: cannot commit" >&2; exit 2; }
rtin "$REPO" > "$WORK/o3" 2>"$WORK/e3"; RC=$?
if [ "$RC" = 0 ] && grep -q '^eq  c.txt .*C3 add c' "$WORK/o3"
then ok "a new commit is indexed and fused by the next bare run"
else bad "the gap run (rc $RC)" "$WORK/o3" "$WORK/e3"; fi

# ==========================================================================
# leg 4 — `lite list` is still a READ verb: it writes no repo-list row
# ==========================================================================
FH2="$WORK/home2"; mkdir -p "$FH2"
( cd "$REPO" && HOME="$FH2" "$RT" list --plain ) > "$WORK/o4" 2>"$WORK/e4"; RC=$?
if [ "$RC" = 0 ] && [ -s "$WORK/o4" ] && [ ! -f "$FH2/.config/bee/repos" ]
then ok "\`lite list\` brings the index up but writes NO repo-list row"
else bad "list wrote a repo-list row (rc $RC)" "$WORK/o4" "$WORK/e4"; fi

# ==========================================================================
# leg 5 — OUTSIDE a repository: today's behaviour, byte for byte
# ==========================================================================
if [ "$NOREPO" = 1 ]; then
    rtin "$NOWHERE" > "$WORK/n1" 2>"$WORK/n1e"; RC=$?
    if [ "$RC" != 0 ] && [ ! -s "$WORK/n1" ] &&
       grep -q '^Usage: lite \[--plain|--color|--html\] <path>\.\.\.$' "$WORK/n1e"
    then ok "outside a repo, a piped bare run is the old usage throw"
    else bad "non-repo bare run (rc $RC)" "$WORK/n1" "$WORK/n1e"; fi

    rtin "$NOWHERE" --plain > "$WORK/n2" 2>"$WORK/n2e"; RC=$?
    if [ "$RC" != 0 ] && [ ! -s "$WORK/n2" ] &&
       grep -q '^Usage: lite \[--plain|--color|--html\] <path>\.\.\.$' "$WORK/n2e"
    then ok "...and so is a bare --plain run"
    else bad "non-repo --plain run (rc $RC)" "$WORK/n2" "$WORK/n2e"; fi

    # A PATH arg outside a repo is untouched: the filesystem pager, plain.
    printf 'hello\n' > "$NOWHERE/loose.txt"
    rtin "$NOWHERE" --plain loose.txt > "$WORK/n3" 2>"$WORK/n3e"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^hunk loose.txt' "$WORK/n3" && grep -q '^hello$' "$WORK/n3"
    then ok "a path arg outside a repo is still the filesystem view"
    else bad "non-repo path arg (rc $RC)" "$WORK/n3" "$WORK/n3e"; fi
fi

# A PATH arg INSIDE a repo is STILL the unconfined filesystem pager, never the
# browser — the zero-arg case is the only one this ticket changed.
rtin "$REPO" --plain a.txt > "$WORK/p1" 2>"$WORK/p1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^hunk a.txt' "$WORK/p1" && grep -q '^A0-dirty$' "$WORK/p1"
then ok "a path arg inside a repo is still the filesystem view, not the browser"
else bad "path arg inside a repo (rc $RC)" "$WORK/p1" "$WORK/p1e"; fi

# ==========================================================================
# leg 6 — the probe and the first run, headless + on a real pty (first.js)
# ==========================================================================
if [ "$NOREPO" = 1 ]; then
    ( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_FRESH="$FRESH" \
      LITE_NOWHERE="$NOWHERE" "$RT" --eval "require('$CASE/first.js')" \
    ) > "$WORK/j.out" 2>"$WORK/j.err"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/j.out" && ! grep -q '^FAIL' "$WORK/j.out"; then
        N=$(grep -c '^ok' "$WORK/j.out"); CHECKS=$((CHECKS + N))
        ok "probe + first-run leg: $N checks (climb, derive-from-nothing, the glass)"
    else
        cat "$WORK/j.out"; head -5 "$WORK/j.err"
        bad "probe + first-run leg (rc $RC)" "$WORK/j.out"
    fi
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/first] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/first] $CHECKS checks, runtime $RT"
exit 0
