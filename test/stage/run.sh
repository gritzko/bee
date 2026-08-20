#!/bin/sh
# bee/test/stage/run.sh — BEE-036: `add`, `add +` and `rm`, the staging verbs.
# THE REPRO: bee was read-only, so the board's FILE-frame buttons had no verb to
# spend a click on.  Each button stages exactly ONE of be's classes, so each
# bare verb must too — a wider reach makes the count on the face lie.
#   leg 1  `bee add` stages the MODIFIED-tracked class and nothing else: the
#          deletion stays unstaged (the `git add -u` trap), untracked stays out
#   leg 2  `bee add +` stages the untracked class, ignored files excluded
#   leg 3  `bee rm` stages the gone-on-disk class
#   leg 4  an empty class is a quiet no-op: one line, exit 0, index untouched
#   leg 5  explicit paths, verbatim wt-relative (a subdir does not re-anchor
#          them), and a git refusal reaching stderr in git's own words
#
# Standalone: `sh bee/test/stage/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/stage
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "stage: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "stage: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "stage: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "stage: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-stage.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "stage: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — nothing here ever
#  writes the developer's own `$HOME/.config/bee/repos`.
export HOME="$FAKEHOME"
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "stage: runtime $RT, fixtures $WORK"

# ==========================================================================
# the fixture — one file per class, plus an already-staged one and an ignored
# ==========================================================================
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'CHG0\n'  > chg.txt
  printf 'GONE\n'  > gone.txt
  printf 'KEEP\n'  > keep.txt
  printf 'PRE0\n'  > pre.txt
  printf 'DEEP0\n' > sub/deep.txt
  printf 'ign.txt\n' > .gitignore
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'seed' || exit 1
  printf 'CHG1\n'  > chg.txt          # chg  — modified tracked
  printf 'DEEP1\n' > sub/deep.txt     # chg  — and one a dir down
  rm gone.txt                         # del  — gone on disk
  printf 'NEW\n'   > new.txt          # add  — untracked
  printf 'IGN\n'   > ign.txt          # ignored: no class at all
  printf 'PRE1\n'  > pre.txt          # already staged, wt == index after this
  git add pre.txt
) || { echo "stage: cannot build the fixture" >&2; exit 2; }

por() { git -C "$1" status --porcelain; }

# ==========================================================================
# leg 1 — `bee add`: the MODIFIED-tracked class, and NOT the deletion
# ==========================================================================
rtin "$REPO" add > "$WORK/l1" 2>"$WORK/l1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l1")" = "add 2 staged" ] && [ ! -s "$WORK/l1e" ]
then ok "\`bee add\` reports the verb and the count, stderr silent"
else bad "the add report line (rc $RC)" "$WORK/l1" "$WORK/l1e"; fi

por "$REPO" > "$WORK/p1"
if grep -qx 'M  chg.txt' "$WORK/p1" && grep -qx 'M  sub/deep.txt' "$WORK/p1"
then ok "both modified-tracked files are staged"
else bad "the chg class is staged" "$WORK/p1"; fi

# THE `git add -u` TRAP: the gone file is `rm`'s to stage, never `add`'s.
if grep -qx ' D gone.txt' "$WORK/p1"
then ok "the deletion is STILL unstaged — \`add\` never swallows it"
else bad "add swallowed the deletion" "$WORK/p1"; fi
if grep -qx '?? new.txt' "$WORK/p1"
then ok "...and the untracked file is still untracked"
else bad "add reached the untracked class" "$WORK/p1"; fi

# `bee status` says the same thing: index-vs-HEAD moved, worktree-vs-index quiet.
rtin "$REPO" status --plain > "$WORK/s1" 2>"$WORK/s1e"
if grep -qx '..v. chg.txt' "$WORK/s1" && grep -qx '...x gone.txt' "$WORK/s1"
then ok "\`bee status\` shows the flip: \`..v.\` staged, the deletion still \`...x\`"
else bad "status parity after add" "$WORK/s1" "$WORK/s1e"; fi

