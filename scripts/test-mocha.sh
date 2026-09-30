#!/usr/bin/env bash
# builds the extension bundle, then runs the mocha suite via @vscode/test-web, deriving the exit code from the reporter's console output
#
# @vscode/test-web's own exit code can't be trusted: the process hangs after all tests finish, so this script greps the reporter's "MOCHA_SUITE_RESULT failures=N" line instead

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

pnpm -C "$ROOT_DIR" run build || exit 1

# a fixed port would collide with another instance already using it; ask the OS for a free one
PORT=$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();})")

OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

# a fresh process group, so the whole tree (including the browser) can be killed together once a result line shows up
setsid pnpm -C "$ROOT_DIR" exec vscode-test-web \
	--browserType=chromium --headless --port="$PORT" \
	--extensionDevelopmentPath="$ROOT_DIR" \
	--extensionTestsPath="$ROOT_DIR/client/extension/dist/test/suite/index.js" \
	"$ROOT_DIR/docstech" > "$OUTPUT_FILE" 2>&1 &
RUNNER_PID=$!

RESULT_LINE=""
for _ in $(seq 1 90); do
	RESULT_LINE="$(grep '^MOCHA_SUITE_RESULT ' "$OUTPUT_FILE" 2>/dev/null | tail -1)"
	if [ -n "$RESULT_LINE" ]; then
		break
	fi
	if ! kill -0 "$RUNNER_PID" 2>/dev/null; then
		break
	fi
	sleep 1
done

kill -- -"$RUNNER_PID" 2>/dev/null
wait "$RUNNER_PID" 2>/dev/null

cat "$OUTPUT_FILE"

if [ -z "$RESULT_LINE" ]; then
	echo "test-mocha: the suite never reported a result within the timeout - see output above"
	exit 1
fi

FAILURES="$(echo "$RESULT_LINE" | grep -oP 'failures=\K[0-9]+')"

if [ "$FAILURES" = "0" ]; then
	exit 0
fi
exit 1
