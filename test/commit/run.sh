#!/bin/sh
# lite/test/commit/run.sh — LITE-009: the `lite commit <hex>` suite.
# Three legs over the LANDED lite tree (main.js, index/commit.js):
#   bytes  — this script: the ACCEPTANCE test, `lite commit <sha>` byte-equal to
#            `commit <sha40>\n` + `git cat-file commit <sha>`, over a root, a
#            merge, a folded-header (gpgsig + encoding) commit and an UNINDEXED
#            dangling one; plus the hexlet/bare/piped forms and the refusals.
#   color  — color.js: the hunk + its tok32 spans, the be-commit palette, the
#            per-newline anti-bleed span, a painted row back to its plain line.
#   pty    — pty.js: the REAL UI path on a tty.openpty() slave through the
#            shipped Pager — banner band, coloured header rows, status bar.
#
# Standalone: `sh lite/test/commit/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`; a quickjab built with
# -DJAB_JSRC=<this tree> -DQUICKJAB_JSRC_PACK=ON passes the same).  Fixtures
# live in a mktemp dir under ~/tmp and are removed on a green run (kept, with
# the path printed, when something fails).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/commit
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

# --- the runtime ----------------------------------------------------------
RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "commit: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "commit: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "commit: SKIP — no git to build a fixture" >&2; exit 0; }

# --- scratch --------------------------------------------------------------
TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "commit: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-commit.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "commit: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

# A commit view writes NOTHING, but openRepo still reads a HOME-less config
# path in be's own layout — run under a planted home like the index suite does.
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME

# --- the fixture repo -----------------------------------------------------
#   c0  a.txt=1  dir/b.txt=B1     (root, no parent header at all)
#   c1  a.txt=2                   (master)
#   c2  dir/b.txt=B2              (side, off c0)
#   c3  merge master+side         (TWO parent headers, in object order)
#   sig a hand-built commit object carrying a FOLDED gpgsig header + encoding,
#       written straight into the ODB: it is DANGLING (no ref, no index row),
#       which is the point — the commit view is pure ODB.
REPO="$WORK/repo"
mkdir -p "$REPO/dir"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf '1\n' > a.txt; printf 'B1\n' > dir/b.txt
  git add -A && cm "2020-01-01T00:00:00Z" c0 || exit 1
  printf '2\n' > a.txt
  git add -A && cm "2020-01-02T00:00:00Z" c1 || exit 1
  git checkout -q -b side HEAD~1
  printf 'B2\n' > dir/b.txt
  git add -A && cm "2020-01-03T00:00:00Z" c2 || exit 1
  git checkout -q master
  GIT_AUTHOR_DATE="2020-01-04T00:00:00Z" GIT_COMMITTER_DATE="2020-01-04T00:00:00Z" \
      git merge -q --no-ff -m 'c3 merge

a merge body line' side || exit 1
) || { echo "commit: cannot build the fixture repo" >&2; exit 2; }

g() { git -C "$REPO" "$@"; }
C0=$(g rev-parse master~1^)
C3=$(g rev-parse master)
TREE=$(g rev-parse 'master^{tree}')

# The folded-header commit.  No gpg key is involved: the object is written
# VERBATIM, which is the only way to pin RFC-822 continuation folding (a
# continuation line begins with a space, and one of them is a bare space).
{
  printf 'tree %s\n' "$TREE"
  printf 'parent %s\n' "$C3"
  printf 'author T <t@t> 1578182400 +0000\n'
  printf 'committer T <t@t> 1578182400 +0000\n'
  printf 'gpgsig -----BEGIN PGP SIGNATURE-----\n'
  printf ' \n'
  printf ' iQEcBAABCgAGBQJmockAAoJEMOCKMOCKMOCmockmockmockmock\n'
  printf ' AAAAmockmockmock==\n'
  printf ' =abcd\n'
  printf ' -----END PGP SIGNATURE-----\n'
  printf 'encoding ISO-8859-1\n'
  printf '\n'
  printf 'c7 signed subject\n\nbody line one\nbody line two\n'
} | g hash-object -t commit -w --stdin > "$WORK/sig" || {
    echo "commit: cannot write the folded-header object" >&2; exit 2; }
SIG=$(cat "$WORK/sig")

echo "commit: runtime $RT, repo $REPO"

