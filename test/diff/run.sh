#!/bin/sh
# lite/test/diff/run.sh — LITE-010: the `lite diff` suite.
# Three legs over the landed lite tree (main.js, view/diff.js, render/*):
#   verb   — this script: the CLI contract over a fixture git repo — the three
#            forms (bare / <path> / <hex>), add / modify / delete / binary /
#            empty-file / symlink, the SET and the per-file +/- counts against
#            `git diff --numstat`, `--plain` byte-parity, and the claim that a
#            diff writes NO index at all.
#   color  — color.js: the diff wash (tok32 sides -> the 157/217 backgrounds),
#            the lite hunk shape, the plain-render channel.
#   pty    — pty.js: the same hunks on a real pty through the shipped Pager.
#
# Standalone: `sh lite/test/diff/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`).  Fixtures live in a mktemp dir
# under ~/tmp, removed on a green run (kept, with the path printed, on a red).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/diff
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

# --- the runtime ----------------------------------------------------------
RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "diff: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "diff: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "diff: SKIP — no git to build a fixture" >&2; exit 0; }

# --- scratch --------------------------------------------------------------
TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "diff: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-diff.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "diff: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
#  BEE-005: the eval legs run from $WORK, whose `jsrc` plant is the require
#  climb's first hit — from $LITE the climb walks past it to a foreign one.
rt()   { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" "$@" ); }
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
ln -sf "$LITE" "$WORK/jsrc"

# --- the fixture repo -----------------------------------------------------
#   c0  a.txt (4 lines), dir/b.txt, gone.txt, bin.dat (NUL), empty.txt (0 B),
#       link.txt -> a.txt
#   c1  a.txt edited, gone.txt deleted, added.txt added, bin.dat changed,
#       empty.txt filled, full.txt added then emptied in c2
#   c2  full.txt emptied
REPO="$WORK/repo"
mkdir -p "$REPO/dir"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf 'one\ntwo\nthree\nfour\n' > a.txt
  printf 'B1\n' > dir/b.txt
  printf 'keep\n' > gone.txt
  printf '\000\001\002binary\n' > bin.dat
  : > empty.txt
  ln -s a.txt link.txt
  git add -A && cm "2020-01-01T00:00:00Z" c0 || exit 1
  printf 'one\n2\nthree\nfour\nfive\n' > a.txt
  rm gone.txt
  printf 'new file\n' > added.txt
  printf '\000\001\002BINARY\n' > bin.dat
  printf 'now has content\n' > empty.txt
  printf 'x\ny\n' > full.txt
  git add -A && cm "2020-01-02T00:00:00Z" c1 || exit 1
  : > full.txt
  git add -A && cm "2020-01-03T00:00:00Z" c2 || exit 1
) || { echo "diff: cannot build the fixture repo" >&2; exit 2; }

g() { git -C "$REPO" "$@"; }
C1=$(g rev-parse master~1)
C2=$(g rev-parse master)
echo "diff: runtime $RT, repo $REPO"

