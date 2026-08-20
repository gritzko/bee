#!/bin/sh
# lite/test/chat/run.sh — LITE-016: `lite chat [dir] [outdir]` renders every
# Claude Code session log (JSONL) under `<claude home>/projects/<mangled-dir>/`
# as a [/wiki/StrictMark] page, strict 1:1, in FORMAT v2.  The first three legs
# are //CHAT-001's test/chat/{render,append,strict} ported over — same fixtures,
# same expected bytes, minus the be-only `jab mark` render check (lite has no
# mark verb); the fourth is LITE-022's naming:
#   render — format v2 itself: the Session header (LOCAL time, OS user, stamped
#            from the first RENDERED row), quoted user turns, verbatim Claude
#            prose, one 4-backtick fence per assistant row holding one line per
#            tool call, NO tool results, NO XML ever, the hidden `[log]:` cursor.
#   append — reentrancy off that cursor: == skips, > appends only the new rows,
#            < regenerates, and an append is BYTE-IDENTICAL to a from-scratch
#            render (which is why a turn is one ROW and the header is due before
#            the first RENDERED turn, not at file creation).
#   strict — the StrictMark sanitizer over Claude's verbatim prose: a depth-0
#            header / ref def / meta pair / never-closed fence run takes one `\`,
#            a BALANCED fence and its body stay byte-verbatim, and the sanitizer
#            being a pure function of one message keeps the append invariant.
#   names  — LITE-022: the page is named by the basename's 10-char ron60 digest,
#            never by the session UUID; a pre-LITE-022 `<uuid>.mkd` page MIGRATES
#            (renamed, then reentrant as ever) instead of being duplicated, and a
#            page owned by another jsonl is refused loudly.  name.js pins the
#            digest itself, hand-computed from sha1 and the RON64 alphabet.
#
# EXPECTED NAMES.  Every leg's page path is the ron60 of its log's basename,
# hard-coded here (see name.js for the derivation), so the harness never asks
# the code under test what it named a page:
#   sess-one c5WgO4DAxQ   sess-two MB05JVWDBe   grow mxNNMO5~rr
#   noisy    uN3aTzq82l   sess     XhzDlVrnFU
#
# The Claude home is pointed at the scratch tree via $CLAUDE_CONFIG_DIR, so no
# leg ever reads (or writes near) the real ~/.claude.
#
# Standalone: `sh lite/test/chat/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), which must be built from THIS
# tree.  Fixtures live in a mktemp dir under ~/tmp, removed on a green run
# (kept, with the path printed, on a red).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/chat
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

# --- the runtime ----------------------------------------------------------
RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "chat: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "chat: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac

# --- scratch --------------------------------------------------------------
TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "chat: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-chat.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "chat: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
# has <file> <fixed string> <what> / hasnt: the grep -F assertions, counted.
has()   { if grep -qF -- "$2" "$1"; then ok "$3"; else bad "$3 (want: $2)" "$1"; fi; }
hasnt() { if grep -qF -- "$2" "$1"; then bad "$3 (found: $2)" "$1"; else ok "$3"; fi; }
rex()   { if grep -q -- "$2" "$1"; then ok "$3"; else bad "$3 (want /$2/)" "$1"; fi; }
norex() { if grep -q -- "$2" "$1"; then bad "$3 (matched /$2/)" "$1"; else ok "$3"; fi; }
eq()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1: got [$2] want [$3]"; fi; }

FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
: "${XDG_CACHE_HOME:=${HOME}/.cache}"
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
echo "chat: runtime $RT, fixtures $WORK"

# One leg's project dir + its mangled log dir under a private Claude home.
# The verb derives the log dir from the project dir's ABSOLUTE path, so the
# mangling here is the independent check of that rule.
mangle() { printf '%s' "$1" | sed 's/[^a-zA-Z0-9]/-/g'; }

