#!/usr/bin/env bash
# guardrail: no em dash (U+2014) or en dash (U+2013) in authored, git-tracked files.
# the house style bans both site-wide - use a plain hyphen instead. this scans only
# git-tracked files, so gitignored local state (.env secrets, generated reports,
# downloaded/vendored bundles) is never flagged; it additionally excludes immutable
# prisma migration history, generated code, deprecated/archived trees, and the pnpm
# lockfile, which embeds registry-authored strings (deprecation notices, package
# descriptions) that can contain either dash and are rewritten by the next install.
# run from anywhere; resolves the repo root from its own location. wired into
# /prod-ready and intended for pre-commit / CI use. exits non-zero on any hit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

hits="$(git grep -lP '[\x{2014}\x{2013}]' -- \
    ':(exclude)**/.env.*' ':(exclude).env.*' \
    ':(exclude)**/prisma/migrations/**' \
    ':(exclude)**/generated/**' \
    ':(exclude)**/pnpm-lock.yaml' ':(exclude)pnpm-lock.yaml' \
    ':(exclude)**/deprecated/**' ':(exclude)deprecated/**' \
    ':(exclude)*.svg' ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.jpeg' \
    ':(exclude)*.gif' ':(exclude)*.webp' ':(exclude)*.ico' \
    2>/dev/null || true)"

if [ -n "$hits" ]; then
    echo ""
    echo "FAIL: em-dash (U+2014) or en-dash (U+2013) found in the tracked files below."
    echo "      replace each with a plain hyphen '-' (house style bans both site-wide)."
    echo ""
    echo "$hits"
    exit 1
fi

echo "OK: no em-dash / en-dash in tracked files."