# ==========================================================================
# leg 2 — `bee add +`: the untracked class, ignored files excluded
# ==========================================================================
rtin "$REPO" add + > "$WORK/l2" 2>"$WORK/l2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l2")" = "add + 1 staged" ] && [ ! -s "$WORK/l2e" ]
then ok "\`bee add +\` reports its own verb spelling and the count"
else bad "the add + report line (rc $RC)" "$WORK/l2" "$WORK/l2e"; fi

por "$REPO" > "$WORK/p2"
if grep -qx 'A  new.txt' "$WORK/p2"
then ok "the untracked file is staged as an addition"
else bad "the untracked class is staged" "$WORK/p2"; fi
if [ -z "$(git -C "$REPO" ls-files -- ign.txt)" ] && ! grep -q 'ign.txt' "$WORK/p2"
then ok "an IGNORED file is not in the class — --exclude-standard holds"
else bad "an ignored file was staged" "$WORK/p2"; fi
if grep -qx ' D gone.txt' "$WORK/p2"
then ok "...and the deletion is still nobody's but \`rm\`'s"
else bad "add + reached the gone class" "$WORK/p2"; fi

# ==========================================================================
# leg 3 — `bee rm`: the gone-on-disk class
# ==========================================================================
rtin "$REPO" rm > "$WORK/l3" 2>"$WORK/l3e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l3")" = "rm 1 staged" ] && [ ! -s "$WORK/l3e" ]
then ok "\`bee rm\` reports the verb and the count"
else bad "the rm report line (rc $RC)" "$WORK/l3" "$WORK/l3e"; fi

por "$REPO" > "$WORK/p3"
if grep -qx 'D  gone.txt' "$WORK/p3"
then ok "the removal is staged"
else bad "the gone class is staged" "$WORK/p3"; fi
rtin "$REPO" status --plain > "$WORK/s3" 2>"$WORK/s3e"
if grep -qx '..x. gone.txt' "$WORK/s3"
then ok "\`bee status\` reads \`..x.\` — index vs HEAD, worktree quiet"
else bad "status parity after rm" "$WORK/s3" "$WORK/s3e"; fi
if [ -z "$(git -C "$REPO" diff --name-only)" ]
then ok "nothing of the three classes is left unstaged"
else bad "the tree is not fully staged" "$WORK/p3"; fi

# ==========================================================================
# leg 4 — an EMPTY class: one line, exit 0, the index untouched
# ==========================================================================
cp "$WORK/p3" "$WORK/before"
for _v in 'add:nothing to add' 'add +:nothing to add' 'rm:nothing to rm'; do
    _verb=${_v%%:*}; _say=${_v#*:}
    # shellcheck disable=SC2086
    rtin "$REPO" $_verb > "$WORK/l4" 2>"$WORK/l4e"; RC=$?
    if [ "$RC" = 0 ] && [ "$(cat "$WORK/l4")" = "$_say" ] && [ ! -s "$WORK/l4e" ]
    then ok "\`bee $_verb\` on an empty class: \"$_say\", exit 0"
    else bad "the empty-class no-op for \`$_verb\` (rc $RC)" "$WORK/l4" "$WORK/l4e"; fi
done
por "$REPO" > "$WORK/after"
if cmp -s "$WORK/before" "$WORK/after"
then ok "...and three no-ops left the index byte-identical"
else bad "a no-op touched the index" "$WORK/after"; fi

# ==========================================================================
# leg 5 — explicit paths, verbatim wt-relative, and a loud refusal
# ==========================================================================
EXP="$WORK/exp"; mkdir -p "$EXP/sub"
(
  cd "$EXP" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'A0\n' > a.txt; printf 'B0\n' > b.txt; printf 'C0\n' > c.txt
  printf 'D0\n' > sub/d.txt
  git add -A
  GIT_AUTHOR_DATE='@1700000000 +0000' GIT_COMMITTER_DATE='@1700000000 +0000' \
    git commit -q -m 'seed' || exit 1
  printf 'A1\n' > a.txt; printf 'B1\n' > b.txt; printf 'D1\n' > sub/d.txt
  rm c.txt; printf 'U\n' > u.txt
) || { echo "stage: cannot build the explicit-path fixture" >&2; exit 2; }

rtin "$EXP" add a.txt u.txt > "$WORK/l5" 2>"$WORK/l5e"; RC=$?
por "$EXP" > "$WORK/p5"
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l5")" = "add 2 staged" ] &&
   grep -qx 'M  a.txt' "$WORK/p5" && grep -qx 'A  u.txt' "$WORK/p5" &&
   grep -qx ' M b.txt' "$WORK/p5"