# --------------------------------------------------------------------------
# leg 1 — render: FORMAT v2
# --------------------------------------------------------------------------
R="$WORK/render"; mkdir -p "$R/src"
export CLAUDE_CONFIG_DIR="$R/claude"
RLOGS="$CLAUDE_CONFIG_DIR/projects/$(mangle "$R/src")"
mkdir -p "$RLOGS"
cp "$CASE/session.jsonl" "$RLOGS/sess-one.jsonl"
# a second log file proves the 1:1 fan-out over *.jsonl
cp "$CASE/session.jsonl" "$RLOGS/sess-two.jsonl"
# a non-jsonl neighbour must be ignored
printf 'not a log\n' > "$RLOGS/notes.txt"
# an OVERSIZED tool arg (400 chars) drives the cap
awk 'BEGIN{ s=""; while (length(s) < 400) s = s "0123456789";
  printf "{\"type\":\"assistant\",\"isSidechain\":false,\"uuid\":\"a9\",\"timestamp\":\"2026-08-03T14:07:00.000Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"toolu_Z\",\"name\":\"Bash\",\"input\":{\"command\":\"echo %s\"}}]}}\n", s }' \
  >> "$RLOGS/sess-one.jsonl"

# the session header must carry the OS USER, whoever runs the suite; a NON-UTC
# zone pins the stamp as LOCAL, so 14:02Z must read 23:02.
run() { D=$1; N=$2; shift 2
    ( cd "$D" && HOME="$FAKEHOME" USER=chattester TZ=Asia/Tokyo \
      "$RT" chat "$@" ) > "$WORK/$N.out" 2>"$WORK/$N.err"
    RC=$?
    cat "$WORK/$N.out" "$WORK/$N.err" > "$WORK/$N.all"
    return $RC
}

run "$R/src" r1 . out || { cat "$WORK/r1.err" >&2; bad "lite chat failed" "$WORK/r1.err"; }
PAGE="$R/src/out/c5WgO4DAxQ.mkd"                 # ron60 of "sess-one"

# every page written is REPORTED, one line each, on the runtime's message stream
N=$(grep -c 'chat: wrote ' "$WORK/r1.all")
eq "2 'chat: wrote' report lines (2 logs)" "$N" "2"
has "$WORK/r1.all" 'out/c5WgO4DAxQ.mkd' "the report names the page written"

if [ -f "$PAGE" ]; then ok "wrote out/c5WgO4DAxQ.mkd"; else bad "no out/c5WgO4DAxQ.mkd"; fi
if [ -f "$R/src/out/MB05JVWDBe.mkd" ]; then ok "1:1 fan-out: out/MB05JVWDBe.mkd"
else bad "no out/MB05JVWDBe.mkd (1:1 fan-out)"; fi
# LITE-022: the UUID-shaped basename never names a page any more
if [ -f "$R/src/out/sess-one.mkd" ]; then bad "the page is still named by the basename"
else ok "no page carries the log's raw basename"; fi
# every page in the dir is TEN RON64 digits, nothing else
eq "2 pages, both 10-char ron60" \
   "$(ls "$R/src/out" | grep -c '^[0-9A-Za-z_~]\{10\}\.mkd$')" "2"
eq "the out dir holds nothing else" "$(ls "$R/src/out" | wc -l | tr -d ' ')" "2"
if [ -f "$R/src/out/EiqwaX8GBn.mkd" ]; then bad "a non-jsonl file was converted"
else ok "a non-jsonl neighbour is ignored"; fi

# ---- (1) the Session header: first RENDERED row, LOCAL time, OS user --------
eq "the Session header is the first line, local time, OS user" \
   "$(head -n 1 "$PAGE")" "#   Session: 2026-08-03 23:02 chattester"
eq "exactly 1 Session header" "$(grep -c '^#   Session:' "$PAGE")" "1"
hasnt "$PAGE" '2026-08-03 14:02' "the stamp is LOCAL, not UTC"
hasnt "$PAGE" '2026-08-03 22:00' "the header is not stamped from a skipped noise row"
hasnt "$PAGE" '2026-08-03 22:30' "the header is not stamped from a second noise row"

# v1 chrome must be gone
norex "$PAGE" '^##  ' "no v1 '##' turn header"
hasnt "$PAGE" '````json' "no v1 json fence"
hasnt "$PAGE" 'Off: '    "no v1 Off: meta pair"

