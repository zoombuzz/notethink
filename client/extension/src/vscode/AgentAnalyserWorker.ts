import * as path from 'path';
import { lineDiffFromBytes, type LineDiffCounts } from '../lib/agentlinediffops';
import { priceCalls, pricePerCallBounded, type AgentPricedUsageEntry } from '../lib/agentpricingops';
import { cropToNewestBytes } from '../lib/agenttailparseops';
import { AGENT_TRANSCRIPT_MAX_BYTES, capabilitiesForVendor, type AgentReadRefusal, type AgentSessionInput, type AgentSessionResult, type AgentSourceFile, type AgentToolInvocationEdit } from '../lib/vendors/agentvendorops';
import { buildClaudeCodeResult, readClaudeCodeSession, type ClaudeTranscriptRecord } from '../lib/vendors/claudecodeops';
import { buildCodexResult, readCodexSession, type CodexLine } from '../lib/vendors/codexops';
import { buildGrokResult, readGrokSession, type GrokLine } from '../lib/vendors/grokops';
import { ACTIVITY_STATE_UNKNOWN, type ActivityCapabilities, type ActivityChildSession, type ActivityEventBody, type ActivityQuestion, type ActivityState, type ActivityUsage } from '../types/AgentActivity';

/**
 * The nested worker: decoding, parsing and pricing run here, off the extension host's own thread,
 * because a 30 day window of transcripts across three vendors is tens of megabytes of JSON a busy
 * host thread cannot afford to block on - a 26 MB transcript decodes and parses in about 68ms in a
 * nested worker, while a 10ms host timer still ticks 6 times in the same round trip. A job therefore
 * carries each file's bytes, never its already-decoded text: `AgentAnalyser.ts` reads with
 * `vscode.workspace.fs.readFile`, which already hands back a `Uint8Array`, and transfers its
 * `ArrayBuffer` to this worker rather than copying a string built from it, so the host thread never
 * runs `TextDecoder` on a large transcript at all.
 *
 * This file's job stops at decode, parse and price. Resolving a write call's path to the workspace or
 * to a repository, binding a session to a story, and reading git state all need APIs only the
 * extension host has (`vscode.workspace`, the built-in git extension), so `AgentAnalyser.ts` does
 * that with what this worker hands back: each write call's path resolved to an ABSOLUTE path (a pure
 * join against the session's own cwd, needing no vscode API), never further than that.
 *
 * Follows transcripts incrementally: `session_line_cache` holds every cacheable session's own
 * already-parsed lines, keyed by session id, for as long as this worker instance lives - but ONLY a
 * session `AgentAnalyser.ts` marked `job.cacheable` (live, or one of its files changed recently; see
 * `AGENT_TAIL_CACHE_RECENT_MS` there), and only up to `AGENT_TAIL_CACHE_MAX_BYTES` in total across
 * every session at once, divided across pooled workers by `request.pool_size` (one session may keep
 * holding the whole cache alone rather than being evicted with nothing smaller left to replace it),
 * least-recently-touched evicted first. A job whose transcript is `'whole'`
 * (first sight, a shrunk or rewritten file, this worker having just been restarted, or the session
 * simply isn't cacheable) is read through the vendor's own `readXSession`, on every file's full
 * current content. A job whose transcript is `'tail'` or `'none'` carries only the bytes appended
 * since its own last parse (or none at all): every file in
 * such a job is resolved by extending its own cached lines with the newly tail-parsed ones (never
 * re-parsing an already-cached line, and never caching a file this session isn't allowed to retain),
 * and the session's result is built from the combined array by the same `buildXResult` a whole read
 * uses internally - one code path building a result from lines, whichever way they were assembled.
 *
 * A transcript past `AGENT_TRANSCRIPT_MAX_BYTES` is read from its newest end, never refused: a 'whole'
 * job's bytes are cropped by `cropToNewestBytes` (the last bound's worth, from the first complete line)
 * before anything decodes them, and a resumed job whose cached lines plus its new ones pass the bound
 * drops its oldest lines until it fits again (`trimTranscriptToBound`). Either way the session's output
 * carries `tail_read`, so its usage and times are known to cover the newest part only. The bound is
 * therefore judged here and nowhere in a vendor's own reader.
 *
 * Memory is bounded in both directions the host cannot see into: `evict_session_ids` on the request is
 * the host telling the worker a session no longer qualifies (or has dropped out of the window
 * entirely), and `evicted_session_ids` on the response is this worker telling the host the reverse -
 * which sessions this worker itself dropped because the byte cap forced them out, so the host never
 * believes a bookmark is resumable when the cache behind it is gone. Host and worker are provably in sync because eviction is never assumed silently by either
 * side: it is always a fact stated on the wire.
 *
 * `handleAgentAnalyserRequest` is the whole of the worker's logic and is exported specifically so it
 * is testable by direct import: a jest environment has no `Worker` global to round-trip postMessage
 * through, so the bottom of this file wires the same function to `self.onmessage` only when running
 * inside an actual worker context.
 *
 * A request's `line_diff_jobs` are a separate, unrelated kind of work this worker also does: counting
 * added/removed lines between an uncommitted file's HEAD and working-tree bytes, an O(a*b) computation
 * that could stall the host thread if run there. Their buffers are left un-detached (unlike a
 * transcript's) since a structured-clone copy costs nothing next to the compute, and it lets the host
 * recompute from the same bytes if the round trip fails.
 */

