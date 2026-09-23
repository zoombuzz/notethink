/**
 * Counting added and removed lines between two texts, the way `git diff --numstat` reports them for
 * one file, and the binary sniff that decides whether a file is worth diffing at all.
 *
 * The count is exact against the standard definition (an edit script that only inserts and deletes,
 * never moves a line): the length of the two texts' longest common subsequence of lines determines
 * how many lines from each side were not shared, and those are exactly what such a script inserts and
 * deletes. `git diff --numstat` itself is a heuristic diff (it can report a moved block as one hunk
 * rather than a delete plus an add), so the two totals are not guaranteed to match git's own,
 * byte-for-byte identical files aside - both are the length definition on the actual line sets.
 */

export interface LineDiffCounts {
    added: number;
    removed: number;
}

// a trailing newline produces one empty trailing element split() would otherwise count as an extra line
function splitLines(text: string): string[] {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') { lines.pop(); }
    return lines;
}

/**
 * The longest common subsequence length of two line arrays, via a rolling two-row dynamic program so
 * memory stays O(min(a, b)) rather than the O(a * b) a full matrix would need; time is still
 * O(a * b), which is why every caller bounds both sides' size before reaching this function.
 */
function lcsLength(a: readonly string[], b: readonly string[]): number {
    // iterate the shorter array across columns so the rolling row is as small as possible
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    let previous = new Array<number>(short.length + 1).fill(0);
    for (let i = 1; i <= long.length; i++) {
        const current = new Array<number>(short.length + 1).fill(0);
        for (let j = 1; j <= short.length; j++) {
            current[j] = long[i - 1] === short[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
        }
        previous = current;
    }
    return previous[short.length];
}

/**
 * Added/removed line counts between an old and a new text; either side absent means that side does
 * not exist at all (a whole-file add or delete), counted directly rather than run through the DP.
 */
export function countLineDiff(old_text: string | undefined, new_text: string | undefined): LineDiffCounts {
    const old_lines = old_text !== undefined ? splitLines(old_text) : [];
    const new_lines = new_text !== undefined ? splitLines(new_text) : [];
    if (old_lines.length === 0) { return { added: new_lines.length, removed: 0 }; }
    if (new_lines.length === 0) { return { added: 0, removed: old_lines.length }; }
    const shared = lcsLength(old_lines, new_lines);
    return { added: new_lines.length - shared, removed: old_lines.length - shared };
}

// how far into a file to sniff for a NUL byte, git's own binary heuristic (a NUL never appears in text encoded as UTF-8, UTF-16 or any ASCII-compatible charset a source file would use)
const BINARY_SNIFF_BYTES = 8000;

/** true when a NUL byte turns up in the first BINARY_SNIFF_BYTES bytes, git's own test for "not text" */
export function looksBinary(bytes: Uint8Array): boolean {
    const end = Math.min(bytes.length, BINARY_SNIFF_BYTES);
    for (let i = 0; i < end; i++) {
        if (bytes[i] === 0) { return true; }
    }
    return false;
}
