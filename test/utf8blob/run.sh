#!/bin/sh
# bee/test/utf8blob/run.sh — BEE-067: a blob that is genuinely NOT UTF-8 must not
# abort a repo's index round, and must not 500 its page.  Legs over the landed
# bee tree, one fixture repo carrying EUC-JP, ISO-8859-1 and mixed blobs:
#   1 — `bee index` completes, 2 — the second run says UP TO DATE (the marks
#   landed), 3 — the LINK and SYM rows of the round are there and answer,
#   4 — the good spans of a BAD blob still mint (the guard is per TOKEN),
#   5 — `bee http` serves those blobs 200, the refused bytes painted U+FFFD.
#
# THE GAP THIS REPROS: `symsOf` (index/lindex.js:126:b_) and `fTokensOn`
# (index/hook.js:37:bn) decoded every raw span STRICTLY, so one EUC-JP fixture blob
# threw `utf8.Decode(): malformed UTF-8` out of `scan()` — no LINK mark, no SYM
# mark, every next process re-lexing the whole tip tree (11.6 s per `bee sym`
# run on ///git), and `upForeign` swallowing the throw so nothing ever said so.
# The page died the same way one layer up: render/html.js decodes the ASSEMBLED
# page buffer, into which the painter feeds blob bytes verbatim.
#
# Standalone: `sh bee/test/utf8blob/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`); the DOG-034 lexer is what fuses the
# multi-byte runs into word tokens, so this wants a quickjab build.  $LITEPORT
# overrides the loopback port.  Fixtures live in a mktemp dir under ~/tmp.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/utf8blob
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "utf8blob: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "utf8blob: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git  >/dev/null 2>&1 || { echo "utf8blob: SKIP — no git to build a fixture" >&2; exit 0; }
command -v curl >/dev/null 2>&1 || { echo "utf8blob: SKIP — no curl to drive the server" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "utf8blob: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-utf8blob.XXXXXX") || exit 2
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "utf8blob: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"            # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
PORT="${LITEPORT:-18067}"
BASE="http://127.0.0.1:$PORT"

# --- the fixture ----------------------------------------------------------
#  The bytes are the shape git.git's own t/t3434 fixtures have — the very blobs
#  that took `bee index ///git` down.  None of them is BINARY (no NUL), so
#  weave.isBinary lets every one through to the lexer, as it does in git.git.
#   doc/guide.mkd    valid UTF-8 prose, the LINK source
#   src/ok.js        valid UTF-8 code, the SYM source
#   t/eucJP.txt      EUC-JP: multi-byte runs lex as words -> the symsOf throw
#   t/ISO8859-1.txt  Latin-1: one-byte bad spans, under SYM_MIN — the PAGE case
#   t/iso.sh         ASCII code AROUND Latin-1 bytes -> the fTokensOn throw, and
#                    the proof the guard is per TOKEN: `latin1Sample` still mints
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p doc src t
  printf 'the guide\nit points at t/eucJP.txt and at LITE-029 here\n' > doc/guide.mkd
  printf 'function utf8Sample() { return 1; }\n' > src/ok.js
  printf '\244\317\244\354\244\322\244\333\244\365\n\n\244\267\244\306\244\244\244\353\244\316\244\254\n' > t/eucJP.txt
  printf '\304\313\321\317\326\n\n\301\142\347\144\350\146\147\n' > t/ISO8859-1.txt
  printf '#!/bin/sh\nlatin1Sample() {\n\techo "\304\313\321\317\326"\n}\n' > t/iso.sh
  git add -A
  GIT_AUTHOR_DATE="2022-01-01T00:00:00Z" GIT_COMMITTER_DATE="2022-01-01T00:00:00Z" \
    git commit -q -m c0 || exit 1
) || { echo "utf8blob: cannot build the fixture repo" >&2; exit 2; }
RREPO=$(cd "$REPO" && pwd -P)
NAME=$(basename "$RREPO")
echo "utf8blob: runtime $RT, repo $REPO, port $PORT"

