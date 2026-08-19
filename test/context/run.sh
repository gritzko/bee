#!/bin/sh
# bee/test/context/run.sh — BEE-023: the `//name` repo axis of the CLI.  The
# call is TRIPARTITE, `bee [//context] verb args`: a FIRST word `//name` (no
# further slash) names the repo the run stands in, and a `//name/rel` word
# anywhere an arg is a path is a path INSIDE that repo.  What this pins:
#
#   * `name` resolves by the registry first, then `$SRC_ROOT/name`, else a
#     worded refusal on stderr and a non-zero exit;
#   * a `$SRC_ROOT` hit is a read-only mount — it is never registered;
#   * `//name/rel` reaches the fs leg AND the path-taking verbs, the fs hunk
#     keeping the `//name/rel` spelling in its URI;
#   * the slot is POSITIONAL and first: after a verb, `//name` is an ARG;
#   * a linked worktree is its own context (own HEAD, own dirty files) and
#     still shares the ORIGINAL's index;
#   * `bee //name` with no verb is the LITE-018 zero-arg story in that repo;
#   * with no `//` word anywhere, the run is what it always was.
#
# Standalone: `sh bee/test/context/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/context
BEE=$(cd "$CASE/../.." && pwd)                   # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "context: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "context: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "context: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "context: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-context.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "context: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FH="$WORK/home"; mkdir -p "$FH"
SRC="$WORK/src"; mkdir -p "$SRC"
OUTSIDE="$WORK/reg"; mkdir -p "$OUTSIDE"
NOWHERE="$WORK/nowhere"; mkdir -p "$NOWHERE"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
# Every run stands OUTSIDE the fixtures: only the `//name` word may name a repo.
bee()  { ( cd "$NOWHERE" && HOME="$FH" SRC_ROOT="$SRC" "$RT" "$@" ); }
beein() { D=$1; shift; ( cd "$D" && HOME="$FH" SRC_ROOT="$SRC" "$RT" "$@" ); }
ln -sf "$BEE" "$WORK/jsrc"
echo "context: runtime $RT, fixtures $WORK"

mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
REG="$OUTSIDE/regrepo"                           # registered, NOT under SRC_ROOT
mkrepo "$REG"
( cd "$REG" && mkdir -p sub && printf 'R0\n' > r.txt && printf 'S0\n' > sub/s.txt &&
  git add -A && GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'reg seed' ) || exit 2

LOOSE="$SRC/loose"                               # under SRC_ROOT, NOT registered
mkrepo "$LOOSE"
( cd "$LOOSE" && printf 'L0\n' > l.txt && git add -A &&
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'loose seed' ) || exit 2

MAIN="$SRC/main"; WT="$SRC/wt"                   # a worktree family, leg 6
mkrepo "$MAIN"
( cd "$MAIN" && printf 'M0\n' > m.txt && git add -A &&
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'main seed' ) || exit 2

REPOS="$FH/.config/bee/repos"
beein "$REG" install > "$WORK/i.reg" 2>&1 || { bad "install the registered repo" "$WORK/i.reg"; exit 1; }
beein "$MAIN" install > "$WORK/i.main" 2>&1 || { bad "install the main worktree" "$WORK/i.main"; exit 1; }
git -C "$MAIN" worktree add -q "$WT" -b wt >/dev/null 2>&1 ||
  { echo "context: SKIP — git worktree add failed" >&2; exit 0; }
( cd "$WT" && printf 'W0\n' > w.txt && git add -A &&
  GIT_AUTHOR_DATE='@1700100000 +0000' GIT_COMMITTER_DATE='@1700100000 +0000' \
    git commit -q -m 'wt commit' && printf 'DIRTY\n' >> w.txt ) || exit 2

# ==========================================================================
# leg 1 — the REGISTRY leg: a name off `~/.config/bee/repos`
# ==========================================================================
bee //regrepo log --plain > "$WORK/o1" 2>"$WORK/e1"; RC=$?
if [ "$RC" = 0 ] && grep -q 'reg seed' "$WORK/o1"
then ok "\`bee //regrepo log\` runs in the registered repo (rc $RC)"
else bad "the registry leg (rc $RC)" "$WORK/o1" "$WORK/e1"; fi

# The context IS standing there: a relative arg resolves against that root.
bee //regrepo cat sub/s.txt --plain > "$WORK/o2" 2>"$WORK/e2"; RC=$?
if [ "$RC" = 0 ] && grep -q '^S0$' "$WORK/o2"
then ok "...and a relative arg of the verb resolves inside it"
else bad "relative arg in a context (rc $RC)" "$WORK/o2" "$WORK/e2"; fi

# ...to the byte: the context is the same run as one made from inside the repo.
beein "$REG" list --plain > "$WORK/o3" 2>"$WORK/e3"
bee //regrepo list --plain > "$WORK/o4" 2>"$WORK/e4"
if cmp -s "$WORK/o3" "$WORK/o4"
then ok "...and \`bee //regrepo list\` is \`bee list\` there, byte for byte"
else bad "context list != in-repo list" "$WORK/o3" "$WORK/o4" "$WORK/e4"; fi

