#!/bin/sh
# lite/test/serve/bytes.sh — LITE-036: `/bytes/<path>[?<rev>]`, the RAW image
# route, and the `<img src>` a rendered `.md` page emits into it.
#
# What it pins:
#   * the CONTENT TYPE comes off the NAME, from the one allowlist table:
#     png jpg jpeg gif webp ico bmp; everything else — `.svg` included, because
#     an svg is script in the page's origin — is application/octet-stream;
#   * `X-Content-Type-Options: nosniff` rides every one of those answers;
#   * the bytes are VERBATIM: a served png is byte-identical to the file, and
#     `?<rev>` serves that rev's own bytes, not the tip's;
#   * a miss 404s through the SAME door as everywhere, no directory form
#     answers, and a file over the source cap is refused 413 in plain words;
#   * a rendered `.md` points its `<img src>` at `/bytes/`, while an ordinary
#     LINK to the same file keeps its painted `/cat/` view.
#
# Standalone: `sh lite/test/serve/bytes.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
# $LITEPORT overrides the loopback port the fixture server binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/serve
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "bytes: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "bytes: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git  >/dev/null 2>&1 || { echo "bytes: SKIP — no git to build a fixture" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "bytes: SKIP — no curl to drive the server" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "bytes: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-bytes.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "bytes: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
PORT="${LITEPORT:-18036}"
BASE="http://127.0.0.1:$PORT"
echo "bytes: runtime $RT, fixtures $WORK, port $PORT"

# ==========================================================================
# the fixture — one file per allowlisted extension (the bytes are never read,
# only the NAME types them), a real-shaped png that carries NULs so a byte
# comparison means something, an svg, an off-list name, and a page.md that
# both SHOWS and LINKS the png.  Two commits, so `?<rev>` has an era to show.
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  # the PNG signature + an IHDR of a 1x1 image: binary, NUL-bearing, verbatim
  printf '\211PNG\r\n\032\n\000\000\000\015IHDR\000\000\000\001\000\000\000\001\010\006\000\000\000' > logo.png
  printf '\377\330\377\340JFIF-0\000' > pic.jpg
  printf '\377\330\377\340JFIF-1\000' > pic.jpeg
  printf 'GIF89a\000\001' > pic.gif
  printf 'RIFF\000\000\000\000WEBP' > pic.webp
  printf '\000\000\001\000\001\000' > pic.ico
  printf 'BM\000\000\000\000' > pic.bmp
  printf '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n' > draw.svg
  printf 'plain words\n' > notes.txt
  printf 'X0\n' > sub/x.txt
  printf '#  Pic\n\n![the logo](logo.png)\n\n[the source](logo.png)\n\n![vector](draw.svg)\n\n![missing](nope.png)\n' \
    > page.md
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed' || exit 1
  cp logo.png "$WORK/logo.v0"
  # C1 repaints the logo: the tip's bytes and C0's differ, byte for byte
  printf '\211PNG\r\n\032\n\000\000\000\015IHDR\000\000\000\002\000\000\000\002\010\006\000\000\000' > logo.png
  git add -A
  GIT_AUTHOR_DATE='@1700086400 +0000' GIT_COMMITTER_DATE='@1700086400 +0000' \
    git commit -q -m 'C1 repaint the logo' || exit 1
) || { echo "bytes: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
C0=$(g rev-parse HEAD~1); C08=$(echo "$C0" | cut -c1-8)

# The over-cap file: past index/weave.js's 4 MB source cap, untracked (the
# route reads the WORKTREE when no rev rides), and never committed.
if dd if=/dev/zero of="$REPO/huge.png" bs=1024 count=5120 2>/dev/null; then BIG=1
else BIG=0; echo "bytes: no dd — skipping the over-cap leg" >&2; fi

# ==========================================================================
# up it goes
# ==========================================================================
( cd "$REPO"; exec env HOME="$FAKEHOME" "$RT" serve --port "$PORT" ) \
  > "$WORK/srv.log" 2>&1 &
SRVPID=$!
N=0
while [ "$N" -lt 100 ]; do
    curl -s -o /dev/null "$BASE/" && break
    grep -qi "in use" "$WORK/srv.log" && break
    N=$((N + 1)); sleep 0.1
done
if grep -qi "in use" "$WORK/srv.log"; then
    echo "bytes: SKIP — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
    SRVPID=""; exit 0
fi
if [ "$N" -lt 100 ]; then ok "the listener came up on $PORT"
else bad "the server never answered on $PORT" "$WORK/srv.log"; exit 1; fi

page() {   # page <label> <url> <want-status>
    curl -s -D "$WORK/hdr" -o "$WORK/body" "$BASE$2"
    _st=$(head -1 "$WORK/hdr" | tr -d '\r')
    case "$_st" in
        "HTTP/1.1 $3"*) ok "$1 [$2] $_st" ;;
        *) bad "$1 [$2]: '$_st' want $3" "$WORK/hdr" "$WORK/body" ;;
    esac
}
has()   { if grep -qF "$2" "$WORK/body"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/body"; fi; }
hasnt() { if grep -qF "$2" "$WORK/body"; then bad "$1 — '$2' is there" "$WORK/body"; else ok "$1"; fi; }
hdr()   { if grep -qiF "$2" "$WORK/hdr"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/hdr"; fi; }
nohdr() { if grep -qiF "$2" "$WORK/hdr"; then bad "$1 — '$2' is there" "$WORK/hdr"; else ok "$1"; fi; }

# ==========================================================================
# leg 1 — the allowlist, one file per extension, typed off the NAME
# ==========================================================================
ctype() {   # ctype <file> <want-type>
    page "typed off the name" "/bytes/$1" 200
    hdr "$1 is $2" "Content-Type: $2"
    hdr "$1 is marked nosniff" "X-Content-Type-Options: nosniff"
}
ctype logo.png  "image/png"
ctype pic.jpg   "image/jpeg"
ctype pic.jpeg  "image/jpeg"
ctype pic.gif   "image/gif"
ctype pic.webp  "image/webp"
ctype pic.ico   "image/x-icon"
ctype pic.bmp   "image/bmp"

# Off the list: the browser downloads it and interprets nothing.
ctype notes.txt "application/octet-stream"
ctype sub/x.txt "application/octet-stream"

# An SVG is TEXT THAT CAN SCRIPT: it never gets the image type that would run it.
page  "an svg ships as bytes" "/bytes/draw.svg" 200
hdr   "the svg is octet-stream" "Content-Type: application/octet-stream"
nohdr "and NEVER image/svg+xml" "image/svg"
hdr   "the svg is marked nosniff" "X-Content-Type-Options: nosniff"
has   "its bytes ride verbatim, un-run" "<script>alert(1)</script>"

# ==========================================================================
# leg 2 — the bytes are the FILE's bytes, and `?<rev>` picks the era
# ==========================================================================
curl -s -o "$WORK/img" "$BASE/bytes/logo.png"
if cmp -s "$WORK/img" "$REPO/logo.png"
then ok "the served png is byte-identical to the worktree file"
else bad "the served png differs from $REPO/logo.png"; fi
LEN=$(grep -i '^Content-Length:' "$WORK/hdr" | tr -dc '0-9')

curl -s -D "$WORK/hdr" -o "$WORK/old" "$BASE/bytes/logo.png?$C08"
if cmp -s "$WORK/old" "$WORK/logo.v0"
then ok "?<rev> serves that rev's own bytes"
else bad "the rev's png is not C0's" "$WORK/hdr"; fi
if cmp -s "$WORK/old" "$REPO/logo.png"
then bad "the rev's png is the TIP's bytes"; else ok "and not the tip's"; fi
hdr "the rev's answer is typed too" "Content-Type: image/png"

# HEAD answers the same head, length included, and sends no body.
curl -s -I -D "$WORK/hdr" -o /dev/null "$BASE/bytes/logo.png"
HL=$(grep -i '^Content-Length:' "$WORK/hdr" | tr -dc '0-9')
if [ -n "$HL" ] && [ "$HL" = "$(wc -c < "$WORK/img" | tr -dc '0-9')" ]
then ok "HEAD answers GET's own length ($HL) with no body"
else bad "HEAD length '$HL' vs GET's $LEN" "$WORK/hdr"; fi

# ==========================================================================
# leg 3 — the refusals: a miss, the directory forms, the cap
# ==========================================================================
page "no such file" "/bytes/nope.png" 404
has  "the verb's own plain words" "cat: there is no nope.png in the worktree"
page "no such file at that rev" "/bytes/logo.png?deadbeef" 404
page "a directory is not a page" "/bytes/sub/" 404
page "and the root is not one either" "/bytes/" 404
page "nothing outside the repo" "/bytes/../../etc/passwd" 404
hasnt "and no bytes of it leak" "root:"

if [ "$BIG" = 1 ]; then
    page "over the source cap" "/bytes/huge.png" 413
    has  "it refuses in plain words" "is too big to serve (over 4 MB)"
fi

# ==========================================================================
# leg 4 — the rendered page: an IMAGE goes to /bytes/, a LINK stays on /cat/
# ==========================================================================
page  "the rendered page" "/cat/page.md" 200
has   "the image src points at the bytes route" '<img src="/bytes/logo.png"'
has   "the alt text rides along" 'alt="the logo"'
has   "an ordinary link keeps its painted view" '<a href="/cat/logo.png">'
hasnt "and no link goes to the bytes route" '<a href="/bytes/'
has   "an svg image points at the bytes route too" '<img src="/bytes/draw.svg"'
hasnt "an image resolving to nothing is NOT an img" '<img src="/bytes/nope.png"'
has   "and its alt text is still there" "missing"

# The page at a REV shows that era's picture: the src carries the rev.
page "the page at a rev" "/cat/page.md?$C08" 200
has  "the image src carries the page's rev" '<img src="/bytes/logo.png?'"$C08"'"'

# It survived all of that, and logged a line per request.
if kill -0 "$SRVPID" 2>/dev/null
then ok "the server is still up after every leg"
else bad "the server died" "$WORK/srv.log"; fi
if grep -q "GET /bytes/logo.png 200" "$WORK/srv.log"
then ok "it logs a line per request to the message stream"
else bad "no access line for /bytes/logo.png" "$WORK/srv.log"; fi

kill "$SRVPID" 2>/dev/null; SRVPID=""

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/bytes] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/bytes] $CHECKS checks, runtime $RT"
exit 0