export type AgentVendorId = 'claude-code' | 'codex' | 'grok';

// cap on priced-usage entries per session; excess folds into this many runs (pricePerCallBounded)
const AGENT_PRICED_USAGE_LIST_MAX = 200;

const VENDOR_READERS: Record<AgentVendorId, (input: AgentSessionInput) => AgentSessionResult> = {
    'claude-code': readClaudeCodeSession,
    codex: readCodexSession,
    grok: readGrokSession,
};

/**
 * One file's bytes as the host reads them. `path` is kept for refusal reporting the same as the
 * decoded shape carries it, and doubles as half of this file's own cache key (`AgentAnalyser.ts`'s
 * `computeTailSlice`/`sliceTail`).
 * - mode: 'whole' when `bytes` is the file's entire current content; 'tail' when `bytes` is only the
 *   content appended since this file's own last successful parse, rounded to complete lines; 'none'
 *   when nothing has completed since last time (`bytes` is empty) and the cached parse is reused
 *   verbatim. Every file in one job is either all 'whole', or all 'tail'/'none' - AgentAnalyser.ts
 *   never sends a mixed job, so this worker never has to reconcile a partially-resumed session.
 */
export interface AgentAnalyserRawFile {
    path: string;
    bytes: ArrayBuffer;
    mode: 'whole' | 'tail' | 'none';
}

/**
 * One session for the worker to read.
 * - cacheable: true when this session is live or one of its files changed recently enough that
 *   AgentAnalyser.ts judged it worth retaining (AGENT_TAIL_CACHE_RECENT_MS); false means this worker
 *   builds the result from this job's own bytes and never retains a line of it, however
 *   `transcript.mode` reads
 */
export interface AgentAnalyserWorkerJob {
    vendor: AgentVendorId;
    session_id: string;
    cwd: string;
    vendor_live?: boolean;
    now_ms: number;
    window_start_ms: number;
    transcript: AgentAnalyserRawFile;
    extra_files: AgentAnalyserRawFile[];
    cacheable: boolean;
}

/**
 * One session's line-diff job: both sides' bytes as the host read them.
 * - key: the host's own key for this job, unique within one request
 * - head_bytes / working_bytes: absent means that side doesn't exist (a whole add or delete)
 */
export interface AgentLineDiffJob {
    key: string;
    head_bytes?: ArrayBuffer;
    working_bytes?: ArrayBuffer;
}

/**
 * One line-diff job's result.
 * - counts: undefined when lineDiffFromBytes declined (over the byte cap, or either side binary)
 */
export interface AgentLineDiffResult {
    key: string;
    counts?: LineDiffCounts;
}

/**
 * One batch of jobs from the host.
 * - evict_session_ids: sessions the host has dropped since the last request (out of the 30 day
 *   window, a deleted file, or one that stopped qualifying as cacheable); their cached lines are freed
 *   before this request's own jobs run
 * - line_diff_jobs: line counts for uncommitted files, independent of `jobs`/`evict_session_ids`; a
 *   request may carry only these, with `jobs` left empty
 * - pool_size: how many worker instances this worker's cache share is divided across; absent keeps
 *   the whole budget
 */
