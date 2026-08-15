#!/bin/sh
# lite/test/blob/run.sh — LITE-017: `lite blob <hexlet>`, be/test/blob/fullsha
# ported.  be's bug was JS-082: the view gated the hex then handed it to a
# {1,39} prefix scanner, so a FULL 40-char object id came back BLOBNONE though
# the header promised full-sha support.  lite has no prefix scanner of its own
# — `git.getHex` takes any 6..40 name — so the same contract is pinned from the
# outside: the full sha emits the SAME bytes the short prefix does, the banner
# is the RESOLVED full sha either way, and the neighbours (a zero sha, a commit,
# a tree, a non-hex arg) are refused cleanly with nothing on stdout.
#
# Model differences from be, deliberate:
#   * lite's blob takes a HEXLET only — be's `<path>?<ref>` slot is `lite cat
#     <path>?<rev>`, which is where a path belongs;
#   * `--plain` is the blob's bytes VERBATIM (no `blob <sha>#L<n>` banner line):
#     the LITE-009 convention, a pipe gets the object.  The banner rides the tty
#     hunk, which is where be's ruling ("a HUNK, not a raw dump") bites.
#
# Standalone: `sh lite/test/blob/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.  Fixtures
# live in a mktemp dir under ~/tmp, removed on a green run.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/blob
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "blob: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "blob: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "blob: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "blob: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-blob.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "blob: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "blob: runtime $RT, fixtures $WORK"

# --- the fixture: one committed file -> a commit, a tree and a blob --------
REPO="$WORK/repo"; mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'hello world\n' > a.txt
  : > empty.txt
  git add -A && git commit -q -m 'first commit'
) || { echo "blob: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
COMMIT=$(g rev-parse HEAD)
TREE=$(g rev-parse "HEAD^{tree}")
BLOB=$(g rev-parse "HEAD:a.txt")
EMPTY=$(g rev-parse "HEAD:empty.txt")
SHORT=$(printf '%s' "$BLOB" | cut -c1-8)
SHORT6=$(printf '%s' "$BLOB" | cut -c1-6)

# The blob sha the fixture found must be a full 40-hex id, or nothing below
# means anything.
case "$BLOB" in
    *[!0-9a-f]*|"") echo "blob: fixture blob sha is not 40-hex: '$BLOB'" >&2; exit 2 ;;
esac

# --- parity: the full sha emits exactly what the short prefix does ---------
rtin "$REPO" blob "$SHORT" > "$WORK/short" 2>"$WORK/short.err"; RC=$?
if [ "$RC" = 0 ] && [ -s "$WORK/short" ]
then ok "the short-prefix oracle emits the blob"
else bad "short oracle (rc $RC)" "$WORK/short" "$WORK/short.err"; fi

parity() {   # parity <label> <hexlet>
    _l=$1; _h=$2
    rtin "$REPO" blob "$_h" > "$WORK/p.out" 2>"$WORK/p.err"; _rc=$?
    if [ "$_rc" = 0 ] && [ -s "$WORK/p.out" ] && cmp -s "$WORK/short" "$WORK/p.out"
    then ok "$_l"
    else bad "$_l (rc $_rc)" "$WORK/short" "$WORK/p.out" "$WORK/p.err"; fi
}
parity "JS-082: a FULL 40-char object id emits the same bytes" "$BLOB"
parity "a 6-char hexlet (the floor) emits the same bytes" "$SHORT6"
parity "an UPPERCASE hexlet emits the same bytes" "$(printf '%s' "$BLOB" | tr 'a-f' 'A-F')"

# --- the bytes are the blob's own, verbatim -------------------------------
g cat-file blob "$BLOB" > "$WORK/oracle"
if cmp -s "$WORK/oracle" "$WORK/short"
then ok "--plain is the blob's bytes verbatim (git cat-file blob parity)"
else bad "verbatim bytes" "$WORK/oracle" "$WORK/short"; fi

# An EMPTY blob emits nothing at all — cat's own no-banner-for-nothing case.
rtin "$REPO" blob "$EMPTY" > "$WORK/e.out" 2>"$WORK/e.err"; RC=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/e.out" ]
then ok "an empty blob emits nothing, and says nothing about it"
else bad "empty blob (rc $RC)" "$WORK/e.out" "$WORK/e.err"; fi

# --- the refusals: no stdout, non-zero, plain words ------------------------
refuse() {   # refuse <label> <want-word> <arg>
    _l=$1; _w=$2; _a=$3
    rtin "$REPO" blob "$_a" > "$WORK/r.out" 2>"$WORK/r.err"; _rc=$?
    if [ "$_rc" != 0 ] && [ ! -s "$WORK/r.out" ] && grep -q "$_w" "$WORK/r.err"
    then ok "$_l"
    else bad "$_l (rc $_rc)" "$WORK/r.out" "$WORK/r.err"; fi
}
ZERO=0000000000000000000000000000000000000000
refuse "a non-existent full sha is refused, silently on stdout" "no object" "$ZERO"
refuse "a COMMIT sha is not a blob and says so" "is a commit, not a file" "$COMMIT"
refuse "a TREE sha is not a blob and says so" "is a tree, not a file" "$TREE"
refuse "a non-hex arg is refused in plain words" "hex digits" "not-a-sha"
refuse "a 5-char hexlet is under the floor" "hex digits" "abcde"
rtin "$REPO" blob > "$WORK/r0.out" 2>"$WORK/r0.err"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/r0.out" ] && grep -q "hex digits" "$WORK/r0.err"
then ok "a bare 'lite blob' is refused in plain words"
else bad "bare blob (rc $RC)" "$WORK/r0.out" "$WORK/r0.err"; fi

# --- the tty side: ONE hunk, banner = the RESOLVED full sha ----------------
ln -sf "$LITE" "$WORK/jsrc"
( cd "$LITE" && HOME="$FAKEHOME" "$RT" --eval \
  "const o = require('view/blob.js').blob('$SHORT', { from: '$REPO' });
   const w = (s) => { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); };
   w('uri=' + o.uri + '\n');
   w('hunks=' + o.hunks.length + ' kind=' + (o.hunks[0] || {}).kind + '\n');" ) \
  > "$WORK/h.out" 2>"$WORK/h.err"; RC=$?
if [ "$RC" = 0 ] && grep -qx "uri=blob $BLOB" "$WORK/h.out" &&
   grep -qx "hunks=1 kind=blob" "$WORK/h.out"
then ok "a short hexlet banners the RESOLVED full sha, as one hunk"
else bad "hunk banner (rc $RC)" "$WORK/h.out" "$WORK/h.err"; fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/blob] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/blob] $CHECKS checks, runtime $RT"
exit 0
