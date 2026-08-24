#!/bin/sh
# bee/test/sym/run.sh — BEE-063: `bee sym <ident>`, the SYMBOL-MENTION suspects
# of the one `.lite3.idx` index.  Legs over the landed bee tree:
#   verb  — this script: the CLI contract over a fixture git repo — the symbol
#           found at one revision and at the next, the mint gates (a two-char
#           name, a comment-only word), the rerun that writes NOTHING, the
#           sweep of a stale `.lite2.idx`, and the cross-repo fan-out.
#   rows  — rows.js: the TOP-nibble key convention, one contiguous range per
#           kind, the SYM key/val layout, the canonical tag slots and the
#           watermark under hlOfText("symdex").
#
# THE GAP THIS REPROS: before this the index could say who LINKS to a file and
# nothing at all about who MENTIONS a symbol — `bee sym u8bFeed` answered "no
# such verb" — and the kind nibble sat in the LOW bits, so a family this fat
# would have peppered every page of the shared stack.
#
# Standalone: `sh bee/test/sym/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`); the DOG-034 lexer is what tags an
# identifier `S` and a comment word `D` — the ONE recognizer this verb has — so
# this wants a quickjab build.  Fixtures live in a mktemp dir under ~/tmp.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/sym
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "sym: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "sym: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "sym: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "sym: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-sym.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "sym: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  Every runtime call runs under a FIXTURE home — `install` and `index` write
#  `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# --- the fixture ----------------------------------------------------------
#   c0  src/abc/TCP.c   defines u8bFeed; its comment carries the word zqcomment
#                       and nothing else does; `id` is the two-char name
#       doc/guide.mkd   prose, no symbol of ours
#       bin/data.bin    a BINARY blob, never tokenised
#   c1  net/WIRE.c      mentions u8bFeed too — the SECOND revision's carrier
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src/abc doc net bin
  printf '//  a zqcomment word, prose the lexer tags as a comment\n' > src/abc/TCP.c
  printf 'int u8bFeed(int len) { int id = len; return id; }\n' >> src/abc/TCP.c
  printf 'the guide says nothing of ours\n' > doc/guide.mkd
  printf 'BM\000\001\002 binary\n' > bin/data.bin
  git add -A
  GIT_AUTHOR_DATE="2022-01-01T00:00:00Z" GIT_COMMITTER_DATE="2022-01-01T00:00:00Z" \
    git commit -q -m c0 || exit 1
) || { echo "sym: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
RREPO=$(cd "$REPO" && pwd -P)
echo "sym: runtime $RT, repo $REPO"

indexbytes() { cat "$REPO"/.git/be/* 2>/dev/null | wc -c | tr -d ' '; }

# ==========================================================================
# leg 1 — the symbol at the FIRST revision
# ==========================================================================
# S1: THE REPRO — one prefix scan names the one file that mentions it.
rtin "$REPO" sym u8bFeed > "$WORK/q1" 2>"$WORK/q1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q1")" = "$RREPO/src/abc/TCP.c" ]
then ok "sym u8bFeed names the one carrier at c0"
else bad "sym u8bFeed names the one carrier at c0 (rc $RC)" "$WORK/q1" "$WORK/q1e"; fi

# S2: the MINT GATES — under three characters, and a word the lexer tagged as
# comment prose, never mint.
rtin "$REPO" sym id > "$WORK/q2" 2>"$WORK/q2e"; RC=$?
rtin "$REPO" sym zqcomment > "$WORK/q3" 2>"$WORK/q3e"; RC2=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/q2" ] && [ "$RC2" = 0 ] && [ ! -s "$WORK/q3" ]
then ok "a two-char name and a comment word mint nothing"
else bad "a two-char name and a comment word mint nothing ($RC/$RC2)" \
         "$WORK/q2" "$WORK/q2e" "$WORK/q3" "$WORK/q3e"; fi

# S3: THE RERUN WRITES NOTHING — the tip has not moved, so the symdex mark hits
# and not one byte lands in the index.
BEFORE=$(indexbytes)
rtin "$REPO" sym u8bFeed > "$WORK/q4" 2>"$WORK/q4e"; RC=$?
AFTER=$(indexbytes)
if [ "$RC" = 0 ] && [ "$BEFORE" = "$AFTER" ] &&
   [ "$(cat "$WORK/q4")" = "$RREPO/src/abc/TCP.c" ]
then ok "a rerun over an unmoved tip writes nothing ($BEFORE bytes)"
else bad "a rerun over an unmoved tip writes nothing (rc $RC, $BEFORE -> $AFTER)" \
         "$WORK/q4" "$WORK/q4e"; fi

# ==========================================================================
# leg 2 — the SECOND revision
# ==========================================================================
printf 'int u8bFeed(int n) { return n; }\n' > "$REPO/net/WIRE.c"
g add -A
GIT_AUTHOR_DATE="2022-01-02T00:00:00Z" GIT_COMMITTER_DATE="2022-01-02T00:00:00Z" \
  g commit -q -m c1
rtin "$REPO" sym u8bFeed > "$WORK/q5" 2>"$WORK/q5e"; RC=$?
printf '%s/net/WIRE.c\n%s/src/abc/TCP.c\n' "$RREPO" "$RREPO" > "$WORK/q5w"
if [ "$RC" = 0 ] && cmp -s "$WORK/q5w" "$WORK/q5"
then ok "the new revision's carrier joins the suspects, sorted"
else bad "the new revision's carrier joins the suspects (rc $RC)" \
         "$WORK/q5w" "$WORK/q5" "$WORK/q5e"; fi

# ==========================================================================
# leg 3 — the EXTENSION IS THE FORMAT: a `.lite2.idx` file is swept
# ==========================================================================
printf 'PRE-BEE-063 INDEX\n' > "$REPO/.git/be/0000000000.lite2.idx"
rtin "$REPO" sym u8bFeed > "$WORK/q6" 2>"$WORK/q6e"; RC=$?
if [ "$RC" = 0 ] && [ ! -f "$REPO/.git/be/0000000000.lite2.idx" ] &&
   cmp -s "$WORK/q5w" "$WORK/q6"
then ok "a stale .lite2.idx is swept and the lane rebuilds lazily"
else bad "a stale .lite2.idx is swept (rc $RC)" "$WORK/q6" "$WORK/q6e"; fi

# L3b: and the whole derived dir rebuilds from the ODB alone.
rm -rf "$REPO/.git/be"
rtin "$REPO" sym u8bFeed > "$WORK/q7" 2>"$WORK/q7e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/q5w" "$WORK/q7"
then ok "rm -rf .git/be rebuilds the SYM rows from the TIP blobs alone"
else bad "rm -rf .git/be rebuilds the SYM rows (rc $RC)" "$WORK/q7" "$WORK/q7e"; fi

# ==========================================================================
# leg 4 — the ROWS (the key convention, the SYM layout, the symdex mark)
# ==========================================================================
LITE_FIX="$REPO" rtin "$REPO" --eval "require('$CASE/rows.js')" \
    > "$WORK/r.out" 2>"$WORK/r.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/r.out" && ! grep -q '^FAIL' "$WORK/r.out"; then
    N=$(grep -c '^ok' "$WORK/r.out"); CHECKS=$((CHECKS + N))
    ok "rows leg: $N checks (top-nibble keys, one range per kind, the SYM record)"
else
    cat "$WORK/r.out"; head -20 "$WORK/r.err"
    bad "rows leg (rc $RC)" "$WORK/r.out"
fi

# ==========================================================================
# leg 5 — the CROSS-REPO fan-out over the BEE-001 registry
# ==========================================================================
#   B  lib/net/SOCK.c  mentions u8bFeed as well; both repos are `bee install`ed,
#      so B answers a query run from REPO, read-only and never brought up.
B="$WORK/B"
mkdir -p "$B"
(
  cd "$B" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p lib/net
  printf 'void useit(void) { u8bFeed(3); }\n' > lib/net/SOCK.c
  git add -A
  GIT_AUTHOR_DATE="2022-02-01T00:00:00Z" GIT_COMMITTER_DATE="2022-02-01T00:00:00Z" \
    git commit -q -m c0 ) || { echo "sym: cannot build $B" >&2; exit 2; }
RB=$(cd "$B" && pwd -P)
rtin "$REPO" install > "$WORK/ia" 2>"$WORK/iae"; RCA=$?
rtin "$B" index    > "$WORK/ib" 2>"$WORK/ibe"; RCB=$?
if [ "$RCA" = 0 ] && [ "$RCB" = 0 ] && grep -qx "$RB" "$FAKEHOME/.config/bee/repos"
then ok "both fixture repos install into the BEE-001 registry"
else bad "both fixture repos install into the registry ($RCA/$RCB)" \
         "$WORK/iae" "$WORK/ibe" "$FAKEHOME/.config/bee/repos"; fi

# X1: the local repo's suspects come FIRST, the registered one's after.
rtin "$REPO" sym u8bFeed > "$WORK/x1" 2>"$WORK/x1e"; RC=$?
printf '%s/net/WIRE.c\n%s/src/abc/TCP.c\n%s/lib/net/SOCK.c\n' "$RREPO" "$RREPO" "$RB" \
  > "$WORK/x1w"
if [ "$RC" = 0 ] && cmp -s "$WORK/x1w" "$WORK/x1"
then ok "a cross-repo mention answers, repo-qualified, the local repo first"
else bad "a cross-repo mention answers (rc $RC)" "$WORK/x1w" "$WORK/x1" "$WORK/x1e"; fi

# X2: the foreign index is never brought UP — B's rows do not move when a query
# runs from REPO, so a stale foreign lane answers with fewer suspects, never wrong.
XB=$(cat "$B"/.git/be/* 2>/dev/null | wc -c | tr -d ' ')
rtin "$REPO" sym u8bFeed > /dev/null 2>&1
XA=$(cat "$B"/.git/be/* 2>/dev/null | wc -c | tr -d ' ')
if [ "$XB" = "$XA" ]
then ok "a query brings no foreign index up ($XB bytes)"
else bad "a query brings no foreign index up ($XB -> $XA)"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/sym] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/sym] $CHECKS checks, runtime $RT"
exit 0
