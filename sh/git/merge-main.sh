#!/usr/bin/env bash
# merge staging -> main (production deployment) and release to the VS Code Marketplace.
# a merge to main IS the production release, so it also runs the credentialed
# `vsce publish`. the publish is version-guarded: if this version is already on the
# marketplace (e.g. a no-op re-merge) it is skipped rather than hard-failing the
# merge; any other publish failure aborts loudly and returns to the source branch.
set -euo pipefail

SOURCE_ENV="staging"
TARGET_ENV="main"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/../.."
EXTENSION_ID="NoteThink.notethink"

git -C "$REPO_DIR" fetch --all
git -C "$REPO_DIR" checkout "$TARGET_ENV"
git -C "$REPO_DIR" merge "$SOURCE_ENV"
git -C "$REPO_DIR" push

# release the merged main state to the VS Code Marketplace
PKG_VERSION="$(node -p "require('$REPO_DIR/package.json').version")"
echo "marketplace: releasing $EXTENSION_ID@$PKG_VERSION"
if PUBLISH_LOG="$(pnpm -C "$REPO_DIR" run publish:marketplace 2>&1)"; then
	echo "$PUBLISH_LOG"
	echo "marketplace: published $EXTENSION_ID@$PKG_VERSION"
else
	echo "$PUBLISH_LOG"
	if printf '%s' "$PUBLISH_LOG" | grep -qiE 'already (exists|published)'; then
		echo "marketplace: $PKG_VERSION already published, skipping (no-op merge)"
	else
		git -C "$REPO_DIR" checkout "$SOURCE_ENV" || true
		echo "marketplace: publish FAILED for $EXTENSION_ID@$PKG_VERSION" >&2
		exit 1
	fi
fi

git -C "$REPO_DIR" checkout "$SOURCE_ENV"
