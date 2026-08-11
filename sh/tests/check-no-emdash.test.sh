#!/usr/bin/env bash
# regression harness for sh/check-no-emdash.sh.
#
# WHY THIS EXISTS. The guard has silently false-passed twice: once because a C/POSIX locale turned
# the printf escape for U+2014 into its own literal source text, disarming every needle, and once
# because a failing `git grep` exit was swallowed and read as "no hits". A gate whose failure mode
# is REPORTING SUCCESS has no natural feedback signal - nobody notices until something ships with
# the glyph in it. So the assertions below care as much about the guard FAILING when it should as
# about it passing when it should, and several deliberately break the environment to check that.
#
# Note this file may not contain either glyph itself, since the guard scans it like anything else.
# The two needles are built from raw bytes below, and every comment here names the codepoint.
#
# WHY BASH AND NOT JEST. This needs `LC_ALL=C` and `env -i` on the process under test. A jest
# worker cannot give either cleanly, and every repo's jest testMatch is scoped to its app source
# (zooey's is <rootDir>/src/**), so a test under sh/ would simply never be collected. A bash test
# also travels byte-identically alongside the script it tests, which is the same distribution the
# script itself uses.
#
# Each case builds a THROWAWAY git repo in a temp dir and copies the guard into it, so nothing here
# reads or writes the real working tree. Run it from anywhere; it resolves the script under test
# from its own location.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$(cd "$SCRIPT_DIR/.." && pwd)/check-no-emdash.sh"

if [ ! -x "$GUARD" ]; then
    echo "FATAL: guard not found or not executable at $GUARD" >&2
    exit 2
fi

# raw bytes, never an escape: printf '\uXXXX' emits its own literal source text in a C locale,
# the exact defect this harness was written after. see the guard's own BANNED_GLYPHS comment.
EM=$'\xe2\x80\x94'
EN=$'\xe2\x80\x93'

pass_count=0
fail_count=0

ok() { pass_count=$((pass_count + 1)); printf '  ok   %s\n' "$1"; }
no() { fail_count=$((fail_count + 1)); printf '  FAIL %s\n' "$1"; [ $# -gt 1 ] && printf '       %s\n' "$2"; }

assert_status() {
    local want="$1" got="$2" what="$3" output="${4:-}"
    if [ "$got" = "$want" ]; then ok "$what"; else no "$what" "expected exit $want, got $got${output:+ | output: $output}"; fi
}

assert_contains() {
    local needle="$1" hay="$2" what="$3"
    case "$hay" in
        *"$needle"*) ok "$what" ;;
        *) no "$what" "expected to find '$needle' in: $hay" ;;
    esac
}

assert_not_contains() {
    local needle="$1" hay="$2" what="$3"
    case "$hay" in
        *"$needle"*) no "$what" "did NOT expect '$needle' in: $hay" ;;
        *) ok "$what" ;;
    esac
}

# a throwaway repo with one committed clean file, and the guard copied to the same relative path it
# occupies in a real repo so its own `git rev-parse --show-toplevel` resolves to the sandbox.
new_repo() {
    local dir
    dir="$(mktemp -d)"
    git -C "$dir" init --quiet
    git -C "$dir" config user.email test@example.com
    git -C "$dir" config user.name test
    git -C "$dir" config commit.gpgsign false
    mkdir -p "$dir/sh"
    cp "$GUARD" "$dir/sh/check-no-emdash.sh"
    printf 'clean baseline - a plain hyphen is fine\n' > "$dir/tracked.md"
    git -C "$dir" add -A >/dev/null
    git -C "$dir" commit --quiet -m "baseline"
    printf '%s' "$dir"
}

run_guard() { # run_guard <repo> [args...] -> prints output, returns exit status
    local repo="$1"; shift
    ( cd "$repo" && ./sh/check-no-emdash.sh "$@" 2>&1 )
}

echo "check-no-emdash regression harness"
echo

# ---------------------------------------------------------------- baseline behaviour
echo "clean tree"
repo="$(new_repo)"
out="$(run_guard "$repo")"; st=$?
assert_status 0 "$st" "clean tree exits 0" "$out"
assert_contains "OK:" "$out" "clean tree says OK"
rm -rf "$repo"

