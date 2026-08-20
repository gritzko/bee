#!/bin/sh
# bee/test/todo/run.sh — BEE-025: `bee todo`, the ticket board.  Two legs:
#   leg 1  this script — the board over a fixture `todo/`: topic headers with
#          counts, the OPEN set (the [BEE-024] lane's `Now:` plus the legacy
#          no-pair fallback), `todo/done/` never listing, one topic's list, the
#          `Key:Value` filters (AND across keys, OR within one, `Key:*`,
#          `Key:`), the `Sev:` bullets, freshest-first with date rows, the
#          all-repos fan-out with its repo prefixes, the refusals, the [BEE-027]
#          worktree frames on a forked ticket's row and the `worktrees` block,
#          `--plain` greppability and the http page
#   leg 2  click.js — the SPANS: `see KEY` on a row, `todo TOPIC` on a header,
#          the arg-line rewrite behind an inline `[value]`, the `Sub:` rails
#
# THE GAP THIS REPROS: bee could open one ticket (`bee see BEE-025`) and had no
# way at all to ask what is OPEN — no board, no topic list, no meta-pair query,
# so the [BEE-024] lane had no consumer and [BEE-027]'s frames had no row.
#
# Standalone: `sh bee/test/todo/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `bee`), built from THIS tree.
# $LITEPORT overrides the loopback port the http leg binds.
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # bee/test/todo
LITE=$(cd "$CASE/../.." && pwd)                  # bee/

RT="${LITEJAB:-bee}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "todo: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "todo: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "todo: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "todo: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/bee-todo.XXXXXX") || exit 2
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
WORK=$(cd "$WORK" && pwd -P)
CHECKS=0; FAILED=0; SRVPID=""
trap 'rc=$?; [ -n "$SRVPID" ] && kill "$SRVPID" 2>/dev/null
      if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "todo: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; head -40 "$f"; done
}
ln -sf "$LITE" "$WORK/jsrc"                      # unpacked-runtime require climb
FH="$WORK/home"; mkdir -p "$FH/.config/bee"
REG="$FH/.config/bee/repos"
SRC="$WORK/src"; mkdir -p "$SRC"
PORT="${LITEPORT:-18044}"
echo "todo: runtime $RT, fixtures $WORK"

