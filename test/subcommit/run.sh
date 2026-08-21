#!/bin/sh
# bee/test/subcommit/run.sh — BEE-056: `bee commit` is RECURSIVE, as `add`/`rm`
# are.  Depth-first over the mounts (index/subs.js), grandchildren first: every
# staged level commits under the SAME message and its moved gitlink is staged in
# the parent, so one act leaves no half-committed level behind.
#   leg 1  THE REPRO — top index empty, the SUB staged: the board's ✓ shows (the
#          BEE-040 tree-wide fold) and the spell it mints now LANDS, both levels
#   leg 2  staged at BOTH levels: one run, both commits, the gitlink included
#   leg 3  staged at the TOP only: as it always was, the sub untouched
#   leg 4  a wholly clean tree still refuses in GIT's own words, non-zero
#   leg 5  three levels: bottom-up, each parent recording its child's NEW head
#   leg 6  an uninitialised mount is skipped, not refused (wtstat's foldSubs rule)
#
# THE GAP THIS REPROS: the COMMIT frame's ✓ gates on the WHOLE TREE's staged
# count ([BEE-040] foldSubs) while `commit` ran plain `git -C <top> commit` — so
# a tree staged in a sub alone lit a green ✓ whose spell git refused.  The fold
# and the gate are right; the verb's reach was not (BEE-056:34).
#
# Standalone: `sh bee/test/subcommit/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/subcommit
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "subcommit: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "subcommit: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "subcommit: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "subcommit: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-subcommit.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
export HOME="$FAKEHOME"                    # BEE-031: a FIXTURE registry, never the user's
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "subcommit: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -60 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
SRC="$WORK/src"; mkdir -p "$SRC"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "subcommit: runtime $RT, fixtures $WORK"