# ---- (2) user turns are blockquotes ------------------------------------------
has "$PAGE" '>   Render the session log, please.' "the user turn is quoted"
has "$PAGE" '>   Take your time over it.'         "every line of the turn is quoted"
rex   "$PAGE" '^>$'    "a blank interior line is a bare '>'"
norex "$PAGE" '^>  *$' "a quoted blank line carries no trailing whitespace"
has "$PAGE" '>   Now check the *fence* handling.' "quoted text keeps its markup"

# ---- (3) Claude prose is plain and verbatim ---------------------------------
rex "$PAGE" '^Reading the file now\.$'      "Claude text is plain and verbatim"
rex "$PAGE" '^Done: \*two\* lines read\.$'  "Claude markdown is not re-wrapped"

# ---- (4) tool INVOCATIONS: one line per call, bare fence, one quad deeper ----
rex "$PAGE" '^````$' "a bare 4-backtick fence (no info string)"
rex "$PAGE" '^    Read /x/y\.txt$' "the Read invocation line"
rex "$PAGE" '^    Bash cmake --build \. --target all$' \
    "the multi-line Bash command is flattened to one line"
rex "$PAGE" '^    TaskUpdate {"taskId":"t7","status":"done"}$' \
    "an input with no primary string field is compact json"
# both calls of one assistant row share ONE fence
eq "6 fence lines (3 fences, open+close)" "$(grep -c '^````$' "$PAGE")" "6"
has "$PAGE" '...' "the oversized tool arg is capped"
eq "no line exceeds the arg cap" \
   "$(awk 'length($0) > 260 { n++ } END { print n+0 }' "$PAGE")" "0"

# ---- (5) nothing but conversation: no results, no sidechains, NO XML ---------
hasnt "$PAGE" 'TOOL RESULT MUST NOT APPEAR'      "no tool_result"
hasnt "$PAGE" 'SIDECHAIN CLAUDE MUST NOT APPEAR' "no sidechain assistant row"
hasnt "$PAGE" 'SIDECHAIN USER MUST NOT APPEAR'   "no sidechain user row"
hasnt "$PAGE" 'THINKING MUST NOT APPEAR'         "no thinking block"
hasnt "$PAGE" 'CAISwwIKiAEIDxgC'                 "no thinking signature"
hasnt "$PAGE" 'NON CONVERSATION MUST NOT APPEAR' "no non-conversation row"
hasnt "$PAGE" 'REMINDER MUST NOT APPEAR'         "no system-reminder"
hasnt "$PAGE" 'NOTIFICATION MUST NOT APPEAR'     "no task-notification"
hasnt "$PAGE" 'Caveat:'                          "no local-command-caveat"
hasnt "$PAGE" '/clear'                           "no slash-command noise"
XMLBAD=0
for TAG in '<local-command-caveat' '<local-command-stdout' '<command-name' \
           '<command-message' '<command-args' '<system-reminder' \
           '<task-notification' '<task-id' '<result>'; do
    grep -qF -- "$TAG" "$PAGE" && XMLBAD=$((XMLBAD + 1))
done
eq "no XML snippet of any kind reaches the page" "$XMLBAD" "0"

# ---- (6) the LAST line is the hidden `[log]:` ref def ------------------------
eq "the last line is the [log]: cursor, stamped with the consumed bytes" \
   "$(tail -n 1 "$PAGE")" \
   "[log]: file:$RLOGS/sess-one.jsonl \"$(wc -c < "$RLOGS/sess-one.jsonl" | tr -d ' ')\""
eq "exactly 1 [log]: ref def" "$(grep -c '^\[log\]: ' "$PAGE")" "1"

# --------------------------------------------------------------------------
# leg 2 — append: reentrancy off the `[log]:` cursor
# --------------------------------------------------------------------------
A="$WORK/append"; mkdir -p "$A/src"
export CLAUDE_CONFIG_DIR="$A/claude"
ALOGS="$CLAUDE_CONFIG_DIR/projects/$(mangle "$A/src")"
mkdir -p "$ALOGS"
LOG="$ALOGS/grow.jsonl"
cp "$CASE/session.jsonl" "$LOG"
PAGE="$A/src/out/mxNNMO5~rr.mkd"
want_ref() { printf '[log]: file:%s "%s"' "$LOG" "$(wc -c < "$LOG" | tr -d ' ')"; }

