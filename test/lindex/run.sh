#!/bin/sh
# lite/test/lindex/run.sh — LITE-033: `lite lindex`, the BACKLINK SUSPECTS in
# the one `.lite.idx` lane.  Two legs over the landed lite tree:
#   verb  — this script: the CLI contract over a fixture git repo — who links to
#           a file, who links to a ticket code, the incremental (mark..tip) run,
#           a rerun that writes NOTHING, the stale row a removed link leaves,
#           the ambiguous ref that mints nothing, the self-link, the binary skip.
#   rows  — rows.js: the LINK record's ruled bit layout (key dst_hl:40|0:20|7,
#           val src path_hl:40|0:20|vnib:4) and the mark under hlOfText("lindex").
#
# THE GAP THIS REPROS: before the verb existed the lane could say what a path IS
# (REV/B2P) and nothing at all about who POINTS at it — `lite lindex <file>`
# answered "no such verb" and every check below was red.
#
# Standalone: `sh lite/test/lindex/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`); the DOG-034 lexer is what fuses a
# `dir/file.c` reference into ONE `F` token — the ONE recognizer this verb has —
# so this wants a quickjab build.  Fixtures live in a mktemp dir under ~/tmp.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/lindex
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "lindex: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "lindex: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "lindex: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "lindex: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-lindex.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "lindex: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

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
#   c0  doc/guide.mkd  names src/abc/TCP.c (a file), LITE-029 (a ticket code),
#                      a bare TCP.c (TWO files answer it) and ITSELF
#       doc/other.mkd  names nothing
#       src/abc/TCP.c  src/abc/FSW.c  net/TCP.c   the targets (and the twin)
#       bin/data.bin   a BINARY blob, never tokenised
#   c1  doc/other.mkd  gains `abc/FSW.c` and a second LITE-029
#   c2  doc/other.mkd  loses them again — the STALE suspect the caller kills
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  mkdir -p doc src/abc net bin
  printf 'the guide\nit points at src/abc/TCP.c and at LITE-029 here\n' > doc/guide.mkd
  printf 'and at TCP.c which two files answer\nand at doc/guide.mkd itself\n' >> doc/guide.mkd
  printf 'nothing to see\n' > doc/other.mkd
  printf 'int tcp;\n' > src/abc/TCP.c
  printf 'int fsw;\n' > src/abc/FSW.c
  printf 'int net;\n' > net/TCP.c
  printf 'BM\000\001\002 binary\n' > bin/data.bin
  git add -A
  GIT_AUTHOR_DATE="2022-01-01T00:00:00Z" GIT_COMMITTER_DATE="2022-01-01T00:00:00Z" \
    git commit -q -m c0 || exit 1
) || { echo "lindex: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
echo "lindex: runtime $RT, repo $REPO"

lanebytes() { cat "$REPO"/.git/be/* 2>/dev/null | wc -c | tr -d ' '; }

# ==========================================================================
# leg 1 — the scan
# ==========================================================================
# S1: the first run scans the tip blobs.  FIVE files, not six: bin/data.bin is
# binary and is never tokenised.
rtin "$REPO" lindex > "$WORK/s1" 2>"$WORK/s1e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^scanned 5 files, [0-9]* links, [0-9]* rows .* refs/heads/master ' "$WORK/s1"
then ok "the first run scans the 5 prose blobs (the binary one is skipped)"
else bad "the first run scans the 5 prose blobs (rc $RC)" "$WORK/s1" "$WORK/s1e"; fi

# S2: THE QUERY — who links to src/abc/TCP.c?  doc/guide.mkd, as TEXT.
rtin "$REPO" lindex src/abc/TCP.c > "$WORK/q1" 2>"$WORK/q1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q1")" = "doc/guide.mkd" ]
then ok "lindex src/abc/TCP.c = doc/guide.mkd"
else bad "lindex src/abc/TCP.c = doc/guide.mkd (rc $RC)" "$WORK/q1" "$WORK/q1e"; fi

# S3: a TICKET dst — the bare code is the target text, so the backlink is keyed
# by `LITE-029` itself and no file has to exist for it.
rtin "$REPO" lindex LITE-029 > "$WORK/q2" 2>"$WORK/q2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q2")" = "doc/guide.mkd" ]
then ok "lindex LITE-029 = doc/guide.mkd (the bare ticket code is the dst)"
else bad "lindex LITE-029 = doc/guide.mkd (rc $RC)" "$WORK/q2" "$WORK/q2e"; fi

# S4: a PARTIAL target resolves the same way the ref did — one dst_hl either way.
rtin "$REPO" lindex abc/TCP.c > "$WORK/q3" 2>"$WORK/q3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q3")" = "doc/guide.mkd" ]
then ok "a partial target (abc/TCP.c) answers the same suspects"
else bad "a partial target answers the same suspects (rc $RC)" "$WORK/q3" "$WORK/q3e"; fi

# S5: THE RERUN WRITES NOTHING — the tip has not moved, so the mark hits and not
# one byte lands in the lane.
BEFORE=$(lanebytes)
rtin "$REPO" lindex > "$WORK/s2" 2>"$WORK/s2e"; RC=$?
AFTER=$(lanebytes)
if [ "$RC" = 0 ] && grep -q '^up to date: links at refs/heads/master ' "$WORK/s2" &&
   [ "$BEFORE" = "$AFTER" ]
then ok "a rerun with no tip move is a no-op and writes nothing ($BEFORE bytes)"
else bad "a rerun writes nothing (rc $RC, $BEFORE -> $AFTER)" "$WORK/s2" "$WORK/s2e"; fi

# S6: a SELF-LINK mints no row — doc/guide.mkd names itself and nothing else does.
rtin "$REPO" lindex doc/guide.mkd > "$WORK/q4" 2>"$WORK/q4e"; RC=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/q4" ]
then ok "a self-link mints no row"
else bad "a self-link mints no row (rc $RC)" "$WORK/q4" "$WORK/q4e"; fi

# S7: an AMBIGUOUS ref mints nothing — `TCP.c` in the prose names two files, and
# the indexer never guesses; the QUERY says so in plain words.
rtin "$REPO" lindex TCP.c > "$WORK/q5" 2>"$WORK/q5e"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$WORK/q5" ] && grep -q 'names 2 files' "$WORK/q5e" &&
   grep -q '^  net/TCP.c$' "$WORK/q5e" && grep -q '^  src/abc/TCP.c$' "$WORK/q5e"
then ok "an ambiguous target is refused in plain words, both paths listed"
else bad "an ambiguous target is refused in plain words (rc $RC)" "$WORK/q5" "$WORK/q5e"; fi

# S8: a target nothing points at prints NOTHING and is no error.
rtin "$REPO" lindex net/TCP.c > "$WORK/q6" 2>"$WORK/q6e"; RC=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/q6" ] && [ ! -s "$WORK/q6e" ]
then ok "a target with no rows prints nothing, exit 0"
else bad "a target with no rows prints nothing (rc $RC)" "$WORK/q6" "$WORK/q6e"; fi

# S9: root-relative from a SUBDIR, like every other lite path arg.
rtin "$REPO/doc" lindex src/abc/TCP.c > "$WORK/q7" 2>"$WORK/q7e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q7")" = "doc/guide.mkd" ]
then ok "a query from a subdirectory answers root-relative paths"
else bad "a query from a subdirectory answers root-relative paths (rc $RC)" "$WORK/q7" "$WORK/q7e"; fi

# ==========================================================================
# leg 2 — the INCREMENTAL run (mark..tip, new blobs only)
# ==========================================================================
printf 'now it names abc/FSW.c and LITE-029 too\n' > "$REPO/doc/other.mkd"
g add -A
GIT_AUTHOR_DATE="2022-01-02T00:00:00Z" GIT_COMMITTER_DATE="2022-01-02T00:00:00Z" \
  g commit -q -m c1
rtin "$REPO" lindex > "$WORK/s3" 2>"$WORK/s3e"; RC=$?
if [ "$RC" = 0 ] && grep -q '^scanned 1 files, 2 links, ' "$WORK/s3"
then ok "the gap run scans ONLY the one changed path's new blob"
else bad "the gap run scans only the changed path (rc $RC)" "$WORK/s3" "$WORK/s3e"; fi

# I2: the new backlink is there, by the FULL path and by the partial the ref used.
rtin "$REPO" lindex src/abc/FSW.c > "$WORK/q8" 2>"$WORK/q8e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/q8")" = "doc/other.mkd" ]
then ok "the added link shows up: lindex src/abc/FSW.c = doc/other.mkd"
else bad "the added link shows up (rc $RC)" "$WORK/q8" "$WORK/q8e"; fi

# I3: the ticket now has TWO suspects, sorted.
rtin "$REPO" lindex LITE-029 > "$WORK/q9" 2>"$WORK/q9e"; RC=$?
printf 'doc/guide.mkd\ndoc/other.mkd\n' > "$WORK/q9w"
if [ "$RC" = 0 ] && cmp -s "$WORK/q9w" "$WORK/q9"
then ok "the ticket's suspects are both carriers, sorted"
else bad "the ticket's suspects are both carriers (rc $RC)" "$WORK/q9w" "$WORK/q9" "$WORK/q9e"; fi

# ==========================================================================
# leg 3 — SUSPECTS, not proof: a removed link leaves its row behind
# ==========================================================================
printf 'the link is gone now\n' > "$REPO/doc/other.mkd"
g add -A
GIT_AUTHOR_DATE="2022-01-03T00:00:00Z" GIT_COMMITTER_DATE="2022-01-03T00:00:00Z" \
  g commit -q -m c2
rtin "$REPO" lindex > "$WORK/s4" 2>"$WORK/s4e"; RC=$?
rtin "$REPO" lindex src/abc/FSW.c > "$WORK/q10" 2>"$WORK/q10e"
if [ "$RC" = 0 ] && grep -q '^scanned 1 files, 0 links, ' "$WORK/s4" &&
   [ "$(cat "$WORK/q10")" = "doc/other.mkd" ]
then ok "a removed link leaves a STALE suspect — rows are never deleted"
else bad "a removed link leaves a stale suspect (rc $RC)" "$WORK/s4" "$WORK/s4e" "$WORK/q10"; fi

# ==========================================================================
# leg 4 — the lane is DERIVED
# ==========================================================================
rm -rf "$REPO/.git/be"
rtin "$REPO" lindex > "$WORK/s5" 2>"$WORK/s5e"; RC=$?
rtin "$REPO" lindex src/abc/TCP.c > "$WORK/q11" 2>"$WORK/q11e"
rtin "$REPO" lindex src/abc/FSW.c > "$WORK/q12" 2>"$WORK/q12e"
if [ "$RC" = 0 ] && grep -q '^scanned 5 files, ' "$WORK/s5" &&
   [ "$(cat "$WORK/q11")" = "doc/guide.mkd" ] && [ ! -s "$WORK/q12" ]
then ok "rm -rf .git/be rebuilds the LINK rows from the TIP blobs alone"
else bad "rm -rf .git/be rebuilds the LINK rows (rc $RC)" "$WORK/s5" "$WORK/s5e" \
         "$WORK/q11" "$WORK/q12"; fi

# ==========================================================================
# leg 5 — the ROWS (the ruled bit layout + the lindex mark)
# ==========================================================================
LITE_FIX="$REPO" rtin "$REPO" --eval "require('$CASE/rows.js')" \
    > "$WORK/r.out" 2>"$WORK/r.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/r.out" && ! grep -q '^FAIL' "$WORK/r.out"; then
    N=$(grep -c '^ok' "$WORK/r.out"); CHECKS=$((CHECKS + N))
    ok "rows leg: $N checks (the LINK key/val layout, the lindex mark)"
else
    cat "$WORK/r.out"; head -20 "$WORK/r.err"
    bad "rows leg (rc $RC)" "$WORK/r.out"
fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/lindex] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/lindex] $CHECKS checks, runtime $RT"
exit 0
