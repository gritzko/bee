#!/bin/sh
# lite/test/render/run.sh — LITE-045: the MODE AXIS.  lite has N views and three
# renderers, and this suite pins that they are ORTHOGONAL: the same verb reaches
# every sink through the one `runVerb`, and a sink never knows which verb fed it.
#
# What it pins, per mode:
#   --plain   no escape byte ever, the bytes a pipe wants (already pinned per
#             verb elsewhere; here only as the ORACLE the other two are read
#             against)
#   --color   the pager's paint without the viewport: a banner band per hunk,
#             then the body — and STRIPPING every SGR gives back the plain
#             bytes, so colour is paint and never content (LITE-045's whole
#             claim: no pairwise view x renderer code)
#   --html    ONE self-contained page: the stylesheet INLINE (a dump has no
#             server to fetch /style.css from), the dog tok tags as
#             `<span class="tok-X">`, and the markup escaped
#
# and across modes: a mode word is a FLAG wherever it stands, never a verb's
# argument; a view with nothing to show writes NOTHING in all three.
#
# The headless half (the three render(hunks) entry points over hand-built and
# fs-built hunks) is test/render/modes.js, run last.
#
# Standalone: `sh lite/test/render/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/render
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "render: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "render: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "render: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "render: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-render.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "render: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -20 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "render: runtime $RT, fixtures $WORK"

ESC=$(printf '\033')
# Strip every SGR sequence, then the banner band's right padding, so a painted
# dump can be read against the plain one.
strip() { sed -e "s/${ESC}\[[0-9;]*m//g" -e 's/  *$//' "$1"; }
has()  { if grep -q -- "$2" "$WORK/$1"; then ok "$3"; else bad "$3" "$WORK/$1"; fi; }
hasnt() { if grep -q -- "$2" "$WORK/$1"; then bad "$3" "$WORK/$1"; else ok "$3"; fi; }

# ==========================================================================
# the fixture — two commits and one uncommitted edit, so every verb has
# something to say and `diff` has both a dirty and a clean answer.
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'int add(int a, int b) {\n    return a + b;\n}\n' > a.c
  printf 'x\n' > sub/x.txt
  printf 'a < b && c > d\n' > angle.txt        # the HTML escape
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'C0 seed' || exit 1
  printf 'y\n' > sub/x.txt
  git add -A
  GIT_AUTHOR_DATE='@1700086400 +0000' GIT_COMMITTER_DATE='@1700086400 +0000' \
    git commit -q -m 'C1 edit sub' || exit 1
  printf 'int mul(int a, int b) { return a * b; }\n' >> a.c   # uncommitted
) || { echo "render: cannot build the fixture repo" >&2; exit 2; }

# ==========================================================================
# leg 1 — COLOUR IS PAINT.  Per view: --color carries SGR, --plain carries
# none, and stripping the paint gives the plain bytes back (a `bare` view has
# no plain banner, so the band line is dropped; a path/diff hunk banners in
# BOTH modes and the line survives the strip).
# ==========================================================================
# paint <label> <bare?> <word>...
#  The mode word rides LAST: `lite <verb> <arg> --flag` — the verb is argl[0]
#  and the flag scan runs over what follows it (a bare path list scans the lot).
paint() {
    _l=$1; _bare=$2; shift 2
    rtin "$REPO" "$@" --plain > "$WORK/p.out" 2>"$WORK/p.err" || true
    rtin "$REPO" "$@" --color > "$WORK/c.out" 2>"$WORK/c.err" || true
    if grep -q "$ESC" "$WORK/p.out"; then bad "$_l: --plain has no escape byte" "$WORK/p.out"
    else ok "$_l: --plain has no escape byte"; fi
    if grep -q "$ESC" "$WORK/c.out"; then ok "$_l: --color paints"
    else bad "$_l: --color paints" "$WORK/c.out" "$WORK/c.err"; fi
    strip "$WORK/c.out" > "$WORK/c.bare"
    if [ "$_bare" = bare ]; then
        # A `bare` view IS the answer: the plain leg wears no band at all, so
        # the ONE painted band line comes off before the compare.
        tail -n +2 "$WORK/c.bare" > "$WORK/c.body"
        cp "$WORK/p.out" "$WORK/p.body"
    else
        # An EXCERPT bands in both modes — plain spells the band `hunk <uri>`
        # (HUNKu8sFeedBanner's `[verb ]<uri>`), the colour band the uri alone.
        cp "$WORK/c.bare" "$WORK/c.body"
        sed -e 's/^hunk //' "$WORK/p.out" > "$WORK/p.body"
    fi
    if diff -u "$WORK/p.body" "$WORK/c.body" > "$WORK/d.out" 2>&1
    then ok "$_l: stripping the paint gives the plain bytes back"
    else bad "$_l: stripping the paint gives the plain bytes back" "$WORK/d.out"; fi
}

paint "a path"   band a.c
paint "cat"      bare cat a.c
paint "log"      bare log
paint "list"     bare list
paint "tree"     bare tree
paint "blob"     bare blob "$(git -C "$REPO" rev-parse HEAD:sub/x.txt)"

