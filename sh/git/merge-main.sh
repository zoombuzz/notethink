#!/usr/bin/env bash
# merge staging -> main (production deployment) and release to the VS Code Marketplace.
# a merge to main IS the production release, so it also runs the credentialed
# `vsce publish`. the publish is version-guarded: if this version is already on the
# marketplace (e.g. a no-op re-merge) it is skipped rather than hard-failing the
# merge; any other publish failure aborts loudly.
#
# main MUST stay a fast-forward of staging - the ref update below fast-forwards main to staging in
# place and can never create a merge commit or prompt for a message. if it aborts with a non-fast-
# forward rejection, main has diverged (it carries a commit staging lacks, e.g. an old merge commit
# or a direct push); realign once with:
#   git checkout main && git reset --hard origin/staging && git push --force-with-lease origin main && git checkout staging
# then re-run. never "fix" a non-ff by forcing the update.
set -euo pipefail

SOURCE_ENV="staging"
TARGET_ENV="main"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/../.."
EXTENSION_ID="NoteThink.notethink"

git -C "$REPO_DIR" fetch --all
# advance the target branch to the source and push WITHOUT checking out the target. checking it out
# lets git overwrite or delete working-tree files that are gitignored but still tracked on the target.
# fetch . source:target fast-forwards the local target ref in place and exits nonzero if it is not a
# fast-forward (the same guard as merge --ff-only); the working tree never leaves the source branch,
# so the marketplace publish below runs from that same fast-forwarded content.
git -C "$REPO_DIR" fetch . "$SOURCE_ENV:$TARGET_ENV"
git -C "$REPO_DIR" push origin "$TARGET_ENV"

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
		echo "marketplace: publish FAILED for $EXTENSION_ID@$PKG_VERSION" >&2
		exit 1
	fi
fi