export interface AgentAnalyserWorkerRequest {
    request_id: string;
    jobs: AgentAnalyserWorkerJob[];
    evict_session_ids?: string[];
    line_diff_jobs?: AgentLineDiffJob[];
    pool_size?: number;
}

/**
 * One write call, its path resolved to absolute so the host can place it against the workspace and a
 * repository without re-parsing anything.
 * - edits, whole_file: passed through verbatim from the reader's own `AgentToolInvocation`; only
 *   `AgentAnalyser.ts`'s story binder reads them, to locate which board section a call changed
 */
export interface AgentAnalyserResolvedCall {
    at: string;
    absolute_path?: string;
    is_commit?: boolean;
    commit_subject?: string;
    edits?: AgentToolInvocationEdit[];
    whole_file?: boolean;
}

/**
 * What the worker made of one session.
 * - priced_calls: this session's calls, priced individually (or, past AGENT_PRICED_USAGE_LIST_MAX,
 *   folded into that many consecutive runs) and kept in write order, so the host can attribute usage
 *   to whichever story a turn near a call's own timestamp bound to; host/worker-only, never carried
 *   onto ActivitySession
 * - active_ms: passed through from the reader's own `AgentSessionResult.active_ms` unchanged
 * - children: the session's subagents with their own calls priced, `children_omitted` the finished ones
 *   the reader's cap left out
 * - tail_read: true when the transcript was over the size bound and only its newest part was analysed
 * - session_name: the vendor's own name for a live session, set by the host from the vendor's live
 *   session file and never by the worker
 */
export interface AgentAnalyserWorkerSessionOutput {
    session_id: string;
    vendor: string;
    cwd: string;
    session_name?: string;
    state: ActivityState;
    started_at: string;
    updated_at: string;
    ended_at?: string;
    current?: ActivityEventBody;
    question?: ActivityQuestion;
    model?: string;
    active_ms?: number;
    usage: ActivityUsage;
    priced_calls: AgentPricedUsageEntry[];
    children?: ActivityChildSession[];
    children_omitted?: number;
    capabilities: ActivityCapabilities;
    calls: AgentAnalyserResolvedCall[];
    refusal?: AgentSessionResult['refusal'];
    tail_read?: boolean;
}

/**
 * The worker's answer to one request.
 * - evicted_session_ids: sessions this worker dropped its own cache for while handling this request
 *   because the byte cap (AGENT_TAIL_CACHE_MAX_BYTES) forced them out; the host must drop its own tail bookmark for each one,
 *   since resuming against it next time would build from a cache that no longer exists
 * - line_diff_results: one entry per `line_diff_jobs` entry; absent (not empty) when the request
 *   carried none
 */
export interface AgentAnalyserWorkerResponse {
    request_id: string;
    sessions: AgentAnalyserWorkerSessionOutput[];
    evicted_session_ids?: string[];
    line_diff_results?: AgentLineDiffResult[];
}

// a bare cwd (no trailing slash) joined to a relative file_path the way every vendor's own tool call declares one
function resolveAbsolutePath(cwd: string, file_path: string | undefined): string | undefined {
    if (!file_path) { return undefined; }
    return path.posix.isAbsolute(file_path) ? path.posix.normalize(file_path) : path.posix.normalize(path.posix.join(cwd, file_path));
}

function resolveCalls(result: AgentSessionResult): AgentAnalyserResolvedCall[] {
    return result.tool_invocations
        .filter(call => call.file_path !== undefined || call.is_commit)
        .map(call => ({
            at: call.at,
            absolute_path: resolveAbsolutePath(result.cwd, call.file_path),
            is_commit: call.is_commit,
            commit_subject: call.commit_subject,
            edits: call.edits,
            whole_file: call.whole_file,
        }));
}

function decodeFile(file: AgentAnalyserRawFile): AgentSourceFile {
    return { path: file.path, text: new TextDecoder().decode(file.bytes) };
}