# The two comparators: git's numstat and lite's plain output, both folded to
# "<path> <ins> <rms>" per file, sorted.  Renames are off — lite has no rename
# detection (it is a from/to tree pair, like be's own diff).
gitstat() { g diff --numstat --no-renames "$@" | awk -F'\t' '{print $3" "$1" "$2}' | sort; }
litestat() {
  awk '
    /^hunk / { p = substr($0, 6); sub(/#L[0-9]+$/, "", p);
               if (!(p in seen)) { seen[p]=1; order[++n]=p } cur=p; next }
    /^--- a\// || /^\+\+\+ b\// || /^@@ / { next }
    /: binary files differ$/ { bin[cur]=1; next }
    /^\+/ { ins[cur]++; next }
    /^-/  { rms[cur]++; next }
    { next }
    END { for (i=1;i<=n;i++) { p=order[i];
            if (p in bin) print p" - -"; else print p" "(ins[p]+0)" "(rms[p]+0) } }' "$1" | sort
}

# ==========================================================================
# leg 1 — the CLI contract
# ==========================================================================
# D1: `diff <hex>` = that commit against its FIRST parent: the same file SET
# and the same per-file +/- counts git reports (binary counted as git's "-").
rtin "$REPO" diff "$C1" --plain > "$WORK/d1" 2>"$WORK/d1e"; RC=$?
gitstat "$C1^" "$C1" | sed 's/^bin.dat.*/bin.dat - -/' > "$WORK/d1g"
litestat "$WORK/d1" > "$WORK/d1l"
if [ "$RC" = 0 ] && cmp -s "$WORK/d1g" "$WORK/d1l"
then ok "diff <hex> = git diff <hex>^ <hex>: same files, same +/- counts"
else bad "diff <hex> vs git (rc $RC)" "$WORK/d1g" "$WORK/d1l" "$WORK/d1e"; fi

# D1b: the four cases are all there — a modify, an add, a delete, a binary.
if grep -q '^hunk a.txt#L' "$WORK/d1" && grep -q '^+2$' "$WORK/d1" &&
   grep -q '^-two$' "$WORK/d1" && grep -q '^+new file$' "$WORK/d1" &&
   grep -q '^-keep$' "$WORK/d1" && grep -q 'bin.dat: binary files differ' "$WORK/d1"
then ok "modify / add / delete / binary all render (add and delete included)"
else bad "the four cases render" "$WORK/d1"; fi

# D1c: the EMPTY-file legs.  empty->content is the collapsing pair be folds in
# the other order (an empty FROM carries no token to anchor on); content->empty
# is the ordinary delete-shaped fold.
if grep -q '^+now has content$' "$WORK/d1"
then ok "an empty file filled = an addition (the inverted fold)"
else bad "empty -> content" "$WORK/d1"; fi
rtin "$REPO" diff "$C2" --plain > "$WORK/d2" 2>"$WORK/d2e"; RC=$?
gitstat "$C2^" "$C2" > "$WORK/d2g"; litestat "$WORK/d2" > "$WORK/d2l"
if [ "$RC" = 0 ] && cmp -s "$WORK/d2g" "$WORK/d2l" && grep -q '^-x$' "$WORK/d2"
then ok "a file emptied = a full deletion, counts match git"
else bad "content -> empty (rc $RC)" "$WORK/d2g" "$WORK/d2l" "$WORK/d2"; fi

# D2: the BARE form = the worktree against HEAD, over the TRACKED paths.
printf 'one\n2\nTHREE\nfour\nfive\n' > "$REPO/a.txt"
printf 'B2\n' > "$REPO/dir/b.txt"
rm "$REPO/added.txt"
printf 'untracked\n' > "$REPO/untracked.txt"
rtin "$REPO" diff --plain > "$WORK/d3" 2>"$WORK/d3e"; RC=$?
gitstat HEAD > "$WORK/d3g"; litestat "$WORK/d3" > "$WORK/d3l"
if [ "$RC" = 0 ] && cmp -s "$WORK/d3g" "$WORK/d3l"
then ok "bare diff = git diff HEAD (edited + deleted tracked files)"
else bad "bare diff vs git diff HEAD (rc $RC)" "$WORK/d3g" "$WORK/d3l" "$WORK/d3e"; fi

# D2b: an UNTRACKED file is not a change — `git diff HEAD` says nothing either.
if ! grep -q 'untracked.txt' "$WORK/d3"
then ok "an untracked file is not in the diff"
else bad "an untracked file is not in the diff" "$WORK/d3"; fi

# D3: a `<path>` arg scopes to that path — a FILE gets the whole-file view
# (every line, changed or not), a DIR gets its subtree only.
rtin "$REPO" diff a.txt --plain > "$WORK/d4" 2>"$WORK/d4e"; RC=$?
if [ "$RC" = 0 ] && [ "$(grep -c '^hunk ' "$WORK/d4")" = "1" ] &&
   grep -q '^hunk a.txt#L' "$WORK/d4" && grep -q '^ one$' "$WORK/d4" &&
   grep -q '^+THREE$' "$WORK/d4" && grep -q '^-three$' "$WORK/d4"
then ok "diff <file> = that file alone, whole-file view"
else bad "diff <file> (rc $RC)" "$WORK/d4" "$WORK/d4e"; fi

rtin "$REPO" diff dir --plain > "$WORK/d5" 2>"$WORK/d5e"; RC=$?
if [ "$RC" = 0 ] && [ "$(grep -c '^hunk ' "$WORK/d5")" = "1" ] &&
   grep -q '^hunk dir/b.txt#L' "$WORK/d5"
then ok "diff <dir> = that subtree alone"
else bad "diff <dir> (rc $RC)" "$WORK/d5" "$WORK/d5e"; fi

# D3b: a path is root-relative from any subdirectory, as `log`'s is.
rtin "$REPO/dir" diff b.txt --plain > "$WORK/d6" 2>&1
if grep -q '^hunk dir/b.txt#L' "$WORK/d6"
then ok "a path resolves against the worktree root from a subdir"
else bad "a subdir path" "$WORK/d6"; fi

# D4: a clean path says NOTHING at all (and exits 0).
rtin "$REPO" diff empty.txt --plain > "$WORK/d7" 2>"$WORK/d7e"; RC=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/d7" ]
then ok "an unchanged path prints nothing"
else bad "an unchanged path prints nothing (rc $RC)" "$WORK/d7" "$WORK/d7e"; fi

# D5: `--plain` after the verb is byte-identical to the piped dump (every test
# and every `| grep` rides that path).
rtin "$REPO" diff > "$WORK/d8" 2>"$WORK/d8e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/d3" "$WORK/d8"
then ok "piped output = --plain output, byte for byte"
else bad "piped = --plain (rc $RC)" "$WORK/d3" "$WORK/d8" "$WORK/d8e"; fi

# D6: a SYMLINK is diffed as its target STRING (never followed): repoint it and
# the change is the link text, not the file's bytes.
ln -sf dir/b.txt "$REPO/link.txt"
rtin "$REPO" diff link.txt --plain > "$WORK/d9" 2>&1
if grep -q '^+dir/b.txt$' "$WORK/d9" && grep -q '^-a.txt$' "$WORK/d9" &&
   ! grep -q '^+one$' "$WORK/d9"
then ok "a symlink diffs as its target string, never followed"
else bad "symlink diff" "$WORK/d9"; fi
ln -sf a.txt "$REPO/link.txt"

# D7: the WORKTREE form is its own floor (the wt sits directly on HEAD), so it
# folds the blob pair and reads NO index at all — a repo whose `.git/be` was
# never built diffs without building one, and answers the same bytes.  The
# forms that SPAN history (`diff <hex>`, `diff <hexA> <hexB>`) do weave, and
# leg F pins their bring-up.
rm -rf "$REPO/.git/be"
rtin "$REPO" diff --plain > "$WORK/da" 2>"$WORK/dae"; RC=$?
if [ "$RC" = 0 ] && [ ! -d "$REPO/.git/be" ] && cmp -s "$WORK/d3" "$WORK/da"
then ok "a worktree diff builds no index and answers the same (BEE-005)"
else bad "the wt diff opens no index (rc $RC)" "$WORK/da" "$WORK/dae"; fi
if [ ! -f "$FAKEHOME/.config/bee/repos" ]
then ok "a diff writes no registry line"
else bad "a diff writes no registry line" "$FAKEHOME/.config/bee/repos"; fi

# D8: a path that is no repository is refused in plain words.
mkdir -p "$WORK/norepo"
rtin "$WORK/norepo" diff > "$WORK/db" 2>"$WORK/dbe"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/db" ] && grep -qi 'repositor' "$WORK/dbe"
then ok "a non-repository is refused in plain words"
else bad "a non-repository is refused (rc $RC)" "$WORK/db" "$WORK/dbe"; fi

# D9: a `<hex>` that names no commit is refused in plain words too.
rtin "$REPO" diff deadbeefdeadbeef > "$WORK/dc" 2>"$WORK/dce"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/dc" ] && grep -q 'no commit' "$WORK/dce"
then ok "an unknown <hex> is refused in plain words"
else bad "an unknown <hex> is refused (rc $RC)" "$WORK/dc" "$WORK/dce"; fi

# ==========================================================================
# leg 2 — the wash (headless)
# ==========================================================================
LITE_FIX="$REPO" LITE_HEX="$C1" rt --eval "require('$CASE/color.js')" > "$WORK/c.out" 2>"$WORK/c.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/c.out" && ! grep -q '^FAIL' "$WORK/c.out"; then
    N=$(grep -c '^ok' "$WORK/c.out"); CHECKS=$((CHECKS + N))
    ok "colour leg: $N checks (hunk shape / tok sides / the 157-217 wash)"
else
    cat "$WORK/c.out"; head -5 "$WORK/c.err"
    bad "colour leg (rc $RC)" "$WORK/c.out"
fi

# ==========================================================================
# leg 3 — the real UI path (a pty), skip-guarded on the tty binding
# ==========================================================================
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$(rt --eval "require('$WORK/ttyprobe.js')" 2>/dev/null || echo err)
if [ "$HAS" != "yes" ]; then
    echo "diff: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    LITE_FIX="$REPO" rt --eval "require('$CASE/pty.js')" > "$WORK/t.out" 2>"$WORK/t.err"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/t.out" && ! grep -q '^FAIL' "$WORK/t.out"; then
        N=$(grep -c '^ok' "$WORK/t.out"); CHECKS=$((CHECKS + N))
        ok "pty leg: $N checks (banner band / washed rows / status bar)"
    else
        cat "$WORK/t.out"; head -5 "$WORK/t.err"
        bad "pty leg (rc $RC)" "$WORK/t.out"
    fi
fi

# ==========================================================================
# leg 4 — BEE-005: the FORK, where a blob pair and a weave part company
# ==========================================================================
#   c0  f.txt = one two three four     the base (the LCA of c1 and c2)
#   c1  line 2 -> TWO                  master, the merge's FIRST parent
#   c2  line 3 -> THREE                the side branch
#   c3  merge(c1, c2)                  one TWO THREE four
FORK="$WORK/fork"
mkdir -p "$FORK"
(
  cd "$FORK" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf 'one\ntwo\nthree\nfour\n' > f.txt
  git add -A && cm "2020-02-01T00:00:00Z" c0 || exit 1
  printf 'one\nTWO\nthree\nfour\n' > f.txt
  git add -A && cm "2020-02-02T00:00:00Z" c1 || exit 1
  git checkout -q -b side master~1
  printf 'one\ntwo\nTHREE\nfour\n' > f.txt
  git add -A && cm "2020-02-03T00:00:00Z" c2 || exit 1
  git checkout -q master
  git merge -q --no-edit side > /dev/null 2>&1
  printf 'one\nTWO\nTHREE\nfour\n' > f.txt
  git add -A
  git commit -q --amend --no-edit > /dev/null 2>&1 ||
    GIT_AUTHOR_DATE="2020-02-04T00:00:00Z" git commit -q -m c3
) || { echo "diff: cannot build the fork fixture" >&2; exit 2; }
gf() { git -C "$FORK" "$@"; }
gfstat() { gf diff --numstat --no-renames "$@" | awk -F'\t' '{print $3" "$1" "$2}' | sort; }
F0=$(gf rev-parse master^1^); F1=$(gf rev-parse master^1); F2=$(gf rev-parse master^2)
F3=$(gf rev-parse master)

# F1: the merge diff is what git says it is — the re-cut changes the SOURCE of
# the answer, not the answer.
rtin "$FORK" diff "$F3" --plain > "$WORK/f1" 2>"$WORK/f1e"; RC=$?
gfstat "$F1" "$F3" > "$WORK/f1g"; litestat "$WORK/f1" > "$WORK/f1l"
if [ "$RC" = 0 ] && cmp -s "$WORK/f1g" "$WORK/f1l"
then ok "a merge diff still equals git's, file for file and count for count"
else bad "merge vs first parent (rc $RC)" "$WORK/f1g" "$WORK/f1l" "$WORK/f1e"; fi

# F2: the TWO-TIP form — neither tip is an ancestor of the other, so the weave
# can only be rooted at their merge base.  It did not exist before BEE-005.
rtin "$FORK" diff "$F1 $F2" --plain > "$WORK/f2" 2>"$WORK/f2e"; RC=$?
gfstat "$F1" "$F2" > "$WORK/f2g"; litestat "$WORK/f2" > "$WORK/f2l"
if [ "$RC" = 0 ] && cmp -s "$WORK/f2g" "$WORK/f2l" && grep -q '^+THREE$' "$WORK/f2"
then ok "diff <hexA> <hexB> = the two tips, rooted at their merge base"
else bad "the two-tip form (rc $RC)" "$WORK/f2g" "$WORK/f2l" "$WORK/f2e"; fi

# F3: a tip UNREACHABLE from HEAD is indexed on demand and read back — the lazy
# contract, not a fallback (BEE-005 ruling 6).  The side branch's own commit is
# what `diff <hexA> <hexB>` had to bring up above.
rm -rf "$FORK/.git/be"
rtin "$FORK" diff "$F2" --plain > "$WORK/f3" 2>"$WORK/f3e"; RC=$?
if [ "$RC" = 0 ] && [ -d "$FORK/.git/be" ] && grep -q '^+THREE$' "$WORK/f3"
then ok "a commit off HEAD's branch indexes on demand and diffs"
else bad "the lazy tip (rc $RC)" "$WORK/f3" "$WORK/f3e"; fi
rtin "$FORK" diff "$F2" --plain > "$WORK/f4" 2>&1
if cmp -s "$WORK/f3" "$WORK/f4"
then ok "the second run over the same tip answers the same (the O(1) no-op)"
else bad "a re-run of the lazy tip" "$WORK/f3" "$WORK/f4"; fi

# F4: PROVENANCE — the repro proper.  A blob pair knows only ID_FROM/ID_TO; the
# weave names the commit that inserted each token.  `fork.pre` pins what today's
# (pre-BEE-005) blob-pair fold answered.
LITE_FIX="$FORK" BEE_C0="$F0" BEE_C1="$F1" BEE_C2="$F2" BEE_C3="$F3" \
  rt --eval "require('$CASE/fork.js')" > "$WORK/f5" 2>"$WORK/f5e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/f5" && ! grep -q '^FAIL' "$WORK/f5"; then
    N=$(grep -c '^ok' "$WORK/f5"); CHECKS=$((CHECKS + N))
    ok "fork leg: $N checks (the merge base, the two tips, the per-token blame)"
else
    cat "$WORK/f5"; head -5 "$WORK/f5e"
    bad "fork leg (rc $RC)" "$WORK/f5"
fi
if [ -f "$CASE/fork.pre" ] && ! cmp -s "$CASE/fork.pre" "$WORK/f5"
then ok "the answer differs from the pinned blob-pair one (fork.pre)"
else bad "the pinned blob-pair answer is unchanged" "$CASE/fork.pre" "$WORK/f5"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/diff] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/diff] $CHECKS checks, runtime $RT"
exit 0
