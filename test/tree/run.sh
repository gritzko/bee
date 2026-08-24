#!/bin/sh
# lite/test/tree/run.sh — LITE-017: `lite tree [<hex>|<path>][?<rev>]`, the raw
# git tree listing.  be has no test dir for `tree:` — its contract lives in the
# view header (JAB-008) — so this leg PINS it: the fixed row bytes, the raw
# tree order, the `..` row, and every mode class the prefix table names.
#
#   bytes — `lite tree --plain` byte-for-byte against `git ls-tree` reshaped to
#           the JAB-008 row (`<mode6> <type6> <sha40>\t<name>[/]`), over a root
#           listing, a descended one, and every mode: dir, file, executable,
#           symlink and gitlink.  No banner: the row block IS the output.
#   forms — the arg classification (log.js's own): bare = the checked-out tip, a
#           commit hexlet, a TREE hexlet, a path, a `<path>?<rev>`, and the
#           refusals (a file as a dir, an absent path, a climb out of the repo).
#   hunk  — hunk.js: the tty side headless — one hunk, the D/F/S spans over the
#           very same visible bytes, and the hidden `U` target per entry (a dir
#           opens a `tree`, a blob a `blob <sha>`, a gitlink nothing).
#
# Standalone: `sh lite/test/tree/run.sh` from anywhere (it cds itself).
# $LITEJAB picks the runtime (default `jab`), which must be built from THIS
# tree.  Fixtures live in a mktemp dir under ~/tmp, removed on a green run
# (kept, with the path printed, on a red).
set -u

CASE=$(cd "$(dirname "$0")" && pwd)              # lite/test/tree
LITE=$(cd "$CASE/../.." && pwd)                  # lite/