// minimal output a refused job owes the batch so its row still draws, instead of throwing out the whole batch
function refusalOutputFor(job: AgentAnalyserWorkerJob, refusal: AgentReadRefusal): AgentAnalyserWorkerSessionOutput {
    const now_iso = new Date(job.now_ms).toISOString();
    return {
        session_id: job.session_id,
        vendor: job.vendor,
        cwd: job.cwd,
        state: ACTIVITY_STATE_UNKNOWN,
        started_at: now_iso,
        updated_at: now_iso,
        usage: priceCalls([]),
        priced_calls: [],
        capabilities: capabilitiesForVendor(job.vendor),
        calls: [],
        refusal,
    };
}

/**
 * Total source bytes (the JSONL text, never the parsed objects' own heap footprint) this worker
 * instance retains across every session's cache at once; past this, the least-recently-touched
 * session is evicted first (enforceCacheByteCap).
 */
const AGENT_TAIL_CACHE_MAX_BYTES = 128 * 1024 * 1024;
let tail_cache_max_bytes_override: number | undefined;
// test-only: overrides the byte cap so it can be exercised without a 128 MB fixture; undefined restores the real limit
export function setTailCacheMaxBytesForTest(bytes: number | undefined): void { tail_cache_max_bytes_override = bytes; }
// this worker's own share of the byte cap: the whole budget alone, or 1/N when pooled across N workers
function tailCacheMaxBytes(pool_size?: number): number {
    const shared = pool_size && pool_size > 1 ? Math.floor(AGENT_TAIL_CACHE_MAX_BYTES / pool_size) : AGENT_TAIL_CACHE_MAX_BYTES;
    return tail_cache_max_bytes_override ?? shared;
}
let tail_cache_global_max_bytes_override: number | undefined;
// test-only: overrides the undivided ceiling the lone-survivor exception uses; undefined restores the real limit
export function setTailCacheGlobalMaxBytesForTest(bytes: number | undefined): void { tail_cache_global_max_bytes_override = bytes; }
// the whole unpooled budget a lone surviving session is held to, regardless of its own smaller per-worker share
function tailCacheGlobalMaxBytes(): number { return tail_cache_global_max_bytes_override ?? AGENT_TAIL_CACHE_MAX_BYTES; }
/**
 * Test-only: the line cache is deliberate module-level state that must survive every request this
 * worker instance handles, so a jest file calling handleAgentAnalyserRequest across many `it()`
 * blocks would otherwise leak one test's cached sessions into the next. Clears every session's
 * cache and the byte total; never called from production code.
 */
export function resetTailCacheForTest(): void { session_line_cache.clear(); total_cached_bytes = 0; touch_sequence = 0; }
/**
 * Test-only: a snapshot of what this worker instance currently retains, for measuring what a real
 * scan's cache would hold or asserting past handleAgentAnalyserRequest's own return value into the
 * cache behind it.
 */
export function tailCacheStatsForTest(): { sessions: number; total_source_bytes: number } { return { sessions: session_line_cache.size, total_source_bytes: total_cached_bytes }; }

let transcript_max_bytes_override: number | undefined;
/**
 * Test-only: overrides AGENT_TRANSCRIPT_MAX_BYTES so the crop and trim can be exercised
 * without a 64 MB fixture; undefined restores the real limit. Never called from production code.
 */
export function setTranscriptMaxBytesForTest(bytes: number | undefined): void { transcript_max_bytes_override = bytes; }
function transcriptMaxBytes(): number { return transcript_max_bytes_override ?? AGENT_TRANSCRIPT_MAX_BYTES; }

/**
 * One session's own cached lines, kept only while it stays cacheable (AgentAnalyser.ts's
 * `AGENT_TAIL_CACHE_RECENT_MS`) and while the whole cache stays under `AGENT_TAIL_CACHE_MAX_BYTES`.
 * - files: path -> that file's already-parsed lines
 * - file_source_bytes: path -> the UTF-8 byte length of the text currently backing `files.get(path)`,
 *   so this session's own share of the byte cap can be measured and freed exactly, without re-encoding
 *   every cached line back to text just to size it
 * - file_line_bytes: path -> the source bytes each cached line accounts for (its own text, its newline
 *   and any blank or unparseable lines just before it), parallel to `files.get(path)`, so the oldest
 *   lines can be dropped to hold a transcript at the size bound
 * - cropped_paths: the files whose oldest part is not in the cache, because it was cropped at the
 *   size bound on a whole read or trimmed to it on a resumed one
 * - last_touched: a monotonic counter (not wall-clock time, which two touches in the same test or the
 *   same millisecond could tie) bumped whenever any of this session's files is seeded or appended to;
 *   the byte cap's own eviction order is least-recently-touched first, not least-recently-created
 */
