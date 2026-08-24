#!/bin/sh
# bee/test/symhunk/run.sh — BEE-066: EVERY HIT of `bee sym <ident>` IS A HUNK,
# the canonical one (/wiki/Hunk, dog/HUNK.h:34): the address `<path>:<line>` as
# the `uri`, the RAW window bytes as the text — the mention line with one line
# of context either side — and the file's own lexer tags with the mention
# marked.  Two windows MERGE where they OVERLAP, so no line is ever shown twice.
#
# THE GAP THIS REPROS: BEE-063 answered with bare repo-qualified paths and
# nothing else — 48 of them for `u8bFeed` — so the reader had to open every one
# to learn why it was named.  The rows store no positions by design, hence the
# verb OPENS each suspect and finds the mentions through the very mint gate the
# scan minted with (index/lindex.js:118:cA), which is also why a false suspect
# prints nothing at all and drops out of the answer.
#
# Legs: the canonical shape, that the view draws NOTHING (no gutters, no line
# numbers, no separators), window overlap-merging, the false-suspect dropout,
# the worktree-over-blob byte source, an unlexable blob, the BEE-063 cap, the
# `--paths` scripting mode, the three surfaces off the one emitter, and the
# FILTER WORDS — segment-aligned paths, extensions, and the row-level prune
# that lets a narrowed query duck the cap the whole-symbol one hits.
#
# Standalone: `sh bee/test/symhunk/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`); the DOG-034 lexer is the one
# recognizer here, so this wants a quickjab build.  Fixtures live under ~/tmp.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/symhunk
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "symhunk: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "symhunk: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "symhunk: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "symhunk: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-symhunk.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "symhunk: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  Every runtime call runs under a FIXTURE home — the registry written is the
#  fixture's, never the user's own.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# --- the fixture ----------------------------------------------------------
#   c0  src/abc/TCP.c  mentions u8bFeed on lines 3 and 7 — two windows that do
#                      NOT overlap, so they stay two hunks
#       doc/old.c      mentions it too, and c1 takes the mention away again
#       bin/blob.c     mentions it as TEXT; a later leg makes the worktree copy
#                      binary, which is the one thing no lexer will touch
#       doc/guide.mkd  prose, nothing of ours
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src/abc doc net bin
  {
    printf '//  a zqcomment word, prose the lexer tags as a comment\n'
    printf 'int one;\n'
    printf 'int u8bFeed(int len) { int id = len; return id; }\n'
    printf 'int two;\n'
    printf 'int three;\n'
    printf 'int four;\n'
    printf 'void go(void) { u8bFeed(1); }\n'
    printf 'int eight;\n'
  } > src/abc/TCP.c
  printf 'void was(void) { u8bFeed(2); }\n' > doc/old.c
  printf 'void raw(void) { u8bFeed(4); }\n' > bin/blob.c
  printf 'the guide says nothing of ours\n' > doc/guide.mkd
  git add -A
  GIT_AUTHOR_DATE="2022-01-01T00:00:00Z" GIT_COMMITTER_DATE="2022-01-01T00:00:00Z" \
    git commit -q -m c0 || exit 1
) || { echo "symhunk: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
gc() { GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
       GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git -C "$REPO" commit -q -m "$2"; }
RREPO=$(cd "$REPO" && pwd -P)
echo "symhunk: runtime $RT, repo $REPO"

# ==========================================================================
# leg 1 — THE REPRO: every hit is a canonical hunk, not a bare path
# ==========================================================================
rtin "$REPO" sym u8bFeed --plain > "$WORK/h1" 2>"$WORK/h1e"; RC=$?
{
  printf '§ %s/bin/blob.c:1\n' "$RREPO"
  printf 'void raw(void) { u8bFeed(4); }\n'
  printf '§ %s/doc/old.c:1\n' "$RREPO"
  printf 'void was(void) { u8bFeed(2); }\n'
  printf '§ %s/src/abc/TCP.c:3\n' "$RREPO"
  printf 'int one;\n'
  printf 'int u8bFeed(int len) { int id = len; return id; }\n'
  printf 'int two;\n'
  printf '§ %s/src/abc/TCP.c:7\n' "$RREPO"
  printf 'int four;\n'
  printf 'void go(void) { u8bFeed(1); }\n'
  printf 'int eight;\n'
} > "$WORK/h1w"
if [ "$RC" = 0 ] && cmp -s "$WORK/h1w" "$WORK/h1"
then ok "every hit is a hunk: the address banners it, the raw window is its text"
else bad "every hit is a canonical hunk (rc $RC)" "$WORK/h1w" "$WORK/h1" "$WORK/h1e"; fi

# H2: the view DRAWS NOTHING — no gutter, no line number, no `--` separator in
# the text; the address lives in the uri and the banner is the renderer's.
if ! grep -qE '^[[:space:]]*[0-9]+[:-]' "$WORK/h1" && ! grep -qx -- '--' "$WORK/h1"
then ok "no gutter bytes, no line numbers and no separators in the text"
else bad "the view draws nothing" "$WORK/h1"; fi

# ==========================================================================
# leg 2 — WINDOWS MERGE ON OVERLAP, and the false-suspect DROPOUT
# ==========================================================================
#  net/WIRE.c mentions it on 2, 4 and 8.  The windows 1..3 and 3..5 OVERLAP on
#  line 3, so they are ONE hunk addressed at the first mention; 7..9 touches
#  nothing and stays its own hunk.  doc/old.c loses the mention, keeping the row.
{
  printf 'int a;\n'
  printf 'int u8bFeed(int n);\n'
  printf 'int u8bFeed2(int m);\n'
  printf 'int u8bFeed(int k);\n'
  printf 'int c;\n'
  printf 'int d;\n'
  printf 'int e;\n'
  printf 'int u8bFeed(int z);\n'
  printf 'int f;\n'
} > "$REPO/net/WIRE.c"
printf 'void was(void) { nothing(2); }\n' > "$REPO/doc/old.c"
g add -A
gc "2022-01-02T00:00:00Z" c1

rtin "$REPO" sym u8bFeed --plain > "$WORK/h2" 2>"$WORK/h2e"; RC=$?
{
  printf '§ %s/net/WIRE.c:2\n' "$RREPO"
  printf 'int a;\n'
  printf 'int u8bFeed(int n);\n'
  printf 'int u8bFeed2(int m);\n'
  printf 'int u8bFeed(int k);\n'
  printf 'int c;\n'
  printf '§ %s/net/WIRE.c:8\n' "$RREPO"
  printf 'int e;\n'
  printf 'int u8bFeed(int z);\n'
  printf 'int f;\n'
} > "$WORK/h2w"
sed -n "\%^§ $RREPO/net/WIRE.c:2\$%,\%^§ $RREPO/src%p" "$WORK/h2" | sed '$d' > "$WORK/h2g"
if [ "$RC" = 0 ] && cmp -s "$WORK/h2w" "$WORK/h2g"
then ok "overlapping windows merge into one hunk, a touching one stays its own"
else bad "windows merge on overlap (rc $RC)" "$WORK/h2w" "$WORK/h2g" "$WORK/h2" "$WORK/h2e"; fi

# M2: the shared line is shown ONCE — that is the whole point of merging.
if [ "$(grep -c 'int u8bFeed2(int m);' "$WORK/h2")" = 1 ]
then ok "the line two windows share is shown once, not twice"
else bad "the shared line is shown once" "$WORK/h2"; fi

# D1: doc/old.c still has its row and its file, and prints NOTHING — precision
# comes from opening (INDEXES.mkd, the suspects contract).
if [ "$RC" = 0 ] && ! grep -q "doc/old.c" "$WORK/h2"
then ok "a suspect whose file no longer carries the symbol drops out"
else bad "the false suspect drops out (rc $RC)" "$WORK/h2" "$WORK/h2e"; fi

# D2: ...while `--paths` opens nothing and so still names it — the scripting
# mode is the SUSPECT list BEE-063 printed, not the confirmed one.
rtin "$REPO" sym u8bFeed --paths --plain > "$WORK/p1" 2>"$WORK/p1e"; RC=$?
if [ "$RC" = 0 ] && grep -q "doc/old.c" "$WORK/p1"
then ok "--paths names the SUSPECTS, unopened, exactly as BEE-063 did"
else bad "--paths keeps the unopened suspect list (rc $RC)" "$WORK/p1" "$WORK/p1e"; fi

# ==========================================================================
# leg 3 — the BYTE SOURCE: the worktree file, else the tip blob
# ==========================================================================
#  An UNCOMMITTED line is what the reader would open, so it is what the hunk
#  shows — and the address it wears is the worktree's line number.
printf 'int a;\nint zz;\nint u8bFeed(int n);\n' > "$REPO/net/WIRE.c"
rtin "$REPO" sym u8bFeed --plain > "$WORK/h3" 2>"$WORK/h3e"; RC=$?
if [ "$RC" = 0 ] && grep -qx "§ $RREPO/net/WIRE.c:3" "$WORK/h3" &&
   ! grep -q 'u8bFeed2' "$WORK/h3"
then ok "the worktree bytes win over the tip blob the row named"
else bad "the worktree bytes win (rc $RC)" "$WORK/h3" "$WORK/h3e"; fi

# B1: with no worktree file at all the tip blob answers, since that is all a
# bare checkout has to show.
mv "$REPO/net/WIRE.c" "$WORK/WIRE.keep"
rtin "$REPO" sym u8bFeed --plain > "$WORK/h4" 2>"$WORK/h4e"; RC=$?
if [ "$RC" = 0 ] && grep -qx "§ $RREPO/net/WIRE.c:8" "$WORK/h4"
then ok "a file gone from the worktree still answers off its tip blob"
else bad "the tip blob answers (rc $RC)" "$WORK/h4" "$WORK/h4e"; fi
mv "$WORK/WIRE.keep" "$REPO/net/WIRE.c"
g checkout -- net/WIRE.c 2>/dev/null || true

# ==========================================================================
# leg 4 — an UNLEXABLE blob names itself and no more
# ==========================================================================
printf 'BM\000\001\002 u8bFeed\n' > "$REPO/bin/blob.c"
rtin "$REPO" sym u8bFeed --plain > "$WORK/h5" 2>"$WORK/h5e"; RC=$?
if [ "$RC" = 0 ] && grep -qx "§ $RREPO/bin/blob.c" "$WORK/h5" &&
   ! grep -q 'BM' "$WORK/h5"
then ok "a binary blob prints its path bare, never a garbage hunk"
else bad "the binary blob prints bare (rc $RC)" "$WORK/h5" "$WORK/h5e"; fi
g checkout -- bin/blob.c 2>/dev/null || true

# ==========================================================================
# leg 5 — the THREE SURFACES off the one emitter
# ==========================================================================
#  The address is banded by the house drawer (render/ansi.js:257:uy, THEME_BANNER's
#  pale-yellow pair) and the mention wears the `E` slot; the view spells neither.
rtin "$REPO" sym u8bFeed --color > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
BAND=$(printf '\033[38;5;0;48;5;230m%s/src/abc/TCP.c:3' "$RREPO")
HIT=$(printf '\033[33mu8bFeed')
if [ "$RC" = 0 ] && grep -qF "$BAND" "$WORK/c1" && grep -qF "$HIT" "$WORK/c1"
then ok "--color bands the address and paints the mention apart"
else bad "--color bands the address (rc $RC)" "$WORK/c1e"; fi

rtin "$REPO" sym u8bFeed --html > "$WORK/w1" 2>"$WORK/w1e"; RC=$?
if [ "$RC" = 0 ] &&
   grep -q "<div class=\"banner\">$RREPO/src/abc/TCP.c:3</div>" "$WORK/w1" &&
   grep -q '<span class="tok-E"[^>]*>u8bFeed</span>' "$WORK/w1"
then ok "--html bands the same address and marks the same token"
else bad "--html bands the address (rc $RC)" "$WORK/w1e"; fi

# S3: the canonical fields themselves — uri the address, text the raw window,
# `land` the mention the pager seats on, and the tag it wears in `toks`.
cat > "$WORK/fields.js" <<'EOJS'
//  What a renderer reads off a hunk (dog/HUNK.h:34): the address, the raw
//  window, and the tag the marked token wears at the landing.
const hs = require("door.js").VERBS.sym("u8bFeed", {});
for (const h of hs) {
  let tag = "-", start = 0;
  for (let i = 0; i < h.toks.length; i++) {
    if (h.land && h.land.lo === start)
      tag = String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f));
    start = h.toks[i] & 0xffffff;
  }
  io.log(h.uri + " win=" + (h.win ? h.win.from + ".." + h.win.to : "-") +
         " land=" + (h.land ? h.land.line + ":" + h.land.col : "-") + " tag=" + tag);
}
EOJS
rtin "$REPO" --eval "require('$WORK/fields.js')" > "$WORK/t1" 2>&1; RC=$?
if [ "$RC" = 0 ] &&
   grep -qxF "$RREPO/src/abc/TCP.c:3 win=2..4 land=2:5 tag=E" "$WORK/t1"