# ---- run 1: the baseline page ------------------------------------------------
run "$A/src" a1 . out || bad "lite chat failed (run 1)" "$WORK/a1.err"
eq "run 1: the cursor stamps the whole log" "$(tail -n 1 "$PAGE")" "$(want_ref)"
cp "$PAGE" "$WORK/base.mkd"
has "$PAGE" '>   Render the session log, please.' "run 1 rendered the first turn"

# ---- run 2: size == bytes -> the page is untouched ---------------------------
run "$A/src" a2 . out || bad "lite chat failed (run 2)" "$WORK/a2.err"
if cmp -s "$PAGE" "$WORK/base.mkd"; then ok "run 2 left an up-to-date page untouched"
else bad "run 2 rewrote an up-to-date page"; fi
hasnt "$WORK/a2.all" 'chat: wrote ' "an up-to-date page is silent"

# ---- run 3: size > bytes -> append only the new turns ------------------------
cat "$CASE/tail.jsonl" >> "$LOG"
run "$A/src" a3 . out || bad "lite chat failed (run 3)" "$WORK/a3.err"
eq "run 3: the cursor is restamped" "$(tail -n 1 "$PAGE")" "$(want_ref)"
has "$PAGE" '>   SECOND ROUND question.' "run 3 rendered the appended user turn"
has "$PAGE" 'SECOND ROUND answer.'       "run 3 rendered the appended assistant turn"
has "$PAGE" '    Grep SECOND'            "run 3 rendered the appended invocation"
has "$WORK/a3.all" 'chat: wrote '        "an appended page is reported"

# the OLD page (minus its ref def line) must be a byte PREFIX of the new one
sed '$d' "$WORK/base.mkd" > "$WORK/prefix.mkd"
head -c "$(wc -c < "$WORK/prefix.mkd" | tr -d ' ')" "$PAGE" > "$WORK/head.mkd"
if cmp -s "$WORK/head.mkd" "$WORK/prefix.mkd"
then ok "run 3 APPENDED (the old page is a byte prefix of the new one)"
else bad "run 3 did not append" "$WORK/prefix.mkd" "$WORK/head.mkd"; fi

# nothing already rendered may render twice, and the furniture stays singular
eq "run 3 duplicated no old turn" \
   "$(grep -cF -- '>   Render the session log, please.' "$PAGE")" "1"
eq "run 3 left 1 Session header" "$(grep -c '^#   Session:' "$PAGE")" "1"
eq "run 3 left 1 [log]: ref def"  "$(grep -c '^\[log\]: ' "$PAGE")" "1"

# ---- the invariant: appending in steps == rendering the whole log at once ----
cp "$PAGE" "$WORK/appended.mkd"
rm -f "$PAGE"
run "$A/src" a4 . out || bad "lite chat failed (whole)" "$WORK/a4.err"
if cmp -s "$PAGE" "$WORK/appended.mkd"
then ok "an appended page is BYTE-IDENTICAL to a from-scratch render"
else bad "appended page differs from a from-scratch render" "$WORK/appended.mkd" "$PAGE"; fi

# ---- run 5: size < bytes -> regenerate the whole page ------------------------
head -n 4 "$CASE/session.jsonl" > "$LOG"
run "$A/src" a5 . out || bad "lite chat failed (run 5)" "$WORK/a5.err"
eq "run 5: the cursor is reset to the shrunken log" "$(tail -n 1 "$PAGE")" "$(want_ref)"
has  "$PAGE" '>   Render the session log, please.' "run 5 kept the surviving turn"
hasnt "$PAGE" 'SECOND ROUND question.'  "run 5 regenerated (no stale user turn)"
hasnt "$PAGE" 'Done: *two* lines read.' "run 5 regenerated (no stale Claude turn)"
eq "run 5 left 1 [log]: ref def" "$(grep -c '^\[log\]: ' "$PAGE")" "1"

