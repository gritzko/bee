#!/bin/sh
# bee/test/hifence/run.sh — MARK-018: a fenced block paints in its own language.
# The info string used to reach the `class="language-c"` attribute and stop
# there (mark/html.js:189:tz), so a `.mkd` page served a C body as one unpainted
# slab while the same bytes in a `.c` file paint fully.  Three legs:
#
#   1. the paint — a known info string puts `tok-*` spans INSIDE the
#      `<pre><code class="language-c">`, one class per dog/tok tag;
#   2. the bytes — stripping the tags off the block gives the fence body back,
#      escaping and indentation included, so no byte is invented or lost;
#   3. the fallback — no info, an unknown info and an empty body render exactly
#      as they did before, and `.md` fences take the same path.
#
# Standalone: `sh bee/test/hifence/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/hifence
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "hifence: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "hifence: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "hifence: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-hifence.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "hifence: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
lite() { ( cd "$WORK" && HOME="$FAKEHOME" "$RT" mark "$@" ); }
echo "hifence: runtime $RT, fixtures $WORK"

# The page: one C fence with a comment, a keyword, a number and a string that
# needs escaping; then the three fences that must NOT paint.
cat > "$WORK/page.mkd" <<'MKD'
#   Fenced

````c
    //  why: the comment paints too
    int x = 42;
    char *s = "a & <b>";
````

````text
    int not_code = 42;
````

````
    int bare_fence = 42;
````
MKD
# The `.md` twin: the same emitter serves CommonMark, so it paints alike.
cat > "$WORK/plain.md" <<'MKD'
# Fenced

```c
int y = 7;
```
MKD

run() {   # run <file> -> $WORK/out
    lite "$1" > "$WORK/out" 2>"$WORK/err"; RC=$?
    [ "$RC" = 0 ] || bad "mark $1 (rc $RC)" "$WORK/out" "$WORK/err"
}
has()   { if grep -qF "$2" "$WORK/out"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/out"; fi; }
hasnt() { if grep -qF "$2" "$WORK/out"; then bad "$1 — '$2' is there" "$WORK/out"; else ok "$1"; fi; }

# The Nth `<pre><code ...>` block's inner html, one file per block.
block() {   # block <n> -> $WORK/blk
    awk -v n="$1" '
      /<pre><code/ { i++; if (i == n) { sub(/^.*<pre><code[^>]*>/, ""); grab = 1 } }
      grab { if (/<\/code><\/pre>/) { sub(/<\/code><\/pre>.*$/, "")
                                   if (length($0)) print
                                   grab = 0; next }
             print }
    ' "$WORK/out" > "$WORK/blk"
}
# The block's own BYTES back: tags off, the four entities unescaped.
plain() {   # plain -> $WORK/plain
    sed -e 's/<[^>]*>//g' -e 's/&lt;/</g' -e 's/&gt;/>/g' \
        -e 's/&quot;/"/g' -e 's/&amp;/\&/g' "$WORK/blk" > "$WORK/plain"
}

# ==========================================================================
# leg 1 — the paint: a `c` fence wears the tok classes
# ==========================================================================
run page.mkd
has "the fence keeps its language class"  '<pre><code class="language-c">'
block 1
inblk() { if grep -qF "$2" "$WORK/blk"; then ok "$1"; else bad "$1 — no '$2'" "$WORK/blk"; fi; }
inblk "a C comment is painted"            '<span class="tok-D">'
inblk "a C keyword is painted"            '<span class="tok-R">'
inblk "a C number is painted"             '<span class="tok-L">'
inblk "a C string is painted"             '<span class="tok-G">'
#  A comment reaches the callback word by word: one span must cover the run.
inblk "a comment is ONE span, not one per word" \
      '<span class="tok-D">//  why: the comment paints too</span>'

# ==========================================================================
# leg 2 — the bytes: the paint invents and drops nothing
# ==========================================================================
plain
printf '//  why: the comment paints too\nint x = 42;\nchar *s = "a & <b>";\n' \
  > "$WORK/want"
if cmp -s "$WORK/plain" "$WORK/want"; then ok "the painted block is the fence body"
else bad "the painted block is the fence body" "$WORK/plain" "$WORK/want"; fi
if grep -qF '&quot;a &amp; &lt;b&gt;&quot;' "$WORK/blk"
then ok "the body is still escaped"
else bad "the body is still escaped — no escaped string" "$WORK/blk"; fi

# ==========================================================================
# leg 3 — the fallback: an unknown info and a bare fence stay as they were
# ==========================================================================
has "an unknown info keeps its class"     '<pre><code class="language-text">'
has "a bare fence keeps its plain code"   '<pre><code>'
block 2
if grep -q '<span' "$WORK/blk"; then bad "an unknown info paints nothing" "$WORK/blk"
else ok "an unknown info paints nothing"; fi
block 3
if grep -q '<span' "$WORK/blk"; then bad "a bare fence paints nothing" "$WORK/blk"
else ok "a bare fence paints nothing"; fi

run plain.md
has "a .md fence paints alike"            '<span class="tok-R">'
block 1
plain
printf 'int y = 7;\n' > "$WORK/want"
if cmp -s "$WORK/plain" "$WORK/want"; then ok "the .md block is its fence body"
else bad "the .md block is its fence body" "$WORK/plain" "$WORK/want"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/hifence] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/hifence] $CHECKS checks, runtime $RT"
exit 0