then ok "the hunk carries the address, the window and the marked mention"
else bad "the canonical fields (rc $RC)" "$WORK/t1"; fi

# ==========================================================================
# leg 6 — the MINT GATE is the one recognizer
# ==========================================================================
# A two-char name and a word the lexer tagged as comment prose never minted a
# row, so they can never grow a hunk either.
rtin "$REPO" sym id --plain > "$WORK/m1" 2>"$WORK/m1e"; RC=$?
rtin "$REPO" sym zqcomment --plain > "$WORK/m2" 2>"$WORK/m2e"; RC2=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/m1" ] && [ "$RC2" = 0 ] && [ ! -s "$WORK/m2" ]
then ok "the gate the scan mints through is the gate the hunks are cut through"
else bad "the mint gate bounds the hunks ($RC/$RC2)" "$WORK/m1" "$WORK/m2"; fi

# ==========================================================================
# leg 7 — the BEE-063 CAP
# ==========================================================================
# Past the cap a repo says how many files carry the symbol and asks for a
# narrower query; not one hunk is cut.
(
  cd "$REPO" || exit 1
  mkdir -p many
  i=0
  while [ "$i" -lt 201 ]; do
    printf 'void f%s(void) { zqWide(1); }\n' "$i" > "many/f$i.c"
    i=$((i + 1))
  done
) || exit 2
g add -A
gc "2022-01-03T00:00:00Z" c2
rtin "$REPO" sym zqWide --plain > "$WORK/k1" 2>"$WORK/k1e"; RC=$?
printf '%s: 201 files carry it — narrow the query\n' "$RREPO" > "$WORK/k1w"
if [ "$RC" = 0 ] && cmp -s "$WORK/k1w" "$WORK/k1"
then ok "past the cap the repo prints its count and the ask, and no hunk"
else bad "the cap prints the count instead of hunks (rc $RC)" \
         "$WORK/k1w" "$WORK/k1" "$WORK/k1e"; fi

