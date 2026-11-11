import { isBoardPath } from './agentstorybindingops';

/**
 * The analyser's persisted read cache: each session's output, keyed by the file identities it was
 * built from, so a window restart reuses every session whose files have not changed instead of
 * reading every transcript whole again. These functions are pure; `AgentAnalyser` owns the file I/O.
 *
 * Only what a card draws is stored. A call's edit bodies are what the agent wrote into source files,
 * so they are dropped unless the call targets a story board, which the story binder needs to locate
 * the section the call changed. No message text is ever held: the output already carries only short
 * bounded fields (`current.arg`, a question's prompt) beside the numbers and call paths.
 */

// bumped whenever the stored shape changes; a file of any other version is discarded whole
export const AGENT_SCAN_CACHE_VERSION = 1;

/**
 * One file's stat as it bears on whether a session needs re-reading: unchanged mtime AND size means
 * the file's content is unchanged.
 * - path: the bare `uri.path`, used only as a stable cache key (`sessionUnchanged`, `tail_state`,
 *   the line-diff cache); it carries no scheme or authority, so it is never rebuilt into a `vscode.Uri`
 * - uri_string: this file's full URI, scheme and authority included, as `uri.toString()` - the only
 *   form that survives a structured-clone boundary (this identity rides along in a worker job) intact,
 *   so a re-read goes through `vscode.Uri.parse(uri_string)` rather than `vscode.Uri.file(path)`, which
 *   always means the LOCAL disk even in a Remote-SSH window
 * - appendable: true for an append-only JSONL transcript (every main transcript, every Claude Code
 *   subagent transcript, Grok's events.jsonl), which is what makes tail-slicing safe; false for a file
 *   a vendor rewrites whole each time it changes (Grok's usage.json), which is always read and sent in
 *   full and never tracked in `tail_state`
 */
export interface AgentFileIdentity {
    path: string;
    uri_string: string;
    mtime: number;
    size: number;
    appendable: boolean;
}

/** the part of a session output the trim looks at: its calls, each possibly carrying the edit bodies it made */
interface TrimmableOutput {
    session_id: string;
    calls: Array<{ absolute_path?: string; edits?: unknown; whole_file?: boolean }>;
}

/**
 * AgentScanCacheEntry is one session's stored answer.
 * - files: the identities the output was built from; the entry is reused only while every one still matches
 */
export interface AgentScanCacheEntry<Output extends TrimmableOutput> {
    session_id: string;
    files: AgentFileIdentity[];
    output: Output;
}

interface AgentScanCacheFile<Output extends TrimmableOutput> {
    version: number;
    saved_at_ms: number;
    entries: AgentScanCacheEntry<Output>[];
}

/** the output with every non-board call's edit bodies dropped, since nothing but story binding ever reads them */
export function trimOutputForStore<Output extends TrimmableOutput>(output: Output): Output {
    const calls = output.calls.map(call => (call.edits !== undefined && !isBoardPath(call.absolute_path ?? '') ? { ...call, edits: undefined } : call));
    return { ...output, calls };
}

/** the newest mtime among an entry's files, which is what keeps it inside the window */
function newestMtimeOf(files: ReadonlyArray<AgentFileIdentity>): number {
    return files.reduce((newest, file) => Math.max(newest, file.mtime), 0);
}

/**
 * The stored text for these entries, leaving out every session whose newest file is older than
 * `window_ms` before `now_ms`, so the store stays bounded by the same window the scan reads.
 */
export function serialiseScanCache<Output extends TrimmableOutput>(entries: Iterable<AgentScanCacheEntry<Output>>, now_ms: number, window_ms: number): string {
    const kept: AgentScanCacheEntry<Output>[] = [];
    for (const entry of entries) {
        if (newestMtimeOf(entry.files) < now_ms - window_ms) { continue; }
        kept.push({ session_id: entry.session_id, files: entry.files, output: trimOutputForStore(entry.output) });
    }
    const file: AgentScanCacheFile<Output> = { version: AGENT_SCAN_CACHE_VERSION, saved_at_ms: now_ms, entries: kept };
    return JSON.stringify(file);
}

function isFileIdentity(value: unknown): value is AgentFileIdentity {
    if (typeof value !== 'object' || value === null) { return false; }
    const file = value as Record<string, unknown>;
    return typeof file.path === 'string' && typeof file.uri_string === 'string' && typeof file.mtime === 'number' && typeof file.size === 'number' && typeof file.appendable === 'boolean';
}

function isEntry<Output extends TrimmableOutput>(value: unknown): value is AgentScanCacheEntry<Output> {
    if (typeof value !== 'object' || value === null) { return false; }
    const entry = value as Record<string, unknown>;
    if (typeof entry.session_id !== 'string' || !Array.isArray(entry.files) || !entry.files.every(isFileIdentity)) { return false; }
    const output = entry.output as Record<string, unknown> | null | undefined;
    return typeof output === 'object' && output !== null && output.session_id === entry.session_id && Array.isArray(output.calls);
}

/**
 * The entries a stored text holds that are still inside the window, or none when the text is not
 * valid JSON, carries another version or has the wrong shape: a store that cannot be trusted is
 * discarded rather than repaired, and the next scan simply reads what it has to.
 */
export function parseScanCache<Output extends TrimmableOutput>(text: string, now_ms: number, window_ms: number): AgentScanCacheEntry<Output>[] {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return []; }
    if (typeof parsed !== 'object' || parsed === null) { return []; }
    const file = parsed as Partial<AgentScanCacheFile<Output>>;
    if (file.version !== AGENT_SCAN_CACHE_VERSION || !Array.isArray(file.entries)) { return []; }
    return file.entries.filter((entry): entry is AgentScanCacheEntry<Output> => isEntry<Output>(entry) && newestMtimeOf(entry.files) >= now_ms - window_ms);
}

/**
 * A short stable key naming one vendor home, so a remote window and a local window, whose homes
 * differ, never read each other's entries. A plain 53-bit string hash, since a store name needs
 * distinctness only, never secrecy.
 */
export function scanCacheKeyFor(home_uri_string: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < home_uri_string.length; i++) {
        const code = home_uri_string.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** the store file's name for one vendor home */
export function scanCacheFileNameFor(home_uri_string: string): string {
    return `agent-scan-${scanCacheKeyFor(home_uri_string)}.json`;
}
