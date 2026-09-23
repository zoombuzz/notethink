import * as path from 'path';
import { priceCalls, pricePerCallBounded, type AgentPricedUsageEntry } from '../lib/agentpricingops';
import { AGENT_TRANSCRIPT_MAX_BYTES, capabilitiesForVendor, type AgentReadRefusal, type AgentSessionInput, type AgentSessionResult, type AgentSourceFile, type AgentToolInvocationEdit } from '../lib/vendors/agentvendorops';
import { buildClaudeCodeResult, readClaudeCodeSession, type ClaudeTranscriptRecord } from '../lib/vendors/claudecodeops';
import { buildCodexResult, readCodexSession, type CodexLine } from '../lib/vendors/codexops';
import { buildGrokResult, readGrokSession, type GrokLine } from '../lib/vendors/grokops';
import { ACTIVITY_STATE_UNKNOWN, type ActivityCapabilities, type ActivityEventBody, type ActivityQuestion, type ActivityState, type ActivityUsage } from '../types/AgentActivity';

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
 * every session at once, least-recently-touched evicted first. A job whose transcript is `'whole'`
 * (first sight, a shrunk or rewritten file, this worker having just been restarted, or the session
 * simply isn't cacheable) is read through the vendor's own `readXSession`, on every file's full
 * current content. A job whose transcript is `'tail'` or `'none'` carries only the bytes appended
 * since its own last parse (or none at all): every file in
 * such a job is resolved by extending its own cached lines with the newly tail-parsed ones (never
 * re-parsing an already-cached line, and never caching a file this session isn't allowed to retain),
 * and the session's result is built from the combined array by the same `buildXResult` a whole read
 * uses internally - one code path building a result from lines, whichever way they were assembled.
 *
 * The transcript's own `AGENT_TRANSCRIPT_MAX_BYTES` bound is judged once, by `transcriptSizeRefusal`,
 * before either path runs: a 'whole' job's own bytes, or a 'tail'/'none' job's cached source bytes plus
 * whatever it adds, against the same limit a vendor's own `readXSession` enforces on a whole read. A job
 * over the bound is refused right there - never cached, never built - so the same transcript gets the
 * same `too_large` verdict whether this is its first scan or its hundredth, instead of the vendor
 * reader's own check (which only a 'whole' job ever reaches) being the only place it was ever applied.
 *
 * Memory is bounded in both directions the host cannot see into: `evict_session_ids` on the request is
 * the host telling the worker a session no longer qualifies (or has dropped out of the window
 * entirely), and `evicted_session_ids` on the response is this worker telling the host the reverse -
 * which sessions this worker itself dropped, whether the byte cap forced them out or a transcript grew
 * past its own size bound, so the host never believes a bookmark is resumable when the cache behind it
 * is gone. Host and worker are provably in sync because eviction is never assumed silently by either
 * side: it is always a fact stated on the wire.
 *
 * `handleAgentAnalyserRequest` is the whole of the worker's logic and is exported specifically so it
 * is testable by direct import: a jest environment has no `Worker` global to round-trip postMessage
 * through, so the bottom of this file wires the same function to `self.onmessage` only when running
 * inside an actual worker context.
 */

export type AgentVendorId = 'claude-code' | 'codex' | 'grok';

// the most priced-usage entries one session's output carries; a session past this many calls is folded into this many consecutive runs instead (pricePerCallBounded), so the turn-attribution list stays bounded the way every other list this worker returns is
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
 * One batch of jobs from the host.
 * - evict_session_ids: sessions the host has dropped since the last request (out of the 30 day
 *   window, a deleted file, or one that stopped qualifying as cacheable); their cached lines are freed
 *   before this request's own jobs run
 */
export interface AgentAnalyserWorkerRequest {
    request_id: string;
    jobs: AgentAnalyserWorkerJob[];
    evict_session_ids?: string[];
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
 */
export interface AgentAnalyserWorkerSessionOutput {
    session_id: string;
    vendor: string;
    cwd: string;
    state: ActivityState;
    started_at: string;
    updated_at: string;
    ended_at?: string;
    current?: ActivityEventBody;
    question?: ActivityQuestion;
    model?: string;
    usage: ActivityUsage;
    priced_calls: AgentPricedUsageEntry[];
    capabilities: ActivityCapabilities;
    calls: AgentAnalyserResolvedCall[];
    refusal?: AgentSessionResult['refusal'];
}

/**
 * The worker's answer to one request.
 * - evicted_session_ids: sessions this worker dropped its own cache for while handling this request,
 *   whether the byte cap (AGENT_TAIL_CACHE_MAX_BYTES) forced them out or a transcript grew past
 *   AGENT_TRANSCRIPT_MAX_BYTES and was refused; the host must drop its own tail bookmark for each one,
 *   since resuming against it next time would build from a cache that no longer exists
 */
export interface AgentAnalyserWorkerResponse {
    request_id: string;
    sessions: AgentAnalyserWorkerSessionOutput[];
    evicted_session_ids?: string[];
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

// the minimal output a job's own refusal (a crash, or transcriptSizeRefusal) still owes the batch: enough for the row to draw, refused rather than thrown out of the whole batch handleAgentAnalyserRequest promises never to do
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

// the most total source bytes (the JSONL text that produced the cached lines, never the parsed objects' own heap footprint, which this worker has no cheap way to measure) this worker instance keeps retained across every session's cache at once; over this, the least-recently-touched session is evicted first (enforceCacheByteCap)
const AGENT_TAIL_CACHE_MAX_BYTES = 128 * 1024 * 1024;
let tail_cache_max_bytes_override: number | undefined;
// test-only: overrides AGENT_TAIL_CACHE_MAX_BYTES so the byte cap can be exercised without allocating a 128 MB fixture; call with undefined to restore the real limit. Never called from production code (self.onmessage's own path never reaches this)
export function setTailCacheMaxBytesForTest(bytes: number | undefined): void { tail_cache_max_bytes_override = bytes; }
function tailCacheMaxBytes(): number { return tail_cache_max_bytes_override ?? AGENT_TAIL_CACHE_MAX_BYTES; }
// test-only: this worker's line cache is module-level state (deliberately - it must survive across every request this worker instance ever handles), so a jest file importing handleAgentAnalyserRequest directly across many `it()` blocks would otherwise leak one test's cached sessions into the next; clears every session's cache and the byte total. Never called from production code
export function resetTailCacheForTest(): void { session_line_cache.clear(); total_cached_bytes = 0; touch_sequence = 0; }
// test-only: a snapshot of what this worker instance is currently retaining, for a measurement (how much a real scan's cache would actually hold) or an assertion that would otherwise have no way to see past handleAgentAnalyserRequest's own return value into the cache behind it
export function tailCacheStatsForTest(): { sessions: number; total_source_bytes: number } { return { sessions: session_line_cache.size, total_source_bytes: total_cached_bytes }; }

let transcript_max_bytes_override: number | undefined;
// test-only: overrides AGENT_TRANSCRIPT_MAX_BYTES so transcriptSizeRefusal can be exercised without allocating a 64 MB fixture; call with undefined to restore the real limit. Never called from production code
export function setTranscriptMaxBytesForTest(bytes: number | undefined): void { transcript_max_bytes_override = bytes; }
function transcriptMaxBytes(): number { return transcript_max_bytes_override ?? AGENT_TRANSCRIPT_MAX_BYTES; }

/**
 * One session's own cached lines, kept only while it stays cacheable (AgentAnalyser.ts's
 * `AGENT_TAIL_CACHE_RECENT_MS`) and while the whole cache stays under `AGENT_TAIL_CACHE_MAX_BYTES`.
 * - files: path -> that file's already-parsed lines
 * - file_source_bytes: path -> the UTF-8 byte length of the text currently backing `files.get(path)`,
 *   so this session's own share of the byte cap can be measured and freed exactly, without re-encoding
 *   every cached line back to text just to size it
 * - last_touched: a monotonic counter (not wall-clock time, which two touches in the same test or the
 *   same millisecond could tie) bumped whenever any of this session's files is seeded or appended to;
 *   the byte cap's own eviction order is least-recently-touched first, not least-recently-created
 */
interface SessionLineCache {
    files: Map<string, unknown[]>;
    file_source_bytes: Map<string, number>;
    last_touched: number;
}

const session_line_cache = new Map<string, SessionLineCache>();
let total_cached_bytes = 0;
let touch_sequence = 0;

function sessionCacheEntry(session_id: string): SessionLineCache {
    let entry = session_line_cache.get(session_id);
    if (!entry) { entry = { files: new Map(), file_source_bytes: new Map(), last_touched: touch_sequence }; session_line_cache.set(session_id, entry); }
    return entry;
}

// drops every cached line and byte-accounting entry belonging to one session, whether the host asked for it (evict_session_ids: out of the 30 day window, a deleted file, or it stopped being cacheable) or the byte cap forced it out on its own
function dropSessionCache(session_id: string): void {
    const entry = session_line_cache.get(session_id);
    if (!entry) { return; }
    for (const bytes of entry.file_source_bytes.values()) { total_cached_bytes -= bytes; }
    session_line_cache.delete(session_id);
}

/**
 * Parses one file's text into lines with no whole-file refusal checking at all: used only for a
 * 'tail' continuation, where the file has already passed those checks on an earlier 'whole' read (the
 * only way a 'tail' bookmark can exist), and for a 'none' file, where it is never called. A line that
 * fails to parse is dropped for that line only, the same tolerance every vendor's own parser already
 * applies to a torn trailing line - though AgentAnalyser.ts's own line-boundary rounding means a
 * 'tail' slice should never actually contain one.
 */
function parseJsonlLenient(text: string): unknown[] {
    const lines: unknown[] = [];
    for (const raw of text.split('\n')) {
        const trimmed = raw.trim();
        if (trimmed.length === 0) { continue; }
        try { lines.push(JSON.parse(trimmed)); } catch { /* dropped for this line only */ }
    }
    return lines;
}

// sets one file's cached lines outright (a 'whole' read), replacing whatever it held before and adjusting the byte total by the difference rather than the new total, so a reseed of an already-cached file never double-counts its old bytes
function setFileLines(session_id: string, path_: string, lines: unknown[], source_bytes: number): void {
    const entry = sessionCacheEntry(session_id);
    const previous_bytes = entry.file_source_bytes.get(path_) ?? 0;
    entry.files.set(path_, lines);
    entry.file_source_bytes.set(path_, source_bytes);
    entry.last_touched = ++touch_sequence;
    total_cached_bytes += source_bytes - previous_bytes;
}

// appends to one file's cached lines (a 'tail' read)
function appendFileLines(session_id: string, path_: string, new_lines: unknown[], added_source_bytes: number): void {
    const entry = sessionCacheEntry(session_id);
    const existing = entry.files.get(path_);
    entry.files.set(path_, existing && existing.length > 0 ? [...existing, ...new_lines] : new_lines);
    entry.file_source_bytes.set(path_, (entry.file_source_bytes.get(path_) ?? 0) + added_source_bytes);
    entry.last_touched = ++touch_sequence;
    total_cached_bytes += added_source_bytes;
}

// extends (or seeds) one file's own cached lines from this job's bytes, unless this session is not cacheable (AgentAnalyser.ts judged it neither live nor recently changed) - such a session's lines are built from this job's own bytes and then thrown away, never retained past this one request; a 'none' file leaves its cache untouched either way, since nothing new has arrived
function updateLineCacheForFile(job: AgentAnalyserWorkerJob, file: AgentAnalyserRawFile): void {
    if (!job.cacheable || file.mode === 'none') { return; }
    const text = decodeFile(file).text;
    const source_bytes = file.bytes.byteLength;
    if (file.mode === 'whole') { setFileLines(job.session_id, file.path, parseJsonlLenient(text), source_bytes); return; }
    appendFileLines(job.session_id, file.path, parseJsonlLenient(text), source_bytes);
}

function linesFor(session_id: string, path_: string): unknown[] {
    return session_line_cache.get(session_id)?.files.get(path_) ?? [];
}

// the UTF-8 byte length of the source text already cached for one session's file, 0 for a file never cached (first sight, or a session this worker never retained)
function existingSourceBytes(session_id: string, path_: string): number {
    return session_line_cache.get(session_id)?.file_source_bytes.get(path_) ?? 0;
}

/**
 * The single place `AGENT_TRANSCRIPT_MAX_BYTES` is judged against a job's transcript, whichever mode it
 * arrives in: a 'whole' job's own bytes stand alone (a fresh total), while a 'tail'/'none' job's bytes
 * are added to whatever this worker already has cached for that same path (a 'none' job adds zero,
 * simply re-checking the cached total). This is what makes a growing transcript refused the scan it
 * crosses the bound, not only the scan that first read it whole - and, since a non-cacheable job is
 * always 'whole' (`AgentAnalyser.ts`'s `resolveSessionTailPlan`) and therefore already goes through a
 * vendor's own `readXSession` check in `runJobWhole`, this only needs to run for a cacheable job.
 */
function transcriptSizeRefusal(job: AgentAnalyserWorkerJob): AgentReadRefusal | undefined {
    if (!job.cacheable) { return undefined; }
    const max_bytes = transcriptMaxBytes();
    const byte_length = job.transcript.mode === 'whole'
        ? job.transcript.bytes.byteLength
        : existingSourceBytes(job.session_id, job.transcript.path) + job.transcript.bytes.byteLength;
    if (byte_length <= max_bytes) { return undefined; }
    return { code: 'too_large', reason: `transcript is ${byte_length} bytes, over the ${max_bytes} byte limit` };
}

/**
 * Evicts the least-recently-touched session(s) until the total drops back under
 * `AGENT_TAIL_CACHE_MAX_BYTES`, and returns which ones it dropped, so `handleAgentAnalyserRequest` can
 * tell the host it no longer holds a bookmark worth resuming against for them (`evicted_session_ids`).
 * Runs once per request, after every job in it has already updated the cache, so a burst of several
 * newly-cacheable big sessions in one scan is judged against the whole cache's final size rather than
 * evicted and re-admitted mid-batch.
 */
function enforceCacheByteCap(): string[] {
    const max_bytes = tailCacheMaxBytes();
    if (total_cached_bytes <= max_bytes) { return []; }
    const ordered = [...session_line_cache.entries()].sort((a, b) => a[1].last_touched - b[1].last_touched);
    const evicted: string[] = [];
    for (const [session_id] of ordered) {
        if (total_cached_bytes <= max_bytes) { break; }
        dropSessionCache(session_id);
        evicted.push(session_id);
    }
    return evicted;
}

// each vendor's buildXResult, normalised to the same unknown[]-in shape the incremental path works with; each build function's own line type is duck-typed from JSON.parse output, which is what the cache actually holds
const VENDOR_RESULT_BUILDERS: Record<AgentVendorId, (input: AgentSessionInput, records: unknown[], extra_records: unknown[][]) => AgentSessionResult> = {
    'claude-code': (input, records, extra_records) => buildClaudeCodeResult(input, records as ClaudeTranscriptRecord[], extra_records as ClaudeTranscriptRecord[][]),
    codex: (input, records) => buildCodexResult(input, records as CodexLine[]),
    grok: (input, records) => buildGrokResult(input, records as GrokLine[]),
};

function buildOutputFrom(job: AgentAnalyserWorkerJob, result: AgentSessionResult): AgentAnalyserWorkerSessionOutput {
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
        usage: priceCalls(result.calls),
        priced_calls: pricePerCallBounded(result.calls, AGENT_PRICED_USAGE_LIST_MAX),
        capabilities: capabilitiesForVendor(job.vendor),
        calls: resolveCalls(result),
        refusal: result.refusal,
    };
}

// a 'whole' job: every file's full current content, through the vendor's own refusal-checked readXSession
function runJobWhole(job: AgentAnalyserWorkerJob): AgentAnalyserWorkerSessionOutput {
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
    return buildOutputFrom(job, result);
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
function runJobIncremental(job: AgentAnalyserWorkerJob): AgentAnalyserWorkerSessionOutput {
    const input: AgentSessionInput = {
        session_id: job.session_id,
        cwd: job.cwd,
        vendor_live: job.vendor_live,
        now_ms: job.now_ms,
        window_start_ms: job.window_start_ms,
        // the transcript itself is never re-decoded here; VENDOR_RESULT_BUILDERS reads it from the line cache, not from `transcript.text`
        transcript: { path: job.transcript.path, text: '' },
        extra_files: job.extra_files.map(file => file.mode === 'whole' ? decodeFile(file) : { path: file.path, text: '' }),
    };
    const records = linesFor(job.session_id, job.transcript.path);
    const extra_records = job.extra_files.map(file => linesFor(job.session_id, file.path));
    const result = VENDOR_RESULT_BUILDERS[job.vendor](input, records, extra_records);
    return buildOutputFrom(job, result);
}

// oversized is checked, and the session dropped, before either the cache or a reader ever sees this job's bytes: transcriptSizeRefusal judges the whole/tail/none job the same way, so a transcript over AGENT_TRANSCRIPT_MAX_BYTES is refused and never cached on any scan, not just its first
function runJob(job: AgentAnalyserWorkerJob, oversized_session_ids: Set<string>): AgentAnalyserWorkerSessionOutput {
    const size_refusal = transcriptSizeRefusal(job);
    if (size_refusal) {
        dropSessionCache(job.session_id);
        oversized_session_ids.add(job.session_id);
        return refusalOutputFor(job, size_refusal);
    }
    updateLineCacheForFile(job, job.transcript);
    for (const extra of job.extra_files) { updateLineCacheForFile(job, extra); }
    return job.transcript.mode === 'whole' ? runJobWhole(job) : runJobIncremental(job);
}

// runJob isolated per job: a reader's own refusal path already returns a normal result, so this only catches an exception runJob itself was not written to expect (priceCalls, capabilitiesForVendor, resolveCalls, or a reader bug), which would otherwise fail the whole batch and leave every OTHER session in it unreported too
function runJobIsolated(job: AgentAnalyserWorkerJob, oversized_session_ids: Set<string>): AgentAnalyserWorkerSessionOutput {
    try { return runJob(job, oversized_session_ids); }
    catch (err) { return refusalOutputFor(job, { code: 'unreadable', reason: err instanceof Error ? err.message : String(err) }); }
}

/**
 * The whole of the worker's job: evict what the host has dropped, read every job handed to it and
 * price what it found (never throwing a bad job out of the batch), then enforce the cache's own byte
 * cap and report anything IT had to evict - the byte cap's own evictions plus every session
 * `transcriptSizeRefusal` refused this request - so the host's next request never assumes a bookmark
 * this worker no longer backs, whether the worker dropped it for space or because the transcript itself
 * grew past its own bound.
 */
export function handleAgentAnalyserRequest(request: AgentAnalyserWorkerRequest): AgentAnalyserWorkerResponse {
    for (const session_id of request.evict_session_ids ?? []) { dropSessionCache(session_id); }
    const oversized_session_ids = new Set<string>();
    const sessions = request.jobs.map(job => runJobIsolated(job, oversized_session_ids));
    const cap_evicted = enforceCacheByteCap();
    const evicted_session_ids = [...new Set([...oversized_session_ids, ...cap_evicted])];
    return { request_id: request.request_id, sessions, evicted_session_ids: evicted_session_ids.length > 0 ? evicted_session_ids : undefined };
}

// wired only inside an actual worker context, so jest (which has no `self`/`onmessage`) never touches this
declare const self: { onmessage?: (event: { data: AgentAnalyserWorkerRequest }) => void; postMessage?: (message: unknown) => void } | undefined;
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = (event) => {
        self!.postMessage!(handleAgentAnalyserRequest(event.data));
    };
}
