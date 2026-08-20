#!/bin/sh
# bee/test/freshcommit/run.sh — BEE-031: a fresh commit is unindexed.  Two legs,
# one gap seen from the writing and from the reading side:
#
#   1. the PLANT — `bee install` puts a `post-commit` hook beside `pre-commit`,
#      composing with one already there, idempotent, QUIET on success; git
#      ignores its status, so a failing pass never blocks or undoes a commit;
#      it runs `bee hook --post`, which does NOT write the registry;
#   2. the FAN-OUT — a foreign lane is brought UP on open (`door.js inMount`),
#      so a ticket page committed in one repo resolves from another with NO
#      `bee index` in between.  The GIT side of that repo stays untouched, a
#      repo with NO lane is left alone, and a lane that will not take a write
#      falls back to the read-only open instead of throwing the page away.
#
# BEFORE BEE-031 both fail: `bee index` right after a commit says `indexed 1
# commits` (the pre-commit pass ran while HEAD was still the parent), and
# `bee see BEE-777` from another repo says `no registered repo holds BEE-777`.
#
# Standalone: `sh bee/test/freshcommit/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/freshcommit
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "freshcommit: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 ||
         { echo "freshcommit: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 ||
  { echo "freshcommit: SKIP — no git to drive a commit" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "freshcommit: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-freshcommit.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK";
      else echo "freshcommit: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}

# The registry lives in $HOME/.config/bee/repos and holds REAL user repos, so
# every run below stands in a FAKE home: nothing here registers or indexes one.
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
gitin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" \
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  git "$@" ); }
mkrepo() {   # mkrepo <dir>
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
echo "freshcommit: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — the PLANT: `bee install` puts post-commit beside pre-commit
# ==========================================================================
CODE="$WORK/code"
mkrepo "$CODE"
( cd "$CODE" && printf 'int a;\n' > a.c && git add -A && git commit -q -m 'a' ) || exit 2

# A PRE-EXISTING post-commit hook bee must COMPOSE with, never clobber.  It
# writes an ABSOLUTE path, so it says it ran wherever the hook is run from.
cat > "$CODE/.git/hooks/post-commit" <<EOF
#!/bin/sh
: > "$WORK/theirs-post.ran"
exit 0
EOF
chmod +x "$CODE/.git/hooks/post-commit"

rtin "$CODE" install > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
if [ "$RC" = 0 ] && [ -x "$CODE/.git/hooks/pre-commit" ] &&
   [ -x "$CODE/.git/hooks/post-commit" ] &&
   grep -q 'BEE-031' "$CODE/.git/hooks/post-commit" &&
   grep -q 'theirs-post.ran' "$CODE/.git/hooks/post-commit"
then ok "install plants post-commit BESIDE pre-commit, keeping the one already there"
else bad "install (rc $RC)" "$WORK/i1" "$WORK/i1e" "$CODE/.git/hooks/post-commit"; fi

if grep -q 'post-commit' "$WORK/i1"
then ok "...and the report line says so"
else bad "the report line still names one hook" "$WORK/i1"; fi

cp "$CODE/.git/hooks/pre-commit"  "$WORK/h.pre"
cp "$CODE/.git/hooks/post-commit" "$WORK/h.post"
rtin "$CODE" install > "$WORK/i2" 2>"$WORK/i2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/h.pre" "$CODE/.git/hooks/pre-commit" &&
   cmp -s "$WORK/h.post" "$CODE/.git/hooks/post-commit" &&
   grep -q 'already installed' "$WORK/i2"
then ok "install twice leaves BOTH hook files byte for byte"
else bad "reinstall no-op (rc $RC)" "$WORK/i2" "$WORK/i2e" "$CODE/.git/hooks/post-commit"; fi

# --- the commit indexes ITSELF --------------------------------------------
rm -f "$WORK/theirs-post.ran"
( cd "$CODE" && printf 'int b;\n' > b.c ) && gitin "$CODE" add -A || exit 2
gitin "$CODE" commit -m 'b' > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
if [ "$RC" = 0 ]; then ok "the commit lands with both hooks in the way"
else bad "git commit (rc $RC)" "$WORK/c1" "$WORK/c1e"; fi

TIP=$(gitin "$CODE" rev-parse HEAD)
rtin "$CODE" index > "$WORK/x1" 2>"$WORK/x1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^up to date' "$WORK/x1" && grep -q "$(echo "$TIP" | cut -c1-8)" "$WORK/x1"
then ok "the lane already holds the commit just made — nothing left to index"
else bad "the fresh commit is UNINDEXED (rc $RC)" "$WORK/x1" "$WORK/x1e"; fi

if [ -f "$WORK/theirs-post.ran" ]
then ok "...and the pre-existing post-commit hook ran too"
else bad "the pre-existing post-commit hook never ran" "$CODE/.git/hooks/post-commit"; fi

# QUIET on success: a summary line per commit is noise.  git's own output is
# the three lines it always writes; nothing of bee's rides along.
if ! grep -q 'up to date\|indexed .* commits\|kv:' "$WORK/c1" &&
   ! grep -q 'up to date\|indexed .* commits\|kv:' "$WORK/c1e"
then ok "the pass is QUIET — no per-commit summary on the commit's streams"
else bad "the post-commit pass talks on a good commit" "$WORK/c1" "$WORK/c1e"; fi

# It must NEVER block or undo a commit: run the hook by hand where `bee index`
# cannot work at all (no repo here).  rc 0, the composed line still runs, and
# the failure is on stderr where a failure belongs.
NOREPO="$WORK/norepo"; mkdir -p "$NOREPO"
rm -f "$WORK/theirs-post.ran"
( cd "$NOREPO" && HOME="$FAKEHOME" sh "$CODE/.git/hooks/post-commit" ) \
  > "$WORK/p1" 2>"$WORK/p1e"; RC=$?
if [ "$RC" = 0 ] && [ -f "$WORK/theirs-post.ran" ] && [ -s "$WORK/p1e" ]
then ok "a FAILING pass exits 0, says so on stderr, and the rest of the hook runs"
else bad "the post-commit hook would block a commit (rc $RC)" "$WORK/p1" "$WORK/p1e"; fi

# --- the REGISTRY is not the hook's to write ------------------------------
# merge.js:196:rE — `install` is the ONE verb that writes `~/.config/bee/repos`.
# `solo` is never installed and never indexed: its hook is planted BY HAND with
# the very line bee plants, so a commit exercises the pass and nothing else.
SOLO="$WORK/solo"
mkrepo "$SOLO"
( cd "$SOLO" && printf 'S0\n' > s.txt && git add -A && git commit -q -m 'solo seed' ) || exit 2
BEELINE=$(grep -F "$RT" "$CODE/.git/hooks/post-commit" | head -1)
printf '#!/bin/sh\n%s\n' "$BEELINE" > "$SOLO/.git/hooks/post-commit"
chmod +x "$SOLO/.git/hooks/post-commit"

REG="$FAKEHOME/.config/bee/repos"
cp "$REG" "$WORK/reg.before" 2>/dev/null || : > "$WORK/reg.before"
( cd "$SOLO" && printf 'S1\n' > t.txt ) && gitin "$SOLO" add -A || exit 2
gitin "$SOLO" commit -q -m 'solo t' || exit 2
if cmp -s "$WORK/reg.before" "$REG" && ! grep -qF "$SOLO" "$REG"
then ok "a commit leaves the REGISTRY byte for byte — the hook never tracks"
else bad "the post-commit pass wrote the registry" "$REG" "$WORK/reg.before"; fi

# ...and it still did its job: the lane holds the commit that just landed.
# (This `index` is a HUMAN run, so it registers `solo` — after the check above.)
rtin "$SOLO" index > "$WORK/x2" 2>"$WORK/x2e"
if grep -q '^up to date' "$WORK/x2"
then ok "...while the lane still came up to the new tip"
else bad "the untracked pass indexed nothing" "$WORK/x2" "$WORK/x2e"; fi

# ==========================================================================
# leg 2 — the FAN-OUT: a foreign lane is brought UP on open
#
# `journal` is registered and indexed but has NO hooks, so its lane goes stale
# the moment a page is committed — which is exactly the state a reader finds a
# repo in when the reader is not the one who committed.
# ==========================================================================
JOURNAL="$WORK/journal"; READER="$WORK/reader"
mkrepo "$JOURNAL"; mkdir -p "$JOURNAL/todo/BEE"
( cd "$JOURNAL" && printf '#   BEE-700: the seed\n\nseeded\n' > todo/BEE/BEE-700.mkd &&
  git add -A && git commit -q -m 'journal seed' ) || exit 2
mkrepo "$READER"
( cd "$READER" && printf 'int r;\n' > r.c && git add -A && git commit -q -m 'reader seed' ) || exit 2
rtin "$JOURNAL" index > "$WORK/j0" 2>&1 || { bad "index journal" "$WORK/j0"; exit 1; }
rtin "$READER"  index > "$WORK/r0" 2>&1 || { bad "index reader"  "$WORK/r0"; exit 1; }

( cd "$JOURNAL" && printf '#   BEE-777: the fresh one\n\nFRESHMARK\n' > todo/BEE/BEE-777.mkd ) || exit 2
gitin "$JOURNAL" add -A || exit 2
gitin "$JOURNAL" commit -q -m 'BEE-777 lands' || exit 2
JTIP=$(gitin "$JOURNAL" rev-parse HEAD)

rtin "$READER" see --plain BEE-777 > "$WORK/s1" 2>"$WORK/s1e"; RC=$?
if [ "$RC" = 0 ] && grep -q 'FRESHMARK' "$WORK/s1"
then ok "a page committed in ANOTHER repo resolves with no \`bee index\` in between"
else bad "the fresh page does not resolve (rc $RC)" "$WORK/s1" "$WORK/s1e"; fi

rtin "$JOURNAL" index > "$WORK/j1" 2>"$WORK/j1e"
if grep -q '^up to date' "$WORK/j1"
then ok "...because the READ brought that repo's lane up"
else bad "the foreign lane was not brought up" "$WORK/j1" "$WORK/j1e"; fi

# The GIT side of a foreign repo is untouchable: only `.git/be` may have moved.
if [ "$(gitin "$JOURNAL" rev-parse HEAD)" = "$JTIP" ] &&
   [ -z "$(gitin "$JOURNAL" status --porcelain)" ] &&
   ! gitin "$JOURNAL" config --get merge.bee.driver >/dev/null 2>&1 &&
   [ ! -e "$JOURNAL/.git/hooks/post-commit" ]
then ok "the GIT side stayed untouched — head, worktree, config, hooks"
else bad "a browse moved the foreign repo's GIT side"; fi

# ==========================================================================
# leg 2, the guards
# ==========================================================================
# A repo with NO lane keeps its answer as today: a browse must not turn into
# somebody's first full index of a kernel clone.
PLAIN="$WORK/plain"
mkrepo "$PLAIN"; mkdir -p "$PLAIN/todo/BEE"
( cd "$PLAIN" && printf '#   BEE-800: unindexed\n\nPLAINMARK\n' > todo/BEE/BEE-800.mkd &&
  git add -A && git commit -q -m 'plain seed' ) || exit 2
printf '%s\n' "$PLAIN" >> "$FAKEHOME/.config/bee/repos"    # registered BY HAND: no lane

rtin "$READER" see --plain BEE-800 > "$WORK/s2" 2>"$WORK/s2e"
if [ ! -d "$PLAIN/.git/be" ]
then ok "a registered repo with NO lane is left alone — no lane was minted"
else bad "the browse indexed an unindexed repo" "$WORK/s2"; fi
if ! grep -q 'PLAINMARK' "$WORK/s2"
then ok "...and it answers exactly as it did before (the anchored/boundary legs)"
else bad "the fresh-lane guard leaked an answer" "$WORK/s2"; fi

# A lane that will not take a write falls back to the READ-ONLY open: the repo
# answers off the rows it has, rather than the page being thrown away.
LOCKED="$WORK/locked"
mkrepo "$LOCKED"; mkdir -p "$LOCKED/todo/BEE"
( cd "$LOCKED" && printf '#   BEE-900: locked\n\nLOCKEDMARK\n' > todo/BEE/BEE-900.mkd &&
  git add -A && git commit -q -m 'locked seed' ) || exit 2
rtin "$LOCKED" index > "$WORK/l0" 2>&1 || { bad "index locked" "$WORK/l0"; exit 1; }
( cd "$LOCKED" && printf 'z\n' > z.txt && git add -A && git commit -q -m 'z' ) || exit 2
chmod 0555 "$LOCKED/.git/be"
if [ "$(id -u)" = 0 ] || ( : > "$LOCKED/.git/be/probe" ) 2>/dev/null; then
    rm -f "$LOCKED/.git/be/probe"
    echo "freshcommit: SKIP the read-only lane check — this user writes anyway" >&2
else
    rtin "$READER" see --plain BEE-900 > "$WORK/s3" 2>"$WORK/s3e"; RC=$?
    if [ "$RC" = 0 ] && grep -q 'LOCKEDMARK' "$WORK/s3"
    then ok "a lane that cannot be written falls back to the read-only open"
    else bad "an unwritable lane threw the page away (rc $RC)" "$WORK/s3" "$WORK/s3e"; fi
fi
chmod 0755 "$LOCKED/.git/be"

if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/freshcommit] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/freshcommit] $CHECKS checks, runtime $RT"
exit 0
