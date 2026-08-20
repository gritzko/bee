#!/bin/sh
# lite/test/cat/run.sh — LITE-017: `lite cat <path>[?<rev>]`.  be's three cat
# cases ported — test/cat/{rev,nav-escape,links} — same fixtures, same
# contracts, lite's model where it differs:
#
#   rev      — BRO-029: `cat <path>?<rev>` reads the blob AT THAT REV, even when
#              the path is ABSENT from the checkout AND from the tip tree; a path
#              absent at that rev fails LOUD (non-zero, nothing on stdout), never
#              the silent-empty that was be's bug.  be reports `CATNOFILE`; lite
#              says it in plain words (the errors-in-plain-words ruling), which
#              is the ONE deviation in this leg.
#   escape   — BE-011: a `..` climb out of the worktree is REFUSED, never a
#              silent read of a sibling tree.  be throws NAVESCAPE, lite says
#              "is outside <root>"; the contract — no secret bytes, non-zero —
#              is identical.  (The bare `lite <path>` pager is a FILESYSTEM view
#              and confines nothing; `cat` is a repo verb, and does.)
#   bytes    — JAB-020: cat shows the file's OWN bytes and no diff.  `--plain` is
#              byte-identical to `cat(1)` on the same file.
#   hunk     — hunk.js: be/test/cat/links ported minus its `U` leg.  lite has no
#              grep verb, so cat emits no per-token click-target: LITE-015 makes
#              any `F` token in a file hunk a reference the pager's own door
#              resolves.  What ports is the rest of that test, which is the part
#              that matters — the colour hunk carries tok32 spans over the
#              VERBATIM source bytes, and nothing is inserted into them.
#
# Standalone: `sh lite/test/cat/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/cat
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "cat: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "cat: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "cat: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "cat: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-cat.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "cat: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "cat: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — be/test/cat/rev's own: c1 seeds a.txt, c2 ADDS gone.c, c3 bumps
# a.txt (so c2 is HISTORIC), then gone.c is removed from the checkout.
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'INSIDE-A\n' > a.txt
  git add -A && git commit -q -m 'c1 base' || exit 1
  printf 'int main(){return 0;} /* GONE-MARKER */\n' > gone.c
  git add -A && git commit -q -m 'c2 add gone.c' || exit 1
  printf 'INSIDE-A\nMORE\n' > a.txt
  printf 'DEEP\n' > sub/deep.txt
  git add -A && git commit -q -m 'c3 bump a.txt' || exit 1
  git rm -q gone.c && git commit -q -m 'c4 drop gone.c' || exit 1
) || { echo "cat: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
C2=$(g rev-parse HEAD~2)
C2SHORT=$(printf '%s' "$C2" | cut -c1-8)
[ -e "$REPO/gone.c" ] && { echo "cat: gone.c still in the checkout" >&2; exit 2; }

# ==========================================================================
# leg 1 — the `?<rev>` form (be/test/cat/rev)
# ==========================================================================
# (a) the blob AT c2, though absent from the wt AND from the tip tree.
rtin "$REPO" cat "gone.c?$C2" > "$WORK/rev.out" 2>"$WORK/rev.err"; RC=$?
if [ "$RC" = 0 ] && grep -q 'GONE-MARKER' "$WORK/rev.out"
then ok "cat <path>?<rev> emits the rev'd blob of a file gone from the checkout"
else bad "(a) cat gone.c?c2 (rc $RC)" "$WORK/rev.out" "$WORK/rev.err"; fi

# (a2) --plain is the same bytes, and they are git's own.
rtin "$REPO" cat --plain "gone.c?$C2" > "$WORK/rev.plain" 2>&1
g cat-file blob "$C2:gone.c" > "$WORK/rev.oracle"
if cmp -s "$WORK/rev.oracle" "$WORK/rev.plain"
then ok "--plain <path>?<rev> is git cat-file's bytes, verbatim"
else bad "(a2) plain rev bytes" "$WORK/rev.oracle" "$WORK/rev.plain"; fi

# (a3) a SHORT hexlet and a BRANCH name are revs too.
rtin "$REPO" cat "gone.c?$C2SHORT" > "$WORK/rev.short" 2>&1
if cmp -s "$WORK/rev.out" "$WORK/rev.short"
then ok "a short rev hexlet names the same blob"
else bad "(a3) short rev" "$WORK/rev.short"; fi
rtin "$REPO" cat "a.txt?master" > "$WORK/rev.br" 2>&1
g cat-file blob "master:a.txt" > "$WORK/rev.bro"
if cmp -s "$WORK/rev.bro" "$WORK/rev.br"
then ok "a BRANCH name resolves as a rev"
else bad "(a3) branch rev" "$WORK/rev.bro" "$WORK/rev.br"; fi

# (b) a path ABSENT at that rev must fail LOUD — never silent-empty.
rtin "$REPO" cat "nope.c?$C2" > "$WORK/absent.out" 2>"$WORK/absent.err"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/absent.out" ] && grep -q 'there is no nope.c at' "$WORK/absent.err"
then ok "a path absent AT THAT REV fails loud, in plain words"
else bad "(b) absent-at-rev (rc $RC)" "$WORK/absent.out" "$WORK/absent.err"; fi
# ...and so does a DIRECTORY at that rev, and an unknown rev.
rtin "$REPO" cat "sub?master" > "$WORK/dir.out" 2>"$WORK/dir.err"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/dir.out" ] && grep -q 'is a directory' "$WORK/dir.err"
then ok "a directory at a rev is refused in plain words"
else bad "(b2) dir-at-rev (rc $RC)" "$WORK/dir.out" "$WORK/dir.err"; fi
rtin "$REPO" cat "a.txt?deadbeefdead" > "$WORK/norev.out" 2>"$WORK/norev.err"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/norev.out" ] && grep -q 'no commit' "$WORK/norev.err"
then ok "an unknown rev is refused in plain words"
else bad "(b3) unknown rev (rc $RC)" "$WORK/norev.out" "$WORK/norev.err"; fi

# (c) the plain-wt form is unchanged, and it is `cat(1)` byte for byte.
rtin "$REPO" cat a.txt > "$WORK/wt.out" 2>"$WORK/wt.err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$REPO/a.txt" "$WORK/wt.out"
then ok "JAB-020: a bare path is the worktree file's OWN bytes, verbatim"
else bad "(c) wt cat (rc $RC)" "$REPO/a.txt" "$WORK/wt.out" "$WORK/wt.err"; fi

# An UNCOMMITTED edit shows — cat reads the worktree, and it is no diff.
printf 'DIRTY\n' >> "$REPO/a.txt"
rtin "$REPO" cat a.txt > "$WORK/dirty.out" 2>&1
if cmp -s "$REPO/a.txt" "$WORK/dirty.out" && grep -q 'DIRTY' "$WORK/dirty.out" &&
   ! grep -q '^[+-]' "$WORK/dirty.out"
then ok "an uncommitted edit shows, and no diff marker does"
else bad "dirty wt cat" "$WORK/dirty.out"; fi
g checkout -q -- a.txt

# From a SUBDIRECTORY the arg resolves against the cwd, like log and diff.
rtin "$REPO/sub" cat deep.txt > "$WORK/sub.out" 2>"$WORK/sub.err"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$REPO/sub/deep.txt" "$WORK/sub.out"
then ok "from a subdirectory the path resolves against the cwd"
else bad "subdir cat (rc $RC)" "$WORK/sub.out" "$WORK/sub.err"; fi

# The refusals of the bare form.
rtin "$REPO" cat nope.txt > "$WORK/n.out" 2>"$WORK/n.err"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/n.out" ] && grep -q 'there is no nope.txt in the worktree' "$WORK/n.err"
then ok "an absent worktree file is refused in plain words"
else bad "absent wt file (rc $RC)" "$WORK/n.out" "$WORK/n.err"; fi
rtin "$REPO" cat > "$WORK/n0.out" 2>"$WORK/n0.err"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/n0.out" ] && grep -q 'needs a path' "$WORK/n0.err"
then ok "a bare 'lite cat' asks for a path"
else bad "bare cat (rc $RC)" "$WORK/n0.out" "$WORK/n0.err"; fi

# ==========================================================================
# leg 2 — the ESCAPE (be/test/cat/nav-escape)
# ==========================================================================
# A SIBLING tree beside the repo, holding a distinctive secret.
OUT="$WORK/outside"; mkdir -p "$OUT"
printf 'SECRET-OUTSIDE\n' > "$OUT/secret.txt"

# (0) sanity: an in-tree path renders its own bytes.
rtin "$REPO" cat a.txt > "$WORK/e0" 2>&1
if grep -q 'INSIDE-A' "$WORK/e0"
then ok "sanity: an in-tree path renders the file"
else bad "(0) in-tree cat" "$WORK/e0"; fi

# (a) the `..` climb must be REFUSED and must not read the outside file.
for _arg in "../outside/secret.txt" "sub/../../outside/secret.txt" "$OUT/secret.txt"; do
    rtin "$REPO" cat "$_arg" > "$WORK/esc.out" 2>"$WORK/esc.err"; RC=$?
    if [ "$RC" != 0 ] && ! grep -q 'SECRET-OUTSIDE' "$WORK/esc.out" "$WORK/esc.err" &&
       grep -q 'is outside' "$WORK/esc.err"
    then ok "BE-011: '$_arg' is refused, and reads nothing outside"
    else bad "(a) escape via '$_arg' (rc $RC)" "$WORK/esc.out" "$WORK/esc.err"; fi
done
# ...and the `?<rev>` form cannot be used to smuggle one either.
rtin "$REPO" cat "../outside/secret.txt?master" > "$WORK/esc2.out" 2>"$WORK/esc2.err"; RC=$?
if [ "$RC" != 0 ] && ! grep -q 'SECRET-OUTSIDE' "$WORK/esc2.out" "$WORK/esc2.err"
then ok "the ?<rev> form escapes no better"
else bad "(a2) rev escape (rc $RC)" "$WORK/esc2.out" "$WORK/esc2.err"; fi
# The bare `lite <path>` pager is a FILESYSTEM view and still opens it — the
# confinement is `cat`'s, and it is not a regression of the pager.
rtin "$REPO" --plain "$OUT/secret.txt" > "$WORK/pag.out" 2>&1
if grep -q 'SECRET-OUTSIDE' "$WORK/pag.out"
then ok "the bare path pager is unconfined, as it always was"
else bad "pager regression" "$WORK/pag.out"; fi

# ==========================================================================
# leg 3 — the hunk (be/test/cat/links, minus its grep-U half)
# ==========================================================================
ln -sf "$LITE" "$WORK/jsrc"
( cd "$LITE" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_REV="$C2" \
  "$RT" --eval "require('$CASE/hunk.js')" ) > "$WORK/h.out" 2>"$WORK/h.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/h.out" && ! grep -q '^FAIL' "$WORK/h.out"; then
    N=$(grep -c '^ok' "$WORK/h.out"); CHECKS=$((CHECKS + N))
    ok "hunk leg: $N checks (spans over the verbatim source, no inserted bytes)"
else
    cat "$WORK/h.out"; head -5 "$WORK/h.err"
    bad "hunk leg (rc $RC)" "$WORK/h.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/cat] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/cat] $CHECKS checks, runtime $RT"
exit 0
