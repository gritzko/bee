#!/bin/sh
# bee/test/chatty/run.sh — CODE-032: a STAGER that talks while we feed it.
# THE REPRO: stage.js:73 fed the whole NUL-framed batch into the child's stdin
# and only drained its stdout afterwards.  With a batch bigger than the 64K pipe
# and a child that says anything at all before it reads, both ends block on a
# full pipe and the run never returns — the "never block a chatty git" comment
# claimed the opposite of what the ordering delivered.
#   leg 1  a `git` shim that writes 256K to STDOUT before touching its stdin:
#          `bee add` over a 100K+ path list must still finish, and report
#   leg 2  the ticket's own scenario, with the REAL git: 1500 CRLF files.  It
#          does NOT hang even unfixed — git's CRLF warnings go to stderr, which
#          the child INHERITS (io.c:913) — so this leg pins where they land
#
# Standalone: `sh bee/test/chatty/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/chatty
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "chatty: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "chatty: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "chatty: SKIP — no git to build a fixture" >&2; exit 0; }
command -v timeout >/dev/null 2>&1 || { echo "chatty: SKIP — no timeout to bound a hang" >&2; exit 0; }
GIT=$(command -v git)

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "chatty: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-chatty.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "chatty: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -c 2000 "$f"; echo; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — nothing here ever
#  writes the developer's own `$HOME/.config/bee/repos`.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                # TEST-005:8 unpacked-runtime climb
echo "chatty: runtime $RT, fixtures $WORK"

# The batch has to outgrow the 64K pipe before either end can wedge, so the
# names are long and there are many of them: 1500 * ~76 bytes ≈ 114K.
PAD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
seed() {
  _at=$1; _body=$2
  mkdir -p "$_at/deep" || return 1
  (
    cd "$_at" || exit 1
    git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
    printf '* text=auto\n' > .gitattributes
    _i=0
    while [ "$_i" -lt 1500 ]; do
      printf 'seed\n' > "deep/$PAD$_i.txt"
      _i=$((_i + 1))
    done
    git add -A
    GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
      git commit -q -m seed || exit 1
    _i=0
    while [ "$_i" -lt 1500 ]; do
      printf "$_body" > "deep/$PAD$_i.txt"
      _i=$((_i + 1))
    done
  ) || return 1
  return 0
}

# ==========================================================================
# leg 1 — a chatty-on-stdout stager: the deadlock, bounded by `timeout`
# ==========================================================================
SHIM="$WORK/shim"; mkdir -p "$SHIM"
cat > "$SHIM/git" <<SHIMEOF
#!/bin/sh
#  CODE-032 fixture: a git that says 256K on STDOUT before it reads one byte of
#  its stdin.  Every other invocation is the real git, verbatim.
for a in "\$@"; do
    [ "\$a" = "--pathspec-from-file=-" ] || continue
    S=xxxxxxxxxxxxxxxx
    while [ \${#S} -lt 262144 ]; do S="\$S\$S"; done
    printf '%s\n' "\$S"
    break
done
exec $GIT "\$@"
SHIMEOF
chmod +x "$SHIM/git"

LOUD="$WORK/loud"
seed "$LOUD" 'edit\n' || { echo "chatty: cannot build the loud fixture" >&2; exit 2; }

( cd "$LOUD" && PATH="$SHIM:$PATH" HOME="$FAKEHOME" timeout 60 "$RT" add ) \
    > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'add 1500 staged' "$WORK/l1"
then ok "a stager chatty on stdout cannot wedge the feed — 1500 staged"
else bad "the chatty stager (rc $RC — a timeout kill means the feed deadlocked)" \
         "$WORK/l1e"; fi

if [ "$(git -C "$LOUD" diff --name-only | wc -l)" = 0 ]
then ok "...and every path of the batch really landed in the index"
else bad "the batch is not fully staged"; fi

# ==========================================================================
# leg 2 — the REAL git, the ticket's CRLF batch: the warnings are STDERR's
# ==========================================================================
CRLF="$WORK/crlf"
seed "$CRLF" 'one\r\ntwo\r\n' || { echo "chatty: cannot build the crlf fixture" >&2; exit 2; }

( cd "$CRLF" && HOME="$FAKEHOME" timeout 60 "$RT" add ) > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'add 1500 staged' "$WORK/l2"
then ok "a 114K CRLF batch through the real git stages and reports"
else bad "the real-git CRLF batch (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi

if grep -q 'CRLF' "$WORK/l2e" && ! grep -q 'CRLF' "$WORK/l2"
then ok "git's per-file CRLF warnings ride INHERITED stderr, never the pipe"
else bad "where the CRLF warnings landed" "$WORK/l2"; fi

echo "chatty: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
