#!/bin/sh
# .github/build-static.sh — the fully static linux x86_64 `bee`: musl +
# vendored quickjs-ng + the embedded jsrc pack, so it runs on ANY Linux with
# zero runtime deps.  Runs inside an alpine container, lite checkout as cwd.
# Nothing to cache here, unlike be's static leg: quickjab's engine is
# vendored, so there is no WebKit compile and no ICU data to embed.
#   build-static.sh <out-binary>
set -eu
OUT=$1
SRC=$PWD

apk add -q build-base cmake samurai git file curl-dev \
    libsodium-dev libsodium-static zlib-dev zlib-static lz4-dev lz4-static \
    linux-headers

# Only dog/ is fetched — quickjab's test/ submodule feeds its own ctest suite,
# which we never run, and a blanket --recurse-submodules dies on its pin.
git config --global --add safe.directory "$SRC"
git clone -q --depth 1 https://github.com/gritzko/quickjab.git quickjab-src
git -C quickjab-src submodule update -q --init --recursive dog

# A pristine archive, so no .git and no fetched fixtures ride into the pack.
mkdir -p bee-jsrc
git archive HEAD | tar -x -C bee-jsrc

# abc's curl group sits outside abc-core, so build the binary target only:
# a curl-linking test TU would break -static.
cmake -S quickjab-src -B qj-build -GNinja -DCMAKE_BUILD_TYPE=Release \
    "-DJAB_JSRC=$SRC/bee-jsrc" -DQUICKJAB_JSRC_PACK=ON -DJAB_BIN=bee \
    -DCMAKE_EXE_LINKER_FLAGS=-static
ninja -C qj-build quickjab
strip qj-build/bin/bee
cp qj-build/bin/bee "$OUT"

file "$OUT" | grep -q 'static' || { echo "FAIL: not static" >&2; exit 1; }
sh "$SRC/.github/smoke-bee.sh" "$OUT"
echo "build-static: OK, $(du -h "$OUT" | cut -f1)"