# ---- an ALL-NOISE log: a bare page now, the header when a real turn lands ----
# the first 3 fixture rows are file-history + a command caveat + a /clear group:
# nothing renders, so the page must be the ref def ALONE — no header, no stray
# empty quote — or the append below could never stay byte-identical.
NOISY="$ALOGS/noisy.jsonl"
head -n 3 "$CASE/session.jsonl" > "$NOISY"
run "$A/src" a6 . out || bad "lite chat failed (noise 1)" "$WORK/a6.err"
NPAGE="$A/src/out/uN3aTzq82l.mkd"
if [ -f "$NPAGE" ]; then ok "an all-noise log still gets its page (1:1)"
else bad "an all-noise log got no page"; fi
eq "an all-noise page is 1 line (the ref def alone)" \
   "$(wc -l < "$NPAGE" | tr -d ' ')" "1"
rex   "$NPAGE" '^\[log\]: ' "the all-noise page is just a ref def"
norex "$NPAGE" '^#   Session:' "an all-noise page gets no Session header"
norex "$NPAGE" '^>' "an all-noise page gets no empty quote"

# now a REAL turn arrives: the header must appear, at the top, exactly once
sed -n '4p' "$CASE/session.jsonl" >> "$NOISY"
run "$A/src" a7 . out || bad "lite chat failed (noise 2)" "$WORK/a7.err"
eq "the header lands with the first real turn" \
   "$(head -n 1 "$NPAGE")" "#   Session: 2026-08-03 23:02 chattester"
has "$NPAGE" '>   Render the session log, please.' "the first real turn rendered"
cp "$NPAGE" "$WORK/noise-appended.mkd"
rm -f "$NPAGE"
run "$A/src" a8 . out || bad "lite chat failed (noise 3)" "$WORK/a8.err"
if cmp -s "$NPAGE" "$WORK/noise-appended.mkd"
then ok "header-on-append is byte-identical to a from-scratch render"
else bad "header-on-append differs from a from-scratch render" \
         "$WORK/noise-appended.mkd" "$NPAGE"; fi

# --------------------------------------------------------------------------
# leg 3 — strict: the StrictMark sanitizer over Claude's verbatim prose
# --------------------------------------------------------------------------
S="$WORK/strict"; mkdir -p "$S/src"
export CLAUDE_CONFIG_DIR="$S/claude"
SLOGS="$CLAUDE_CONFIG_DIR/projects/$(mangle "$S/src")"
mkdir -p "$SLOGS"
LOG="$SLOGS/sess.jsonl"
PAGE="$S/src/out/XhzDlVrnFU.mkd"

# ---- the append invariant, with the sanitizer in the path --------------------
# The sanitizer must be a pure function of ONE message: rows rendered by an
# append must be byte-identical to the same rows rendered from scratch.
head -n 3 "$CASE/strict.jsonl" > "$LOG"
run "$S/src" s1 . out || bad "lite chat failed (part)" "$WORK/s1.err"
if [ -f "$PAGE" ]; then ok "the partial log rendered"; else bad "run 1 wrote no page"; fi
cp "$CASE/strict.jsonl" "$LOG"
run "$S/src" s2 . out || bad "lite chat failed (grow)" "$WORK/s2.err"
cp "$PAGE" "$WORK/s-appended.mkd"
rm -f "$PAGE"
run "$S/src" s3 . out || bad "lite chat failed (whole)" "$WORK/s3.err"
if cmp -s "$PAGE" "$WORK/s-appended.mkd"
then ok "the sanitizer is a pure function of one message (append invariant)"
else bad "an appended page differs from a from-scratch render" \
         "$WORK/s-appended.mkd" "$PAGE"; fi

# ---- every created/updated page is reported; an up-to-date one is silent -----
has "$WORK/s3.all" 'chat: wrote ' "a written page is reported"
has "$WORK/s3.all" 'out/XhzDlVrnFU.mkd' "the report names the page"
run "$S/src" s4 . out || bad "lite chat failed (again)" "$WORK/s4.err"
hasnt "$WORK/s4.all" 'chat: wrote ' "an up-to-date page is silent"

