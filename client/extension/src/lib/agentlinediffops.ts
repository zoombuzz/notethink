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
 * Maps each distinct line to a small integer, so the longest-common-subsequence step below compares
 * integers rather than strings. One map is shared across both sides so equal lines get equal ids.
 */
function internLines(a: readonly string[], b: readonly string[]): [Int32Array, Int32Array] {
    const ids = new Map<string, number>();
    const a_ids = new Int32Array(a.length);
    const b_ids = new Int32Array(b.length);
    for (let i = 0; i < a.length; i++) {
        a_ids[i] = internLine(ids, a[i]);
    }
    for (let i = 0; i < b.length; i++) {
        b_ids[i] = internLine(ids, b[i]);
    }
    return [a_ids, b_ids];
}

function internLine(ids: Map<string, number>, line: string): number {
    let id = ids.get(line);
    if (id === undefined) {
        id = ids.size;
        ids.set(line, id);
    }
    return id;
}

/**
 * The longest common subsequence length of two interned line arrays, via a rolling two-row dynamic
 * program so memory stays O(min(a, b)) rather than the O(a * b) a full matrix would need. Time is
 * O(a * b); this is the fallback `lcsLength` reaches for once Myers' algorithm below would cost more.
 */
function dpLcsLength(a: Int32Array, b: Int32Array): number {
    // iterate the shorter array across columns so the rolling row is as small as possible
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    let previous = new Int32Array(short.length + 1);
    for (let i = 1; i <= long.length; i++) {
        const current = new Int32Array(short.length + 1);
        for (let j = 1; j <= short.length; j++) {
            current[j] = long[i - 1] === short[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
        }
        previous = current;
    }
    return previous[short.length];
}

/**
 * Myers' greedy edit-distance search (insertions and deletions only, no substitution), stopped once
 * it has done `bound` outer passes without finding a solution. Cost is O((a + b) * d) for the true
 * distance d, so `bound` is set by the caller to the point where that would exceed the O(a * b) the
 * DP fallback costs instead; returns undefined when the search is stopped for that reason.
 */
function myersEditDistance(a: Int32Array, b: Int32Array, bound: number): number | undefined {
    const n = a.length;
    const m = b.length;
    const offset = n + m + 1;
    const v = new Int32Array(2 * (n + m) + 2);
    v[offset + 1] = 0;
    for (let d = 0; d <= bound; d++) {
        for (let k = -d; k <= d; k += 2) {
            let x: number;
            if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
                x = v[offset + k + 1];
            } else {
                x = v[offset + k - 1] + 1;
            }
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x += 1;
                y += 1;
            }
            v[offset + k] = x;
            if (x >= n && y >= m) { return d; }
        }
    }
    return undefined;
}

/**
 * The longest common subsequence length of two line arrays. Trims the shared prefix and suffix first
 * (those lines are all shared, and never need comparing), since an uncommitted-file scan's diffs are
 * almost always a small edit inside an otherwise-unchanged file. What remains is interned to integers
 * and measured with Myers' O((a + b) * d) algorithm, bounded to stay cheaper than the O(a * b) rolling
 * DP; past that bound the DP takes over instead, so the exact count matches the DP in every case.
 */
function lcsLength(a: readonly string[], b: readonly string[]): number {
    const min_len = Math.min(a.length, b.length);
    let prefix = 0;
    while (prefix < min_len && a[prefix] === b[prefix]) { prefix += 1; }
    let suffix = 0;
    while (suffix < min_len - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) { suffix += 1; }
    const a_mid = a.slice(prefix, a.length - suffix);
    const b_mid = b.slice(prefix, b.length - suffix);
    if (a_mid.length === 0 || b_mid.length === 0) { return prefix + suffix; }
    const [a_ids, b_ids] = internLines(a_mid, b_mid);
    const bound = Math.ceil((a_ids.length * b_ids.length) / (a_ids.length + b_ids.length));
    const distance = myersEditDistance(a_ids, b_ids, bound);
    const mid_shared = distance !== undefined ? (a_ids.length + b_ids.length - distance) / 2 : dpLcsLength(a_ids, b_ids);
    return prefix + suffix + mid_shared;
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

// how far into a file to sniff for a NUL byte, git's own binary heuristic
const BINARY_SNIFF_BYTES = 8000;

/** true when a NUL byte turns up in the first BINARY_SNIFF_BYTES bytes, git's own test for "not text" */
export function looksBinary(bytes: Uint8Array): boolean {
    const end = Math.min(bytes.length, BINARY_SNIFF_BYTES);
    for (let i = 0; i < end; i++) {
        if (bytes[i] === 0) { return true; }
    }
    return false;
}

// a side over this is declined rather than diffed: lcsLength's worst case is still O(n*m), unbounded could stall a thread
export const AGENT_LINE_DIFF_MAX_BYTES = 256 * 1024;

/**
 * Computes a line diff from raw bytes: applies the size cap and binary sniff, decodes, then diffs.
 * Pure, so it can run on a worker thread or directly on the host. Returns undefined if either side
 * exceeds AGENT_LINE_DIFF_MAX_BYTES or looks binary.
 */
export function lineDiffFromBytes(head_bytes: Uint8Array | undefined, working_bytes: Uint8Array | undefined): LineDiffCounts | undefined {
    if ((head_bytes && head_bytes.byteLength > AGENT_LINE_DIFF_MAX_BYTES) || (working_bytes && working_bytes.byteLength > AGENT_LINE_DIFF_MAX_BYTES)) { return undefined; }
    if ((head_bytes && looksBinary(head_bytes)) || (working_bytes && looksBinary(working_bytes))) { return undefined; }
    const head_text = head_bytes ? new TextDecoder().decode(head_bytes) : undefined;
    const working_text = working_bytes ? new TextDecoder().decode(working_bytes) : undefined;
    return countLineDiff(head_text, working_text);
}
