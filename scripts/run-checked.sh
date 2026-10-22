#!/usr/bin/env bash
# runs a named check through green-stamp.sh when the operator's skills tree is reachable, or the
# plain command otherwise, so `pnpm run lint` / `pnpm run test-jest` behave the same for a
# contributor's machine or a CI runner as for the operator: skip-on-unchanged where the helper
# exists, the real check everywhere else. notethink is a public repository, so its package.json
# scripts must not hard-depend on a path under the operator's home directory.
set -uo pipefail

check="$1"
command="$2"
green_stamp="${HOME}/.claude/skills/scripts/green-stamp.sh"

if [ -f "${green_stamp}" ]; then
  exec bash "${green_stamp}" run . "${check}" "${command}"
fi

exec bash -c "${command}"
