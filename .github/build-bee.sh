#!/bin/sh
# .github/build-bee.sh — the release binary: quickjab with THIS rev packed in
# as its default jsrc floor (JAB-035), so `bee` runs with no checkout at all.
# Shared by ci.yml and release.yml so the shipped build is the tested build.
# The lite checkout is the cwd; the binary lands in qj-build/bin/bee.
# Only dog/ is fetched — quickjab's other submodule test/ feeds its own ctest
# suite, which we never run, and a blanket --recurse-submodules dies on it.
set -eu
SRC=$PWD

git config --global --add safe.directory "$SRC"
git clone -q --depth 1 https://github.com/gritzko/quickjab.git quickjab-src
git -C quickjab-src submodule update -q --init --recursive dog
git -C quickjab-src submodule update -q --init --recursive qjs

# A pristine archive, so no .git and no fetched fixtures ride into the pack.
mkdir -p bee-jsrc
git archive HEAD | tar -x -C bee-jsrc

cmake -S quickjab-src -B qj-build -GNinja -DCMAKE_BUILD_TYPE=Release \
    "-DJAB_JSRC=$SRC/bee-jsrc" -DQUICKJAB_JSRC_PACK=ON -DJAB_BIN=bee
ninja -C qj-build quickjab
