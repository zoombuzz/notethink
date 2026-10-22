#!/usr/bin/env bash
# lint script for notethink, run by scripts/run-checked.sh (wrapped by green-stamp.sh where that
# is reachable).
#
# green-stamp.sh's `run` execs its command array directly rather than through a shell, so a
# compound command (`eslint . && tsc`) cannot be passed to it as the literal argument - the `&&`
# reaches eslint as a plain CLI argument instead of being interpreted. This script holds the
# compound command itself, so green-stamp.sh only ever execs one program.
set -euo pipefail

pkg_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${pkg_dir}"

node --test 'eslint-rules/*.test.mjs'
eslint .
tsc --noEmit -p client/extension
tsc --noEmit -p client/webview
tsc --noEmit -p client/webview/src/notethink-views
