#!/bin/sh
# lite/test/hook/run.sh — LITE-026: the PRE-COMMIT hook upgrades fresh
# `file:line(:col)` refs in the STAGED text to `file:OFF:HASHLET` permalinks.
# One end-to-end leg: a throwaway repo, a PRE-EXISTING pre-commit hook, then
# `lite install` composing with it, then a REAL `git commit` — after which
#   hook.js  asserts the COMMITTED blobs carry the permalink form, the refs
#            that do not resolve are untouched, the pre-existing text is
#            untouched, and the minted links FOLLOW back to the right line
#            (through the door and through a real pty click).
#
# Standalone: `sh lite/test/hook/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`); the DOG-034 lexer is what fuses a
# `path:line:col` ref into ONE `F` token, which is what the hook scans for, so
# this wants a quickjab build.  Fixtures live in a mktemp dir under ~/tmp.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/hook
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "hook: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "hook: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "hook: SKIP — no git to drive a commit" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "hook: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-hook.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "hook: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# --- the fixture ----------------------------------------------------------
# FIXED-WIDTH lines, 16 bytes each (`int FSWMARK007;\n`), so a blob BYTE OFFSET
# is arithmetic the test states without asking the code under test.
#   r0  src/abc/FSW.c 40 lines, src/abc/TCP.c 40 lines, net/TCP.c its twin
#       (so a bare `TCP.c` names TWO files — ambiguity), doc/old.mkd carrying a
#       `file:line` ref IN COMMITTED TEXT, which nothing may ever rewrite.
#   r1  the commit under test: doc/new.mkd is NEW, doc/old.mkd gains ONE line,
#       src/abc/TCP.c gains a 41st line that only the STAGED blob has.
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p src/abc net doc
  numbered() {                                   # $1 = mark prefix, $2 = out file
    i=1
    : > "$2"
    while [ "$i" -le 40 ]; do
        printf 'int %s%03d;\n' "$1" "$i" >> "$2"
        i=$((i + 1))
    done
  }
  numbered FSWMARK src/abc/FSW.c
  numbered TCPMARK src/abc/TCP.c
  cp src/abc/TCP.c net/TCP.c
  printf 'the old page\nold ref src/abc/FSW.c:3 stays\nthe end\n' > doc/old.mkd
  git add -A
  GIT_AUTHOR_DATE="2020-02-01T00:00:00Z" GIT_COMMITTER_DATE="2020-02-01T00:00:00Z" \
    git commit -q -m "r0 the anchored files" || exit 1
) || { echo "hook: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }

# A PRE-EXISTING pre-commit hook that lite must COMPOSE with, never clobber —
# and one that ends in `exit 0`, the shape an appended line would never reach.
cat > "$REPO/.git/hooks/pre-commit" <<'EOF'
#!/bin/sh
echo mine >> "$(git rev-parse --git-dir)/theirs.ran"
exit 0
EOF
chmod +x "$REPO/.git/hooks/pre-commit"
cp "$REPO/.git/hooks/pre-commit" "$WORK/theirs.orig"

rtin "$REPO" install > "$WORK/i1" 2>"$WORK/i1e"; RC=$?
if [ "$RC" = 0 ] && [ -x "$REPO/.git/hooks/pre-commit" ] &&
   grep -q 'hook' "$REPO/.git/hooks/pre-commit" &&
   grep -q 'theirs.ran' "$REPO/.git/hooks/pre-commit"
then ok "install plants the pre-commit hook, KEEPING the one already there"
else bad "install (rc $RC)" "$WORK/i1" "$WORK/i1e" "$REPO/.git/hooks/pre-commit"; fi

cp "$REPO/.git/hooks/pre-commit" "$WORK/h1"
rtin "$REPO" install > "$WORK/i2" 2>"$WORK/i2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/h1" "$REPO/.git/hooks/pre-commit" &&
   grep -q 'already installed' "$WORK/i2"
then ok "install twice leaves the hook file byte for byte"
else bad "reinstall no-op (rc $RC)" "$WORK/i2" "$WORK/i2e" "$REPO/.git/hooks/pre-commit"; fi

# --- the staged commit ----------------------------------------------------
# Six ref shapes in ONE new file: two that must be minted, three that must NOT
# be touched, one that needs the STAGED blob of a file this very commit changes.
cat > "$REPO/doc/new.mkd" <<'EOF'
see src/abc/FSW.c:20 for the anchor
and src/abc/FSW.c:20:5 with a column
gone no/such/file.c:3 resolves to nothing
past src/abc/FSW.c:999 is off the end
self doc/new.mkd:2 names this very file
many TCP.c:5 names two files at once
plus src/abc/TCP.c:41 from the staged blob
EOF
printf 'new ref src/abc/FSW.c:7 here\n' >> "$REPO/doc/old.mkd"
printf 'int TCPMARK041;\n' >> "$REPO/src/abc/TCP.c"
g add -A

B_FSW=$(g rev-parse ":src/abc/FSW.c") || exit 2
B_TCP0=$(g rev-parse "HEAD:src/abc/TCP.c") || exit 2
B_TCP1=$(g rev-parse ":src/abc/TCP.c") || exit 2

( cd "$REPO" && HOME="$FAKEHOME" \
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  GIT_AUTHOR_DATE="2020-03-01T00:00:00Z" GIT_COMMITTER_DATE="2020-03-01T00:00:00Z" \
  git commit -q -m "r1 fresh refs" ) > "$WORK/c1" 2>"$WORK/c1e"; RC=$?
if [ "$RC" = 0 ]; then ok "the commit lands with the hook in the way"
else bad "git commit (rc $RC)" "$WORK/c1" "$WORK/c1e"; fi

if [ -f "$REPO/.git/theirs.ran" ]
then ok "...and the pre-existing hook ran too"
else bad "the pre-existing hook never ran" "$REPO/.git/hooks/pre-commit"; fi

if [ -z "$(g status --porcelain)" ]
then ok "...leaving a CLEAN tree — the rewrite was re-staged, not left dirty"
else bad "the worktree is dirty after the commit" ; g status --porcelain; fi

# A FULLY staged file ends with index and disk in lockstep, both upgraded.
g show ":doc/new.mkd" > "$WORK/idx.new" 2>/dev/null
if cmp -s "$WORK/idx.new" "$REPO/doc/new.mkd" &&
   grep -q 'src/abc/FSW.c:' "$WORK/idx.new" &&
   ! grep -q 'src/abc/FSW.c:20 ' "$WORK/idx.new"
then ok "...index and disk carry the SAME upgraded bytes"
else bad "index/disk lockstep" "$WORK/idx.new"; fi

# --- the assertions -------------------------------------------------------
( cd "$REPO" && HOME="$FAKEHOME" LITE_FIX="$REPO" \
  LITE_BFSW="$B_FSW" LITE_BTCP0="$B_TCP0" LITE_BTCP1="$B_TCP1" \
  "$RT" --eval "require('$CASE/hook.js')" ) > "$WORK/h.out" 2>"$WORK/h.err"
RC=$?
cat "$WORK/h.out"
if [ "$RC" != 0 ]; then
    FAILED=$((FAILED + 1))
    echo "--- stderr ---"; cat "$WORK/h.err"
fi

# --- a second commit with nothing fresh -----------------------------------
printf 'int FSWMARK041;\n' >> "$REPO/src/abc/FSW.c"
g add -A
cp "$REPO/doc/new.mkd" "$WORK/new.before"
( cd "$REPO" && HOME="$FAKEHOME" \
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  git commit -q -m "r2 no fresh refs" ) > "$WORK/c2" 2>"$WORK/c2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/new.before" "$REPO/doc/new.mkd"
then ok "a commit with no fresh refs rewrites nothing"
else bad "second commit (rc $RC)" "$WORK/c2" "$WORK/c2e"; fi

# --- a PARTIALLY staged file: the INDEX is what gets rewritten -------------
# The hook rewrites the STAGED bytes and points the index at them; the working
# file is only written when it was in lockstep with the index to begin with.
# Here it is not, so the commit carries the permalink while the unstaged edits
# stay on disk, unstaged and untouched — the diff honestly shows the old ref.
printf 'part ref src/abc/FSW.c:9 here\n' >> "$REPO/doc/new.mkd"
g add doc/new.mkd
printf 'a tail nobody staged\n' >> "$REPO/doc/new.mkd"
cp "$REPO/doc/new.mkd" "$WORK/part.before"
( cd "$REPO" && HOME="$FAKEHOME" \
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  git commit -q -m "r3 a partially staged ref" ) > "$WORK/p1" 2>"$WORK/p1e"; RC=$?
PERMA9=$(g show "HEAD:doc/new.mkd" | grep '^part ref ' || echo "")
if [ "$RC" = 0 ] && [ "$PERMA9" != "part ref src/abc/FSW.c:9 here" ] &&
   [ -n "$(printf '%s' "$PERMA9" | grep 'src/abc/FSW.c:')" ]
then ok "a PARTIALLY staged ref is upgraded in the COMMITTED blob"
else bad "partial stage commit (rc $RC) line='$PERMA9'" "$WORK/p1" "$WORK/p1e"; fi

if grep -qxF "$PERMA9" "$REPO/doc/new.mkd" &&
   grep -qxF 'a tail nobody staged' "$REPO/doc/new.mkd"
then ok "...and the DIRTY working file carries the SAME permalink, its edits intact"
else bad "the working file was not upgraded in place" "$REPO/doc/new.mkd"; fi

# The whole point: index vs worktree now differs by the REAL edit and nothing
# else — no ref shows up in one link form on one side and another on the other.
g diff -- doc/new.mkd > "$WORK/p1d" 2>/dev/null
if [ "$(grep -c '^+[^+]' "$WORK/p1d")" = 1 ] &&
   grep -qx '+a tail nobody staged' "$WORK/p1d" &&
   ! grep -q 'src/abc/FSW.c:9 ' "$WORK/p1d"
then ok "...so the unstaged diff shows ONLY that edit — no link-form noise"
else bad "the unstaged diff carries link-form noise" "$WORK/p1d"; fi
g checkout -q -- doc/new.mkd || true
g reset -q --hard HEAD > /dev/null 2>&1

# --- the very FIRST commit ------------------------------------------------
# A repo with NO commits has no HEAD to index and no blob history to extend a
# hashlet against — but every path in it IS staged, so the staged set alone
# answers every ref and the ROOT commit mints like any other.
FRESH="$WORK/fresh"; mkdir -p "$FRESH"
(
  cd "$FRESH" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  mkdir -p src
  i=1
  : > src/A.c
  while [ "$i" -le 20 ]; do printf 'int SRCMARK%03d;\n' "$i" >> src/A.c; i=$((i + 1)); done
  printf 'see src/A.c:5 here\nself n.mkd:1 stays\ngone no/such.c:2 nothing\n' > n.mkd
  git add -A
) || { echo "hook: cannot build the fresh repo" >&2; exit 2; }
B_A=$(git -C "$FRESH" rev-parse ":src/A.c") || exit 2

rtin "$FRESH" install > "$WORK/f0" 2>"$WORK/f0e" || true
( cd "$FRESH" && HOME="$FAKEHOME" \
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  GIT_AUTHOR_DATE="2020-01-01T00:00:00Z" GIT_COMMITTER_DATE="2020-01-01T00:00:00Z" \
  git commit -q -m "r0 the very first commit" ) > "$WORK/f1" 2>"$WORK/f1e"; RC=$?
if [ "$RC" = 0 ]; then ok "the very FIRST commit lands with the hook in the way"
else bad "first commit (rc $RC)" "$WORK/f1" "$WORK/f1e"; fi

( cd "$FRESH" && HOME="$FAKEHOME" LITE_FIX="$FRESH" LITE_BA="$B_A" \
  "$RT" --eval "require('$CASE/first.js')" ) > "$WORK/f.out" 2>"$WORK/f.err"
RC=$?
cat "$WORK/f.out"
if [ "$RC" != 0 ]; then
    FAILED=$((FAILED + 1))
    echo "--- stderr ---"; cat "$WORK/f.err"
fi

if [ "$FAILED" = 0 ]; then
    echo "PASS [lite/hook] $CHECKS shell checks, plus hook.js"
else
    echo "FAIL [lite/hook] $FAILED bad" >&2
    exit 1
fi