# ==========================================================================
# leg 8 — the BARE-PATHS mode for scripting
# ==========================================================================
rtin "$REPO" sym u8bFeed --paths --plain > "$WORK/p2" 2>"$WORK/p2e"; RC=$?
printf '%s/bin/blob.c\n%s/doc/old.c\n%s/net/WIRE.c\n%s/src/abc/TCP.c\n' \
  "$RREPO" "$RREPO" "$RREPO" "$RREPO" > "$WORK/p2w"
if [ "$RC" = 0 ] && cmp -s "$WORK/p2w" "$WORK/p2"
then ok "--paths keeps one repo-qualified path per line, no banner at all"
else bad "--paths keeps the path list (rc $RC)" "$WORK/p2w" "$WORK/p2" "$WORK/p2e"; fi

# ==========================================================================
# leg 9 — the FILTER WORDS (BEE-066:24)
# ==========================================================================
#   dog/abc/DNS.h, dog/abc/DNS.c, dog/net/SOCK.c and catalog/abc/OTHER.c all
#   mention zqSeg — `catalog/abc` is the trap a substring match would fall into.
#   few/one.c joins the 201 `many/` carriers of zqWide, so a filter can duck the
#   cap the whole-symbol query hits.
(
  cd "$REPO" || exit 1
  mkdir -p dog/abc dog/net catalog/abc few
  printf 'int a;\nint zqSeg(int n);\nint b;\n' > dog/abc/DNS.h
  printf 'int a;\nint zqSeg(int n);\nint b;\n' > dog/abc/DNS.c
  printf 'int a;\nint zqSeg(int n);\nint b;\n' > dog/net/SOCK.c
  printf 'int a;\nint zqSeg(int n);\nint b;\n' > catalog/abc/OTHER.c
  printf 'void g(void) { zqWide(2); }\n' > few/one.c
) || exit 2
g add -A
gc "2022-01-04T00:00:00Z" c3