# ---------------------------------------------------------------- the core catch, three environments
# the locale cases are the regression: the guard once used printf '\uXXXX' to build its needles,
# which a C/POSIX locale renders as the literal characters backslash-u-2-0-1-4, matching nothing.
echo
echo "a glyph in a modified tracked file is caught"
for env_label in "utf8" "LC_ALL=C" "env -i"; do
    repo="$(new_repo)"
    printf 'a line with an %s dash\n' "$EM" >> "$repo/tracked.md"
    case "$env_label" in
        utf8)     out="$( cd "$repo" && LC_ALL=C.UTF-8 ./sh/check-no-emdash.sh 2>&1 )"; st=$? ;;
        LC_ALL=C) out="$( cd "$repo" && LC_ALL=C ./sh/check-no-emdash.sh 2>&1 )"; st=$? ;;
        "env -i") out="$( cd "$repo" && env -i PATH="$PATH" HOME="$HOME" ./sh/check-no-emdash.sh 2>&1 )"; st=$? ;;
    esac
    assert_status 1 "$st" "em dash caught under $env_label" "$out"
    assert_contains "tracked.md:2" "$out" "em dash reported as file:line under $env_label"
    rm -rf "$repo"
done

repo="$(new_repo)"
printf 'an %s en dash too\n' "$EN" >> "$repo/tracked.md"
out="$(run_guard "$repo")"; st=$?
assert_status 1 "$st" "en dash is caught as well as em"
rm -rf "$repo"

# ---------------------------------------------------------------- untracked files
echo
echo "new files"
repo="$(new_repo)"
printf 'brand new %s file\n' "$EM" > "$repo/fresh.md"
out="$(run_guard "$repo")"; st=$?
assert_status 1 "$st" "an untracked new file is scanned whole" "$out"
assert_contains "fresh.md" "$out" "the untracked hit names the file"
rm -rf "$repo"

repo="$(new_repo)"
printf 'ignored %s\n' "$EM" > "$repo/secret.env.local"
printf '*.env.local\n' > "$repo/.gitignore"
out="$(run_guard "$repo")"; st=$?
assert_status 0 "$st" "a gitignored file is out of scope" "$out"
rm -rf "$repo"

# ---------------------------------------------------------------- committed history is not policed
echo
echo "scope"
repo="$(new_repo)"
printf 'committed %s dash\n' "$EM" >> "$repo/tracked.md"
git -C "$repo" add -A >/dev/null
git -C "$repo" commit --quiet -m "history carrying the glyph"
out="$(run_guard "$repo")"; st=$?
assert_status 0 "$st" "a committed glyph is history and is not re-flagged" "$out"
out="$(run_guard "$repo" --all)"; st=$?
assert_status 1 "$st" "--all does see the committed glyph" "$out"
rm -rf "$repo"

# ---------------------------------------------------------------- argument handling
echo
echo "arguments"
repo="$(new_repo)"
out="$(run_guard "$repo" --nonsense)"; st=$?
assert_status 2 "$st" "an unknown flag exits 2" "$out"
# regression: a second positional used to be ignored entirely, so this silently ran the DEFAULT
# (narrower) scope while the author believed they had asked for --all.
printf 'committed %s dash\n' "$EM" >> "$repo/tracked.md"
git -C "$repo" add -A >/dev/null
git -C "$repo" commit --quiet -m "history carrying the glyph"
out="$(run_guard "$repo" --all --nonsense)"; st=$?
assert_status 2 "$st" "a second positional argument is rejected rather than ignored" "$out"
rm -rf "$repo"

# ---------------------------------------------------------------- a broken git must not read as clean
echo
echo "failure modes must not report success"
repo="$(new_repo)"
printf 'a %s dash\n' "$EM" >> "$repo/tracked.md"
# forcing git grep to fail: an unreadable pathspec magic makes it exit >1 rather than 0/1. the guard
# must treat that as "the check did not run", never as "no hits found".
mkdir -p "$repo/fakebin"
cat > "$repo/fakebin/git" <<'FAKE'
#!/usr/bin/env bash
# stand-in that fails only the grep subcommand, so every other git call still works
for a in "$@"; do
    if [ "$a" = "grep" ]; then echo "fatal: simulated git grep failure" >&2; exit 128; fi
done
exec /usr/bin/git "$@"
FAKE
chmod +x "$repo/fakebin/git"
out="$( cd "$repo" && PATH="$repo/fakebin:$PATH" ./sh/check-no-emdash.sh --all 2>&1 )"; st=$?
assert_status 2 "$st" "a forced git grep failure exits 2, not 0" "$out"
assert_not_contains "OK:" "$out" "a forced git grep failure never prints OK"
rm -rf "$repo"