interface SessionLineCache {
    files: Map<string, unknown[]>;
    file_source_bytes: Map<string, number>;
    file_line_bytes: Map<string, number[]>;
    cropped_paths: Set<string>;
    last_touched: number;
}

const session_line_cache = new Map<string, SessionLineCache>();
let total_cached_bytes = 0;
let touch_sequence = 0;

function sessionCacheEntry(session_id: string): SessionLineCache {
    let entry = session_line_cache.get(session_id);
    if (!entry) { entry = { files: new Map(), file_source_bytes: new Map(), file_line_bytes: new Map(), cropped_paths: new Set(), last_touched: touch_sequence }; session_line_cache.set(session_id, entry); }
    return entry;
}

/**
 * Drops every cached line and byte-accounting entry for one session, whether the host asked
 * (evict_session_ids: outside the 30-day window, a deleted file, or no longer cacheable) or the
 * byte cap forced it out on its own.
 */
function dropSessionCache(session_id: string): void {
    const entry = session_line_cache.get(session_id);
    if (!entry) { return; }
    for (const bytes of entry.file_source_bytes.values()) { total_cached_bytes -= bytes; }
    session_line_cache.delete(session_id);
}

// UTF-8 byte length of a string without encoding it, counting a surrogate pair as its four bytes
function utf8Length(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) { bytes += 1; }
        else if (code < 0x800) { bytes += 2; }
        else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
        else { bytes += 3; }
    }
    return bytes;
}

/**
 * Parses one file's text into lines with no whole-file refusal checking at all: used only for a
 * 'tail' continuation, where the file has already passed those checks on an earlier 'whole' read (the
 * only way a 'tail' bookmark can exist), and for a 'none' file, where it is never called. A line that
 * fails to parse is dropped for that line only, the same tolerance every vendor's own parser already
 * applies to a torn trailing line - though AgentAnalyser.ts's own line-boundary rounding means a
 * 'tail' slice should never actually contain one. Each kept line also reports the source bytes it
 * accounts for, so a transcript can later be trimmed to the size bound.
 */
function parseJsonlLenient(text: string): { lines: unknown[]; line_bytes: number[] } {
    const lines: unknown[] = [];
    const line_bytes: number[] = [];
    let pending_bytes = 0;
    for (const raw of text.split('\n')) {
        pending_bytes += utf8Length(raw) + 1;
        const trimmed = raw.trim();
        if (trimmed.length === 0) { continue; }
        try { lines.push(JSON.parse(trimmed)); line_bytes.push(pending_bytes); pending_bytes = 0; } catch { /* dropped for this line only */ }
    }
    if (pending_bytes > 0 && line_bytes.length > 0) { line_bytes[line_bytes.length - 1] += pending_bytes; }
    return { lines, line_bytes };
}

/**
 * Sets one file's cached lines outright (a 'whole' read), adjusting the byte total by the
 * difference rather than the new total, so reseeding an already-cached file never double-counts.
 */
function setFileLines(session_id: string, path_: string, parsed: { lines: unknown[]; line_bytes: number[] }, source_bytes: number, cropped: boolean): void {
    const entry = sessionCacheEntry(session_id);
    const previous_bytes = entry.file_source_bytes.get(path_) ?? 0;
    entry.files.set(path_, parsed.lines);
    entry.file_line_bytes.set(path_, parsed.line_bytes);
    entry.file_source_bytes.set(path_, source_bytes);
    if (cropped) { entry.cropped_paths.add(path_); } else { entry.cropped_paths.delete(path_); }
    entry.last_touched = ++touch_sequence;
    total_cached_bytes += source_bytes - previous_bytes;
}