# F1: a PATH filter, segment-aligned — and `catalog/abc` is NOT `dog/abc`.
rtin "$REPO" sym --paths zqSeg dog/abc/ --plain > "$WORK/f1" 2>"$WORK/f1e"; RC=$?
printf '%s/dog/abc/DNS.c\n%s/dog/abc/DNS.h\n' "$RREPO" "$RREPO" > "$WORK/f1w"
if [ "$RC" = 0 ] && cmp -s "$WORK/f1w" "$WORK/f1"
then ok "a path filter is a SEGMENT RUN: catalog/abc is not dog/abc"
else bad "the path filter is segment-aligned (rc $RC)" "$WORK/f1w" "$WORK/f1" "$WORK/f1e"; fi

# F2: the run matches ANYWHERE in the path, so a bare `abc` takes both parents;
# a trailing slash says the same thing as none.
rtin "$REPO" sym --paths zqSeg abc --plain > "$WORK/f2" 2>"$WORK/f2e"; RC=$?
rtin "$REPO" sym --paths zqSeg abc/ --plain > "$WORK/f2b" 2>&1; RC2=$?
printf '%s/catalog/abc/OTHER.c\n%s/dog/abc/DNS.c\n%s/dog/abc/DNS.h\n' \
  "$RREPO" "$RREPO" "$RREPO" > "$WORK/f2w"