RT="${LITEJAB:-jab}"
case "$RT" in
    */*) [ -x "$RT" ] || { echo "tree: no runtime at $RT" >&2; exit 2; }
         RT=$(cd "$(dirname "$RT")" && pwd)/$(basename "$RT") ;;
    *)   command -v "$RT" >/dev/null 2>&1 || { echo "tree: no runtime '$RT' on PATH" >&2; exit 2; } ;;
esac
command -v git >/dev/null 2>&1 || { echo "tree: SKIP — no git to build a fixture" >&2; exit 0; }

TMPROOT="${HOME}/tmp"
mkdir -p "$TMPROOT" || { echo "tree: cannot mkdir $TMPROOT" >&2; exit 2; }
WORK=$(mktemp -d "$TMPROOT/lite-tree.XXXXXX") || exit 2
CHECKS=0; FAILED=0
trap 'rc=$?; if [ "$rc" = 0 ] && [ "$FAILED" = 0 ]; then rm -rf "$WORK";
      else echo "tree: fixtures kept at $WORK" >&2; fi; exit $rc' EXIT

ok()  { CHECKS=$((CHECKS + 1)); echo "ok   $1"; }
bad() {
    CHECKS=$((CHECKS + 1)); FAILED=$((FAILED + 1))
    echo "FAIL $1"; shift
    for f in "$@"; do [ -f "$f" ] || continue; echo "--- $f ---"; cat "$f"; done
}
FAKEHOME="$WORK/home"; mkdir -p "$FAKEHOME"
: "${XDG_CACHE_HOME:=${HOME}/.cache}"      # the pack cache stays on the REAL home
export XDG_CACHE_HOME
#  BEE-031: every runtime call runs under a FIXTURE home — `install` and
#  `index` write `$HOME/.config/bee/repos`, never the user's own registry.
export HOME="$FAKEHOME"
ln -sf "$LITE" "$WORK/jsrc"                # TEST-005:8 unpacked-runtime climb
rtin() { D=$1; shift; ( cd "$D" && HOME="$FAKEHOME" "$RT" "$@" ); }
echo "tree: runtime $RT, fixtures $WORK"

# --- the fixture ----------------------------------------------------------
# One commit carrying every mode class the JAB-008 prefix table names: a plain
# file, an executable, a symlink, a subdirectory, and a GITLINK (planted through
# the git index, which is all a gitlink ever is — a sha in a tree).
REPO="$WORK/repo"; mkdir -p "$REPO/sub"
(
  cd "$REPO" || exit 1
  git init -q -b master . && git config user.email t@t && git config user.name T || exit 1
  printf 'A0\n' > a.txt
  printf '#!/bin/sh\necho hi\n' > run.sh && chmod +x run.sh
  ln -s a.txt link.txt
  printf 'X0\n' > sub/x.txt
  git add -A && git commit -q -m 'C0 the mode zoo' || exit 1
  # the gitlink: a commit sha of THIS repo, recorded at path `mod` as 160000.
  git update-index --add --cacheinfo "160000,$(git rev-parse HEAD),mod" || exit 1
  git commit -q -m 'C1 a gitlink' || exit 1
) || { echo "tree: cannot build the fixture repo" >&2; exit 2; }
g() { git -C "$REPO" "$@"; }
TIP=$(g rev-parse HEAD)
ROOTTREE=$(g rev-parse "HEAD^{tree}")
SUBTREE=$(g rev-parse "HEAD:sub")

# `git ls-tree` reshaped into the JAB-008 row: the type column padded to six and
# a dir's name carrying its trailing '/'.  This is the ORACLE for the bytes.
expect() {   # expect <tree-ish> [<prefix-line>...]
    _t=$1; shift
    for _pre in "$@"; do printf '%s\n' "$_pre"; done
    g ls-tree "$_t" | awk '{ printf "%s %-6s %s\t%s%s\n", $1, $2, $3, $4, ($2 == "tree" ? "/" : "") }'
}

# ==========================================================================
# leg 1 — THE BYTES
# ==========================================================================
expect HEAD > "$WORK/want.root"
rtin "$REPO" tree --plain > "$WORK/got.root" 2>"$WORK/err.root"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/want.root" "$WORK/got.root"
then ok "the root listing is the JAB-008 row block, byte for byte"
else bad "root rows (rc $RC)" "$WORK/want.root" "$WORK/got.root" "$WORK/err.root"; fi

# Every mode class made it into those bytes, spelled the ruled way.
for _row in "040000 tree   " "100644 blob   " "100755 blob   " "120000 blob   " "160000 commit "; do
    if grep -q "^$_row" "$WORK/got.root"
    then ok "the '$_row' prefix is spelled the JAB-008 way"
    else bad "missing mode prefix '$_row'" "$WORK/got.root"; fi
done
# A dir's name carries the trailing '/', a file's does not.
if grep -q "	sub/$" "$WORK/got.root" && grep -q "	a.txt$" "$WORK/got.root"
then ok "a dir's name carries the trailing '/', a file's does not"
else bad "the trailing-slash rule" "$WORK/got.root"; fi
# The order is the TREE's own, never re-sorted: `git ls-tree` order is the file.
if [ "$(cut -c1-6 "$WORK/got.root" | tr '\n' ' ')" = "$(cut -c1-6 "$WORK/want.root" | tr '\n' ' ')" ]
then ok "the rows come out in raw git-tree order"
else bad "tree order" "$WORK/got.root" "$WORK/want.root"; fi
# There is NO banner: the first byte of the output is the first row.
if [ "$(head -n1 "$WORK/got.root" | cut -c1-6)" = "$(head -n1 "$WORK/want.root" | cut -c1-6)" ]
then ok "the plain output leads with a row, not a banner"
else bad "banner-free plain output" "$WORK/got.root"; fi

# Descended: the BARE `..` row comes first, then that subtree's rows.
expect "HEAD:sub" ".." > "$WORK/want.sub"
rtin "$REPO" tree --plain sub > "$WORK/got.sub" 2>"$WORK/err.sub"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/want.sub" "$WORK/got.sub"
then ok "a descended listing leads with the bare '..' row"
else bad "sub rows (rc $RC)" "$WORK/want.sub" "$WORK/got.sub" "$WORK/err.sub"; fi
if [ "$(head -n1 "$WORK/got.sub")" = ".." ]
then ok "the '..' row is bare — no mode, no type, no sha"
else bad "'..' row shape" "$WORK/got.sub"; fi
# ...and NEVER at the root.
if ! head -n1 "$WORK/got.root" | grep -q '^\.\.$'
then ok "the root listing has no '..' row"
else bad "'..' at the root" "$WORK/got.root"; fi
# A trailing slash on the arg is the same listing.
rtin "$REPO" tree --plain sub/ > "$WORK/got.sub2" 2>&1
if cmp -s "$WORK/got.sub" "$WORK/got.sub2"
then ok "'sub' and 'sub/' name the same tree"
else bad "trailing slash" "$WORK/got.sub2"; fi

# ==========================================================================
# leg 2 — THE FORMS
# ==========================================================================
same() {   # same <label> <args...>  — output equal to the bare root listing
    _l=$1; shift
    rtin "$REPO" tree --plain "$@" > "$WORK/f.out" 2>"$WORK/f.err"
    if cmp -s "$WORK/want.root" "$WORK/f.out"
    then ok "$_l"
    else bad "$_l" "$WORK/want.root" "$WORK/f.out" "$WORK/f.err"; fi
}
same "a full commit sha lists that commit's tree" "$TIP"
same "a short commit hexlet lists the same tree" "$(printf '%s' "$TIP" | cut -c1-8)"
same "a TREE sha lists itself" "$ROOTTREE"
same "a short tree hexlet lists itself" "$(printf '%s' "$ROOTTREE" | cut -c1-10)"
same "'.' is the root" .
same "an empty ?rev is the checked-out tip" "?"

# `<path>?<rev>` — the SUBTREE at that commit (the `?` split is uri._parse's,
# never a hand-rolled scan for a '?').
rtin "$REPO" tree --plain "sub?$TIP" > "$WORK/f.rev" 2>"$WORK/f.reve"; RC=$?
if [ "$RC" = 0 ] && cmp -s "$WORK/got.sub" "$WORK/f.rev"
then ok "'<path>?<rev>' lists that path at that rev"
else bad "path?rev (rc $RC)" "$WORK/got.sub" "$WORK/f.rev" "$WORK/f.reve"; fi

# A branch NAME is a rev too (a refname beats a hashlet, be's own order).
rtin "$REPO" tree --plain "sub?master" > "$WORK/f.br" 2>&1
if cmp -s "$WORK/got.sub" "$WORK/f.br"
then ok "a branch name resolves as a rev"
else bad "branch rev" "$WORK/f.br"; fi

# The refusals: plain words, nothing on stdout, non-zero.
refuse() {   # refuse <label> <want-word> <args...>
    _l=$1; _w=$2; shift 2
    rtin "$REPO" tree "$@" > "$WORK/r.out" 2>"$WORK/r.err"; _rc=$?
    if [ "$_rc" != 0 ] && [ ! -s "$WORK/r.out" ] && grep -q "$_w" "$WORK/r.err"
    then ok "$_l"
    else bad "$_l (rc $_rc)" "$WORK/r.out" "$WORK/r.err"; fi
}
refuse "a file as a directory is refused in plain words" "is a file, not a directory" a.txt
refuse "an absent path is refused in plain words" "is not in" nosuch/deep
refuse "a climb out of the repository is refused" "is outside" ../elsewhere
refuse "an unknown hexlet is refused in plain words" "no object" deadbeefdead
refuse "a BLOB hexlet is refused in plain words" "has no entries" "$(g rev-parse HEAD:a.txt)"

# ==========================================================================
# leg 3 — the tty side, headless (hunk + spans + the hidden U targets)
# ==========================================================================
( cd "$LITE" && HOME="$FAKEHOME" LITE_FIX="$REPO" LITE_TIP="$TIP" LITE_SUBTREE="$SUBTREE" \
  "$RT" --eval "require('$CASE/hunk.js')" ) > "$WORK/h.out" 2>"$WORK/h.err"; RC=$?
if [ "$RC" = 0 ] && grep -q '^DONE' "$WORK/h.out" && ! grep -q '^FAIL' "$WORK/h.out"; then
    N=$(grep -c '^ok' "$WORK/h.out"); CHECKS=$((CHECKS + N))
    ok "hunk leg: $N checks (spans over the plain bytes + the U targets)"
else
    cat "$WORK/h.out"; head -5 "$WORK/h.err"
    bad "hunk leg (rc $RC)" "$WORK/h.out"
fi

if [ "$FAILED" != 0 ]; then
    echo "FAIL [lite/tree] $FAILED of $CHECKS checks failed" >&2
    exit 1
fi
echo "PASS [lite/tree] $CHECKS checks, runtime $RT"
exit 0