then ok "\`bee add <path>...\` stages the NAMED files and no neighbour"
else bad "the explicit add (rc $RC)" "$WORK/l5" "$WORK/l5e" "$WORK/p5"; fi

rtin "$EXP" rm c.txt > "$WORK/l6" 2>"$WORK/l6e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l6")" = "rm 1 staged" ] &&
   git -C "$EXP" status --porcelain | grep -qx 'D  c.txt'
then ok "\`bee rm <path>...\` stages the named removal"
else bad "the explicit rm (rc $RC)" "$WORK/l6" "$WORK/l6e"; fi

# be BE-039: the path is WT-RELATIVE, verbatim — a subdir never re-anchors it.
rtin "$EXP/sub" add sub/d.txt > "$WORK/l7" 2>"$WORK/l7e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/l7")" = "add 1 staged" ] &&
   git -C "$EXP" status --porcelain | grep -qx 'M  sub/d.txt'
then ok "a path is wt-relative wherever the run stands — no context merging"
else bad "the wt-relative path from a subdir (rc $RC)" "$WORK/l7" "$WORK/l7e"; fi

rtin "$EXP" add nosuch.txt > "$WORK/l8" 2>"$WORK/l8e"; RC=$?
if [ "$RC" != 0 ] && grep -q "did not match any files" "$WORK/l8e"
then ok "a git refusal reaches stderr in GIT's own words, exit non-zero"
else bad "the loud refusal (rc $RC)" "$WORK/l8" "$WORK/l8e"; fi

# BEE-036 r2 (ruling 2026-08-20): `add!` = add EXTENDED — the edited class plus
# the untracked one in ONE move; the deletion stays `rm`'s to stage.
BANG="$WORK/bang"; mkdir -p "$BANG"
git -C "$BANG" init -q -b main
git -C "$BANG" -c user.email=t@t -c user.name=t commit -q --allow-empty -m seed
echo one > "$BANG/mod.txt"; echo gone > "$BANG/gone.txt"
git -C "$BANG" add -A
git -C "$BANG" -c user.email=t@t -c user.name=t commit -q -m base
echo edit >> "$BANG/mod.txt"; echo fresh > "$BANG/new.txt"; rm "$BANG/gone.txt"
rtin "$BANG" 'add!' > "$WORK/lb1" 2>"$WORK/lb1e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/lb1")" = "add! 2 staged" ] &&
   git -C "$BANG" status --porcelain | grep -qx 'M  mod.txt' &&
   git -C "$BANG" status --porcelain | grep -qx 'A  new.txt' &&
   git -C "$BANG" status --porcelain | grep -qx ' D gone.txt'
then ok "\`bee add!\` stages edited AND untracked, leaves the deletion to rm"
else bad "add! (rc $RC)" "$WORK/lb1" "$WORK/lb1e"; fi
rtin "$BANG" 'add!' > "$WORK/lb2" 2>"$WORK/lb2e"; RC=$?
if [ "$RC" = 0 ] && [ "$(cat "$WORK/lb2")" = "nothing to add" ]
then ok "...and a second \`add!\` is a quiet no-op"
else bad "add! rerun (rc $RC)" "$WORK/lb2" "$WORK/lb2e"; fi

echo "stage: $CHECKS checks, $FAILED failed"
[ "$FAILED" = 0 ] || exit 1
