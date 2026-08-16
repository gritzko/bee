#!/bin/sh
# bee/test/worktree/run.sh — BEE-009: a LINKED WORKTREE is not a repo.
# [BEE-001] ruled that bee knows a repo BY ITS PATH and made `bee install`
# refuse a linked worktree — but `index()` registers on its own (`track()`), so
# a bare `bee` run inside a `git worktree` checkout listed THAT path too.  One
# repository then stood in the registry twice, every ordinary filename in a
# cross-repo reference resolved twice, `door.seatOf` answered the {rels}
# chooser, and `http.js:2Yp:7s1h` dropped it to plain painted text — no link at all.
#
# The fixture is that shape: a main worktree, a `git worktree add` checkout of
# it, and a third repo whose page names a file of the family.
#   leg 1  registration — `bee index` and a bare `bee` INSIDE the checkout
#          register the MAIN root, and say so; the lane is the main one's
#   leg 2  `install` still refuses in [BEE-001]'s words, naming the original
#   leg 3  the fan-out — a clean registry, then a LEGACY one carrying the
#          worktree line, which must heal at resolve time (fanout.js)
#
# Standalone: `sh bee/test/worktree/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/worktree
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "worktree: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "worktree: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "worktree: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "worktree: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-worktree.XXXXXX") || exit 2
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "worktree: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FH="$WORK/home"; mkdir -p "$FH"
REG="$FH/.config/bee/repos"
MAIN="$WORK/main"; WT="$WORK/wt"; OTHER="$WORK/other"
echo "worktree: runtime $RT, fixtures $WORK"

# --- the fixture: one repository in two checkouts, plus a reader ------------
mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
mkrepo "$MAIN"
( cd "$MAIN" && mkdir -p render && printf 'HTMLMARK\n' > render/html.js &&
  printf 'the main worktree\n' > README.mkd && git add -A &&
  git commit -q -m 'main seed' ) || exit 2
git -C "$MAIN" worktree add -q "$WT" -b wt >/dev/null 2>&1 ||
  { echo "worktree: SKIP — git worktree add failed" >&2; exit 0; }

mkrepo "$OTHER"
( cd "$OTHER" && printf 'it names render/html.js\n' > page.mkd &&
  git add -A && git commit -q -m 'other seed' ) || exit 2
( cd "$OTHER" && HOME="$FH" "$RT" install ) > "$WORK/i.other" 2>&1 ||
  { bad "install the reading repo" "$WORK/i.other"; exit 1; }

# ==========================================================================
# leg 1 — registration: the ORIGINAL, never the second path
# ==========================================================================
( cd "$WT" && HOME="$FH" "$RT" index ) > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && grep -q "^$MAIN\$" "$REG" && ! grep -q "^$WT\$" "$REG"
then ok "\`bee index\` inside a linked worktree registers the MAIN root"
else bad "index registers the main root (rc $RC)" "$WORK/l1" "$WORK/l1e" "$REG"; fi

if grep -q "registered $MAIN" "$WORK/l1"
then ok "...and the summary line says which repo it took"
else bad "the summary names the repo taken" "$WORK/l1"; fi

# The bare run is the OTHER door — `view/list.js` brings the index up with
# `track: true`, which is how the polluted registries were written.
( cd "$WT" && HOME="$FH" "$RT" ) > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(wc -l < "$REG")" = "2" ] && ! grep -q "^$WT\$" "$REG"
then ok "a bare \`bee\` run inside it adds no second line"
else bad "the bare run adds no line (rc $RC)" "$WORK/l2" "$WORK/l2e" "$REG"; fi

# The lane is the COMMON gitdir's, so the registered root is the indexed one.
if ls "$MAIN/.git/be" 2>/dev/null | grep -q '\.lite2\.idx$' &&
   [ ! -d "$MAIN/.git/worktrees/wt/be" ]
then ok "the lane is the main worktree's, not the checkout's"
else bad "the lane is the main worktree's" "$WORK/l1"; fi

# ==========================================================================
# leg 2 — `install` keeps BEE-001's refusal, and now names the original
# ==========================================================================
( cd "$WT" && HOME="$FH" "$RT" install ) > "$WORK/l3" 2>"$WORK/l3e"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/l3" ] && grep -q "worktree" "$WORK/l3e" &&
   grep -q "$MAIN" "$WORK/l3e" && ! grep -q "^$WT\$" "$REG"
then ok "install still refuses a linked worktree, naming the original"
else bad "install refuses and names the original (rc $RC)" "$WORK/l3" "$WORK/l3e" "$REG"; fi

# ==========================================================================
# leg 3 — the fan-out: one repository, one row
# ==========================================================================
fan() {   # fan <label> <cwd>
    ( cd "$2" && HOME="$FH" BEE_MAIN="$MAIN" BEE_WT="$WT" \
      "$RT" --eval "require('$CASE/fanout.js')" ) > "$WORK/f" 2>"$WORK/fe"
    _rc=$?
    sed 's/^/     /' "$WORK/f"
    _n=$(grep -c '^ok' "$WORK/f" 2>/dev/null || echo 0)
    if [ "$_rc" = 0 ] && grep -q '^PASS' "$WORK/f"
    then ok "$1: $_n checks"; CHECKS=$((CHECKS + _n - 1))
    else bad "$1 (rc $_rc)" "$WORK/fe"; fi
}
fan "a clean registry answers once" "$OTHER"

# The LEGACY registry: BOTH checkouts listed, as a pre-BEE-009 run left them.
# It is the USER's file, so nothing rewrites it — the fold heals it at RESOLVE
# time.  Unfixed, `render/html.js` answers twice here and reaches the chooser.
printf '%s\n%s\n%s\n' "$OTHER" "$MAIN" "$WT" > "$REG"
cp "$REG" "$WORK/reg.was"
fan "a legacy worktree line does not compete" "$OTHER"
fan "...and the reader inside the checkout stays in it" "$WT"
if cmp -s "$REG" "$WORK/reg.was"
then ok "the user's registry file is left exactly as it was"
else bad "the registry must not be rewritten" "$REG" "$WORK/reg.was"; fi

# ==========================================================================
if [ "$FAILED" = 0 ]; then
    echo "PASS [bee/worktree] $CHECKS checks, runtime $RT"
else
    echo "FAIL [bee/worktree] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
