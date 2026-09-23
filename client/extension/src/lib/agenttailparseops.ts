/**
 * Slices a grown, append-only vendor session file down to only the bytes worth re-parsing this scan,
 * given what a previous scan itself already parsed (agent-activity-card story, "follow transcripts
 * incrementally"). Byte-level, not text-level, since it runs before decode: the file is assumed
 * UTF-8, and a newline byte (0x0A) never appears as a continuation or lead byte of any other UTF-8
 * code point, so scanning raw bytes for it is safe without decoding first.
 *
 * `AgentAnalyser.ts` still reads a file's WHOLE current bytes every scan it changed at all -
 * `vscode.workspace.fs` has no ranged read (background, agent-activity-card story) - so this saves
 * transfer to the worker, decode and parse, never the host's own disk read.
 */

// how many bytes just before a bookmark's offset are hashed, to notice a rewrite that keeps the file at least as large and leaves its tail past the offset untouched
const HASH_WINDOW_BYTES = 256;

/**
 * What one file's own last successful parse left behind, handed back on the next scan so it can
 * resume from here rather than from the start.
 * - offset: the byte offset immediately after the last complete line already parsed
 * - hash: a hash of the HASH_WINDOW_BYTES immediately before `offset`, at the time `offset` was set
 */
export interface TailBookmark {
    offset: number;
    hash: string;
}

/**
 * One file's slice for this scan.
 * - mode: 'whole' means `slice` is the file's entire current content, and any earlier parse of it
 *   must be discarded; 'tail' means `slice` is only the newly complete lines since `prev`; 'none'
 *   means nothing new has completed since `prev` (almost always a torn trailing line still being written)
 * - next: this scan's own bookmark, to hand back next time; absent for 'none' (nothing to update) and
 *   for a 'whole' result whose entire content is still one incomplete line
 */
export interface TailSliceResult {
    mode: 'whole' | 'tail' | 'none';
    slice: Uint8Array;
    next?: TailBookmark;
}

// FNV-1a, 32 bit: not for security, only fast and reliable enough to notice a changed byte window
function fnv1a(bytes: Uint8Array): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}

function hashWindow(bytes: Uint8Array, end: number): string {
    return fnv1a(bytes.subarray(Math.max(0, end - HASH_WINDOW_BYTES), end));
}

// the byte offset just after the last '\n' (0x0a) in `bytes`, or 0 when the whole buffer is one incomplete line with no newline at all
function lastLineBoundary(bytes: Uint8Array): number {
    for (let i = bytes.length - 1; i >= 0; i--) {
        if (bytes[i] === 0x0a) { return i + 1; }
    }
    return 0;
}

function wholeResult(bytes: Uint8Array): TailSliceResult {
    const offset = lastLineBoundary(bytes);
    return { mode: 'whole', slice: bytes, next: offset > 0 ? { offset, hash: hashWindow(bytes, offset) } : undefined };
}

/**
 * `prev` is the bookmark the previous scan handed back for this exact file, or undefined for a file
 * never successfully parsed before (including one whose bookmark the caller has already decided not
 * to trust, such as a stale worker generation - AgentAnalyser.ts's `computeTailSlice`).
 *
 * Returns 'whole' whenever `prev` is absent, the file has shrunk below `prev`'s own offset, or the
 * window immediately before that offset no longer hashes the same (a rewrite that kept the file at
 * least as large, so the size/offset check alone would miss it). Returns 'none' when the file has not
 * grown a single new complete line since `prev`.
 */
export function sliceTail(prev: TailBookmark | undefined, bytes: Uint8Array): TailSliceResult {
    if (!prev || bytes.length < prev.offset) { return wholeResult(bytes); }
    if (hashWindow(bytes, prev.offset) !== prev.hash) { return wholeResult(bytes); }
    const tail = bytes.subarray(prev.offset);
    const boundary = lastLineBoundary(tail);
    if (boundary === 0) { return { mode: 'none', slice: new Uint8Array(0) }; }
    const slice = tail.subarray(0, boundary);
    const offset = prev.offset + boundary;
    return { mode: 'tail', slice, next: { offset, hash: hashWindow(bytes, offset) } };
}