# ==========================================================================
# leg 2 — the $SRC_ROOT leg: a repo nobody registered
# ==========================================================================
if ! grep -q "^$LOOSE$" "$REPOS"
then ok "the fixture: \`loose\` is on no registry line"
else bad "loose is registered — the leg proves nothing" "$REPOS"; fi
bee //loose log --plain > "$WORK/o5" 2>"$WORK/e5"; RC=$?
if [ "$RC" = 0 ] && grep -q 'loose seed' "$WORK/o5"
then ok "\`bee //loose log\` finds it under \$SRC_ROOT"
else bad "the \$SRC_ROOT leg (rc $RC)" "$WORK/o5" "$WORK/e5"; fi

# A $SRC_ROOT hit is a READ-ONLY mount for the run: it is never registered.
if ! grep -q "^$LOOSE$" "$REPOS"
then ok "...and the hit did NOT register it (BEE-023:35)"
else bad "the \$SRC_ROOT hit was auto-registered" "$REPOS"; fi

# $SRC_ROOT is READ, not assumed: point it elsewhere and the name dies.
( cd "$NOWHERE" && HOME="$FH" SRC_ROOT="$WORK/elsewhere" "$RT" //loose log --plain ) \
    > "$WORK/o6" 2>"$WORK/e6"; RC=$?
if [ "$RC" != 0 ] && grep -q "no such repo (registry, $WORK/elsewhere)" "$WORK/e6"
then ok "...and \$SRC_ROOT is what the second leg reads (rc $RC)"
else bad "SRC_ROOT is not read (rc $RC)" "$WORK/o6" "$WORK/e6"; fi

# ==========================================================================
# leg 3 — a MISS is refused in words, and nothing is created
# ==========================================================================
for _name in nosuch bee-BEE-999; do
    bee "//$_name" log --plain > "$WORK/m1" 2>"$WORK/m1e"; RC=$?
    if [ "$RC" != 0 ] && [ ! -s "$WORK/m1" ] &&
       grep -q "^bee: //$_name: no such repo (registry, $SRC)$" "$WORK/m1e"
    then ok "//$_name is refused in words, non-zero, nothing on stdout"
    else bad "the refusal for //$_name (rc $RC)" "$WORK/m1" "$WORK/m1e"; fi
    [ -d "$SRC/$_name" ] && bad "//$_name was CREATED — that is BEE-026's verb" ||
      ok "...and no such directory was created"
done
bee //nosuch > "$WORK/m2" 2>"$WORK/m2e"; RC=$?
if [ "$RC" != 0 ] && grep -q '^bee: //nosuch: no such repo' "$WORK/m2e"
then ok "a bare \`bee //nosuch\` is refused too (rc $RC)"
else bad "the bare refusal (rc $RC)" "$WORK/m2" "$WORK/m2e"; fi

# ==========================================================================
# leg 4 — a ROOTED PATH ARG: `//name/rel` wherever an arg is a path
# ==========================================================================
bee //regrepo/sub/s.txt --plain > "$WORK/p1" 2>"$WORK/p1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^hunk //regrepo/sub/s.txt$' "$WORK/p1" && grep -q '^S0$' "$WORK/p1"
then ok "the fs leg opens //regrepo/sub/s.txt, URI spelling kept"
else bad "the rooted fs arg (rc $RC)" "$WORK/p1" "$WORK/p1e"; fi

bee cat //regrepo/sub/s.txt --plain > "$WORK/p2" 2>"$WORK/p2e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^S0$' "$WORK/p2"
then ok "\`bee cat //regrepo/sub/s.txt\` reads it through the verb"
else bad "the rooted cat arg (rc $RC)" "$WORK/p2" "$WORK/p2e"; fi

bee log //regrepo/r.txt --plain > "$WORK/p3" 2>"$WORK/p3e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'reg seed' "$WORK/p3"
then ok "...and \`bee log //regrepo/r.txt\` is that file's history"
else bad "the rooted log arg (rc $RC)" "$WORK/p3" "$WORK/p3e"; fi

# The slot is POSITIONAL: after a verb, `//name` is an ARG — and a bare name
# names the root, so `list //regrepo` is the board `//regrepo list` shows.
bee list //regrepo --plain > "$WORK/p4" 2>"$WORK/p4e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/p4" "$WORK/o4"
then ok "\`bee list //regrepo\` is the ARG reading, and lists the same root"
else bad "the positional rule (rc $RC)" "$WORK/p4" "$WORK/o4" "$WORK/p4e"; fi

bee cat //nosuch/x.txt --plain > "$WORK/p5" 2>"$WORK/p5e"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/p5" ] && grep -q '//nosuch: no such repo' "$WORK/p5e"
then ok "a rooted arg with an unknown name is refused by NAME (rc $RC)"
else bad "the rooted-arg refusal (rc $RC)" "$WORK/p5" "$WORK/p5e"; fi

bee //nosuch/x.txt --plain > "$WORK/p6" 2>"$WORK/p6e"; RC=$?
if [ "$RC" != 0 ] && grep -q '^bee: //nosuch: no such repo' "$WORK/p6e"
then ok "...and so is one on the fs leg (rc $RC)"
else bad "the fs-leg rooted refusal (rc $RC)" "$WORK/p6" "$WORK/p6e"; fi

# ==========================================================================
# leg 5 — a LINKED WORKTREE is its own context, on the ORIGINAL's index
# ==========================================================================
bee //wt log --plain > "$WORK/w1" 2>"$WORK/w1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'wt commit' "$WORK/w1"
then ok "\`bee //wt\` stands in the linked worktree, at ITS head"
else bad "the worktree context (rc $RC)" "$WORK/w1" "$WORK/w1e"; fi
bee //main log --plain > "$WORK/w2" 2>"$WORK/w2e"; RC=$?
if [ "$RC" = 0 ] && ! grep -q 'wt commit' "$WORK/w2"
then ok "...while //main stands at the original's own head"
else bad "the main context saw the worktree's commit (rc $RC)" "$WORK/w2" "$WORK/w2e"; fi
bee //wt status --plain > "$WORK/w3" 2>"$WORK/w3e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'w.txt' "$WORK/w3"
then ok "...and its own dirty file is the one \`status\` reports"
else bad "the worktree's dirty file (rc $RC)" "$WORK/w3" "$WORK/w3e"; fi
if [ -d "$MAIN/.git/be" ] && [ ! -d "$MAIN/.git/worktrees/wt/be" ]
then ok "...on the ORIGINAL's index — the family shares one lane (BEE-009)"
else bad "the worktree grew a lane of its own" "$WORK/w1e"; fi

# ==========================================================================
# leg 6 — with NO `//` word, the run is what it always was
# ==========================================================================
beein "$REG" cat sub/s.txt --plain > "$WORK/n1" 2>"$WORK/n1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^S0$' "$WORK/n1"
then ok "a plain in-repo verb run is untouched"
else bad "the plain verb run (rc $RC)" "$WORK/n1" "$WORK/n1e"; fi
beein "$REG" --plain r.txt > "$WORK/n2" 2>"$WORK/n2e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^hunk r.txt$' "$WORK/n2" && grep -q '^R0$' "$WORK/n2"
then ok "...and so is the fs leg with a relative path"
else bad "the plain fs run (rc $RC)" "$WORK/n2" "$WORK/n2e"; fi
# The bare zero-arg run in a repo is still the LITE-018 story, tracked.
FH2="$WORK/home2"; mkdir -p "$FH2"
( cd "$LOOSE" && HOME="$FH2" SRC_ROOT="$SRC" "$RT" --plain ) > "$WORK/n3" 2>"$WORK/n3e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'l.txt' "$WORK/n3" && grep -q "^$LOOSE$" "$FH2/.config/bee/repos"
then ok "...and a bare run in a repo still indexes, lists AND registers it"
else bad "the bare in-repo run (rc $RC)" "$WORK/n3" "$WORK/n3e"; fi
# ...whereas the same story IN A CONTEXT registers nothing (a read-only mount).
FH3="$WORK/home3"; mkdir -p "$FH3"
( cd "$NOWHERE" && HOME="$FH3" SRC_ROOT="$SRC" "$RT" //loose --plain ) > "$WORK/n4" 2>"$WORK/n4e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'l.txt' "$WORK/n4" && [ ! -f "$FH3/.config/bee/repos" ]
then ok "\`bee //loose\` is the zero-arg story there, and registers nothing"
else bad "the zero-arg context run (rc $RC)" "$WORK/n4" "$WORK/n4e" "$FH3/.config/bee/repos"; fi

# ==========================================================================
# leg 7 — the DOOR's own leg, headless: what a pager click and an href go through
# ==========================================================================
mkdir -p "$SRC/nogit"                            # a dir under $SRC_ROOT, no repo
( cd "$NOWHERE" && HOME="$FH" SRC_ROOT="$SRC" CTX_REG="$REG" \
  "$RT" --eval "require('$CASE/door.js')" ) > "$WORK/j.out" 2>"$WORK/j.err"; RC=$?
sed -n 's/^ok   /ok   door.js: /p; s/^FAIL /FAIL door.js: /p' "$WORK/j.out"
JN=$(grep -c '^ok   ' "$WORK/j.out")
CHECKS=$((CHECKS + JN))
if [ "$RC" = 0 ] && grep -q '^PASS \[bee/context\] door.js' "$WORK/j.out"
then ok "the headless door leg passed ($JN checks)"
else bad "door.js (rc $RC)" "$WORK/j.out" "$WORK/j.err"; fi

echo
if [ "$FAILED" = 0 ]
then echo "PASS [bee/context] $CHECKS checks"; exit 0
else echo "FAIL [bee/context] $FAILED of $CHECKS checks"; exit 1; fi
