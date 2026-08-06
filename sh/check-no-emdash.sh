#!/usr/bin/env bash
# guardrail: never author an em dash (U+2014) or en dash (U+2013). use a plain hyphen.
#
# ONE RULE, EVERY FILE, ONE MOMENT. the scope is deliberately not carved up by directory:
# every tracked path is in scope, and the only thing that varies is WHEN a line is judged.
#
# DEFAULT MODE checks only work that is not yet committed - the working tree and index against
# HEAD, plus any new untracked file. that is the whole trick, and it is what keeps the rule
# simple enough to apply evenhandedly:
#   - you are only ever told about text you have not committed, which is text you are still
#     writing. fixing it is one keystroke in a line already under your cursor.
#   - nothing already committed is ever re-flagged, so no one is sent ferreting through
#     artifacts where the character has to be there or where changing it is consequential.
#   - text a model produced and we committed as evidence (analysis dumps, design handovers,
#     recorded outputs) is history the moment it lands, so it is never policed again.
#   - a repo can adopt this guard on day one without first converging its history, however much of
#     the character that history already carries.
# the trade is that a dash committed without running this check becomes history and is not
# caught later. that is the intended bargain, and /prod-ready runs before the commit, which is
# exactly when authored text is still uncommitted.
#
# --branch widens the window to everything this branch adds over its merge base with the default
# branch: the right scope for reviewing a whole story before it ships.
# --all scans every tracked file, the full sweep for a repo whose tree is already clean.
#
# gitignored local state (.env secrets, generated reports, vendored bundles) is out of scope in
# every mode because only tracked and new-untracked paths are considered. the explicit :(exclude)
# pathspecs additionally drop immutable prisma migration history, generated code, deprecated
# trees, binary image types, and the pnpm lockfile (registry-authored strings such as npm
# deprecation notices can carry either dash, and any hand edit is undone by the next install).
#
# run from anywhere; resolves the repo root from its own location. wired into /prod-ready and
# intended for pre-commit / CI use. exits non-zero on any hit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MODE="uncommitted"
case "${1:-}" in
    "")         MODE="uncommitted" ;;
    --branch)   MODE="branch" ;;
    --all)      MODE="all" ;;
    *)          echo "usage: $(basename "$0") [--branch|--all]" >&2; exit 2 ;;
esac

# the banned glyphs are built from raw bytes so this script never contains them itself.
# $'\xHH' is byte-literal and identical in every locale; printf '\uXXXX' is NOT - in a C/POSIX
# locale bash emits the literal text \u2014, which silently disarms every check below.
EM_DASH=$'\xe2\x80\x94'
EN_DASH=$'\xe2\x80\x93'

# git grep exits 1 for "no match" and >=2 for a real failure. conflating them is precisely how a
# broken guardrail reports success, so anything above 1 is loud and non-zero.
run_git_grep() {
    local out status
    out="$(git grep -n -F -e "$EM_DASH" -e "$EN_DASH" "$@" 2>&1)" && status=0 || status=$?
    if [ "$status" -gt 1 ]; then
        echo "ERROR: git grep failed (exit $status) - the check did NOT run: $out" >&2
        exit 2
    fi
    printf '%s' "$out"
}

PATHSPECS=(
    ':(exclude)**/.env.*' ':(exclude).env.*'
    ':(exclude)**/prisma/migrations/**'
    ':(exclude)**/generated/**'
    ':(exclude)**/pnpm-lock.yaml' ':(exclude)pnpm-lock.yaml'
    ':(exclude)**/deprecated/**' ':(exclude)deprecated/**'
    ':(exclude)*.svg' ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.jpeg'
    ':(exclude)*.gif' ':(exclude)*.webp' ':(exclude)*.ico'
)

# resolve the default branch for --branch: origin's HEAD if known, else main, else master
resolve_base_branch() {
    local origin_head
    origin_head="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
    if [ -n "$origin_head" ] && git rev-parse --verify --quiet "$origin_head" >/dev/null; then
        echo "$origin_head"
        return
    fi
    for candidate in main master origin/main origin/master; do
        if git rev-parse --verify --quiet "$candidate" >/dev/null; then
            echo "$candidate"
            return
        fi
    done
}

# added lines in a diff against $1, reported as file:line to match git grep -n output.
# awk tracks the +++ header and hunk start; index() on the literal glyph sidesteps awk's
# inconsistent handling of multibyte escapes in regex character classes.
added_line_hits() {
    git diff --unified=0 --no-color --no-ext-diff "$1" -- "${PATHSPECS[@]}" 2>/dev/null \
        | awk -v em="$EM_DASH" -v en="$EN_DASH" '
            /^\+\+\+ b\// { file = substr($0, 7); next }
            /^@@ / { split($3, hunk, ","); line = substr(hunk[1], 2) + 0; next }
            /^\+/ {
                body = substr($0, 2)
                if (index(body, em) || index(body, en)) { print file ":" line ": " body }
                line++
            }
        ' || true
}

# a brand-new file is untracked until it is staged, so no diff can see it. /prod-ready runs
# before the commit, which is exactly when new files are still untracked - without this pass a
# freshly authored file would sail through the gate it exists to catch. every line of such a
# file is new by definition, so it is scanned whole.
# git grep --no-index rather than plain grep so both this pass and --all match through the same
# engine. a bare `grep -P '[\x{2014}...]'` depends on the ambient grep supporting PCRE with
# codepoint escapes, which is not a safe assumption across machines (a ugrep shim, busybox, or a
# non-UTF-8 locale each silently match nothing, and a guardrail that silently matches nothing is
# worse than no guardrail).
untracked_hits() {
    local files=() f
    while IFS= read -r -d '' f; do files+=("$f"); done \
        < <(git ls-files --others --exclude-standard -z -- "${PATHSPECS[@]}")
    [ ${#files[@]} -eq 0 ] && return 0
    run_git_grep --no-index -- "${files[@]}"
}

case "$MODE" in
    all)
        hits="$(run_git_grep -- "${PATHSPECS[@]}")"
        scope="every tracked file"
        ;;
    branch)
        base_branch="$(resolve_base_branch)"
        merge_base=""
        if [ -n "$base_branch" ]; then
            merge_base="$(git merge-base HEAD "$base_branch" 2>/dev/null || true)"
        fi
        if [ -z "$merge_base" ]; then
            echo "note: no merge base with a default branch; narrowing to uncommitted work" >&2
            merge_base="HEAD"
            scope="uncommitted work (no merge base found)"
        else
            scope="everything added since $base_branch"
        fi
        hits="$(added_line_hits "$merge_base")"
        ;;
    *)
        hits="$(added_line_hits HEAD)"
        scope="uncommitted work"
        ;;
esac

new_files="$(untracked_hits)"
if [ -n "$new_files" ]; then
    hits="${hits:+$hits$'\n'}$new_files"
fi

if [ -n "$hits" ]; then
    echo ""
    echo "FAIL: em-dash (U+2014) or en-dash (U+2013) authored in $scope."
    echo "      replace each with a plain hyphen '-' (house style bans authoring both)."
    echo ""
    echo "$hits"
    exit 1
fi

echo "OK: no em-dash / en-dash authored in $scope."
