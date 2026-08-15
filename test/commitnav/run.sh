#!/bin/sh
# lite/test/commitnav/run.sh — LITE-021: the commit view's hashes are LINKS.
# Three legs over the landed lite tree (view/commit.js, view/tree.js, door.js):
#   bytes — this script: `--plain` and the piped dump stay byte-identical to
#           `commit <sha40>` + `git cat-file commit <sha>` (the LITE-009
#           contract), because the `U` targets are pager-only paint; plus
#           `lite tree <raw-tree-sha>` on the CLI.
#   nav   — nav.js: the hidden targets per hash row (banner none, tree ->
#           `tree <sha>`, every parent -> `commit <sha>`), a merge's SEVERAL
#           parents, and the door opening each of them.
#   pty   — pty.js: the REAL UI path — Enter on the tree row opens the tree
#           listing, `-` backs out, a mouse click on a parent sha opens that
#           parent's commit page.
#
# Standalone: `sh lite/test/commitnav/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), which must be built from THIS
# tree.  Fixtures live in a mktemp dir under ~/tmp, removed on a green run
# (kept, with the path printed, on a red).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/commitnav
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "commitnav: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "commitnav: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "commitnav: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "commitnav: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-commitnav.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "commitnav: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME

# --- the fixture ----------------------------------------------------------
#   c0  a.txt, sub/x.txt     (the ROOT: no parent header at all)
#   c1  a.txt                (master)
#   c2  sub/x.txt            (side, off c0)
#   c3  the MERGE            (TWO parent headers, in object order)
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  printf 'A0\n' > a.txt; printf 'X0\n' > sub/x.txt
  git add -A && cm "2020-01-01T00:00:00Z" c0 || exit 1
  printf 'A1\n' > a.txt
  git add -A && cm "2020-01-02T00:00:00Z" c1 || exit 1
  git checkout -q -b side HEAD~1
  printf 'X1\n' > sub/x.txt
  git add -A && cm "2020-01-03T00:00:00Z" c2 || exit 1
  git checkout -q master
  GIT_AUTHOR_DATE="2020-01-04T00:00:00Z" GIT_COMMITTER_DATE="2020-01-04T00:00:00Z" \
      git merge -q --no-ff -m 'c3 merge' side || exit 1
) || { echo "commitnav: cannot build the fixture repo" >&2; exit 2; }

g() { git -C "$REPO" "$@"; }
C3=$(g rev-parse master)
C0=$(g rev-parse master~1^)
P1=$(g rev-parse 'master^1'); P2=$(g rev-parse 'master^2')
TREE=$(g rev-parse 'master^{tree}')
SUBTREE=$(g rev-parse 'master:sub')

ln -sf "$LITE" "$WORK/jsrc"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "commitnav: runtime $RT, repo $REPO"