if [ "$RC" = 0 ] && [ "$RC2" = 0 ] && cmp -s "$WORK/f2w" "$WORK/f2" &&
   cmp -s "$WORK/f2" "$WORK/f2b"
then ok "the run matches at any depth, and a trailing slash reads the same"
else bad "the run matches at any depth (rc $RC/$RC2)" "$WORK/f2w" "$WORK/f2" "$WORK/f2b"; fi

# F3: an EXTENSION filter is the weave lexer's own spelling of the suffix.
rtin "$REPO" sym --paths zqSeg .h --plain > "$WORK/f3" 2>"$WORK/f3e"; RC=$?
printf '%s/dog/abc/DNS.h\n' "$RREPO" > "$WORK/f3w"
if [ "$RC" = 0 ] && cmp -s "$WORK/f3w" "$WORK/f3"
then ok "an extension filter keeps the files of that one suffix"
else bad "the extension filter (rc $RC)" "$WORK/f3w" "$WORK/f3" "$WORK/f3e"; fi

# F4: the two kinds COMBINE, in either order.
rtin "$REPO" sym --paths zqSeg dog/abc .c --plain > "$WORK/f4" 2>"$WORK/f4e"; RC=$?
rtin "$REPO" sym --paths zqSeg .c dog/abc --plain > "$WORK/f4b" 2>&1; RC2=$?
printf '%s/dog/abc/DNS.c\n' "$RREPO" > "$WORK/f4w"
if [ "$RC" = 0 ] && [ "$RC2" = 0 ] && cmp -s "$WORK/f4w" "$WORK/f4" &&
   cmp -s "$WORK/f4" "$WORK/f4b"
then ok "a path and an extension filter combine, in any order"
else bad "the filters combine (rc $RC/$RC2)" "$WORK/f4w" "$WORK/f4" "$WORK/f4b"; fi

