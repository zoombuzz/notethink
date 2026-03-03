#!/usr/bin/env bash
# Run all jest test suites and print a combined summary.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

SUITES=(
    "extension|$ROOT_DIR/client/extension"
    "webview|$ROOT_DIR/client/webview"
    "notethink-views|$ROOT_DIR/client/webview/src/notethink-views"
)

# strip ANSI escape codes for parsing
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

RESULTS=()
ALL_PASSED=true

for entry in "${SUITES[@]}"; do
    IFS='|' read -r name dir <<< "$entry"

    # FORCE_COLOR keeps jest's coloured output even though we're capturing via pipe
    output=$(cd "$dir" && FORCE_COLOR=1 pnpm test 2>&1) || ALL_PASSED=false
    echo "$output"
    echo ""

    # parse jest summary lines (strip ANSI codes first)
    plain=$(echo "$output" | strip_ansi)
    suites=$(echo "$plain" | grep 'Test Suites:' | grep -oP '\d+(?= passed)' || echo "0")
    passed=$(echo "$plain" | grep 'Tests:' | grep -oP '\d+(?= passed)' || echo "0")
    failed=$(echo "$plain" | grep 'Tests:' | grep -oP '\d+(?= failed)' || echo "0")
    time=$(echo "$plain" | grep 'Time:' | grep -oP '[\d.]+(?= s)' || echo "?")

    RESULTS+=("$name|$suites|$passed|$failed|$time")
done

# summary table
GREEN='\033[32m'
RED='\033[31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

total_suites=0
total_passed=0
total_failed=0

echo ""
echo -e "${BOLD}┌──────────────────┬───────┬────────┬────────┬─────────┐${RESET}"
echo -e "${BOLD}│ Suite            │ Files │ Passed │ Failed │ Time    │${RESET}"
echo -e "${BOLD}├──────────────────┼───────┼────────┼────────┼─────────┤${RESET}"

for r in "${RESULTS[@]}"; do
    IFS='|' read -r name suites passed failed time <<< "$r"

    if [ "$failed" = "0" ]; then
        pass_color="$GREEN"
        fail_color="$DIM"
    else
        pass_color="$RESET"
        fail_color="$RED"
    fi

    printf "│ %-16s │ %5s │ ${pass_color}%6s${RESET} │ ${fail_color}%6s${RESET} │ %5s s │\n" \
        "$name" "$suites" "$passed" "$failed" "$time"

    total_suites=$((total_suites + suites))
    total_passed=$((total_passed + passed))
    total_failed=$((total_failed + failed))
done

if [ "$total_failed" = "0" ]; then
    total_pass_color="$GREEN"
    total_fail_color="$DIM"
else
    total_pass_color="$RESET"
    total_fail_color="$RED"
fi

echo -e "${BOLD}├──────────────────┼───────┼────────┼────────┼─────────┤${RESET}"
printf "${BOLD}│ %-16s │ %5s │${RESET} ${total_pass_color}%6s${RESET} ${BOLD}│${RESET} ${total_fail_color}%6s${RESET} ${BOLD}│         │${RESET}\n" \
    "TOTAL" "$total_suites" "$total_passed" "$total_failed"
echo -e "${BOLD}└──────────────────┴───────┴────────┴────────┴─────────┘${RESET}"

if [ "$ALL_PASSED" = false ]; then
    exit 1
fi