// appends to one file's cached lines (a 'tail' read)
function appendFileLines(session_id: string, path_: string, parsed: { lines: unknown[]; line_bytes: number[] }, added_source_bytes: number): void {
    const entry = sessionCacheEntry(session_id);
    const existing = entry.files.get(path_);
    const existing_bytes = entry.file_line_bytes.get(path_);
    entry.files.set(path_, existing && existing.length > 0 ? [...existing, ...parsed.lines] : parsed.lines);
    entry.file_line_bytes.set(path_, existing_bytes && existing_bytes.length > 0 ? [...existing_bytes, ...parsed.line_bytes] : parsed.line_bytes);
    entry.file_source_bytes.set(path_, (entry.file_source_bytes.get(path_) ?? 0) + added_source_bytes);
    entry.last_touched = ++touch_sequence;
    total_cached_bytes += added_source_bytes;
}

/**
 * Holds a resumed transcript's cached lines at the size bound by dropping its oldest lines, and marks
 * the file cropped when it had to: the same newest-end rule a whole read applies, kept incrementally.
 */
function trimTranscriptToBound(session_id: string, path_: string): void {
    const entry = session_line_cache.get(session_id);
    const lines = entry?.files.get(path_);
    const line_bytes = entry?.file_line_bytes.get(path_);
    if (!entry || !lines || !line_bytes) { return; }
    const max_bytes = transcriptMaxBytes();
    const source_bytes = entry.file_source_bytes.get(path_) ?? 0;
    if (source_bytes <= max_bytes) { return; }
    let drop_count = 0;
    let dropped_bytes = 0;
    while (drop_count < line_bytes.length && source_bytes - dropped_bytes > max_bytes) { dropped_bytes += line_bytes[drop_count++]; }
    entry.files.set(path_, lines.slice(drop_count));
    entry.file_line_bytes.set(path_, line_bytes.slice(drop_count));
    entry.file_source_bytes.set(path_, source_bytes - dropped_bytes);
    entry.cropped_paths.add(path_);
    total_cached_bytes -= dropped_bytes;
}

/**
 * Extends (or seeds) one file's cached lines from this job's bytes, unless the session is not
 * cacheable (AgentAnalyser.ts judged it neither live nor recently changed) - then the lines are
 * built and thrown away, never retained past this request. A 'none' file's cache is untouched
 * either way, since nothing new arrived.
 */
function updateLineCacheForFile(job: AgentAnalyserWorkerJob, file: AgentAnalyserRawFile, cropped = false): void {
    // a subagent's launch record is one small JSON document read whole each time, never line-parsed or tail-resumed
    if (!job.cacheable || file.mode === 'none' || file.path.endsWith('.meta.json')) { return; }
    const text = decodeFile(file).text;
    const source_bytes = file.bytes.byteLength;
    if (file.mode === 'whole') { setFileLines(job.session_id, file.path, parseJsonlLenient(text), source_bytes, cropped); return; }
    appendFileLines(job.session_id, file.path, parseJsonlLenient(text), source_bytes);
    if (file.path === job.transcript.path) { trimTranscriptToBound(job.session_id, file.path); }
}

function linesFor(session_id: string, path_: string): unknown[] {
    return session_line_cache.get(session_id)?.files.get(path_) ?? [];
}

/**
 * Evicts the least-recently-touched session(s) until the total drops back under
 * `AGENT_TAIL_CACHE_MAX_BYTES`, and returns which ones it dropped, so `handleAgentAnalyserRequest` can
 * tell the host it no longer holds a bookmark worth resuming against for them (`evicted_session_ids`).
 * Runs once per request, after every job in it has already updated the cache, so a burst of several
 * newly-cacheable big sessions in one scan is judged against the whole cache's final size rather than
 * evicted and re-admitted mid-batch.
 *
 * The single session left holding the whole cache is spared its own per-worker share, up to the whole
 * unpooled budget: discarding it gains nothing since nothing smaller is left to replace it, but a
 * session that outgrows even the unpooled budget is evicted anyway. Every other session still yields
 * first, in least-recently-touched order.
 *
 * Worst case, this lets `pool_size` different sessions each hold a full unpooled budget across
 * `pool_size` workers; not tightened further, since that ceiling is already well below what an editor
 * host has to spare.
 */