# F5: the HUNK mode narrows with them — one window, one banner, nothing else.
rtin "$REPO" sym zqSeg dog/net/ --plain > "$WORK/f5" 2>"$WORK/f5e"; RC=$?
{
  printf '§ %s/dog/net/SOCK.c:2\n' "$RREPO"
  printf 'int a;\n'
  printf 'int zqSeg(int n);\n'
  printf 'int b;\n'
} > "$WORK/f5w"
if [ "$RC" = 0 ] && cmp -s "$WORK/f5w" "$WORK/f5"
then ok "the hunks narrow with the filter, not just the paths"
else bad "the hunks narrow (rc $RC)" "$WORK/f5w" "$WORK/f5" "$WORK/f5e"; fi

# F6: a filter that matches nothing answers CLEANLY — no rows, no words, rc 0.
rtin "$REPO" sym zqSeg .zz --plain > "$WORK/f6" 2>"$WORK/f6e"; RC=$?
rtin "$REPO" sym --paths zqSeg nowhere/ --plain > "$WORK/f6b" 2>&1; RC2=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/f6" ] && [ "$RC2" = 0 ] && [ ! -s "$WORK/f6b" ]
then ok "a filter that empties the answer says nothing and still exits 0"
else bad "an empty filtered answer (rc $RC/$RC2)" "$WORK/f6" "$WORK/f6e" "$WORK/f6b"; fi

# F7: THE POINT — the row-level prune runs BEFORE the cap, so a query the whole
# symbol could not answer is answered once it is narrowed.
rtin "$REPO" sym zqWide --plain > "$WORK/f7" 2>"$WORK/f7e"; RC=$?
rtin "$REPO" sym zqWide few/ --plain > "$WORK/f8" 2>"$WORK/f8e"; RC2=$?
printf '%s: 202 files carry it — narrow the query\n' "$RREPO" > "$WORK/f7w"
{ printf '§ %s/few/one.c:1\n' "$RREPO"; printf 'void g(void) { zqWide(2); }\n'; } > "$WORK/f8w"
if [ "$RC" = 0 ] && cmp -s "$WORK/f7w" "$WORK/f7" &&
   [ "$RC2" = 0 ] && cmp -s "$WORK/f8w" "$WORK/f8"
then ok "a filtered query ducks under the cap the whole-symbol one hits"
else bad "the filter ducks the cap (rc $RC/$RC2)" "$WORK/f7" "$WORK/f8w" "$WORK/f8" "$WORK/f8e"; fi

# F8: the run is matched over the ADDRESS, so a segment living in a registered
# repo's ROOT answers too — `~/src/quickjab/dog/abc` is a lane of its own, and
# `dog/abc` names no dir of its rows at all.
SIDE="$WORK/side/dog/abc"
mkdir -p "$SIDE"
(
  cd "$SIDE" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  printf 'int p;\nint zqSeg(int q);\nint r;\n' > NET.c
  git add -A
  GIT_AUTHOR_DATE="2022-02-01T00:00:00Z" GIT_COMMITTER_DATE="2022-02-01T00:00:00Z" \
    git commit -q -m c0 ) || { echo "symhunk: cannot build $SIDE" >&2; exit 2; }
RSIDE=$(cd "$SIDE" && pwd -P)
rtin "$REPO" install > "$WORK/ia" 2>&1
rtin "$SIDE" index   > "$WORK/ib" 2>&1
rtin "$REPO" sym --paths zqSeg dog/abc/ --plain > "$WORK/f9" 2>"$WORK/f9e"; RC=$?
printf '%s/dog/abc/DNS.c\n%s/dog/abc/DNS.h\n%s/NET.c\n' "$RREPO" "$RREPO" "$RSIDE" \
  > "$WORK/f9w"
if [ "$RC" = 0 ] && cmp -s "$WORK/f9w" "$WORK/f9"
then ok "a run that lives in a registered repo's ROOT is matched all the same"
else bad "the run matches over the address (rc $RC)" "$WORK/f9w" "$WORK/f9" "$WORK/f9e"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/symhunk] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/symhunk] $CHECKS checks, runtime $RT"
exit 0