# ---------------------------------------------------------------- diff-config independence
echo
echo "diff configuration cannot disarm the report"
repo="$(new_repo)"
printf 'a %s dash\n' "$EM" >> "$repo/tracked.md"
git -C "$repo" config diff.noprefix true
out="$(run_guard "$repo")"; st=$?
assert_status 1 "$st" "diff.noprefix still fails the run"
assert_contains "tracked.md:2" "$out" "diff.noprefix still reports file:line, not a bare line number"
rm -rf "$repo"

repo="$(new_repo)"
printf 'a %s dash\n' "$EM" >> "$repo/tracked.md"
git -C "$repo" config diff.mnemonicPrefix true
out="$(run_guard "$repo")"; st=$?
assert_contains "tracked.md:2" "$out" "diff.mnemonicPrefix still reports file:line"
rm -rf "$repo"

# ---------------------------------------------------------------- parser edges (2026-08-06 review)
echo
echo "parser edges"

# core.quotePath defaults ON, so a non-ASCII path arrives C-quoted and the header match failed,
# losing the filename exactly as an unpinned prefix does.
repo="$(new_repo)"
printf 'cafe %s note\n' "$EM" > "$repo/café.md"
git -C "$repo" add -A >/dev/null
git -C "$repo" commit --quiet -m "add non-ascii path"
printf 'another %s line\n' "$EM" >> "$repo/café.md"
out="$(run_guard "$repo")"; st=$?
assert_status 1 "$st" "a glyph in a non-ASCII filename is caught"
assert_contains "café.md" "$out" "a non-ASCII filename is reported intact, not C-quoted"
assert_not_contains "\\303" "$out" "the report does not contain a C-quoted escape"
rm -rf "$repo"

# an ADDED line beginning '++ b/' reaches awk as '+++ b/...' and used to be eaten as a header:
# the line's own glyph was never scanned AND the filename was clobbered for every later hit.
repo="$(new_repo)"
{
    printf 'quoting a patch fragment below\n'
    printf '++ b/some/other/path.md with an %s dash\n' "$EM"
    printf 'and a later %s dash in the same file\n' "$EM"
} >> "$repo/tracked.md"
out="$(run_guard "$repo")"; st=$?
assert_status 1 "$st" "a line beginning '++ b/' does not disarm the scan"
assert_contains "tracked.md:3" "$out" "the '++ b/' line is scanned as content, at its own line number"
# the clobbered filename cannot be asserted with a plain substring check: the offending text is
# ALSO the body of the reported hit, so it appears in correct output too. Compare the reported
# filenames themselves - everything found here lives in tracked.md and nothing else.
reported_files="$(printf '%s' "$out" | grep -oE '^[^ :]+\.md:[0-9]+:' | cut -d: -f1 | sort -u | tr '\n' ' ')"
if [ "$reported_files" = "tracked.md " ]; then
    ok "every hit is attributed to tracked.md, not to the quoted patch path"
else
    no "every hit is attributed to tracked.md, not to the quoted patch path" "reported filenames were: $reported_files"
fi
rm -rf "$repo"

# .gitattributes marking a text file binary made git print "Binary files differ", so its added
# lines were never scanned. a file the author types into is in scope whatever git calls it.
repo="$(new_repo)"
printf '*.psm1 binary\n' > "$repo/.gitattributes"
printf 'function Get-Thing {}\n' > "$repo/module.psm1"
git -C "$repo" add -A >/dev/null
git -C "$repo" commit --quiet -m "add a binary-marked text file"
printf '# a comment with an %s dash\n' "$EM" >> "$repo/module.psm1"
out="$(run_guard "$repo")"; st=$?
assert_status 1 "$st" "a glyph in a .gitattributes-binary text file is caught"
assert_contains "module.psm1" "$out" "the binary-marked file is named in the report"
rm -rf "$repo"

# ---------------------------------------------------------------- excluded paths stay excluded
echo
echo "documented exclusions"
repo="$(new_repo)"
mkdir -p "$repo/docstech/reports" "$repo/nodejs/app"
printf 'generated %s report\n' "$EM" > "$repo/docstech/reports/jest-results.txt"
printf 'managed %s block\n' "$EM" > "$repo/nodejs/app/AGENTS.md"
out="$(run_guard "$repo")"; st=$?
assert_status 0 "$st" "docstech/reports and nodejs/*/AGENTS.md stay excluded" "$out"
rm -rf "$repo"

# ---------------------------------------------------------------- result
echo
echo "----------------------------------------"
printf 'passed %d, failed %d\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
echo "check-no-emdash: all assertions passed"