# The fixture's own world: its own HOME (hence its own registry) and its own
# $SRC_ROOT, so nothing of the developer's tree is ever read or touched.
bee() { ( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" "$@" ); }

# ==========================================================================
# the fixture — two registered repos with a `todo/` each, a third with none,
# thin and fat tickets over three topics, a spread of Now:/Sev:/Sub:/Who:, a
# `todo/done/` parking lot, and one forked worktree named for a ticket
# ==========================================================================
mkrepo() {
    mkdir -p "$1" && ( cd "$1" && git init -q -b master . &&
      git config user.email t@t && git config user.name T ) || exit 2
}
commit() {
    ( cd "$1" && git add -A &&
      GIT_AUTHOR_DATE="@$2 +0000" GIT_COMMITTER_DATE="@$2 +0000" \
        git -c user.email=t@t -c user.name=T commit -q -m "$3" ) || exit 2
}

mkrepo "$SRC/alpha"
printf 'the alpha repo\n' > "$SRC/alpha/README.mkd"
mkdir -p "$SRC/alpha/todo/GET" "$SRC/alpha/todo/PUT" "$SRC/alpha/todo/done" \
         "$SRC/alpha/todo/GET/GET-003" "$SRC/alpha/todo/notopic"
cat > "$SRC/alpha/todo/GET/GET-001.mkd" <<'EOF'
#   GET-001: the first ticket
    Now: OPEN
    Sev: CRIT
    Who: gritzko

The body is never read by the board.  Kin: GET-002.mkd (an http link
into `todo/` must NOT route as the `todo` verb).
EOF
cat > "$SRC/alpha/todo/GET/GET-002.mkd" <<'EOF'
#   GET-002: a closed one
    Now: DONE
    Sev: LOW
EOF
# A FAT ticket, and a `Sub:` child of GET-001 — the rail case.
cat > "$SRC/alpha/todo/GET/GET-003/README.mkd" <<'EOF'
#   GET-003: a fat ticket
    Now: OPEN
    Sev: HIGH
    Sub: GET-001
    Who: someone
EOF
cat > "$SRC/alpha/todo/GET/GET-004.mkd" <<'EOF'
#   GET-004: a dim one
    Now: OPEN
    Sev: LOW
EOF
# The LEGACY fallback: no `Now:` pair at all and no closed header mark.
cat > "$SRC/alpha/todo/PUT/PUT-010.mkd" <<'EOF'
#   PUT-010: a ticket with no Now pair
    Who: gritzko
EOF
# ...and the legacy CLOSE: a `[DONE]` header mark still closes.
cat > "$SRC/alpha/todo/PUT/PUT-011.mkd" <<'EOF'
#   PUT-011 [DONE]: closed the old way
    Who: gritzko
EOF
# The parking lot and a lowercase dir: neither ever lists.
cat > "$SRC/alpha/todo/done/GET-099.mkd" <<'EOF'
#   GET-099: parked
    Now: OPEN
EOF
cat > "$SRC/alpha/todo/notopic/GET-098.mkd" <<'EOF'
#   GET-098: off the layout
    Now: OPEN
EOF
printf 'a wiki page, not a ticket\n' > "$SRC/alpha/todo/GET/README.mkd"
commit "$SRC/alpha" 1700000000 seed

mkrepo "$SRC/beta"
mkdir -p "$SRC/beta/todo/OPS"
cat > "$SRC/beta/todo/OPS/OPS-007.mkd" <<'EOF'
#   OPS-007: the other repo's ticket
    Now: OPEN
    Sev: MED
EOF
commit "$SRC/beta" 1700000100 seed

mkrepo "$SRC/gamma"                              # registered, but no todo/
printf 'x\n' > "$SRC/gamma/a.txt"
commit "$SRC/gamma" 1700000200 seed

printf '%s\n%s\n%s\n' "$SRC/alpha" "$SRC/beta" "$SRC/gamma" > "$REG"

# One forked worktree named for a ticket (the wt column) and one whose tail is
# no ticket code at all (the trailing `worktrees` block).
git -C "$SRC/alpha" worktree add -q -b GET-001 "$SRC/alpha-GET-001" || exit 2
git -C "$SRC/alpha" worktree add -q -b spike "$SRC/alpha-spike" || exit 2

# ==========================================================================
# leg 1a — the board: topics, counts, the open set, what never lists
# ==========================================================================
bee //alpha todo --plain > "$WORK/board" 2> "$WORK/board.err" || {
    echo "todo: the board failed" >&2; cat "$WORK/board.err" >&2; exit 2; }

if grep -q '^GET (3)$' "$WORK/board" && grep -q '^PUT (1)$' "$WORK/board"
then ok "topic headers carry their open count"
else bad "topic headers carry their open count" "$WORK/board"; fi

for k in GET-001 GET-003 GET-004 PUT-010; do
    if grep -q "$k" "$WORK/board"
    then ok "$k is on the board"
    else bad "$k is on the board" "$WORK/board"; fi
done

if grep -q 'GET-002' "$WORK/board"
then bad "Now: DONE never lists" "$WORK/board"; else ok "Now: DONE never lists"; fi
if grep -q 'PUT-011' "$WORK/board"
then bad "a legacy [DONE] header mark still closes" "$WORK/board"
else ok "a legacy [DONE] header mark still closes"; fi
if grep -q 'GET-099' "$WORK/board"
then bad "todo/done/ never lists" "$WORK/board"; else ok "todo/done/ never lists"; fi
if grep -q 'GET-098' "$WORK/board"
then bad "a lowercase dir is no topic" "$WORK/board"; else ok "a lowercase dir is no topic"; fi
if grep -q 'README' "$WORK/board"
then bad "a topic README is no ticket" "$WORK/board"; else ok "a topic README is no ticket"; fi

# --plain is `KEY title` lines: greppable, no chrome, no hidden target.
if grep -q '^GET-001: the first ticket' "$WORK/board"
then ok "--plain stays greppable KEY title lines"
else bad "--plain stays greppable KEY title lines" "$WORK/board"; fi
if grep -q '●' "$WORK/board"
then bad "--plain wears no bullet" "$WORK/board"; else ok "--plain wears no bullet"; fi

# A `Sub:` child hangs on the dotted rail, under its parent.
if grep -q -- '`-- GET-003' "$WORK/board"
then ok "a Sub: family nests on the rail"
else bad "a Sub: family nests on the rail" "$WORK/board"; fi

# ==========================================================================
# leg 1b — one topic's list
# ==========================================================================
bee //alpha todo GET --plain > "$WORK/topic" 2>&1
if [ "$(grep -c 'GET-00' "$WORK/topic")" = 3 ] && ! grep -q '^GET (' "$WORK/topic"
then ok "a topic list is the tickets alone, no header"
else bad "a topic list is the tickets alone, no header" "$WORK/topic"; fi

bee //alpha todo ZZZ --plain > "$WORK/miss" 2> "$WORK/miss.err"
if [ $? != 0 ] && grep -q '^todo: ZZZ: TODONONE$' "$WORK/miss.err"
then ok "a topic that is no dir is one TODONONE line and a throw"
else bad "a topic that is no dir is one TODONONE line and a throw" "$WORK/miss" "$WORK/miss.err"; fi

bee //alpha todo GET-001 --plain > "$WORK/code" 2>&1
if grep -q 'bee see GET-001' "$WORK/code"
then ok "a ticket code names a page and points at see"
else bad "a ticket code names a page and points at see" "$WORK/code"; fi

# ==========================================================================
# leg 1c — the filters: AND across keys, OR within one, `Key:*`, `Key:`
# ==========================================================================
filt() { bee //alpha todo $1 --plain > "$WORK/f" 2>&1; }

filt "Sev:HIGH"
if grep -q 'GET-003' "$WORK/f" && ! grep -q 'GET-001' "$WORK/f"
then ok "one filter narrows to its value"
else bad "one filter narrows to its value" "$WORK/f"; fi

filt "Sev:HIGH Who:someone"
if grep -q 'GET-003' "$WORK/f" && [ "$(grep -c 'GET-' "$WORK/f")" = 1 ]
then ok "two keys AND"
else bad "two keys AND" "$WORK/f"; fi

filt "Sev:HIGH Who:gritzko"
if ! grep -q 'GET-' "$WORK/f" && grep -q 'no ticket matches' "$WORK/f"
then ok "an AND that nothing satisfies says so"
else bad "an AND that nothing satisfies says so" "$WORK/f"; fi

filt "Sev:CRIT Sev:HIGH"
if grep -q 'GET-001' "$WORK/f" && grep -q 'GET-003' "$WORK/f" &&
   [ "$(grep -c 'GET-00' "$WORK/f")" = 2 ]
then ok "one key repeated ORs"
else bad "one key repeated ORs" "$WORK/f"; fi

filt "Now:DONE"
if grep -q 'GET-002' "$WORK/f"
then ok "naming Now: reaches the closed tickets"
else bad "naming Now: reaches the closed tickets" "$WORK/f"; fi

filt "Sev:*"
if grep -q 'GET-001' "$WORK/f" && ! grep -q 'PUT-010' "$WORK/f"
then ok "Key:* is presence"
else bad "Key:* is presence" "$WORK/f"; fi

filt "Sev:"
if grep -q 'PUT-010' "$WORK/f" && ! grep -q 'GET-001' "$WORK/f"
then ok "Key: is absence"
else bad "Key: is absence" "$WORK/f"; fi

filt "GET Who:gritzko"
if grep -q 'GET-001' "$WORK/f" && ! grep -q 'PUT-010' "$WORK/f"
then ok "a topic and a filter both narrow"
else bad "a topic and a filter both narrow" "$WORK/f"; fi

# The value the line asked for shows INLINE, in a bracket of its own.
if grep -q 'GET-001 \[gritzko\]' "$WORK/f"
then ok "a filtered key shows its value inline"
else bad "a filtered key shows its value inline" "$WORK/f"; fi

# ==========================================================================
# leg 1d — freshest first, each row stamped (gritzko 2026-08-20: the per-row
# `Thu20` stamp replaced the `-- yyyy-mm-dd` separator bands)
# ==========================================================================
bee //alpha todo Now:OPEN --color > "$WORK/fresh0" 2>&1
if grep -qE '[A-Z][a-z][a-z][0-9][0-9] ' "$WORK/fresh0"
then ok "a row carries its last-touch stamp"
else bad "a row carries its last-touch stamp" "$WORK/fresh0"; fi
if grep -q -- '-- 20' "$WORK/fresh0"
then bad "no date separator band survives" "$WORK/fresh0"
else ok "no date separator band survives"; fi

# An edited ticket is DIRTY and heads the list, above every committed one.
printf '\nan edit that makes it the freshest\n' >> "$SRC/alpha/todo/GET/GET-004.mkd"
bee //alpha todo Now:OPEN --plain > "$WORK/fresh1" 2>&1
if [ "$(grep 'GET-\|PUT-' "$WORK/fresh1" | head -1 | cut -c1-7)" = "GET-004" ]
then ok "an edited ticket is the freshest row"
else bad "an edited ticket is the freshest row" "$WORK/fresh1"; fi

# ==========================================================================
# leg 1e — the Sev: bullets: the 24-bit quartet of render/theme.js:29:Lc, CRIT and
# MED on slots Y/Z of their own, HIGH and LOW on the quad's orange V and green J
# ==========================================================================
bee //alpha todo --color > "$WORK/color" 2>&1
if grep -q '\[38;2;223;32;43m●' "$WORK/color"; then ok "CRIT paints the bullet crimson"
else bad "CRIT paints the bullet crimson" "$WORK/color"; fi
if grep -q '\[38;2;248;147;7m●' "$WORK/color"; then ok "HIGH paints the bullet orange"
else bad "HIGH paints the bullet orange" "$WORK/color"; fi
if grep -q '\[38;2;126;211;44m●' "$WORK/color"; then ok "LOW paints the bullet green"
else bad "LOW paints the bullet green" "$WORK/color"; fi

# ==========================================================================
# leg 1f — the [BEE-027] worktree column and the trailing worktrees block
# ==========================================================================
if grep -q '^GET-001: the first ticket \[.*\] \[.*\]$' "$WORK/board"
then ok "a forked ticket's row carries the two frames"
else bad "a forked ticket's row carries the two frames" "$WORK/board"; fi
if grep -q 'GET-003.*\[.*\] \[.*\]' "$WORK/board"
then bad "a ticket with no worktree carries none" "$WORK/board"
else ok "a ticket with no worktree carries none"; fi
if grep -q '^worktrees$' "$WORK/board" && grep -q '^  alpha-spike ' "$WORK/board"
then ok "a worktree whose tail is no code lists in its own block"
else bad "a worktree whose tail is no code lists in its own block" "$WORK/board"; fi

# ==========================================================================
# leg 1g — the fan-out: no context, no local todo/, every registered repo
# ==========================================================================
bee todo --plain > "$WORK/all" 2>&1
if grep -q 'alpha/GET-001' "$WORK/all" && grep -q 'beta/OPS-007' "$WORK/all"
then ok "the all-repos board prefixes each row with its repo"
else bad "the all-repos board prefixes each row with its repo" "$WORK/all"; fi
if [ "$(grep -c 'alpha/\|beta/' "$WORK/all")" -gt 1 ]
then ok "the all-repos board lists every repo, newest first"
else bad "the all-repos board lists every repo, newest first" "$WORK/all"; fi

# A CONTEXT with no `todo/` refuses, naming itself (BEE-025:75's default).
# BEE-028: a context with no `todo/` is no refusal — it boards every repo that
# has one, as a run with no context does (over http every URL has a context).
bee //gamma todo --plain > "$WORK/none" 2>&1
if grep -q '^alpha/GET-001' "$WORK/none" && grep -q '^beta/OPS-007' "$WORK/none"
then ok "a context with no todo/ fans out over every board"
else bad "a context with no todo/ fans out over every board" "$WORK/none"; fi

# Standing INSIDE a repo with a todo/, that repo is the board — no fan-out.
( cd "$SRC/alpha" && HOME="$FH" SRC_ROOT="$SRC" "$RT" todo --plain ) \
  > "$WORK/local" 2>&1
if grep -q '^GET (' "$WORK/local" && ! grep -q 'OPS-007' "$WORK/local"
then ok "a local todo/ is the board, with no fan-out"
else bad "a local todo/ is the board, with no fan-out" "$WORK/local"; fi

# ==========================================================================
# leg 1h — http serves the very same view through render/html.js
# ==========================================================================
if command -v curl >/dev/null 2>&1; then
    ( cd "$SRC/alpha"; exec env HOME="$FH" SRC_ROOT="$SRC" "$RT" http --port "$PORT" ) \
      > "$WORK/srv.log" 2>&1 &
    SRVPID=$!
    N=0
    while [ "$N" -lt 100 ]; do
        N=$((N + 1))
        curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
        sleep 0.05
    done
    curl -s -o "$WORK/page" "http://127.0.0.1:$PORT/alpha/todo"
    if grep -q 'GET-001' "$WORK/page" && grep -q 'tok-' "$WORK/page"
    then ok "http paints the board through render/html.js"
    else bad "http paints the board through render/html.js" "$WORK/page"; fi
    curl -s -o "$WORK/page2" "http://127.0.0.1:$PORT/alpha/todo/GET/Sev:CRIT"
    if grep -q 'GET-001' "$WORK/page2" && ! grep -q 'GET-003' "$WORK/page2"
    then ok "an http arg line is its path segments"
    else bad "an http arg line is its path segments" "$WORK/page2"; fi
    #  A reference INTO `todo/` is a path, not the verb: the href spells `cat`.
    curl -s -o "$WORK/page3" "http://127.0.0.1:$PORT/alpha/cat/todo/GET/GET-001.mkd"
    if grep -q 'href="/alpha/cat/todo/GET/GET-002.mkd' "$WORK/page3" \
       && ! grep -q 'href="/alpha/todo/GET/GET-002.mkd' "$WORK/page3"
    then ok "a link into todo/ routes as a path, not the todo verb"
    else bad "a link into todo/ routes as a path, not the todo verb" "$WORK/page3"; fi
    #  BEE-028: `/todo/<rest>` IS the verb, always — a file sitting under the
    #  repo's `todo/` is refused there, and the refusal links the path form.
    curl -s -D "$WORK/hdr4" -o "$WORK/page4" "http://127.0.0.1:$PORT/alpha/todo/GET/GET-002.mkd"
    if head -1 "$WORK/hdr4" | grep -q ' 404 ' && grep -q '<title>todo</title>' "$WORK/page4" \
       && grep -q 'href="/alpha/cat/todo/GET/GET-002.mkd"' "$WORK/page4"
    then ok "/todo/<file> is the verb, refused with a link to the path form"
    else bad "/todo/<file> is the verb, refused with a link to the path form" "$WORK/page4"; fi
    #  ...while a verb-less path that spells no verb converges on its spelled form.
    curl -s -D "$WORK/hdr5" -o /dev/null "http://127.0.0.1:$PORT/alpha/README.mkd"
    if head -1 "$WORK/hdr5" | grep -q ' 301 ' && grep -qi '^Location: /alpha/cat/README.mkd' "$WORK/hdr5"
    then ok "a verb-less file URL 301s to its cat form"
    else bad "a verb-less file URL 301s to its cat form" "$WORK/hdr5"; fi
    kill "$SRVPID" 2>/dev/null; SRVPID=""
else
    echo "todo: SKIP the http leg — no curl"
fi

# ==========================================================================
# leg 2 — the spans, in the runtime
# ==========================================================================
( cd "$WORK" && HOME="$FH" SRC_ROOT="$SRC" "$RT" --eval "require('$CASE/click.js')" ) \
  > "$WORK/c.out" 2> "$WORK/c.err"
RC=$?
sed 's/^/     /' "$WORK/c.out"
if [ "$RC" = 0 ] && grep -q '^PASS ' "$WORK/c.out"
then ok "click.js: the click spells, the grammar and the rails"
else bad "click.js: the click spells, the grammar and the rails" "$WORK/c.err"; fi

if [ "$FAILED" = 0 ]
then echo "PASS [bee/todo] $CHECKS shell checks, plus click.js"; exit 0
else echo "FAIL [bee/todo] $FAILED of $CHECKS shell checks"; exit 1; fi
