#!/bin/sh
# bee/test/front/run.sh — BEE-029: a Markdown YAML front matter is METADATA and
# never prose.  Before the fix a preamble opened the page as a `<hr />` and its
# keys came out a setext `<h2>`, the `---` closer being read as the underline.
# Three legs:
#
#   1. the split — the preamble goes, the body stays, over the `mark` verb;
#   2. the edges — a `---` below line 1, a `----`, a lone `---` and a setext
#      underline all stay what CommonMark says they are;
#   3. the server — `http cat` of a `.md` serves the same body (the reported
#      case), and a page with NO preamble is untouched.
#
# Standalone: `sh bee/test/front/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/front
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "front: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "front: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "front: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-front.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "front: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
lite() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" mark "$@" ); }
echo "front: runtime $RT, fixtures $WORK"

# The reported page, plus the keys a generator really carries.
printf -- '---\nlayout: post\ntitle: Hi\ntags: [a, b]\n---\n\n##  Header\n\nsome text\n' \
  > "$WORK/post.md"
# The same shape in the StrictMark ext, closed by `...` — the kv lane reads a
# preamble off either ext (index/kv.js:126:De), so the page must too.
printf -- '---\nlayout: post\n...\n\n#   Title\n\nbody\n' > "$WORK/post.mkd"
# No preamble at all: this page must render exactly as it does today.
printf -- '#   Plain\n\nA line, then a ruler.\n\n---\n\nAnd more.\n' > "$WORK/plain.mkd"
# A `---` below line 1 is a thematic break; a setext underline is a heading.
printf -- 'Lead paragraph.\n\n---\nlayout: post\n---\n\nTail.\n' > "$WORK/below.md"
printf -- 'Title\n---\n\nbody\n' > "$WORK/setext.md"
# Neither of these opens a preamble: `----` is a ruler, and a `---` with no
# body and no closer is the ruler CommonMark says it is (MARK-017, MDFM.c:41).
printf -- '----\nlayout: post\n----\n\nTail.\n' > "$WORK/wide.md"
printf -- '---\n' > "$WORK/lone.md"

# ==========================================================================
# leg 1 — the split: the preamble goes, the body stays
# ==========================================================================
run() {   # run <file> -> $WORK/out
    lite "$1" > "$WORK/out" 2>"$WORK/err"; RC=$?
    [ "$RC" = 0 ] || bad "mark $1 (rc $RC)" "$WORK/out" "$WORK/err"
}
has()   { if grep -qF "$2" "$WORK/out"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/out"; fi; }
hasnt() { if grep -qF "$2" "$WORK/out"; then bad "$1 — '$2' is there" "$WORK/out"; else ok "$1"; fi; }

run post.md
hasnt "the preamble leaves no ruler"        "<hr />"
hasnt "the preamble leaves no heading"      "layout: post"
hasnt "a preamble key is not prose"         "title: Hi"
hasnt "an inline sequence is not a link"    "tags: [a, b]"
has   "the body's own heading is rendered"  '<h2 id="header">Header</h2>'
has   "the body's own text is rendered"     "<p>some text</p>"

run post.mkd
hasnt "an "..."-closed preamble goes too"    "layout: post"
has   "the .mkd body is rendered"           '<h1 id="title">Title</h1>'

# ==========================================================================
# leg 2 — the edges: below line 1 nothing changes
# ==========================================================================
run plain.mkd
has   "a page with no preamble keeps its ruler"   "<hr />"
has   "a page with no preamble keeps its title"   '<h1 id="plain">Plain</h1>'
has   "a page with no preamble keeps its tail"    "<p>And more.</p>"

run below.md
has   "a "---" below line 1 is a thematic break"  "<hr />"
has   "the lead paragraph stands"                 "<p>Lead paragraph.</p>"
has   "the text under it stands"                  "layout: post"

run setext.md
has   "a setext underline is still a heading"     '<h2 id="title">Title</h2>'

run wide.md
has   "a "----" line opens no preamble"           "layout: post"

run lone.md
has   "a lone "---" file is a ruler"              "<hr />"

# ==========================================================================
# leg 3 — the server: the reported URL, `http cat` of a .md
# ==========================================================================
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    echo "front: SKIP the http leg — no git or no curl" >&2
else
REPO="$WORK/repo"; mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  cp "$WORK/post.md" page.md
  cp "$WORK/plain.mkd" plain.mkd
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'the page' || exit 1
) || { echo "front: cannot build the fixture repo" >&2; exit 2; }

PORT="${LITEPORT:-18029}"
BASE="http://127.0.0.1:$PORT"
( cd "$REPO"; exec env HOME="$FAKEHOME" "$RT" http --port "$PORT" ) > "$WORK/srv.log" 2>&1 &
SRVPID=$!
N=0
while [ "$N" -lt 100 ]; do
    curl -s -o /dev/null "$BASE/" && break
    grep -qi "in use" "$WORK/srv.log" && break
    N=$((N + 1)); sleep 0.1
done
if grep -qi "in use" "$WORK/srv.log"; then
    echo "front: SKIP the http leg — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
    kill "$SRVPID" 2>/dev/null; SRVPID=""
elif [ "$N" -ge 100 ]; then
    bad "the server never answered on $PORT" "$WORK/srv.log"
else
    ok "the listener came up on $PORT"
    curl -s -o "$WORK/out" "$BASE/repo/cat/page.md"
    hasnt "GET /repo/cat/page.md serves no ruler"    "<hr />"
    hasnt "GET /repo/cat/page.md serves no preamble" "layout: post"
    has   "GET /repo/cat/page.md serves the body"    '<h2 id="header">Header</h2>'
    kill "$SRVPID" 2>/dev/null; SRVPID=""
fi
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/front] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/front] $CHECKS checks, runtime $RT"
exit 0