# ---- (1) the page keeps ONE outline entry: the Session header ---------------
HBAD=0
for H in '^# heading at depth zero$' '^##  ATX two$' '^####Gapless quad$' \
         '^  # padded in another column$'; do
    grep -q -- "$H" "$PAGE" && HBAD=$((HBAD + 1))
done
eq "no depth-0 heading quad survived Claude's prose" "$HBAD" "0"
eq "the Session header is the first line" \
   "$(head -n 1 "$PAGE")" "#   Session: 2026-08-03 23:00 chattester"
has "$PAGE" '\# heading at depth zero'      "a depth-0 ATX heading is escaped"
has "$PAGE" '\##  ATX two'                  "a depth-0 '##' heading is escaped"
has "$PAGE" '\####Gapless quad'             "a gapless full-quad heading is escaped"
has "$PAGE" '  \# padded in another column' "a padded heading quad is escaped"

# ---- (2) fences: the unbalanced runs are escaped, the balanced one is not ----
has "$PAGE" '\```'   "an unclosed 3-backtick fence is escaped"
has "$PAGE" '\````js' "an unbalanced 4-backtick fence is escaped"
norex "$PAGE" '^```[^`]*$' "no bare 3-backtick fence line survives"
# the page's own fences: the BALANCED pair from Claude + the tool fence
eq "4 fence lines (a balanced pair + a tool fence)" "$(grep -c '^````$' "$PAGE")" "4"
has "$PAGE" '    inner [ref]: def and # heading inside the fence' \
    "a balanced fence's VERBATIM body is untouched"
has "$PAGE" 'Tail line after the block.' "the line after a balanced fence survives"

# ---- (3) ref defs: exactly one, the page's own `[log]:` cursor ---------------
eq "1 depth-0 ref def (the [log]: cursor)" "$(grep -c '^\[' "$PAGE")" "1"
has "$PAGE" '\[log]: file:/evil/log.jsonl'  "a prose [log]: ref def is escaped"
has "$PAGE" '\[Home]: http://evil.example/' "a prose ref def is escaped"
eq "the last line is this page's own cursor" "$(tail -n 1 "$PAGE")" \
   "[log]: file:$LOG \"$(wc -c < "$LOG" | tr -d ' ')\""

# ---- (4) meta pairs: none; the page carries no injected metadata -------------
eq "no meta pair reaches the page" "$(grep -c '^[A-Z][a-z][a-z0-9]: ' "$PAGE")" "0"
has "$PAGE" 'Now\: HIJACKED' "a meta pair shape is escaped"

# ---- (5) everything else is VERBATIM ----------------------------------------
rex "$PAGE" '^#not-a-heading stays put$' "a non-marker '#' line is untouched"
rex "$PAGE" '^Normal prose with `inline code` and \*strong\*\.$' \
    "prose with inline markup is untouched"
rex "$PAGE" '^-   plain bullet$'  "a bullet is untouched"
rex "$PAGE" '^ -  spaced bullet$' "a padded bullet is untouched"
rex "$PAGE" '^    indented body line$' "an indented line is untouched"
rex "$PAGE" '^----$'  "a ruler is untouched"
rex "$PAGE" '^Done\.$' "the tail of the message survives"

# ---- (6) the turns AROUND the adversarial one still render as themselves -----
has "$PAGE" '>   BEFORE the adversarial turn.' "the preceding user turn"
has "$PAGE" '>   AFTER the adversarial turn.'  "the following user turn"
has "$PAGE" 'Wrapping up.'                     "the following Claude turn"
rex "$PAGE" '^    Read /a/b\.txt$'             "the following tool invocation"

# --------------------------------------------------------------------------
# leg 4 — names: LITE-022, ron60 pages, migration, clash refusal
# --------------------------------------------------------------------------
# A REAL session UUID drives this leg, and its page name is hand-computed (see
# name.js): sha1("d12979f3-336b-4666-88b1-d7e6765c817e") = 640a...; its top 60
# bits, ten RON64 digits msb-first, are MQitMZ6mBT.
UUID=d12979f3-336b-4666-88b1-d7e6765c817e
R60=MQitMZ6mBT