# The verb climbs to the repo from the CWD, so the legs run INSIDE it; the
# $WORK/jsrc plant keeps an unpacked runtime's require climb satisfied.
ln -sf "$LITE" "$WORK/jsrc"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# ==========================================================================
# leg 1 — THE ACCEPTANCE TEST: the bytes are the object's own
# ==========================================================================
# B1..B3: the root, the merge and the folded-header commit.  The METADATA — the
# bytes before the first `hunk ` banner — is byte-equal to `commit <sha40>\n` +
# `git cat-file commit <sha>`; the commit's own diff hunks follow it.
for pair in "root:$C0" "merge:$C3" "folded:$SIG"; do
    WHAT=${pair%%:*}; SHA=${pair#*:}
    { printf 'commit %s\n' "$SHA"; g cat-file commit "$SHA"; } > "$WORK/w.$WHAT"
    rtin "$REPO" commit "$SHA" > "$WORK/all.$WHAT" 2>"$WORK/e.$WHAT"; RC=$?
    # the metadata prefix: everything up to the first hunk banner
    sed -n '1,/^hunk /p' "$WORK/all.$WHAT" | sed '$ { /^hunk /d; }' > "$WORK/g.$WHAT"
    if [ "$RC" = 0 ] && cmp -s "$WORK/w.$WHAT" "$WORK/g.$WHAT"
    then ok "commit <sha> = 'commit <sha40>' + git cat-file commit ($WHAT)"
    else bad "commit <sha> = git cat-file commit ($WHAT, rc $RC)" \
             "$WORK/w.$WHAT" "$WORK/g.$WHAT" "$WORK/e.$WHAT"; fi
done

# B4: the merge's TWO parent headers are there, in the object's own order, and
# the folded value's continuation lines survive verbatim (headers git's own
# parser would drop or reorder).
P1=$(g rev-parse 'master^1'); P2=$(g rev-parse 'master^2')
if [ "$(sed -n '3p' "$WORK/g.merge")" = "parent $P1" ] &&
   [ "$(sed -n '4p' "$WORK/g.merge")" = "parent $P2" ] &&
   grep -q '^ -----END PGP SIGNATURE-----$' "$WORK/g.folded" &&
   grep -q '^encoding ISO-8859-1$' "$WORK/g.folded"
then ok "ordered headers survive: two parents, a folded gpgsig, an encoding"
else bad "ordered headers survive" "$WORK/g.merge" "$WORK/g.folded"; fi

# B5: a 6..40 hexlet is the same object name a full sha is.
rtin "$REPO" commit "$(echo "$SIG" | cut -c1-8)" > "$WORK/g.hexlet" 2>"$WORK/e.hexlet"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/all.folded" "$WORK/g.hexlet"
then ok "an 8-char hexlet resolves to the same commit, byte for byte"
else bad "an 8-char hexlet resolves the same (rc $RC)" "$WORK/g.hexlet" "$WORK/e.hexlet"; fi

# B6: bare `commit` = the checked-out tip.
rtin "$REPO" commit > "$WORK/g.bare" 2>"$WORK/e.bare"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/all.merge" "$WORK/g.bare"
then ok "bare commit = the checked-out tip"
else bad "bare commit = the checked-out tip (rc $RC)" "$WORK/g.bare" "$WORK/e.bare"; fi

# B7: `--plain` after the verb is byte-identical to the piped dump.
rtin "$REPO" commit --plain "$C3" > "$WORK/g.plain" 2>"$WORK/e.plain"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/all.merge" "$WORK/g.plain"
then ok "commit --plain = the piped bytes, byte for byte"
else bad "commit --plain = the piped bytes (rc $RC)" "$WORK/g.plain" "$WORK/e.plain"; fi

# B8: PURE ODB — the folded commit is dangling and no index was ever built, so
# the whole run must leave `.git/be` absent and the tracks list unwritten.
if [ ! -e "$REPO/.git/be" ] && [ ! -e "$FAKEHOME/.config/be/tracks" ]
then ok "a commit view reads the ODB only: no .git/be, no tracks line"
else bad "a commit view reads the ODB only" ; fi

# B9: the refusals, in plain words, with nothing on stdout.
rtin "$REPO" commit "$TREE" > "$WORK/g.tree" 2>"$WORK/e.tree"; RC1=$?
rtin "$REPO" commit deadbeefdead > "$WORK/g.unk" 2>"$WORK/e.unk"; RC2=$?
rtin "$REPO" commit nosuchthing > "$WORK/g.nh" 2>"$WORK/e.nh"; RC3=$?
if [ "$RC1" != 0 ] && [ ! -s "$WORK/g.tree" ] &&
   grep -q 'no commit in this repository is named' "$WORK/e.tree" &&
   [ "$RC2" != 0 ] && [ ! -s "$WORK/g.unk" ] &&
   grep -q 'no commit in this repository is named' "$WORK/e.unk" &&
   [ "$RC3" != 0 ] && [ ! -s "$WORK/g.nh" ] &&
   grep -q 'is not a commit name' "$WORK/e.nh"
then ok "a tree sha, an unknown hexlet and a non-hex arg are refused in plain words"
else bad "the refusals (rc $RC1/$RC2/$RC3)" "$WORK/e.tree" "$WORK/e.unk" "$WORK/e.nh"; fi

# ==========================================================================
# leg 2 — the COLOUR pieces (headless: hunk + tok32 spans + the paint)
# ==========================================================================
( cd "$LITE" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_SHA="$C3" LITE_SIG="$SIG" \
  "$RT" --eval "require('$CASE/color.js')" ) > "$WORK/c.out" 2>"$WORK/c.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/c.out" && ! grep -q '^FAIL' "$WORK/c.out"; then
    N=$(grep -c '^ok' "$WORK/c.out"); CHECKS=$((CHECKS + N))
    ok "colour leg: $N checks (hunk + tok32 spans + the be-commit palette)"
else
    cat "$WORK/c.out"; head -5 "$WORK/c.err"
    bad "colour leg (rc $RC)" "$WORK/c.out"
fi

# ==========================================================================
# leg 3 — the REAL UI path on a pty.  Skip-guarded on the tty binding.
# ==========================================================================
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$( ( cd "$LITE" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/ttyprobe.js')" ) 2>/dev/null || echo err)
if [ "$HAS" != "yes" ]; then
    echo "commit: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    ( cd "$LITE" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_SHA="$C3" \
      "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/p.out" && ! grep -q '^FAIL' "$WORK/p.out"; then
        N=$(grep -c '^ok' "$WORK/p.out"); CHECKS=$((CHECKS + N))
        ok "pty leg: $N checks (banner band / painted header rows / status bar)"
    else
        cat "$WORK/p.out"; head -5 "$WORK/p.err"
        bad "pty leg (rc $RC)" "$WORK/p.out"
    fi
fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/commit] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/commit] $CHECKS checks, runtime $RT"
exit 0
