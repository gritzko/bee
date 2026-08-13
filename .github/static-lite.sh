#!/bin/sh
# .github/static-lite.sh — build the fully static Beagle-lite `be` (musl +
# vendored quickjs-ng + embedded lite jsrc pack).  Runs inside an alpine
# container; the lite checkout is the cwd.  After be/.github/static-be.sh,
# minus its JSC and ICU stages: quickjab's engine is vendored, so there is
# no WebKit compile to cache and no ICU data to embed.
#
#   static-lite.sh <out-binary>
set -eu
OUT=$1
SRC=$PWD

apk add -q build-base cmake samurai git file curl-dev \
    libsodium-dev libsodium-static zlib-dev zlib-static lz4-dev lz4-static \
    linux-headers

# --- 1. sources: quickjab, STANDALONE ---------------------------------------
# quickjab carries dog (libdog) and test (the jab-shared API suite) as its
# own submodules, plus the jsrcpack.js/.S packer pair and lsan.supp — no jab
# tree anywhere in the build.
git config --global --add safe.directory "$SRC"
git clone -q --recurse-submodules --depth 1 \
    https://github.com/gritzko/quickjab.git quickjab-src

# --- 2. the lite jsrc pack source: a pristine archive of this rev -----------
mkdir -p lite-jsrc
git archive HEAD | tar -x -C lite-jsrc

# --- 3. quickjab, static, with the lite pack --------------------------------
# abc's curl group is outside abc-core (POL/NET/CURL): build the binary only,
# as static-be does with jab, so no curl-linking test TU breaks -static.
cmake -S quickjab-src -B qj-build -GNinja -DCMAKE_BUILD_TYPE=Release \
    "-DJAB_JSRC=$SRC/lite-jsrc" -DQUICKJAB_JSRC_PACK=ON \
    -DCMAKE_EXE_LINKER_FLAGS=-static
ninja -C qj-build quickjab
strip qj-build/bin/quickjab
cp qj-build/bin/quickjab "$OUT"

# --- 4. smoke: static, floor extracts, a bareword runs with no checkout -----
file "$OUT" | grep -q 'static' || { echo "FAIL: not static" >&2; exit 1; }
S=$(mktemp -d); W=$(mktemp -d)
( cd "$W" && HOME="$S" XDG_CACHE_HOME= "$OUT" status 2>&1 | head -3 ) || true
find "$S/.cache/jsrcs" -mindepth 1 -maxdepth 1 -type d | grep -q . \
    || { echo "FAIL: jsrc floor did not extract" >&2; exit 1; }
echo "static-lite: OK, $(du -h "$OUT" | cut -f1)"
