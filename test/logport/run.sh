#!/bin/sh
# bee/test/logport/run.sh — BEE-020: the three legs of be's `log:` view that
# never arrived — `?<rev>`, the SUBMODULE descent, and the ticket code in a
# summary.  Three legs over one parent/submodule fixture pair:
#   verb — this script: the CLI contract (`?<rev>` tips, `log <sub>/<path>` ==
#          the sub's own log, a missing path = empty) and the `--plain`
#          byte pins;
#   port — port.js: the tok32 spans (an `F` over the ticket code, the sha8's
#          hidden `commit <hex>`), the hunk's own `pos`, the door opening a
#          descended row in the SUB, and the http href for a sub page's row;
#   pty  — pty.js: the REAL UI path — Enter on a descended log row opens THAT
#          commit, out of the submodule.
#
# Standalone: `sh bee/test/logport/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), built from THIS tree.  Fixtures
# live in a mktemp dir under ~/tmp and are removed on a green run.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/logport
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "logport: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "logport: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "logport: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "logport: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-logport.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "logport: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
ln -sf "$LITE" "$WORK/jsrc"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }

# ==========================================================================
# the fixture — a SUB with a history of its own, added to a PAR that carries a
# ticket file and a `side` branch.
#   sub:  s0 g.txt=g0 | s1 g.txt=g1 | s2 g.txt=g2
#   par:  p0 f.txt=f0 + todo/TKT/TKT-12.mkd
#         p1 submodule `sub` at s2
#         p2 f.txt=f1, summary carrying the ticket code TKT-12
#         side: sx f.txt=f2      (off p2, never merged)
#         p3 f.txt=f3            (master tip)
# ==========================================================================
SUB="$WORK/sub"; PAR="$WORK/par"; mkdir -p "$SUB" "$PAR"
(
  set -e
  export GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t
  cm() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }
  cd "$SUB"; git init -q -b master .
  printf 'g0\n' > g.txt; git add -A; cm "2023-01-01T00:00:00Z" "s0 seed"
  printf 'g1\n' > g.txt; git add -A; cm "2023-01-02T00:00:00Z" "s1 bump"
  printf 'g2\n' > g.txt; git add -A; cm "2023-01-03T00:00:00Z" "s2 tip"

  cd "$PAR"; git init -q -b master .
  mkdir -p todo/TKT
  printf 'f0\n' > f.txt
  printf '#   TKT-12: a ticket the summary names\n' > todo/TKT/TKT-12.mkd
  git add -A; cm "2023-02-01T00:00:00Z" "p0 seed"
  git -c protocol.file.allow=always submodule add -q "$SUB" sub
  git add -A; cm "2023-02-02T00:00:00Z" "p1 add sub"
  printf 'f1\n' > f.txt; git add -A; cm "2023-02-03T00:00:00Z" "TKT-12: parent edit"
  git checkout -q -b side
  printf 'f2\n' > f.txt; git add -A; cm "2023-02-04T00:00:00Z" "sx side edit"
  git checkout -q master
  printf 'f3\n' > f.txt; git add -A; cm "2023-02-05T00:00:00Z" "p3 tip"
) >/dev/null 2>&1 || { echo "logport: cannot build the fixture" >&2; exit 2; }
[ -f "$PAR/sub/g.txt" ] || { echo "logport: SKIP — git built no submodule" >&2; exit 0; }

gp() { git -C "$PAR" "$@"; }
gs() { git -C "$PAR/sub" "$@"; }
P3=$(gp rev-parse master);        P38=$(echo "$P3" | cut -c1-8)
SX=$(gp rev-parse side);          SX8=$(echo "$SX" | cut -c1-8)
P2=$(gp rev-parse master~1);      P28=$(echo "$P2" | cut -c1-8)
S2=$(gs rev-parse HEAD);          S28=$(echo "$S2" | cut -c1-8)
S1=$(gs rev-parse HEAD~1);        S18=$(echo "$S1" | cut -c1-8)
echo "logport: runtime $RT, fixtures $WORK"

# ==========================================================================
# leg 1 — the CLI contract
# ==========================================================================
# L0: the BASELINE — master's own log is 4 rows and knows nothing of `side`.
rtin "$PAR" log --plain > "$WORK/l0" 2>"$WORK/l0e"; RC=$?
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/l0") ))" = "4" ] && ! grep -q "$SX8" "$WORK/l0"
then ok "the bare log is master's 4 commits, no side branch in it"
else bad "the bare log is master's own (rc $RC)" "$WORK/l0" "$WORK/l0e"; fi