# ==========================================================================
# leg 1 — the PLAIN bytes did not move (the U targets are pager-only paint)
# ==========================================================================
# N1: the metadata prefix of the piped dump is still `commit <sha40>` + the raw
# object, over the merge and the root alike.
for pair in "merge:$C3" "root:$C0"; do
    WHAT=${pair%%:*}; SHA=${pair#*:}
    { printf 'commit %s\n' "$SHA"; g cat-file commit "$SHA"; } > "$WORK/w.$WHAT"
    rtin "$REPO" commit "$SHA" > "$WORK/all.$WHAT" 2>"$WORK/e.$WHAT"; RC=$?
    sed -n '1,/^hunk /p' "$WORK/all.$WHAT" | sed '$ { /^hunk /d; }' > "$WORK/g.$WHAT"
    if [ "$RC" = 0 ] && cmp -s "$WORK/w.$WHAT" "$WORK/g.$WHAT"
    then ok "piped commit bytes unchanged: 'commit <sha40>' + cat-file ($WHAT)"
    else bad "piped commit bytes unchanged ($WHAT, rc $RC)" \
             "$WORK/w.$WHAT" "$WORK/g.$WHAT" "$WORK/e.$WHAT"; fi
done

# N2: `--plain` is the piped dump, to the byte.
rtin "$REPO" commit --plain "$C3" > "$WORK/g.plain" 2>"$WORK/e.plain"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/all.merge" "$WORK/g.plain"
then ok "commit --plain = the piped bytes, byte for byte"
else bad "commit --plain = the piped bytes (rc $RC)" "$WORK/g.plain" "$WORK/e.plain"; fi

# N3: no target byte LEAKED into plain — the `tree`/`parent` lines are the
# object's own 40-hex values and nothing else.
if [ "$(sed -n '2p' "$WORK/g.merge")" = "tree $TREE" ] &&
   [ "$(sed -n '3p' "$WORK/g.merge")" = "parent $P1" ] &&
   [ "$(sed -n '4p' "$WORK/g.merge")" = "parent $P2" ]
then ok "no click-target bytes leak into the plain tree/parent lines"
else bad "no click-target bytes leak into plain" "$WORK/g.merge"; fi

# N4: `lite tree <raw TREE sha>` lists that tree — the target a tree row's link
# hands the door, on the CLI.  Both the root tree and a SUBtree.
g ls-tree "$TREE" | awk '{ printf "%s %-6s %s\t%s%s\n", $1, $2, $3, $4, ($2 == "tree" ? "/" : "") }' > "$WORK/w.tree"
rtin "$REPO" tree --plain "$TREE" > "$WORK/g.tree" 2>"$WORK/e.tree"; RC=$?
g ls-tree "$SUBTREE" | awk '{ printf "%s %-6s %s\t%s%s\n", $1, $2, $3, $4, ($2 == "tree" ? "/" : "") }' > "$WORK/w.sub"
rtin "$REPO" tree --plain "$SUBTREE" > "$WORK/g.sub" 2>"$WORK/e.sub"; RC2=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/w.tree" "$WORK/g.tree" &&
   [ "$RC2" = 0 ] && cmp -s "$WORK/w.sub" "$WORK/g.sub"
then ok "lite tree accepts a raw TREE-object sha (root tree and a subtree)"
else bad "lite tree on a raw tree sha (rc $RC/$RC2)" "$WORK/w.tree" "$WORK/g.tree" \
         "$WORK/e.tree" "$WORK/e.sub"; fi

# ==========================================================================
# leg 2 — the targets themselves (headless)
# ==========================================================================
( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_SHA="$C3" LITE_ROOT="$C0" \
  LITE_TREE="$TREE" LITE_P1="$P1" LITE_P2="$P2" \
  "$RT" --eval "require('$CASE/nav.js')" ) > "$WORK/n.out" 2>"$WORK/n.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/n.out" && ! grep -q '^FAIL' "$WORK/n.out"; then
    N=$(grep -c '^ok' "$WORK/n.out"); CHECKS=$((CHECKS + N))
    ok "nav leg: $N checks (per-row targets, the merge's two parents, the door)"
else
    cat "$WORK/n.out"; head -5 "$WORK/n.err"
    bad "nav leg (rc $RC)" "$WORK/n.out"
fi

# ==========================================================================
# leg 3 — the REAL UI path on a pty.  Skip-guarded on the tty binding.
# ==========================================================================
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function" && typeof tty.raw === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$( ( cd "$REPO" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/ttyprobe.js')" ) 2>/dev/null || echo err)
if [ "$HAS" != "yes" ]; then
    echo "commitnav: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    ( cd "$REPO" && HOME="$FAKEHOME" LITE_SHA="$C3" LITE_TREE="$TREE" LITE_P1="$P1" \
      "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/p.out" && ! grep -q '^FAIL' "$WORK/p.out"; then
        N=$(grep -c '^ok' "$WORK/p.out"); CHECKS=$((CHECKS + N))
        ok "pty leg: $N checks (Enter to the tree, '-' back, a click to a parent)"
    else
        cat "$WORK/p.out"; head -5 "$WORK/p.err"
        bad "pty leg (rc $RC)" "$WORK/p.out"
    fi
fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/commitnav] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/commitnav] $CHECKS checks, runtime $RT"
exit 0