# DIFF is the ONE view whose two modes are not the same bytes, and that is the
# escape hatch working: a diff hunk's `text` is the WEAVE (both sides
# interleaved, the side in each tok32) which only a painter can read, so its
# `plain` carries the C unified render instead.  Pinned both ways.
rtin "$REPO" diff --plain > "$WORK/dp.out" 2>&1
rtin "$REPO" diff --color > "$WORK/dc.out" 2>&1
has dp.out '^+++ b/a.c'  "diff --plain writes the unified render"
has dp.out '^@@ '        "...hunk headers and all"
has dc.out '48;5;157'    "diff --color washes the to-side salad green"
strip "$WORK/dc.out" > "$WORK/dc.bare"
if grep -q 'int mul' "$WORK/dc.bare" && ! grep -q '^+++ b/a.c' "$WORK/dc.bare"
then ok "...over the WEAVE, which carries no unified markers at all"
else bad "...over the WEAVE, which carries no unified markers at all" "$WORK/dc.bare"; fi
if [ "$(head -1 "$WORK/dc.bare")" = "a.c#L1" ]
then ok "...under the same band the plain leg names"
else bad "...under the same band the plain leg names" "$WORK/dc.bare"; fi

# the BAND itself: --color opens each hunk with the theme's banner SGR
rtin "$REPO" --color a.c > "$WORK/band.out" 2>&1
has band.out "38;5;0;48;5;230" "--color opens a hunk with the theme's banner band"
if [ "$(head -1 "$WORK/band.out" | sed -e "s/${ESC}\[[0-9;]*m//g" | sed -e 's/ *$//')" = "a.c" ]
then ok "...and the band names the hunk's uri"
else bad "...and the band names the hunk's uri" "$WORK/band.out"; fi

# ==========================================================================
# leg 2 — --html is ONE self-contained page
# ==========================================================================
rtin "$REPO" --html a.c > "$WORK/h.out" 2>"$WORK/h.err"
has  h.out '<!DOCTYPE html>'          "--html emits a page"
has  h.out '<style>'                  "...with the stylesheet INLINE"
hasnt h.out 'href="/style.css"'       "...and no link to a server it has not got"
has  h.out 'class="tok-'              "...the dog tok tags as span classes"
has  h.out '<title>a.c</title>'       "...titled by the hunk's uri"

#  The source is `a < b && c > d`; the lexer gives each punctuator its own span,
#  so the escaping is asserted per character and the raw byte per pre body.
rtin "$REPO" --html angle.txt > "$WORK/e.out" 2>&1
has  e.out '>&lt;</span>' "--html escapes a source '<'"
has  e.out '>&gt;</span>' "...a source '>'"
has  e.out '>&amp;</span>' "...and a source '&'"
sed -e 's/.*<pre class="body">//' -e 's|</pre>.*||' "$WORK/e.out" > "$WORK/e.body"
if grep -q '[a-z] < \| > [a-z]' "$WORK/e.body"
then bad "...leaving no raw markup byte in the body" "$WORK/e.body"
else ok "...leaving no raw markup byte in the body"; fi

rtin "$REPO" cat --html a.c > "$WORK/hc.out" 2>&1
has  hc.out '<title>cat a.c</title>'  "a verb reaches --html through the same door"
rtin "$REPO" log --html > "$WORK/hl.out" 2>&1
has  hl.out 'C1 edit sub'             "...and so does the log"

# ==========================================================================
# leg 3 — the flag is a FLAG, and nothing to show is nothing in every mode
# ==========================================================================
rtin "$REPO" cat --color a.c > "$WORK/f1.out" 2>&1
rtin "$REPO" cat a.c --color > "$WORK/f2.out" 2>&1
if cmp -s "$WORK/f1.out" "$WORK/f2.out"
then ok "a mode word is a flag wherever it stands"
else bad "a mode word is a flag wherever it stands" "$WORK/f1.out" "$WORK/f2.out"; fi

QUIET=0
for M in --plain --color --html; do
    rtin "$REPO" diff sub/x.txt $M > "$WORK/q.out" 2>"$WORK/q.err"
    [ -s "$WORK/q.out" ] && QUIET=1
done
if [ "$QUIET" = 0 ]
then ok "a view with nothing to show writes nothing, in every mode"
else bad "a view with nothing to show writes nothing, in every mode" "$WORK/q.out"; fi

# a file NAMED like a mode flag is still an argument, not a flag
printf 'plain file\n' > "$REPO/--plainish"
rtin "$REPO" --plain "--plainish" > "$WORK/n.out" 2>"$WORK/n.err"
has n.out 'plain file' "an unknown --word stays the view's argument"

# ==========================================================================
# leg 4 — the headless renderers
# ==========================================================================
( cd "$LITE" && HOME="$FAKEHOME" LITE_FIX="$REPO" \
  "$RT" --eval "require('$CASE/modes.js')" ) > "$WORK/m.out" 2>"$WORK/m.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/m.out" && ! grep -q '^FAIL' "$WORK/m.out"; then
    N=$(grep -c '^ok' "$WORK/m.out"); CHECKS=$((CHECKS + N))
    ok "headless leg: $N checks (the three render(hunks) entry points)"
else
    cat "$WORK/m.out"; head -5 "$WORK/m.err"
    bad "headless leg (rc $RC)" "$WORK/m.out"
fi

if [ "$FAILED" = 0 ]; then echo "PASS [lite/render] $CHECKS checks, runtime $RT"; exit 0
else echo "FAIL [lite/render] $FAILED of $CHECKS checks failed"; exit 1; fi
