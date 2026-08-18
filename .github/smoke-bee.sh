#!/bin/sh
# .github/smoke-bee.sh — the floor smoke: a fresh HOME has no jsrc anywhere,
# so a bareword invocation must extract the embedded pack and run from it.
# The command itself is free to fail; what is asserted is the extraction.
#   smoke-bee.sh <binary>
set -eu
BIN=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
S=$(mktemp -d); W=$(mktemp -d)
( cd "$W" && HOME="$S" XDG_CACHE_HOME= "$BIN" status 2>&1 | head -3 ) || true
find "$S/.cache/jsrcs" -mindepth 1 -maxdepth 1 -type d | grep -q . \
    || { echo "FAIL: jsrc floor did not extract" >&2; exit 1; }