M="$WORK/name"; mkdir -p "$M/src"
export CLAUDE_CONFIG_DIR="$M/claude"
MLOGS="$CLAUDE_CONFIG_DIR/projects/$(mangle "$M/src")"
mkdir -p "$MLOGS"
LOG="$MLOGS/$UUID.jsonl"
head -n 6 "$CASE/session.jsonl" > "$LOG"

# ---- (1) a UUID log gets a ron60 page, and NOTHING named by the UUID --------
run "$M/src" m1 . out || bad "lite chat failed (name 1)" "$WORK/m1.err"
if [ -f "$M/src/out/$R60.mkd" ]; then ok "a UUID log is written to out/$R60.mkd"
else bad "no out/$R60.mkd" "$WORK/m1.all"; fi
if [ -f "$M/src/out/$UUID.mkd" ]; then bad "the UUID still names a page"
else ok "the UUID names no page"; fi
eq "the out dir holds exactly that one page" \
   "$(ls "$M/src/out" | tr -d ' ')" "$R60.mkd"
has "$WORK/m1.all" "out/$R60.mkd" "the report names the ron60 page"

# ---- (2) the name is STABLE: a rerun writes nothing, appends to the same page
cp "$M/src/out/$R60.mkd" "$WORK/m-base.mkd"
run "$M/src" m2 . out || bad "lite chat failed (name 2)" "$WORK/m2.err"
hasnt "$WORK/m2.all" 'chat: wrote ' "a rerun on the ron60 page writes nothing"
if cmp -s "$M/src/out/$R60.mkd" "$WORK/m-base.mkd"
then ok "a rerun leaves the ron60 page untouched"
else bad "a rerun rewrote the ron60 page"; fi
sed -n '7,$p' "$CASE/session.jsonl" >> "$LOG"
run "$M/src" m3 . out || bad "lite chat failed (name 3)" "$WORK/m3.err"
eq "the grown log restamps the SAME ron60 page" \
   "$(tail -n 1 "$M/src/out/$R60.mkd")" \
   "[log]: file:$LOG \"$(wc -c < "$LOG" | tr -d ' ')\""
eq "the append made no second page" "$(ls "$M/src/out" | wc -l | tr -d ' ')" "1"
has "$M/src/out/$R60.mkd" '>   Render the session log, please.' \
    "the appended-to page kept its earlier turns"

# ---- (3) MIGRATION: a pre-LITE-022 `<uuid>.mkd` page is RENAMED -------------
# The old-world page is the very bytes this tree writes, under the old name —
# so if the rerun REGENERATED instead of renaming, it would report a write.
G="$WORK/migr"; mkdir -p "$G/src"
export CLAUDE_CONFIG_DIR="$G/claude"
GLOGS="$CLAUDE_CONFIG_DIR/projects/$(mangle "$G/src")"
mkdir -p "$GLOGS"
GLOG="$GLOGS/$UUID.jsonl"
cp "$CASE/session.jsonl" "$GLOG"
run "$G/src" g1 . out || bad "lite chat failed (migr 1)" "$WORK/g1.err"
mv "$G/src/out/$R60.mkd" "$G/src/out/$UUID.mkd"      # back to the old world
cp "$G/src/out/$UUID.mkd" "$WORK/g-old.mkd"
run "$G/src" g2 . out || bad "lite chat failed (migr 2)" "$WORK/g2.err"
if [ -f "$G/src/out/$R60.mkd" ]; then ok "migration: the ron60 page is there"
else bad "migration: no ron60 page" "$WORK/g2.all"; fi
if [ -f "$G/src/out/$UUID.mkd" ]; then bad "migration: the UUID page survived"
else ok "migration: the UUID page is gone (renamed, not copied)"; fi
eq "migration left ONE page, not two" "$(ls "$G/src/out" | wc -l | tr -d ' ')" "1"
if cmp -s "$G/src/out/$R60.mkd" "$WORK/g-old.mkd"
then ok "migration carried the old page over byte for byte"
else bad "migration did not carry the page over" "$WORK/g-old.mkd"; fi
hasnt "$WORK/g2.all" 'chat: wrote ' "migration alone rewrites nothing"
# and the migrated page stays reentrant: a grown log appends onto it
cat "$CASE/tail.jsonl" >> "$GLOG"
run "$G/src" g3 . out || bad "lite chat failed (migr 3)" "$WORK/g3.err"
has "$G/src/out/$R60.mkd" '>   SECOND ROUND question.' \
    "the migrated page still appends"
