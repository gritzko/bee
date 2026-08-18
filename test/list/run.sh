#!/bin/sh
# lite/test/list/run.sh — LITE-017: `lite list [<path>][?<rev>]`, the
# github-style directory browser.  be/test/list/{e2e,fuse.js} ported onto be's
# own fixture — a.txt seeded at C0, b.txt added at C1, sub/x.txt edited at C2,
# plus ONE uncommitted edit to a.txt — asserting be's own fused row shape:
#
#   * a.txt  -> the wt marker `mod` (the uncommitted edit) + its LAST commit C0
#   * b.txt  -> a clean `eq` + its add-commit C1
#   * sub/   -> a `dir` row + the NEWEST commit UNDER it (C2), NOT its C0 seed
#   * every attributed entry carries a rel-age token.
#
# The MODEL DIFFERENCES from be, deliberate and recorded in the ticket:
#   * no banner line — `--plain` is the rows alone, the log/tree convention, so
#     be's "the banner is the list scheme" check has nothing to assert here;
#   * lite lists the TRACKED TREE, not the raw worktree: it has no ignore
#     machinery, so an UNTRACKED file has no row and be's `new` marker bucket
#     never appears (a tracked file gone from the worktree reads `del`);
#   * a dir's marker is a flat `dir` — be rolls worktree dirtiness up into it,
#     which costs a subtree walk per row;
#   * the FUSE is lite's own: a file is one LITE-006 index prefix scan, a dir is
#     the CPAR ancestry walk, capped LITE-013-style (the fuse leg pins the cap).
#
# Standalone: `sh lite/test/list/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/list
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "list: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "list: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "list: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "list: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-list.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "list: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "list: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — be/test/list/e2e's own, plus an `old/` dir seeded at C0 and
# never touched again (what the fuse's walk CEILING is pinned against).
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO/sub" "$REPO/old" "$REPO/deep/er"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'A0\n' > a.txt
  printf 'X0\n' > sub/x.txt
  printf 'OLD\n' > old/o.txt
  printf 'DEEP\n' > deep/er/f.txt      # LITE-044: a dir UNDER a dir, C0 only
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
) || { echo "list: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
TIP=$(g rev-parse HEAD)
C1=$(g rev-parse HEAD~1)

# ==========================================================================
# leg 1 — the FUSED rows end to end
# ==========================================================================
rtin "$REPO" list --plain > "$WORK/out" 2>"$WORK/err"; RC=$?
if [ "$RC" = 0 ] && [ -s "$WORK/out" ]
then ok "the browser emits rows"
else bad "list (rc $RC)" "$WORK/out" "$WORK/err"; fi

# The wt marker column, be's own three buckets that lite can tell apart.
for _row in 'mod a.txt' 'eq  b.txt' 'dir old/' 'dir sub/' 'dir deep/' 'del gone.txt'; do
    if grep -q "^$_row " "$WORK/out"
    then ok "row: $_row"
    else bad "missing entry row: $_row" "$WORK/out"; fi
done
# The untracked file is NOT a row (the recorded model difference).
if ! grep -q 'u\.txt' "$WORK/out"
then ok "an untracked file has no row (lite lists the tracked tree)"
else bad "untracked file listed" "$WORK/out"; fi
# ...and neither is `.git`, which is the whole reason for that.
if ! grep -q '\.git' "$WORK/out"
then ok "and neither does .git"
else bad ".git listed" "$WORK/out"; fi

# THE FUSE: each entry carries its LAST-commit summary, and the DIR gets the
# newest commit UNDER it (C2), not its C0 seed.
if grep -q '^mod a.txt .*C0 seed a and sub' "$WORK/out"
then ok "a.txt is fused with C0 (wt mod + its last commit)"
else bad "a.txt not fused with C0" "$WORK/out"; fi
if grep -q '^eq  b.txt .*C1 add b' "$WORK/out"
then ok "b.txt is fused with C1"
else bad "b.txt not fused with C1" "$WORK/out"; fi
if grep -q '^dir sub/ .*C2 edit sub' "$WORK/out"
then ok "sub/ is fused with the newest commit UNDER it (C2), not its seed"
else bad "sub/ not fused with C2" "$WORK/out"; fi
if grep -q '^dir old/ .*C0 seed a and sub' "$WORK/out"
then ok "old/ is fused with C0 — the newest commit under it IS its seed"
else bad "old/ not fused with C0" "$WORK/out"; fi
# LITE-044: a dir NESTED under a dir fuses too — one index scan per entry, so
# depth costs nothing and no walk ceiling can starve the row.
rtin "$REPO" list --plain deep > "$WORK/deep.out" 2>"$WORK/deep.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^dir er/ .*C0 seed a and sub' "$WORK/deep.out"
then ok "a dir one level down fuses as exactly as a file does"
else bad "nested dir not fused (rc $RC)" "$WORK/deep.out" "$WORK/deep.err"; fi
# Every row carries a rel-age token at its tail.
if [ "$(grep -cE '[0-9]+[smhdy]$' "$WORK/out")" = "$(( $(wc -l < "$WORK/out") ))" ]
then ok "every row carries a rel-age column"
else bad "rel-age column" "$WORK/out"; fi

# A SCOPED listing, and the `?<rev>` one.
rtin "$REPO" list --plain sub > "$WORK/sub.out" 2>"$WORK/sub.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^eq  x.txt .*C2 edit sub' "$WORK/sub.out" &&
   [ "$(( $(wc -l < "$WORK/sub.out") ))" = 1 ]
then ok "a scoped listing is that dir's entries alone, fused"
else bad "scoped list (rc $RC)" "$WORK/sub.out" "$WORK/sub.err"; fi
rtin "$REPO" list --plain "?$C1" > "$WORK/rev.out" 2>"$WORK/rev.err"; RC=$?
if [ "$RC" = 0 ] && grep -q 'b.txt' "$WORK/rev.out" && ! grep -q 'gone.txt.*C1' "$WORK/rev.out"
then ok "'?<rev>' lists the tree at that rev"
else bad "rev list (rc $RC)" "$WORK/rev.out" "$WORK/rev.err"; fi
# At C0 there is no b.txt yet.
rtin "$REPO" list --plain "?$(g rev-parse HEAD~2)" > "$WORK/rev0.out" 2>&1
if ! grep -q 'b.txt' "$WORK/rev0.out"
then ok "at C0 the listing has no b.txt yet"
else bad "rev0 list" "$WORK/rev0.out"; fi

# The refusals.
refuse() {   # refuse <label> <want-word> <args...>
    _l=$1; _w=$2; shift 2
    rtin "$REPO" list "$@" > "$WORK/r.out" 2>"$WORK/r.err"; _rc=$?
    if [ "$_rc" != 0 ] && [ ! -s "$WORK/r.out" ] && grep -q "$_w" "$WORK/r.err"
    then ok "$_l"
    else bad "$_l (rc $_rc)" "$WORK/r.out" "$WORK/r.err"; fi
}
refuse "a file is not a directory, and it says so" "is a file, not a directory" a.txt
refuse "an absent path is refused in plain words" "there is no" nosuch
refuse "a climb out of the repository is refused" "is outside" ../elsewhere
refuse "an unknown rev is refused in plain words" "no commit" "?deadbeefdead"

# ==========================================================================
# leg 1b — LITE-044: a garbage index file in .git/be does not break the run;
# the fresh derivation still yields fused dir rows.
# ==========================================================================
BE="$REPO/.git/be"
rm -rf "$BE"; mkdir -p "$BE"
printf 'PRE-LITE-044 INDEX\n' > "$BE/0000000000.lite.idx"
rtin "$REPO" list --plain > "$WORK/old.out" 2>"$WORK/old.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^dir old/ .*C0 seed a and sub' "$WORK/old.out"
then ok "a garbage index file still yields fused dir rows"
else bad "garbage index file broke the run (rc $RC)" "$WORK/old.out" "$WORK/old.err"; fi

# ==========================================================================
# leg 2 — the FUSE itself (be/test/list/fuse.js ported), headless
# ==========================================================================
ln -sf "$LITE" "$WORK/jsrc"
( cd "$LITE" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_TIP="$TIP" \
  "$RT" --eval "require('$CASE/fuse.js')" ) > "$WORK/f.out" 2>"$WORK/f.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/f.out" && ! grep -q '^FAIL' "$WORK/f.out"; then
    N=$(grep -c '^ok' "$WORK/f.out"); CHECKS=$((CHECKS + N))
    ok "fuse leg: $N checks (attribution / relAge / row spans / the walk cap)"
else
    cat "$WORK/f.out"; head -5 "$WORK/f.err"
    bad "fuse leg (rc $RC)" "$WORK/f.out"
fi

# ==========================================================================
# leg 3 — the REAL UI path: the family navigated on a live pty through the
# SHIPPED door (door.js openTarget).  Skip-guarded on the tty binding.
# ==========================================================================
( cd "$REPO" && HOME="$FAKEHOME" "$RT" --eval \
  "if (typeof tty === 'undefined' || !tty.openpty) { io.log('SKIP no tty binding\n'); }
   else require('$CASE/pty.js');" ) > "$WORK/p.out" 2>"$WORK/p.err"; RC=$?
if grep -q '^SKIP' "$WORK/p.out"; then
    echo "skip pty leg — no tty.openpty binding"
elif [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/p.out" && ! grep -q '^FAIL' "$WORK/p.out"; then
    N=$(grep -c '^ok' "$WORK/p.out"); CHECKS=$((CHECKS + N))
    ok "pty leg: $N checks (painted rows, Enter into cat/list/blob, back)"
else
    cat "$WORK/p.out"; head -5 "$WORK/p.err"
    bad "pty leg (rc $RC)" "$WORK/p.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/list] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/list] $CHECKS checks, runtime $RT"
exit 0