indexbytes() { cat "$REPO"/.git/be/* 2>/dev/null | wc -c | tr -d ' '; }

# ==========================================================================
# leg 1 — the round completes
# ==========================================================================
# S1: THE BUG.  One EUC-JP blob used to throw out of scan() and take the whole
# repo with it; nothing here is unreadable, so the verb must simply finish.
rtin "$REPO" index > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
if [ "$RC" = 0 ] && ! grep -q "malformed UTF-8" "$WORK/i1" "$WORK/i1e"
then ok "bee index finishes with EUC-JP, Latin-1 and mixed blobs in the tip"
else bad "bee index finishes over non-UTF-8 blobs (rc $RC)" "$WORK/i1" "$WORK/i1e"; fi

# ==========================================================================
# leg 2 — the marks landed, so the tip is never re-lexed
# ==========================================================================
# S2: the whole point — a mark the first run never wrote made EVERY next process
# walk the tip tree again (BEE-067:11).
B1=$(indexbytes)
rtin "$REPO" index > "$WORK/i2" 2>"$WORK/i2e"; RC=$?
if [ "$RC" = 0 ] && grep -q "up to date" "$WORK/i2"
then ok "the second run is UP TO DATE — both marks landed"
else bad "the second run is up to date (rc $RC)" "$WORK/i2" "$WORK/i2e"; fi

# S3: and it wrote nothing at all.
B2=$(indexbytes)
if [ "$B1" = "$B2" ]
then ok "the rerun writes no bytes ($B1)"
else bad "the rerun writes no bytes ($B1 -> $B2)" "$WORK/i2"; fi

# ==========================================================================
# leg 3 — the rows of that round are there
# ==========================================================================
# S4: the LINK family survived the bad blobs beside it.
rtin "$REPO" lindex t/eucJP.txt > "$WORK/q1" 2>"$WORK/q1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q1")" = "$RREPO/doc/guide.mkd" ]
then ok "lindex t/eucJP.txt = doc/guide.mkd (the LINK round still ran)"
else bad "lindex t/eucJP.txt = doc/guide.mkd (rc $RC)" "$WORK/q1" "$WORK/q1e"; fi

# S5: and so did the SYM family.
rtin "$REPO" sym --paths utf8Sample > "$WORK/q2" 2>"$WORK/q2e"; RC=$?
if [ "$RC" = 0 ] && grep -qF "src/ok.js" "$WORK/q2"
then ok "sym utf8Sample = src/ok.js (the SYM round still ran)"
else bad "sym utf8Sample = src/ok.js (rc $RC)" "$WORK/q2" "$WORK/q2e"; fi

# ==========================================================================
# leg 4 — the guard is per TOKEN, not per blob
# ==========================================================================
# S6: t/iso.sh carries Latin-1 bytes AND ASCII code.  Only the spans that will
# not decode are dropped; every other token of that same blob still mints.
rtin "$REPO" sym --paths latin1Sample > "$WORK/q3" 2>"$WORK/q3e"; RC=$?
if [ "$RC" = 0 ] && grep -qF "t/iso.sh" "$WORK/q3"
then ok "sym latin1Sample = t/iso.sh (a bad blob's GOOD spans still mint)"
else bad "sym latin1Sample = t/iso.sh (rc $RC)" "$WORK/q3" "$WORK/q3e"; fi

# ==========================================================================
# leg 5 — the page
# ==========================================================================
( cd "$REPO"; exec env HOME="$FAKEHOME" "$RT" http --port "$PORT" ) \
  > "$WORK/srv.log" 2>&1 &
SRVPID=$!
N=0
while [ "$N" -lt 100 ]; do
    curl -s -o /dev/null "$BASE/$NAME/list/" && break
    grep -qi "in use" "$WORK/srv.log" && break
    N=$((N + 1)); sleep 0.1
done
if grep -qi "in use" "$WORK/srv.log"; then
    echo "utf8blob: SKIP — port $PORT is taken; rerun with LITEPORT=<free port>" >&2
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

# S7..S10: every one of these answered 500 `bee http: utf8.Decode(): malformed
# UTF-8` before — the painter decodes the ASSEMBLED page, so one refused byte
# anywhere killed the whole response.
page "a Latin-1 blob paints"      "/$NAME/cat/t/ISO8859-1.txt" 200
page "its source view paints"     "/$NAME/raw/t/ISO8859-1.txt" 200
page "an EUC-JP blob paints"      "/$NAME/cat/t/eucJP.txt"     200
page "a mixed shell blob paints"  "/$NAME/cat/t/iso.sh"        200

# S11: a refused byte paints as U+FFFD — the replacement character, what every
# reader shows — so the page says WHERE the bytes stopped being text.
curl -s -o "$WORK/body" "$BASE/$NAME/cat/t/ISO8859-1.txt"
if grep -q "$(printf '\357\277\275')" "$WORK/body"
then ok "a refused byte paints as U+FFFD, not as a 500"
else bad "a refused byte paints as U+FFFD" "$WORK/body"; fi

# S12: the ASCII around it is untouched.
if grep -qF "fg" "$WORK/body"
then ok "the readable bytes of the same blob paint verbatim"
else bad "the readable bytes of the same blob paint verbatim" "$WORK/body"; fi

# S13: the server is still up — a bad blob never takes the one pol loop down.
page "the server survived it all" "/$NAME/list/" 200

echo "utf8blob: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
