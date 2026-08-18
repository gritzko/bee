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

# tzdata is not build input: alpine ships no zoneinfo, musl then resolves every
# zone to UTC, and the chat suite pins a local-time stamp (test/chat/run.sh:104:cy).
apk add -q build-base cmake samurai git file curl-dev \
    libsodium-dev libsodium-static zlib-dev zlib-static lz4-dev lz4-static \
    linux-headers tzdata

# Only dog/ is fetched — quickjab's test/ submodule feeds its own ctest suite,
# which we never run, and a blanket --recurse-submodules dies on its pin.
git config --global --add safe.directory "$SRC"
git clone -q --depth 1 https://github.com/gritzko/quickjab.git quickjab-src
git -C quickjab-src submodule update -q --init --recursive dog

# A pristine archive, so no .git and no fetched fixtures ride into the pack.
mkdir -p bee-jsrc
git archive HEAD | tar -x -C bee-jsrc

# find_library would hand -static the .so and ld would refuse, so make every
# lookup in the tree try .a first.  CMakeGenericSystem.cmake re-sets these with
# a plain set(), which shadows a -D, so inject after project() instead.
# .so stays as the fallback for libcurl, which has no archive on alpine and
# never reaches the link line anyway (abc's curl group is outside abc-core).
mkdir -p qj-build
echo 'set(CMAKE_FIND_LIBRARY_SUFFIXES ".a" ".so")' > qj-build/prefer-static.cmake

# abc's curl group sits outside abc-core, so build the binary target only:
# a curl-linking test TU would break -static.
cmake -S quickjab-src -B qj-build -GNinja -DCMAKE_BUILD_TYPE=Release \
    "-DJAB_JSRC=$SRC/bee-jsrc" -DQUICKJAB_JSRC_PACK=ON -DJAB_BIN=bee \
    -DCMAKE_EXE_LINKER_FLAGS=-static \
    "-DCMAKE_PROJECT_INCLUDE=$SRC/qj-build/prefer-static.cmake"
ninja -C qj-build quickjab

# The suites before the strip, so a musl-only regression cannot ship.
ctest --test-dir qj-build -R '^JSRC' --output-on-failure

strip qj-build/bin/bee
cp qj-build/bin/bee "$OUT"

file "$OUT" | grep -q 'static' || { echo "FAIL: not static" >&2; exit 1; }
sh "$SRC/.github/smoke-bee.sh" "$OUT"
echo "build-static: OK, $(du -h "$OUT" | cut -f1)"