function enforceCacheByteCap(pool_size?: number): string[] {
    const max_bytes = tailCacheMaxBytes(pool_size);
    if (total_cached_bytes <= max_bytes) { return []; }
    const ordered = [...session_line_cache.entries()].sort((a, b) => a[1].last_touched - b[1].last_touched);
    const evicted: string[] = [];
    for (const [session_id] of ordered) {
        if (total_cached_bytes <= max_bytes) { break; }
        if (session_line_cache.size <= 1 && total_cached_bytes <= tailCacheGlobalMaxBytes()) { break; }
        dropSessionCache(session_id);
        evicted.push(session_id);
    }
    return evicted;
}

/**
 * Each vendor's buildXResult, normalised to the same unknown[]-in shape the incremental path uses;
 * each build function's line type is duck-typed from JSON.parse output, which is what the cache
 * actually holds.
 */
const VENDOR_RESULT_BUILDERS: Record<AgentVendorId, (input: AgentSessionInput, records: unknown[], extra_records: unknown[][]) => AgentSessionResult> = {
    'claude-code': (input, records, extra_records) => buildClaudeCodeResult(input, records as ClaudeTranscriptRecord[], extra_records as ClaudeTranscriptRecord[][]),
    codex: (input, records) => buildCodexResult(input, records as CodexLine[]),
    grok: (input, records) => buildGrokResult(input, records as GrokLine[]),
};

function buildOutputFrom(job: AgentAnalyserWorkerJob, result: AgentSessionResult, tail_read: boolean): AgentAnalyserWorkerSessionOutput {
    return {
        session_id: result.session_id,
        vendor: job.vendor,
        cwd: result.cwd,
        state: result.state,
        started_at: result.started_at,
        updated_at: result.updated_at,
        ended_at: result.ended_at,
        current: result.current,
        question: result.question,
        model: result.model,
        active_ms: result.active_ms,
        usage: priceCalls(result.calls),
        priced_calls: pricePerCallBounded(result.calls, AGENT_PRICED_USAGE_LIST_MAX),
        children: result.children?.map(({ calls, ...child }): ActivityChildSession => ({ ...child, usage: priceCalls(calls) })),
        children_omitted: result.children_omitted,
        capabilities: capabilitiesForVendor(job.vendor),
        calls: resolveCalls(result),
        refusal: result.refusal,
        tail_read: tail_read ? true : undefined,
    };
}

// a 'whole' job: every file's full current content, through the vendor's own refusal-checked readXSession
function runJobWhole(job: AgentAnalyserWorkerJob, cropped: boolean): AgentAnalyserWorkerSessionOutput {
    const reader = VENDOR_READERS[job.vendor];
    const input: AgentSessionInput = {
        session_id: job.session_id,
        cwd: job.cwd,
        vendor_live: job.vendor_live,
        now_ms: job.now_ms,
        window_start_ms: job.window_start_ms,
        transcript: decodeFile(job.transcript),
        extra_files: job.extra_files.map(decodeFile),
    };
    const result = reader(input);
    return buildOutputFrom(job, result, cropped);
}

/**
 * A 'tail'/'none' job on its transcript: every file already has (or, for a 'none' file, keeps) cached
 * lines from an earlier scan; the session's result is built from the combined arrays, never re-parsing
 * an already-cached line. An EXTRA file within such a job can independently be 'whole' - a new
 * subagent transcript seen for the first time, or Grok's `usage.json`, which is rewritten whole every
 * turn and never tail-tracked (`AgentAnalyser.ts`'s `appendable: false`) - so its real decoded text is
 * still handed to `input.extra_files` for a build function that reads it directly rather than through
 * `extra_records` (`buildGrokResult`'s own `usage.json` lookup): a resumed job would otherwise silently
 * lose it, since `VENDOR_RESULT_BUILDERS` never sees that file at all for Grok.
 */