#  `protocol.file.allow` is git 2.38's clamp on local submodule URIs — a fixture
#  that adds one by path needs it said out loud (test/subfold/run.sh:57:hs).
G() { git -c user.email=t@t -c user.name=T -c protocol.file.allow=always "$@"; }
DATED() { GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' G "$@"; }

#  seed <dir> <file> — a fresh repo with one commit in it.
seed() {
    mkdir -p "$1" || return 1
    ( cd "$1" && git init -q -b master . && printf 'V0\n' > "$2" &&
      G add -A && DATED commit -q -m seed ) >/dev/null || return 1
}
#  mount <parent> <child> <name> — <child> becomes <parent>/<name>, committed.
mount_at() {
    ( cd "$1" && G submodule add -q "$2" "$3" && DATED commit -q -m "mount $3" ) \
        >/dev/null || return 1
}
#  sha <repo> [rev] — the full object name, so a moved head is provable.
sha() { git -C "$1" rev-parse "${2:-HEAD}"; }
subj() { git -C "$1" log -1 --format=%s; }

MSG='BEE-056: one act, every level'

# ==========================================================================
# the fixtures — four two-level trees (one per leg) and one three-level
# ==========================================================================
for n in t1 t2 t3 t4; do
    seed "$SRC/$n-src" s.txt && seed "$SRC/$n" p.txt &&
    mount_at "$SRC/$n" "$SRC/$n-src" sub || { echo "subcommit: no fixture $n" >&2; exit 2; }
done
seed "$SRC/leaf-src" l.txt && seed "$SRC/mid-src" m.txt && seed "$SRC/t5" p.txt &&
mount_at "$SRC/mid-src" "$SRC/leaf-src" leaf &&
mount_at "$SRC/t5" "$SRC/mid-src" mid &&
( cd "$SRC/t5" && G submodule update -q --init --recursive ) ||
    { echo "subcommit: no three-level fixture" >&2; exit 2; }

# ==========================================================================
# leg 1 — THE REPRO: the top index EMPTY, the sub staged
# ==========================================================================
printf 'NEW\n' > "$SRC/t1/sub/n.txt"
G -C "$SRC/t1/sub" add n.txt
P0=$(sha "$SRC/t1"); S0=$(sha "$SRC/t1/sub")

# The ✓ gate (view/wtstat.js:216:23I) stays on the BEE-040 tree-wide fold: it must
# ALREADY show for this tree — that is the promise `commit` has to keep.
cat > "$WORK/gate.js" <<'EOF'
"use strict";
const ws = require("view/wtstat.js"), th = require("render/theme.js");
const f = ws.frames(io.getenv("BEE_FIX")).commit;
const b = io.buf(64);
b.feed(utf8.Encode((f.indexOf(th.BTN_FACE.commit) >= 0 ? "TICK" : "BLANK") + "\n"));
io.writeAll(1, b);
EOF
( cd "$WORK" && HOME="$FAKEHOME" BEE_FIX="$SRC/t1" "$RT" --eval "require('$WORK/gate.js')" ) \
    > "$WORK/g1" 2>"$WORK/g1e"
if [ "$(cat "$WORK/g1")" = "TICK" ]
then ok "the ✓ shows on the tree-wide fold with the SUB alone staged (BEE-040)"
else bad "the ✓ gate stays tree-wide" "$WORK/g1" "$WORK/g1e"; fi

rtin "$SRC/t1" commit -m "$MSG" > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && grep -qE '^commit [0-9a-f]{4,} 2 commits$' "$WORK/l1" &&
   [ ! -s "$WORK/l1e" ]
then ok "\`bee commit -m\` lands, ONE report line naming both commits"
else bad "the recursive commit report (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

if [ "$(sha "$SRC/t1/sub")" != "$S0" ] && [ "$(subj "$SRC/t1/sub")" = "$MSG" ]
then ok "the SUB commit is there, carrying the very same message"
else bad "the sub commit" "$WORK/l1" "$WORK/l1e"; fi
if [ "$(sha "$SRC/t1")" != "$P0" ] && [ "$(subj "$SRC/t1")" = "$MSG" ] &&
   [ "$(git -C "$SRC/t1" diff --name-only HEAD~1 HEAD)" = "sub" ]
then ok "...and the parent's own commit is the MOVED GITLINK, same message"
else bad "the parent gitlink commit" "$WORK/l1"; fi
if [ "$(sha "$SRC/t1" HEAD:sub)" = "$(sha "$SRC/t1/sub")" ] &&
   [ -z "$(git -C "$SRC/t1" status --porcelain)" ]
then ok "the recorded gitlink IS the sub's new head — no level left half-done"
else bad "the tree is not whole after the run"; fi

# ==========================================================================
# leg 2 — staged at BOTH levels: one run commits both, the gitlink included
# ==========================================================================
printf 'P1\n' > "$SRC/t2/p.txt";       G -C "$SRC/t2" add p.txt
printf 'S1\n' > "$SRC/t2/sub/s.txt";   G -C "$SRC/t2/sub" add s.txt
S0=$(sha "$SRC/t2/sub")
rtin "$SRC/t2" commit -m "$MSG" > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && grep -qE '^commit [0-9a-f]{4,} 2 commits$' "$WORK/l2"
then ok "both levels staged: one run, one line, two commits"
else bad "the both-levels report (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi
if [ "$(sha "$SRC/t2/sub")" != "$S0" ] && [ "$(subj "$SRC/t2/sub")" = "$MSG" ] &&
   git -C "$SRC/t2" diff --name-only HEAD~1 HEAD > "$WORK/d2" &&
   grep -qx 'p.txt' "$WORK/d2" && grep -qx 'sub' "$WORK/d2" &&
   [ -z "$(git -C "$SRC/t2" status --porcelain)" ]
then ok "...the top commit carries its OWN file and the bumped gitlink"
else bad "the both-levels commit" "$WORK/d2"; fi

# ==========================================================================
# leg 3 — staged at the TOP only: exactly as it always was
# ==========================================================================
printf 'P1\n' > "$SRC/t3/p.txt"; G -C "$SRC/t3" add p.txt
S0=$(sha "$SRC/t3/sub"); SN=$(git -C "$SRC/t3/sub" rev-list --count HEAD)
rtin "$SRC/t3" commit -m "$MSG" > "$WORK/l3" 2>"$WORK/l3e"; RC=$?
if [ "$RC" = 0 ] && grep -qE '^commit [0-9a-f]{4,}$' "$WORK/l3" && [ ! -s "$WORK/l3e" ]
then ok "top-only staged: the report line is the bare \`commit <hashlet>\`"
else bad "the top-only report (rc $RC)" "$WORK/l3" "$WORK/l3e"; fi
if [ "$(sha "$SRC/t3/sub")" = "$S0" ] &&
   [ "$(git -C "$SRC/t3/sub" rev-list --count HEAD)" = "$SN" ] &&
   [ "$(git -C "$SRC/t3" diff --name-only HEAD~1 HEAD)" = "p.txt" ]
then ok "...and the quiet sub is UNTOUCHED — a level with nothing staged commits nothing"
else bad "the quiet sub was touched"; fi

# ==========================================================================
# leg 4 — a wholly clean tree: git's own refusal, non-zero, nothing written
# ==========================================================================
P0=$(sha "$SRC/t4"); S0=$(sha "$SRC/t4/sub")
rtin "$SRC/t4" commit -m "$MSG" > "$WORK/l4" 2>"$WORK/l4e"; RC=$?
if [ "$RC" != 0 ] && grep -qE 'nothing to commit|no changes added to commit' "$WORK/l4" &&
   ! grep -q '^commit ' "$WORK/l4"
then ok "a clean tree refuses in GIT's own words, non-zero, no report line"
else bad "the clean-tree refusal (rc $RC)" "$WORK/l4" "$WORK/l4e"; fi
if [ "$(sha "$SRC/t4")" = "$P0" ] && [ "$(sha "$SRC/t4/sub")" = "$S0" ]
then ok "...and not one level moved"
else bad "a refused run still wrote a commit"; fi

# ==========================================================================
# leg 5 — three levels: GRANDCHILDREN FIRST, each parent recording the new head
# ==========================================================================
printf 'NEW\n' > "$SRC/t5/mid/leaf/n.txt"
G -C "$SRC/t5/mid/leaf" add n.txt
L0=$(sha "$SRC/t5/mid/leaf"); M0=$(sha "$SRC/t5/mid"); P0=$(sha "$SRC/t5")
rtin "$SRC/t5" commit -m "$MSG" > "$WORK/l5" 2>"$WORK/l5e"; RC=$?
if [ "$RC" = 0 ] && grep -qE '^commit [0-9a-f]{4,} 3 commits$' "$WORK/l5" &&
   [ ! -s "$WORK/l5e" ]
then ok "a three-level tree reports its three commits on one line"
else bad "the three-level report (rc $RC)" "$WORK/l5" "$WORK/l5e"; fi
if [ "$(sha "$SRC/t5/mid/leaf")" != "$L0" ] && [ "$(sha "$SRC/t5/mid")" != "$M0" ] &&
   [ "$(sha "$SRC/t5")" != "$P0" ] &&
   [ "$(subj "$SRC/t5/mid/leaf")" = "$MSG" ] && [ "$(subj "$SRC/t5/mid")" = "$MSG" ] &&
   [ "$(subj "$SRC/t5")" = "$MSG" ]
then ok "every level committed, the one message all the way down"
else bad "the three-level commits"; fi
# The BOTTOM-UP proof: a parent that committed BEFORE its child would record the
# child's OLD head, so these two equalities can only hold depth-first.
if [ "$(sha "$SRC/t5/mid" HEAD:leaf)" = "$(sha "$SRC/t5/mid/leaf")" ] &&
   [ "$(sha "$SRC/t5" HEAD:mid)" = "$(sha "$SRC/t5/mid")" ] &&
   [ "$(git -C "$SRC/t5" diff --name-only HEAD~1 HEAD)" = "mid" ] &&
   [ "$(git -C "$SRC/t5/mid" diff --name-only HEAD~1 HEAD)" = "leaf" ]
then ok "bottom-up: each parent records its child's NEW head, gitlink only"
else bad "the bottom-up order"; fi

# ==========================================================================
# leg 6 — an UNINITIALISED mount is skipped, never refused (subs.js:29 live)
# ==========================================================================
G clone -q "$SRC/t3" "$SRC/dead" || exit 2      # a clone never initialises its mounts
printf 'X\n' > "$SRC/dead/x.txt"; G -C "$SRC/dead" add x.txt
rtin "$SRC/dead" commit -m "$MSG" > "$WORK/l6" 2>"$WORK/l6e"; RC=$?
if [ "$RC" = 0 ] && grep -qE '^commit [0-9a-f]{4,}$' "$WORK/l6" && [ ! -s "$WORK/l6e" ]
then ok "a dead mount tallies nothing and stops nothing — the top still commits"
else bad "the uninitialised mount (rc $RC)" "$WORK/l6" "$WORK/l6e"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [bee/subcommit] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [bee/subcommit] $CHECKS checks, runtime $RT"
exit 0