# L0b: the file log BEFORE any `?<rev>` brought another branch up — f.txt on
# master is p3, p2, p0 and the side commit is nowhere in the index yet.
rtin "$PAR" log --plain f.txt > "$WORK/l3m" 2>/dev/null
if [ "$(( $(wc -l < "$WORK/l3m") ))" = "3" ] && ! grep -q "$SX8" "$WORK/l3m"
then ok "log f.txt on master is the 3 master revisions"
else bad "log f.txt on master" "$WORK/l3m"; fi

# L1: `log ?<ref>` walks THAT tip — `side` is 4 commits ending at sx, and the
# master-only tip p3 is not among them.
rtin "$PAR" log --plain '?side' > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/l1") ))" = "4" ] &&
   head -1 "$WORK/l1" | grep -q "^$SX8 " && ! grep -q "$P38" "$WORK/l1"
then ok "log ?side walks the side tip (sx newest, no master-only p3)"
else bad "log ?side walks the side tip (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

# L2: a `?<rev>` HEXLET names the same tip as the branch does, to the byte.
rtin "$PAR" log --plain "?$(echo "$SX" | cut -c1-12)" > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/l1" "$WORK/l2"
then ok "log ?<hexlet> = log ?<branch> for the same tip, byte for byte"
else bad "log ?<hexlet> = log ?<branch> (rc $RC)" "$WORK/l1" "$WORK/l2" "$WORK/l2e"; fi

# L3: `log <path>?<rev>` is the file's revisions reachable from THAT tip only —
# f.txt on side is sx, p2, p0; p3 amended f.txt on master and must not show.
rtin "$PAR" log --plain 'f.txt?side' > "$WORK/l3" 2>"$WORK/l3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/l3") ))" = "3" ] &&
   head -1 "$WORK/l3" | grep -q "^$SX8 " && ! grep -q "$P38" "$WORK/l3"
then ok "log f.txt?side = the file's side revisions only (master's tip absent)"
else bad "log f.txt?side (rc $RC)" "$WORK/l3" "$WORK/l3e"; fi

# L4: THE DESCENT — `log <sub>/<path>` from the parent logs the SUB's own
# history, byte for byte what the sub itself answers.
rtin "$PAR" log --plain sub/g.txt > "$WORK/l4" 2>"$WORK/l4e"; RC=$?
rtin "$PAR/sub" log --plain g.txt > "$WORK/l4w" 2>"$WORK/l4we"
if [ "$RC" = 0 ] && [ -s "$WORK/l4" ] && cmp -s "$WORK/l4w" "$WORK/l4" &&
   [ "$(( $(wc -l < "$WORK/l4") ))" = "3" ]
then ok "log sub/g.txt from the parent = the sub's own g.txt log, byte for byte"
else bad "log sub/g.txt descends (rc $RC)" "$WORK/l4" "$WORK/l4w" "$WORK/l4e" "$WORK/l4we"; fi

# L5: `log <sub>` alone is the SUB's whole history, not the parent's gitlink bump.
rtin "$PAR" log --plain sub > "$WORK/l5" 2>"$WORK/l5e"; RC=$?
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/l5") ))" = "3" ] &&
   head -1 "$WORK/l5" | grep -q "^$S28 " && grep -q "^$S18 " "$WORK/l5"
then ok "log sub is the submodule's own 3 commits"
else bad "log sub is the submodule's own log (rc $RC)" "$WORK/l5" "$WORK/l5e"; fi

# L6: an unknown path is an EMPTY log, exit 0 — git says nothing either, the
# test/index/run.sh:181:ZR ruling stands (BEE-020 decision 6 dropped).
rtin "$PAR" log --plain nosuch.c > "$WORK/l6" 2>"$WORK/l6e"; RC=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/l6" ]
then ok "a path no repo answers is an empty log, exit 0"
else bad "a missing path is an empty log (rc $RC)" "$WORK/l6" "$WORK/l6e"; fi

# L7: an EMPTY history for a REAL path stays the empty answer it is (a file the
# worktree carries and no commit ever did).
printf 'new\n' > "$PAR/untracked.txt"
rtin "$PAR" log --plain untracked.txt > "$WORK/l7" 2>"$WORK/l7e"; RC=$?
if [ "$RC" = 0 ] && [ ! -s "$WORK/l7" ]
then ok "an untracked but REAL path is an empty log, not a refusal"
else bad "an untracked real path is an empty log (rc $RC)" "$WORK/l7" "$WORK/l7e"; fi