function runJobIncremental(job: AgentAnalyserWorkerJob, cropped: boolean): AgentAnalyserWorkerSessionOutput {
    const input: AgentSessionInput = {
        session_id: job.session_id,
        cwd: job.cwd,
        vendor_live: job.vendor_live,
        now_ms: job.now_ms,
        window_start_ms: job.window_start_ms,
        // the transcript is never re-decoded here; VENDOR_RESULT_BUILDERS reads it from the line cache
        transcript: { path: job.transcript.path, text: '' },
        extra_files: job.extra_files.map(file => file.mode === 'whole' ? decodeFile(file) : { path: file.path, text: '' }),
    };
    const records = linesFor(job.session_id, job.transcript.path);
    const extra_records = job.extra_files.map(file => linesFor(job.session_id, file.path));
    const result = VENDOR_RESULT_BUILDERS[job.vendor](input, records, extra_records);
    return buildOutputFrom(job, result, cropped);
}

/**
 * A 'whole' job's transcript is cropped to the newest bound's worth before the cache or a reader sees
 * it; a resumed job is trimmed to the bound as it is cached. The session's `tail_read` is true when
 * either happened, now or on an earlier scan whose cache this job resumes.
 */
function runJob(job: AgentAnalyserWorkerJob): AgentAnalyserWorkerSessionOutput {
    const whole = job.transcript.mode === 'whole';
    const crop = whole ? cropToNewestBytes(new Uint8Array(job.transcript.bytes), transcriptMaxBytes()) : undefined;
    const cropped_job = crop?.cropped ? { ...job, transcript: { ...job.transcript, bytes: crop.bytes.slice().buffer as ArrayBuffer } } : job;
    updateLineCacheForFile(cropped_job, cropped_job.transcript, crop?.cropped);
    for (const extra of job.extra_files) { updateLineCacheForFile(job, extra); }
    const cropped = whole ? crop!.cropped : (session_line_cache.get(job.session_id)?.cropped_paths.has(job.transcript.path) ?? false);
    return whole ? runJobWhole(cropped_job, cropped) : runJobIncremental(job, cropped);
}

/**
 * Isolates runJob per job: a reader's own refusal path already returns a normal result, so this
 * only catches an exception runJob was not written to expect (priceCalls, capabilitiesForVendor,
 * resolveCalls, or a reader bug) - one that would otherwise fail the whole batch and leave every
 * other session in it unreported too.
 */
function runJobIsolated(job: AgentAnalyserWorkerJob): AgentAnalyserWorkerSessionOutput {
    try { return runJob(job); }
    catch (err) { return refusalOutputFor(job, { code: 'unreadable', reason: err instanceof Error ? err.message : String(err) }); }
}

// one line-diff job's bytes to lineDiffFromBytes's compute, isolated the same way runJobIsolated is
function runLineDiffJobIsolated(job: AgentLineDiffJob): AgentLineDiffResult {
    try {
        const head_bytes = job.head_bytes ? new Uint8Array(job.head_bytes) : undefined;
        const working_bytes = job.working_bytes ? new Uint8Array(job.working_bytes) : undefined;
        return { key: job.key, counts: lineDiffFromBytes(head_bytes, working_bytes) };
    } catch {
        return { key: job.key };
    }
}

/**
 * The whole of the worker's job: evict what the host has dropped, read every job handed to it and
 * price what it found (never throwing a bad job out of the batch), then enforce the cache's own byte
 * cap and report anything IT had to evict, so the host's next request never assumes a bookmark this
 * worker no longer backs. `line_diff_jobs`, when present, are computed the same pass, unrelated to
 * the session jobs above.
 */
export function handleAgentAnalyserRequest(request: AgentAnalyserWorkerRequest): AgentAnalyserWorkerResponse {
    for (const session_id of request.evict_session_ids ?? []) { dropSessionCache(session_id); }
    const sessions = request.jobs.map(runJobIsolated);
    const evicted_session_ids = enforceCacheByteCap(request.pool_size);
    const line_diff_results = request.line_diff_jobs?.map(runLineDiffJobIsolated);
    return {
        request_id: request.request_id,
        sessions,
        evicted_session_ids: evicted_session_ids.length > 0 ? evicted_session_ids : undefined,
        line_diff_results,
    };
}

// wired only inside an actual worker context, so jest (which has no `self`/`onmessage`) never touches this
declare const self: { onmessage?: (event: { data: AgentAnalyserWorkerRequest }) => void; postMessage?: (message: unknown) => void } | undefined;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = (event) => {
        self!.postMessage!(handleAgentAnalyserRequest(event.data));
    };
}