has "$G/src/out/$R60.mkd" '>   Render the session log, please.' \
    "the migrated page kept its old turns"
eq "the migrated page is still the only one" \
   "$(ls "$G/src/out" | wc -l | tr -d ' ')" "1"

# ---- (4) CLASH: a page whose cursor names ANOTHER jsonl is refused ----------
C="$WORK/clash"; mkdir -p "$C/src/out"
export CLAUDE_CONFIG_DIR="$C/claude"
CLOGS="$CLAUDE_CONFIG_DIR/projects/$(mangle "$C/src")"
mkdir -p "$CLOGS"
CLOG="$CLOGS/$UUID.jsonl"
cp "$CASE/session.jsonl" "$CLOG"
# an honest page of a DIFFERENT session, parked on this name
OTHER="$CLOGS/impostor.jsonl"
cp "$CASE/session.jsonl" "$OTHER"
{ printf 'Someone else\047s conversation.\n\n'
  printf '[log]: file:%s "%s"\n' "$OTHER" "$(wc -c < "$OTHER" | tr -d ' ')"
} > "$C/src/out/$R60.mkd"
cp "$C/src/out/$R60.mkd" "$WORK/c-before.mkd"
if run "$C/src" c1 . out
then bad "a clashing page was accepted" "$WORK/c1.all"
else ok "a clashing page is REFUSED (nonzero rc)"; fi
has "$WORK/c1.all" "$OTHER" "the refusal names the page's own jsonl"
has "$WORK/c1.all" "$CLOG" "the refusal names the jsonl being converted"
if cmp -s "$C/src/out/$R60.mkd" "$WORK/c-before.mkd"
then ok "the clashing page is left untouched"
else bad "the clashing page was overwritten"; fi

# ---- (5) both names present, the ron60 page carrying no cursor -> refuse ----
B="$WORK/both"; mkdir -p "$B/src/out"
export CLAUDE_CONFIG_DIR="$B/claude"
BLOGS="$CLAUDE_CONFIG_DIR/projects/$(mangle "$B/src")"
mkdir -p "$BLOGS"
cp "$CASE/session.jsonl" "$BLOGS/$UUID.jsonl"
printf 'hand-written, no cursor\n' > "$B/src/out/$R60.mkd"
printf 'the old page\n' > "$B/src/out/$UUID.mkd"
if run "$B/src" b1 . out
then bad "an ambiguous pair was accepted" "$WORK/b1.all"
else ok "an ambiguous uuid+ron60 pair is REFUSED"; fi
has "$WORK/b1.all" "out/$R60.mkd" "the refusal names the ron60 page"
has "$WORK/b1.all" "out/$UUID.mkd" "the refusal names the uuid page"

# ---- (6) the name function itself, hand-computed ----------------------------
( cd "$WORK" && HOME="$FAKEHOME" "$RT" --eval "require('$CASE/name.js')" ) \
    > "$WORK/name.out" 2>&1
NRC=$?
sed 's/^/     /' "$WORK/name.out"
NN=$(grep -c '^ok   ' "$WORK/name.out")
CHECKS=$((CHECKS + NN))
if [ "$NRC" = 0 ] && ! grep -q '^FAIL ' "$WORK/name.out"
then ok "name.js: the ron60 name function is pinned ($NN checks)"
else bad "name.js failed (rc $NRC)" "$WORK/name.out"; fi

# ==========================================================================
if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/chat] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/chat] $CHECKS checks, runtime $RT"
exit 0
