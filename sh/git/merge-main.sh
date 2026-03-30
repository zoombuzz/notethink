SOURCE_ENV="staging"
TARGET_ENV="main"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/../.."

git -C "$REPO_DIR" fetch --all && git -C "$REPO_DIR" checkout ${TARGET_ENV} && git -C "$REPO_DIR" merge ${SOURCE_ENV} && git -C "$REPO_DIR" push && git -C "$REPO_DIR" checkout ${SOURCE_ENV}