# L8: the `--plain` byte pins — the piped dump and `--plain` stay identical over
# every new form, so the F spans and the descent are paint, never text.
RCS=0
for a in '' '?side' 'f.txt?side' 'sub/g.txt' 'sub'; do
    if [ -z "$a" ]; then rtin "$PAR" log > "$WORK/b1" 2>/dev/null
                         rtin "$PAR" log --plain > "$WORK/b2" 2>/dev/null
    else rtin "$PAR" log "$a" > "$WORK/b1" 2>/dev/null
         rtin "$PAR" log --plain "$a" > "$WORK/b2" 2>/dev/null; fi
    cmp -s "$WORK/b1" "$WORK/b2" || RCS=$((RCS + 1))
done
if [ "$RCS" = 0 ]
then ok "log --plain = the piped rows for every form (bare, ?rev, path?rev, sub)"
else bad "log --plain = the piped rows ($RCS forms differ)" "$WORK/b1" "$WORK/b2"; fi

# L8b: a name the URI leaf refuses (a raw space) is ALL PATH and still logs —
# the `?<rev>` split may never cost a file its log.
printf 'sp\n' > "$PAR/a b.txt"
( cd "$PAR" && HOME="$FAKEHOME" git add -A &&
  GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@t \
  GIT_AUTHOR_DATE="2023-02-06T00:00:00Z" GIT_COMMITTER_DATE="2023-02-06T00:00:00Z" \
  git commit -q -m "p4 spaced name" ) >/dev/null 2>&1
rtin "$PAR" log --plain "a b.txt" > "$WORK/l8b" 2>"$WORK/l8be"; RC=$?
if [ "$RC" = 0 ] && [ "$(( $(wc -l < "$WORK/l8b") ))" = "1" ] && grep -q 'p4 spaced name' "$WORK/l8b"
then ok "a path with a space still logs (the URI split never eats a name)"
else bad "a path with a space still logs (rc $RC)" "$WORK/l8b" "$WORK/l8be"; fi

# L9: a summary's ticket code takes NO column — the plain row is the four
# columns and nothing more, F span or not.
if grep -q "^$P28 [0-9][0-9][A-Z][a-z][a-z]23 TKT-12: parent edit (T)\$" "$WORK/l0"
then ok "a summary carrying a ticket code keeps its exact plain bytes"
else bad "a ticket code takes no column in plain" "$WORK/l0"; fi

# ==========================================================================
# leg 2 — the spans, the pos, the door and the http href (headless)
# ==========================================================================
( cd "$PAR" && HOME="$FAKEHOME" BEE_PAR="$PAR" BEE_SUB="$PAR/sub" \
  BEE_P2="$P2" BEE_S2="$S2" BEE_SX="$SX" \
  "$RT" --eval "require('$CASE/port.js')" ) > "$WORK/n.out" 2>"$WORK/n.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/n.out" && ! grep -q '^FAIL' "$WORK/n.out"; then
    N=$(grep -c '^ok' "$WORK/n.out"); CHECKS=$((CHECKS + N))
    ok "port leg: $N checks (F spans, the U target, hunk pos, the door, the href)"
else
    cat "$WORK/n.out"; head -20 "$WORK/n.err"
    bad "port leg (rc $RC)" "$WORK/n.out"
fi

# ==========================================================================
# leg 3 — the REAL UI path on a pty.  Skip-guarded on the tty binding.
# ==========================================================================
cat > "$WORK/ttyprobe.js" <<'EOF'
"use strict";
const ok = typeof tty === "object" && typeof tty.openpty === "function" &&
           typeof tty.setSize === "function" && typeof tty.raw === "function";
const b = io.buf(8); b.feed(utf8.Encode(ok ? "yes" : "no")); io.writeAll(1, b);
EOF
HAS=$( ( cd "$PAR" && HOME="$FAKEHOME" "$RT" --eval "require('$WORK/ttyprobe.js')" ) 2>/dev/null || echo err)
if [ "$HAS" != "yes" ]; then
    echo "logport: SKIP pty leg — runtime has no tty binding (got '$HAS')" >&2
else
    ( cd "$PAR" && HOME="$FAKEHOME" BEE_S2="$S2" \
      "$RT" --eval "require('$CASE/pty.js')" ) > "$WORK/p.out" 2>"$WORK/p.err"; RC=$?
    if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/p.out" && ! grep -q '^FAIL' "$WORK/p.out"; then
        N=$(grep -c '^ok' "$WORK/p.out"); CHECKS=$((CHECKS + N))
        ok "pty leg: $N checks (Enter on a descended row opens the SUB's commit)"
    else
        cat "$WORK/p.out"; head -20 "$WORK/p.err"
        bad "pty leg (rc $RC)" "$WORK/p.out"
    fi
fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/logport] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/logport] $CHECKS checks, runtime $RT"
exit 0
