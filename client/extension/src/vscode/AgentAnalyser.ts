import * as path from 'path';
import * as vscode from 'vscode';
import { agentVendorHomeFrom, type AgentVendorHome } from '../lib/agenthomeops';
import {
    buildActivitySnapshot,
    emptyAnalyserState,
    unreadableSessionIds,
    type ActivityAnalyserState,
    type ActivityRefusal,
    type ActivitySessionState,
    type ActivityTreeState,
} from '../lib/agentanalyserops';
import { writeToErrorLog, writeToLogAtLevel } from '../lib/errorops';
import { attributeCommitsToSessions, attributeFilesToSessions, type AgentCommitCall, type AgentWriteCall } from '../lib/agentgitattributionops';
import { lineDiffFromBytes, type LineDiffCounts } from '../lib/agentlinediffops';
import type { AgentPricedUsageEntry } from '../lib/agentpricingops';
import { readLineDiffSides, readRepositoryTree, resolveGitApi, type GitApi, type GitRepository } from './agentgitops';
import type { GitReflogCommit } from '../lib/agentgitreflogops';
import { isBoardPath, siblingBoardPath, storiesForWriteCall, type StoryBindingWriteCall, type StoryDocument } from '../lib/agentstorybindingops';
import { sliceTail, type TailBookmark } from '../lib/agenttailparseops';
import type { AgentAnalyserRawFile, AgentAnalyserWorkerJob, AgentAnalyserWorkerRequest, AgentAnalyserWorkerResponse, AgentAnalyserWorkerSessionOutput, AgentLineDiffJob, AgentVendorId } from './AgentAnalyserWorker';
import { AgentAnalyserWorkerPool, defaultAgentAnalyserPoolSize } from './AgentAnalyserWorkerPool';
import { addActivityUsage, emptyActivityUsage, type ActivityChangedFile, type ActivitySession, type ActivityState, type ActivityStoryRef, type ActivityStoryUsage, type ActivityUsage } from '../types/AgentActivity';
import type { HashMapOf } from '../types/general';

// only sessions with activity inside this window count toward what a story's card draws
const AGENT_WINDOW_DAYS = 30;
// the periodic poll behind the watchers below, so a change no watcher caught still lands within this long
const AGENT_RESCAN_INTERVAL_MS = 15_000;
// coalesces a burst of writes to a session's files into one scan, short enough a live tool call still lands fast
const AGENT_WATCH_DEBOUNCE_MS = 300;
// toggling the agent card on and off in quick succession must not thrash the analyser, so a withdrawal waits this long
const AGENT_STOP_GRACE_MS = 5_000;
// caps how many sessions a Claude Code scan opens, so an unusually large history cannot make one scan unbounded
const AGENT_FILE_STAT_MAX_ENTRIES = 4_000;
let file_stat_max_entries_override: number | undefined;
// test-only: exercises the stat-cap's bounded overshoot without thousands of fake sessions
export function setFileStatMaxEntriesForTest(entries: number | undefined): void { file_stat_max_entries_override = entries; }
function fileStatMaxEntries(): number { return file_stat_max_entries_override ?? AGENT_FILE_STAT_MAX_ENTRIES; }
// concurrent whole-file reads per batch; a batch is read whole before it is sent, so this does not raise peak memory
const AGENT_DISCOVERY_READ_CONCURRENCY = 16;
// concurrent directory/session stats during discovery; each is one IPC round trip, slow while the host starts up
const AGENT_DISCOVERY_STAT_CONCURRENCY = 64;
// flat floor for scan spacing; short enough that activity still reaches the card within about a second
const AGENT_MIN_SCAN_SPACING_MS = 1_000;
// first batch sent to the pool: small enough that one worker answers under a second, posting the newest first
const AGENT_FIRST_BATCH_MAX_JOBS = 8;
const AGENT_FIRST_BATCH_MAX_BYTES = 4 * 1024 * 1024;
// every batch after the first: large enough to avoid dozens of round trips, small enough to post again soon
const AGENT_BATCH_MAX_JOBS = 64;
// bytes PER POOL WORKER, not a flat total: scaling by pool size keeps every batch big enough to use every worker
const AGENT_BATCH_TARGET_BYTES_PER_WORKER = 32 * 1024 * 1024;
// a credited file is always diffed; an uncredited one only until a repo's uncommitted band reaches this many diffed files
const AGENT_LINE_DIFF_MAX_FILES_PER_REPO = 20;
// concurrent diff-side reads per repository; each HEAD side is a git show, so an unbounded burst only queues
const AGENT_LINE_DIFF_READ_CONCURRENCY = 8;
/**
 * The worker keeps a session's parsed lines, for the next scan's tail continuation, only while it is
 * live or one of its files changed within this long; otherwise the lines are built and discarded rather
 * than held on the chance they are needed again. This bounds memory on a first scan over every session
 * in the 30-day window, hundreds of them mostly long ended, which would otherwise hold every transcript
 * in the worker at once.
 */
const AGENT_TAIL_CACHE_RECENT_MS = 10 * 60 * 1000;

type PostFn = (message: Record<string, unknown>) => void;

/**
 * A worker job as discovery built it.
 * - identity: this session's own files (transcript plus every extra file) as stated at discovery
 *   time, cached verbatim so a later scan can tell whether the session needs re-reading without
 *   re-reading it
 */
interface DiscoveredJob extends AgentAnalyserWorkerJob {
    identity: AgentFileIdentity[];
}

/**
 * One file's stat as it bears on whether a session needs re-reading: unchanged mtime AND size means
 * the file's content is unchanged.
 * - appendable: true for an append-only JSONL transcript (every main transcript, every Claude Code
 *   subagent transcript, Grok's events.jsonl), which is what makes tail-slicing safe; false for a file
 *   a vendor rewrites whole each time it changes (Grok's usage.json), which is always read and sent in
 *   full and never tracked in `tail_state`
 */
interface AgentFileIdentity {
    path: string;
    mtime: number;
    size: number;
    appendable: boolean;
}

// a Claude Code session found changed by the stat pass, not yet read; read closes over it until its batch's turn
interface ClaudeCodeCandidate {
    session_id: string;
    dir_name: string;
    transcript_uri: vscode.Uri;
    transcript_identity: AgentFileIdentity;
    extra_identity: AgentFileIdentity[];
    identity: AgentFileIdentity[];
    vendor_live: boolean;
}

/**
 * One changed session, stat only. `identity` sorts by recency and estimates batch size before
 * anything is read; `read` is a per-vendor closure, invoked once this candidate's batch is chosen,
 * so a batch's read cost is paid only when it is actually read.
 */
interface DiscoveryCandidate {
    vendor: AgentVendorId;
    session_id: string;
    identity: AgentFileIdentity[];
    read: () => Promise<{ job: DiscoveredJob; bytes_read: number } | undefined>;
}

/**
 * What one scan's stat-only discovery pass found for one vendor: candidates to read later, and,
 * for each session whose files match the last scan's stat, the cached output reused with no read.
 * - stat_ms: wall-clock time in stat-only work; reading now happens per batch, timed in runScanOnce
 * - live_status: each live session's vendor-reported state, by session id; only Claude Code writes one
 */
interface DiscoveryResult {
    candidates: DiscoveryCandidate[];
    reused: AgentAnalyserWorkerSessionOutput[];
    live_status?: Map<string, ActivityState>;
    stat_ms?: number;
}

/**
 * What THIS scan's live-list/clock check found for a session, so its live/ended (and, where the
 * vendor reports it, working/idle/waiting) state can be re-derived without re-reading a single byte
 * of its transcript. `status` is only ever known for Claude Code, whose own
 * `~/.claude/sessions/<pid>.json` reports a `status` of `busy`, `idle` or `waiting` directly, and it
 * outranks what the transcript implies: a transcript cannot tell a pending permission prompt from a
 * running tool. Codex and Grok have no host-only signal independent of transcript content, so a live
 * session's working/idle/question split there is left exactly as the cached read last found it -
 * only the live/ended transition is recomputed for them.
 */
/**
 * Running totals `runScanOnce` accumulates batch by batch, mutated in place so `handleBatchFailure`
 * can log the same totals without passing every field back and forth.
 * - discovery_ms/reused_count/story_docs_ms/git_trees_ms/batch_count: set once before the batch loop;
 *   every other field starts at zero and grows per batch
 * - fold_ms sums story_docs_ms + git_trees_ms + each batch's binding_ms + attribution_ms +
 *   line_diff_ms; line_diff_ms (applyLineDiffs) is the one sub-phase with real I/O, and the most
 *   likely to dominate on a dirty working tree
 * - live_post_ms: when the scan's `live` snapshot was posted; fresh line counts follow it
 */
interface ScanPhaseTotals {
    discovery_ms: number;
    reused_count: number;
    story_docs_ms: number;
    git_trees_ms: number;
    reading_ms: number;
    parsing_ms: number;
    binding_ms: number;
    binding_cache_hits: number;
    binding_cache_misses: number;
    attribution_ms: number;
    line_diff_ms: number;
    fold_ms: number;
    posting_ms: number;
    bytes_read: number;
    bytes_transferred: number;
    sessions_read: number;
    batch_count: number;
    first_post_ms?: number;
    live_post_ms?: number;
}

interface LiveOverlay {
    live: boolean;
    status?: ActivityState;
}

// Claude Code's pid-file `status` values mapped to card states; an unmapped value keeps the transcript's reading
const CLAUDE_PID_STATUS_STATES: Readonly<Record<string, ActivityState>> = { busy: 'working', idle: 'idle', waiting: 'waiting' };

// pairs a write call with its timestamp, which splitUsageByTurn needs to place a priced usage entry against a turn
interface TimedWriteCall {
    at_ms: number;
    call: StoryBindingWriteCall;
}

// one write call's timestamp and the stories that call alone binds to
interface EditEvent {
    at_ms: number;
    stories: ActivityStoryRef[];
}

// a promise's value with its own wall time, for phases that run alongside others
async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const started_ms = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - started_ms };
}

// every story the calls bind to, in the order they found them, deduplicated by doc_path and id
function unionStories(edit_events: ReadonlyArray<EditEvent>): ActivityStoryRef[] {
    const bound = new Map<string, ActivityStoryRef>();
    for (const event of edit_events) {
        for (const ref of event.stories) { bound.set(`${ref.doc_path}\u0000${ref.id}`, ref); }
    }
    return [...bound.values()];
}

// tree and reflog live only until attributeTrees consumes the timestamps; repository survives for line-diffing
interface RepositoryRead {
    tree: ActivityTreeState['tree'];
    reflog: GitReflogCommit[];
    root_relative: string;
    repository: GitRepository;
}

/**
 * What made a cached line-diff result for one file still good: its `change`/`previous_path` (a
 * reclassification invalidates it outright), the working-tree side's own mtime and size where one
 * exists, and the repository's HEAD commit, since that is what the HEAD side of the diff is read
 * against. `result` is undefined when the file was diffed and declined (binary, oversized, or a side
 * that could not be read) - cached the same as a real result, so a declined file is not re-attempted
 * every scan until something about it actually changes.
 */
interface LineDiffCacheEntry {
    change: ActivityChangedFile['change'];
    previous_path?: string;
    mtime?: number;
    size?: number;
    head_commit: string;
    result: LineDiffCounts | undefined;
}

/**
 * What one session's own story binding last produced, kept so a file-cache hit can skip
 * re-matching write calls against story boards and re-splitting priced usage by turn - the two
 * expensive steps of a fold. `signature` is scoped to only the story documents this session's
 * write calls target, so a session touching no board keeps a stable signature regardless of what
 * other boards do. NOT cached: `state`/`current`/`question`/`ended_at`, which
 * `toActivitySessionFromCache` always takes fresh off this scan's own output, so a live reused
 * session's status is never stale.
 */
interface SessionFoldCache {
    signature: string;
    stories: ActivityStoryRef[];
    story_usage: ActivityStoryUsage[] | undefined;
}

/**
 * The agent activity analyser: one instance per extension host, shared by every panel drawing the
 * `agent` card type. It reads each vendor's own local session files directly, with no external
 * producer and no `.notethink/` contract, decodes and prices them in a nested worker, and folds
 * the result with each open repository's git state into the snapshot every subscribed panel is
 * posted.
 *
 * Lifecycle: `demand()`/`withdraw()` ref-count the panels currently drawing an `agent` card. The
 * first demand starts scanning; the last withdrawal stops it after `AGENT_STOP_GRACE_MS`, so a
 * card-type toggle does not restart the whole analyser. A panel that was never told to demand never
 * causes a single vendor file to be opened.
 */
export class AgentAnalyser {
    private readonly subscribers = new Set<PostFn>();
    private demand_count = 0;
    private stop_timer: ReturnType<typeof setTimeout> | undefined;
    private rescan_timer: ReturnType<typeof setTimeout> | undefined;
    private running = false;
    // true once the first scan ever completes, never cleared: decides whether a scan's progress is shown at all
    private has_shown_live = false;
    private scan_in_progress = false;
    // a trigger that landed mid-scan; exactly one follow-up scan runs once this one ends, not a second on top of it
    private rescan_requested = false;
    private last_scan_ended_ms = 0;
    // how long the last scan attempt took; the next scan's floor scales with this rather than a flat guess
    private last_scan_duration_ms = 0;
    private readonly pool: AgentAnalyserWorkerPool;
    // consecutive failed scan attempts, not round trips: a round-trip count would reset on other batches' successes
    private consecutive_scan_failures = 0;
    private readonly vendor_home: AgentVendorHome | undefined;
    private git_api: GitApi | undefined;
    private git_failure_logged = false;
    private readonly warned_unreadable = new Set<string>();
    // keyed by session_id: the file stats that produced `output`, so an unchanged session skips re-reading and re-parsing
    private readonly file_cache = new Map<string, { files: AgentFileIdentity[]; output: AgentAnalyserWorkerSessionOutput }>();
    // keyed by `${session_id}\0${path}`; a file with no entry here is read whole the next time it changes
    private readonly tail_state = new Map<string, TailBookmark & { worker_generation: number }>();
    // bumped on every worker replacement, so a bookmark from an earlier instance's line cache is never trusted
    private worker_generation = 0;
    // session ids pruneFileCache dropped, flushed onto the next worker request so it frees their cached lines too
    private pending_worker_evictions: string[] = [];
    // keyed by `${root_path}\0${file_path}`; an unchanged file's added/removed counts are reused rather than re-diffed
    private readonly line_diff_cache = new Map<string, LineDiffCacheEntry>();
    // one entry per session folded, keyed by session_id: skips re-folding while its boards are unchanged
    private readonly session_fold_cache = new Map<string, SessionFoldCache>();
    // keyed by board doc_path: the last text seen and a version bumped on each change, so signatures stay small
    private readonly board_versions = new Map<string, { text: string; version: number }>();
    private readonly watchers: vscode.FileSystemWatcher[] = [];
    private watch_debounce_timer: ReturnType<typeof setTimeout> | undefined;

    private state: ActivityAnalyserState = emptyAnalyserState('scanning');
    private sessions: HashMapOf<ActivitySessionState> = {};
    private trees: HashMapOf<ActivityTreeState> = {};
    private last_posted: string | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        worker_factory: () => Worker = () => new Worker(vscode.Uri.joinPath(context.extensionUri, 'client/extension/dist/agentAnalyserWorker.js').toString()),
        pool_size: number = defaultAgentAnalyserPoolSize(),
    ) {
        this.vendor_home = context.logUri ? agentVendorHomeFrom(context.logUri.path) : undefined;
        this.pool = new AgentAnalyserWorkerPool(worker_factory, pool_size);
    }

    /**
     * Registers a panel's demand for activity; the first demand starts the analyser. Every path here
     * ends by handing the new subscriber the current snapshot once: the already-running branch
     * always has one, a fresh start already broadcasts one (a harmless duplicate here), and a
     * restart with a completed scan on record broadcasts nothing on its own, so this call is what
     * lets a reattaching panel see the last snapshot immediately.
     */
    public demand(post: PostFn): void {
        this.subscribers.add(post);
        this.demand_count++;
        if (this.stop_timer !== undefined) { clearTimeout(this.stop_timer); this.stop_timer = undefined; }
        if (!this.running) { this.startRunning(); }
        post(this.currentMessage());
    }

    /** withdraw a panel's demand; the analyser stops after a short grace once nothing demands it any more */
    public withdraw(post: PostFn): void {
        this.subscribers.delete(post);
        this.demand_count = Math.max(0, this.demand_count - 1);
        if (this.demand_count > 0) { return; }
        if (this.stop_timer !== undefined) { clearTimeout(this.stop_timer); }
        this.stop_timer = setTimeout(() => { this.stopRunning(); }, AGENT_STOP_GRACE_MS);
        (this.stop_timer as unknown as { unref?: () => void }).unref?.();
    }

    /** the current snapshot for a panel that has just (re)loaded and holds nothing */
    public resendTo(post: PostFn): void {
        post(this.currentMessage());
    }

    /** the working tree one repository last read, for the diff opener's admission gate */
    public treeFor(root_path: string): ActivityTreeState['tree'] | undefined {
        return this.trees[root_path]?.tree;
    }

    /** the main transcript (Claude Code, Codex) or event log (Grok) the last scan read for a session, for the chat opener's fallback; every vendor's first file identity is that file */
    public transcriptPathFor(session_id: string): string | undefined {
        return this.file_cache.get(session_id)?.files[0]?.path;
    }

    public dispose(): void {
        this.subscribers.clear();
        this.demand_count = 0;
        if (this.stop_timer !== undefined) { clearTimeout(this.stop_timer); this.stop_timer = undefined; }
        this.stopRunning();
    }

    // --- lifecycle ---

    // a fresh start broadcasts 'scanning' immediately; a restart keeps the last snapshot while a new scan runs quietly
    private startRunning(): void {
        this.running = true;
        if (!this.vendor_home) {
            this.state = emptyAnalyserState('unavailable', 'This host has no local file access the analyser recognises (a web host, or an unrecognised user-data layout).');
            this.postToAll();
            return;
        }
        if (!this.has_shown_live) {
            this.state = emptyAnalyserState('scanning');
            this.postToAll();
        }
        this.armWatchers(this.vendor_home);
        this.scheduleScan(0);
    }

    private stopRunning(): void {
        this.running = false;
        if (this.rescan_timer !== undefined) { clearTimeout(this.rescan_timer); this.rescan_timer = undefined; }
        if (this.watch_debounce_timer !== undefined) { clearTimeout(this.watch_debounce_timer); this.watch_debounce_timer = undefined; }
        for (const watcher of this.watchers) { watcher.dispose(); }
        this.watchers.length = 0;
        this.pool.dispose();
    }

    /**
     * Watch every vendor directory a session file could appear or change under, so a live session's
     * new activity reaches its card within about a second rather than waiting for the next
     * `AGENT_RESCAN_INTERVAL_MS` poll - the poll stays armed underneath this as a safety net for a
     * change a watcher misses. A burst of writes (a session file, its usage figures) triggers one
     * debounced scan rather than one per file.
     */
    private armWatchers(home: AgentVendorHome): void {
        const globs = [
            new vscode.RelativePattern(vscode.Uri.file(home.claudeCode), '**/*'),
            new vscode.RelativePattern(vscode.Uri.file(home.codex), '**/*'),
            new vscode.RelativePattern(vscode.Uri.file(home.grok), '**/*'),
        ];
        for (const glob of globs) {
            try {
                const watcher = vscode.workspace.createFileSystemWatcher(glob);
                const onEvent = (): void => this.debounceScan();
                watcher.onDidCreate(onEvent);
                watcher.onDidChange(onEvent);
                watcher.onDidDelete(onEvent);
                this.watchers.push(watcher);
            } catch (err) {
                // a host that cannot watch outside the workspace still has the poll, just later
                writeToErrorLog('armWatchers', `agent activity watcher unavailable for ${glob.base}`, err);
            }
        }
    }

    private debounceScan(): void {
        if (this.watch_debounce_timer !== undefined) { clearTimeout(this.watch_debounce_timer); }
        this.watch_debounce_timer = setTimeout(() => {
            this.watch_debounce_timer = undefined;
            // minScanDelayMs, not a flat 0: without it, a constantly-writing agent re-triggers a new scan back to back
            this.scheduleScan(this.minScanDelayMs());
        }, AGENT_WATCH_DEBOUNCE_MS);
        (this.watch_debounce_timer as unknown as { unref?: () => void }).unref?.();
    }

    private scheduleScan(delay_ms: number): void {
        if (this.rescan_timer !== undefined) { clearTimeout(this.rescan_timer); }
        this.rescan_timer = setTimeout(() => {
            void this.runScan().catch(err => this.recoverFromScanError(err));
        }, delay_ms);
        (this.rescan_timer as unknown as { unref?: () => void }).unref?.();
    }

    /**
     * A scan that threw rather than returned. A first scan that never finishes leaves every panel
     * told the analyser is still scanning, so this reports 'failed' instead; a later scan succeeding
     * puts it back to live. The poll is re-armed either way, since a bad read must not be the
     * analyser's last. A background rescan throwing mid-flight leaves the last good snapshot exactly
     * as it was.
     */
    private recoverFromScanError(err: unknown): void {
        writeToErrorLog('runScan', 'agent activity scan failed', err);
        if (this.state.state === 'scanning') {
            this.state = emptyAnalyserState('failed', 'The agent analyser could not finish its first scan.');
            this.postToAll();
        }
        if (this.running) { this.scheduleScan(AGENT_RESCAN_INTERVAL_MS); }
    }

    // --- scanning ---

    /**
     * Single-flight guard: at most one scan runs at a time. Without it, an overlapping scan would
     * share this instance's `pool`/`consecutive_scan_failures` state and corrupt it (a second
     * `pool.roundTrip` call overwrites the first's `onmessage`, silently discarding its response). A
     * trigger mid-scan sets `rescan_requested` instead, and `finally` runs exactly one follow-up once
     * the current scan ends.
     */
    private async runScan(): Promise<void> {
        if (!this.running || !this.vendor_home) { return; }
        if (this.scan_in_progress) { this.rescan_requested = true; return; }
        this.scan_in_progress = true;
        const attempt_started_ms = Date.now();
        try {
            await this.runScanOnce(this.vendor_home);
        } finally {
            this.scan_in_progress = false;
            this.last_scan_ended_ms = Date.now();
            this.last_scan_duration_ms = this.last_scan_ended_ms - attempt_started_ms;
            if (this.rescan_requested) {
                this.rescan_requested = false;
                this.scheduleScan(this.minScanDelayMs());
            }
        }
    }

    /**
     * The floor the next scan waits behind, measured from when the previous attempt ended - applied
     * to both a queued follow-up and every watcher debounce, so a constantly-writing agent cannot
     * drive scans back to back. Proportional to `last_scan_duration_ms` (a 5s scan waits ~5s), so
     * scanning stays under ~50% busy, while a cheap scan still only waits the flat floor. Capped at
     * `AGENT_RESCAN_INTERVAL_MS`.
     */
    private minScanDelayMs(): number {
        const required_gap_ms = Math.max(AGENT_MIN_SCAN_SPACING_MS, Math.min(this.last_scan_duration_ms, AGENT_RESCAN_INTERVAL_MS));
        return Math.max(0, required_gap_ms - (Date.now() - this.last_scan_ended_ms));
    }

    // zeroed running totals for one scan attempt, with what's already known before the batch loop filled in
    private initScanPhaseTotals(discovery_ms: number, reused_count: number, story_docs_ms: number, git_trees_ms: number, batch_count: number): ScanPhaseTotals {
        return {
            discovery_ms, reused_count, story_docs_ms, git_trees_ms, batch_count,
            binding_ms: 0, binding_cache_hits: 0, binding_cache_misses: 0,
            attribution_ms: 0, line_diff_ms: 0, fold_ms: story_docs_ms + git_trees_ms,
            reading_ms: 0, parsing_ms: 0, posting_ms: 0, bytes_read: 0, bytes_transferred: 0, sessions_read: 0,
        };
    }

    /**
     * Newest sessions first, in batches, folded and posted as each batch completes rather than once
     * at the end. Story documents and each open repository's git tree are read once per scan, before
     * the batch loop, and reused by every batch's fold, so attribution only ever improves as later
     * batches add write calls, never regresses. Only the LAST batch re-diffs lines (real git IO per
     * repository); earlier batches post whatever the last scan cached. `state` stays 'scanning'
     * through every batch but the last.
     *
     * Reads pipeline one batch ahead (`startBatchRead`): batch N+1's read starts the moment batch N's
     * is collected, running concurrently with batch N's round trip, fold and post, so only the first
     * batch pays its read serially.
     */
    private async runScanOnce(vendor_home: AgentVendorHome): Promise<void> {
        const scan_started_ms = Date.now();
        const now_ms = scan_started_ms;
        const window_start_ms = now_ms - AGENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const previous_sessions = this.sessions;
        // discovery (stat-only), story documents and git trees are independent, so they run together ahead of the first batch
        const [{ candidates: discovered, reused, live_status, stat_ms }, { value: story_docs, ms: story_docs_ms }, { value: reads, ms: git_trees_ms }] = await Promise.all([
            this.discoverJobs(now_ms, window_start_ms),
            timed(() => this.readStoryDocuments()),
            timed(() => this.readRepositoryTrees(now_ms)),
        ]);
        // newest first: Codex's own discovery walks date directories oldest-first, so this sort establishes real recency
        const candidates = [...discovered].sort((a, b) => b.identity[0].mtime - a.identity[0].mtime);
        // a scan with nothing to read still makes one round trip (carrying pending evictions), so a worker failure is still caught
        const batches = candidates.length > 0 ? this.buildBatches(candidates) : [[]];
        const phases = this.initScanPhaseTotals(stat_ms ?? 0, reused.length, story_docs_ms, git_trees_ms, batches.length);
        let sessions_acc: HashMapOf<ActivitySessionState> = {};
        const write_calls_by_repo = new Map<string, AgentWriteCall[]>();
        const commit_calls_by_repo = new Map<string, AgentCommitCall[]>();
        const refusals: ActivityRefusal[] = [];
        const sessions_seen_this_scan: AgentAnalyserWorkerSessionOutput[] = [...reused];
        const reused_ids = new Set(reused.map(output => output.session_id));
        // computed once, not per session: a fold cache signature names board versions, never board text
        const board_versions = this.boardVersions(story_docs);
        // read-ahead by one batch: batch N+1 reads while batch N's round trip, fold and post are still running
        let pending_read = this.startBatchRead(batches, 0);
        for (let batch_index = 0; batch_index < batches.length; batch_index++) {
            const is_last_batch = batch_index === batches.length - 1;
            const { started_ms: read_started_ms, promise: read_promise } = pending_read;
            const read_results = await read_promise;
            phases.reading_ms += Date.now() - read_started_ms;
            pending_read = this.startBatchRead(batches, batch_index + 1);
            const batch: DiscoveredJob[] = [];
            for (const result of read_results) {
                if (!result) { continue; }
                batch.push(result.job);
                phases.bytes_read += result.bytes_read;
            }
            phases.sessions_read += batch.length;
            phases.bytes_transferred += batch.reduce((sum, job) => sum + this.jobBytes(job), 0);
            const worker_started_ms = Date.now();
            const response = await this.sendToWorker(batch);
            phases.parsing_ms += Date.now() - worker_started_ms;
            if (!response) {
                this.handleBatchFailure(vendor_home, phases, scan_started_ms);
                return;
            }
            this.updateFileCache(batch, response.sessions);
            // the worker's byte cap can evict a cached session; dropping the bookmark here avoids targeting a gone cache
            for (const session_id of response.evicted_session_ids ?? []) { this.evictTailStateFor(session_id); }
            // caching skips re-reading the transcript, so a fresh output takes the vendor's status here too, as discovery did
            const fresh = response.sessions.map(output => (output.state === 'ended' ? output : this.overlayLiveState(output, { live: true, status: live_status?.get(output.session_id) })));
            sessions_seen_this_scan.push(...fresh);
            refusals.push(...this.refusalsFrom(fresh));
            // a reused session needs no round trip, so it rides the FIRST batch's post; session_fold_cache makes folding it cheap too
            const batch_outputs = batch_index === 0 ? [...fresh, ...reused] : fresh;
            const fold_started_ms = Date.now();
            sessions_acc = this.foldBatch(batch_outputs, story_docs, reads, sessions_acc, write_calls_by_repo, commit_calls_by_repo, reused_ids, board_versions, phases);
            phases.binding_ms += Date.now() - fold_started_ms;
            // every batch posts the last scan's cached line counts; fresh ones (a git read per file) follow the live post
            const trees_this_batch = await this.attributeTrees(reads, write_calls_by_repo, commit_calls_by_repo, false, phases);
            phases.fold_ms += Date.now() - fold_started_ms;
            // an earlier batch of a later scan is never shown alone once a scan has ever completed; the first scan is the exception
            if (is_last_batch || !this.has_shown_live) {
                this.sessions = sessions_acc;
                this.trees = trees_this_batch;
                this.state = emptyAnalyserState(is_last_batch ? 'live' : 'scanning');
                this.state.refusals = refusals;
                const post_started_ms = Date.now();
                this.postToAll();
                phases.posting_ms += Date.now() - post_started_ms;
                if (phases.first_post_ms === undefined) { phases.first_post_ms = Date.now() - scan_started_ms; }
                if (is_last_batch) {
                    this.has_shown_live = true;
                    phases.live_post_ms = Date.now() - scan_started_ms;
                }
            }
        }
        await this.postFreshLineDiffs(reads, write_calls_by_repo, commit_calls_by_repo, phases);
        // this attempt ended with no batch failure, so a future failure starts counting from zero
        this.consecutive_scan_failures = 0;
        this.pruneFileCache(sessions_seen_this_scan);
        this.logSessionChanges(previous_sessions, this.sessions);
        // logged even with nothing found, so that reads differently from "never ran"; bytes_transferred is what tail-slicing sent
        writeToLogAtLevel('debug', 'runScan', this.scanTimingLine(vendor_home, phases, Date.now() - scan_started_ms));
        if (this.running) { this.scheduleScan(AGENT_RESCAN_INTERVAL_MS); }
    }

    /**
     * Recomputes line counts after the scan's live post, since each HEAD side is a git show per file,
     * and posts again only when the fresh counts changed what that post showed.
     */
    private async postFreshLineDiffs(
        reads: HashMapOf<RepositoryRead>,
        write_calls_by_repo: Map<string, AgentWriteCall[]>,
        commit_calls_by_repo: Map<string, AgentCommitCall[]>,
        phases: ScanPhaseTotals,
    ): Promise<void> {
        const diff_started_ms = Date.now();
        const diffed_trees = await this.attributeTrees(reads, write_calls_by_repo, commit_calls_by_repo, true, phases);
        phases.fold_ms += Date.now() - diff_started_ms;
        if (JSON.stringify(diffed_trees) === JSON.stringify(this.trees)) { return; }
        this.trees = diffed_trees;
        const post_started_ms = Date.now();
        this.postToAll();
        phases.posting_ms += Date.now() - post_started_ms;
    }

    /**
     * One batch's worker round trip failed. The first failure in a streak restarts once: logs what
     * this attempt got done, then re-discovers and re-reads the whole scan from scratch, since a
     * failed postMessage has already transferred this batch's buffers away. A second attempt in a
     * row failing gives up for this poll, but only shows 'failed' on this instance's very first
     * scan; once a scan has ever completed, a later double failure is logged and retried silently.
     */
    private handleBatchFailure(vendor_home: AgentVendorHome, phases: ScanPhaseTotals, scan_started_ms: number): void {
        if (this.consecutive_scan_failures === 0) {
            this.consecutive_scan_failures = 1;
            writeToLogAtLevel('debug', 'runScan', this.scanTimingLine(vendor_home, phases, Date.now() - scan_started_ms));
            this.scheduleScan(0);
            return;
        }
        // a background rescan fails silently, keeping the last snapshot; only the very first scan surfaces this
        if (!this.has_shown_live) {
            this.state = emptyAnalyserState('failed', 'The agent analyser worker crashed and its restart also failed.');
            const post_started_ms = Date.now();
            this.postToAll();
            phases.posting_ms += Date.now() - post_started_ms;
        }
        writeToLogAtLevel('debug', 'runScan', this.scanTimingLine(vendor_home, phases, Date.now() - scan_started_ms));
        this.scheduleScan(AGENT_RESCAN_INTERVAL_MS);
    }

    // one debug line naming every phase this scan spent time in, plus time to first post
    private scanTimingLine(vendor_home: AgentVendorHome, phases: ScanPhaseTotals, elapsed_ms: number): string {
        const {
            sessions_read, reused_count, bytes_read, bytes_transferred, discovery_ms, reading_ms, parsing_ms,
            fold_ms, story_docs_ms, git_trees_ms, binding_ms, binding_cache_hits, binding_cache_misses,
            attribution_ms, line_diff_ms, posting_ms, batch_count, first_post_ms, live_post_ms,
        } = phases;
        // story docs/git trees are read once per scan; the rest sum across batches, showing whether the cache helps
        return `scanned ${vendor_home.claudeCode}, ${vendor_home.codex}, ${vendor_home.grok}: ${sessions_read + reused_count} session(s) (${sessions_read} read, ${reused_count} skipped), ${bytes_read} byte(s) read, ${bytes_transferred} byte(s) transferred, total ${elapsed_ms}ms across ${batch_count} batch(es) (discovery ${discovery_ms}ms, reading ${reading_ms}ms, parsing ${parsing_ms}ms, fold ${fold_ms}ms [story docs ${story_docs_ms}ms, git trees ${git_trees_ms}ms, binding ${binding_ms}ms (${binding_cache_hits} cache hit(s), ${binding_cache_misses} miss(es)), attribution ${attribution_ms}ms, line diffs ${line_diff_ms}ms], posting ${posting_ms}ms, first post ${first_post_ms ?? elapsed_ms}ms, live post ${live_post_ms ?? elapsed_ms}ms)`;
    }

    // candidates split by count and size before anything is read: a small first batch, then pool-sized batches
    private buildBatches(candidates: DiscoveryCandidate[]): DiscoveryCandidate[][] {
        const batches: DiscoveryCandidate[][] = [];
        const later_batch_max_bytes = AGENT_BATCH_TARGET_BYTES_PER_WORKER * this.pool.pool_size;
        let index = 0;
        while (index < candidates.length) {
            const is_first = batches.length === 0;
            const max_jobs = is_first ? AGENT_FIRST_BATCH_MAX_JOBS : AGENT_BATCH_MAX_JOBS;
            const max_bytes = is_first ? AGENT_FIRST_BATCH_MAX_BYTES : later_batch_max_bytes;
            const batch: DiscoveryCandidate[] = [candidates[index]];
            let bytes = this.candidateStatBytes(candidates[index]);
            index++;
            while (index < candidates.length && batch.length < max_jobs) {
                const next_bytes = this.candidateStatBytes(candidates[index]);
                if (bytes > 0 && bytes + next_bytes > max_bytes) { break; }
                batch.push(candidates[index]);
                bytes += next_bytes;
                index++;
            }
            batches.push(batch);
        }
        return batches;
    }

    // current size on disk, from stat alone: an upper bound on the transfer, the only size known before reading
    private candidateStatBytes(candidate: DiscoveryCandidate): number {
        return candidate.identity.reduce((sum, entry) => sum + entry.size, 0);
    }

    // kicks off one batch's reads a batch ahead of the loop, concurrent with the previous batch's round trip, fold and post
    private startBatchRead(batches: ReadonlyArray<ReadonlyArray<DiscoveryCandidate>>, index: number): { started_ms: number; promise: Promise<Array<{ job: DiscoveredJob; bytes_read: number } | undefined>> } {
        const started_ms = Date.now();
        const candidate_batch = batches[index] ?? [];
        const promise = this.mapWithConcurrency(candidate_batch, AGENT_DISCOVERY_READ_CONCURRENCY, candidate => candidate.read());
        return { started_ms, promise };
    }

    // bytes this job adds to the worker's postMessage payload; summed across batches into bytes_transferred
    private jobBytes(job: DiscoveredJob): number {
        return job.transcript.bytes.byteLength + job.extra_files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    }

    // records freshly-read sessions against the identity that produced them, so an unchanged one is skipped next scan
    private updateFileCache(jobs: DiscoveredJob[], outputs: AgentAnalyserWorkerSessionOutput[]): void {
        const output_by_id = new Map(outputs.map(output => [output.session_id, output]));
        for (const job of jobs) {
            const output = output_by_id.get(job.session_id);
            if (output) { this.file_cache.set(job.session_id, { files: job.identity, output }); }
        }
    }

    /**
     * A session neither freshly read nor reused this scan is gone, dropped out of the window or its
     * file deleted; its cached identity, output and tail bookmarks are evicted, and its id is queued
     * onto pending_worker_evictions so the worker frees its own cached lines for a session that no
     * longer exists.
     */
    private pruneFileCache(sessions_seen: AgentAnalyserWorkerSessionOutput[]): void {
        const seen = new Set(sessions_seen.map(s => s.session_id));
        for (const session_id of this.file_cache.keys()) {
            if (seen.has(session_id)) { continue; }
            this.file_cache.delete(session_id);
            this.session_fold_cache.delete(session_id);
            this.evictTailStateFor(session_id);
            this.pending_worker_evictions.push(session_id);
        }
    }

    private evictTailStateFor(session_id: string): void {
        const prefix = `${session_id}\u0000`;
        for (const key of this.tail_state.keys()) { if (key.startsWith(prefix)) { this.tail_state.delete(key); } }
    }

    // true when this session has at least one tail bookmark, a proxy for the worker still retaining its lines
    private sessionTracked(session_id: string): boolean {
        const prefix = `${session_id}\u0000`;
        for (const key of this.tail_state.keys()) { if (key.startsWith(prefix)) { return true; } }
        return false;
    }

    // true when every one of this session's files matches the last scan's cached stat, so its output can be reused
    private sessionUnchanged(session_id: string, identity: AgentFileIdentity[]): boolean {
        const cached = this.file_cache.get(session_id);
        if (!cached || cached.files.length !== identity.length) { return false; }
        const by_path = new Map(cached.files.map(f => [f.path, f]));
        return identity.every(f => { const prev = by_path.get(f.path); return prev !== undefined && prev.mtime === f.mtime && prev.size === f.size; });
    }

    /**
     * Whether the worker is worth asking to retain this session's own lines at all: live, or one of
     * its files changed within `AGENT_TAIL_CACHE_RECENT_MS`. A session that fails both is still read
     * and built correctly every time its files change - it just never occupies the worker's cache, the
     * bound that keeps a first scan over the whole 30 day window (hundreds of sessions, most long
     * ended) from leaving the worker holding every one of their transcripts at once.
     *
     * Called for every session touched this scan, reused ones included: a session whose files did not
     * change can still stop qualifying purely by the clock (it ages past the recent window with no
     * live signal), and `!cacheable` here is what notices that and evicts it - see the call sites in
     * each `discoverX`.
     */
    private reconcileCacheability(session_id: string, vendor_live: boolean, identity: ReadonlyArray<AgentFileIdentity>, now_ms: number): boolean {
        const cacheable = vendor_live || identity.some(entry => now_ms - entry.mtime < AGENT_TAIL_CACHE_RECENT_MS);
        if (!cacheable && this.sessionTracked(session_id)) {
            this.evictTailStateFor(session_id);
            this.pending_worker_evictions.push(session_id);
        }
        return cacheable;
    }

    /**
     * Decides, for every one of a changed session's own files, how much of it is actually worth
     * sending the worker this scan: re-read on change, parse only the appended tail. `files[0]` is
     * always the transcript, by `buildJobFiles`'s own convention.
     *
     * A session `!cacheable` (not live, not recently changed enough to be worth the worker's memory -
     * `reconcileCacheability`) sends every file whole and tracks nothing: the worker is told
     * `job.cacheable = false` and builds the result from this job's own bytes without retaining a
     * line of it, so there is nothing here to resume from next time regardless.
     *
     * A cacheable session's TRANSCRIPT needing a whole reparse - first sight, shrunk, a rewritten
     * prefix, or a bookmark recorded under a worker generation this instance has since replaced -
     * forces every EXTRA file in the job whole too, since `AgentAnalyserWorker.ts`'s whole-job path
     * (`runJobWhole`, the vendor's own `readXSession`) needs every file's true full content. An extra
     * needing whole on its OWN account (a brand new subagent file, or Grok's `usage.json`, which is
     * never appendable and so always resolves whole) does NOT drag the transcript along: the worker's
     * incremental path resolves each file independently once the transcript itself is resumable.
     */
    private resolveSessionTailPlan(session_id: string, files: ReadonlyArray<{ identity: AgentFileIdentity; bytes: Uint8Array }>, cacheable: boolean): Array<{ path: string; bytes: Uint8Array; mode: 'whole' | 'tail' | 'none' }> {
        if (!cacheable) {
            this.evictTailStateFor(session_id);
            return files.map(file => ({ path: file.identity.path, bytes: file.bytes, mode: 'whole' as const }));
        }
        const decided = files.map(file => ({ file, result: this.computeTailSlice(session_id, file.identity, file.bytes) }));
        const transcript_forced_whole = decided[0].result.mode === 'whole';
        return decided.map(({ file, result }, index) => {
            const final = index > 0 && transcript_forced_whole && result.mode !== 'whole' ? sliceTail(undefined, file.bytes) : result;
            this.commitTailState(session_id, file.identity, final);
            return { path: file.identity.path, bytes: final.slice, mode: final.mode };
        });
    }

    private computeTailSlice(session_id: string, identity: AgentFileIdentity, bytes: Uint8Array): ReturnType<typeof sliceTail> {
        if (!identity.appendable) { return sliceTail(undefined, bytes); }
        const key = `${session_id}\u0000${identity.path}`;
        const prev = this.tail_state.get(key);
        const usable_prev = prev !== undefined && prev.worker_generation === this.worker_generation ? prev : undefined;
        return sliceTail(usable_prev, bytes);
    }

    private commitTailState(session_id: string, identity: AgentFileIdentity, result: ReturnType<typeof sliceTail>): void {
        const key = `${session_id}\u0000${identity.path}`;
        if (!identity.appendable) { this.tail_state.delete(key); return; }
        if (result.next) { this.tail_state.set(key, { ...result.next, worker_generation: this.worker_generation }); }
    }

    /**
     * Re-derives a reused session's live-dependent fields (`state`, `ended_at`, `current`, `question`)
     * from this scan's fresh live signal, leaving everything the unchanged transcript itself produced
     * (usage, calls, started_at, updated_at) untouched. Without this, a session whose files
     * genuinely stop changing keeps whatever `state` its last real read happened to compute forever -
     * "live" long after the process exited, since nothing would ever trigger a re-read to notice.
     */
    private overlayLiveState(output: AgentAnalyserWorkerSessionOutput, overlay: LiveOverlay): AgentAnalyserWorkerSessionOutput {
        if (!overlay.live) {
            if (output.state === 'ended') { return output; }
            return { ...output, state: 'ended', ended_at: output.ended_at ?? output.updated_at, current: undefined, question: undefined };
        }
        const state = overlay.status;
        if (state === undefined || output.state === state) { return output; }
        // going idle clears the last pending tool call; working or waiting keep the transcript's own, unable to fabricate one
        return { ...output, state, current: state === 'idle' ? undefined : output.current };
    }

    // one line per session that appeared, bound to a story, or changed state, never one per transcript append
    private logSessionChanges(before: HashMapOf<ActivitySessionState>, after: HashMapOf<ActivitySessionState>): void {
        for (const [session_id, next] of Object.entries(after)) {
            const previous = before[session_id];
            if (!previous) { writeToLogAtLevel('debug', 'logSessionChanges', `${session_id} (${next.session.vendor}) appeared, state ${next.session.state}`); continue; }
            if (previous.session.story_binding !== 'bound' && next.session.story_binding === 'bound') {
                const named = (next.session.stories ?? []).map(story => `${story.doc_path}#${story.id}`).join(', ');
                writeToLogAtLevel('debug', 'logSessionChanges', `${session_id} bound to ${named}`);
            }
            if (previous.session.state !== next.session.state) {
                writeToLogAtLevel('debug', 'logSessionChanges', `${session_id} state ${previous.session.state} -> ${next.session.state}`);
            }
        }
        for (const session_id of Object.keys(before)) {
            if (!after[session_id]) { writeToLogAtLevel('debug', 'logSessionChanges', `${session_id} dropped out of the 30 day window`); }
        }
    }

    // one row per session this batch's response carried a refusal for, appended onto the scan's running refusal list
    private refusalsFrom(outputs: AgentAnalyserWorkerSessionOutput[]): ActivityRefusal[] {
        return outputs
            .filter(s => s.refusal)
            .map(s => ({ file: `${s.vendor} transcript for ${s.session_id.slice(0, 8)}`, code: s.refusal!.code, reason: s.refusal!.reason, session_id: s.session_id }));
    }

    // --- the worker pool round trip ---

    private async sendToWorker(jobs: DiscoveredJob[]): Promise<AgentAnalyserWorkerResponse | undefined> {
        // deduped: pruneFileCache and reconcileCacheability can both queue the same session_id in one scan
        const evict_session_ids = [...new Set(this.pending_worker_evictions)];
        const request: AgentAnalyserWorkerRequest = {
            request_id: this.nextRequestId(),
            jobs,
            evict_session_ids: evict_session_ids.length > 0 ? evict_session_ids : undefined,
        };
        this.pending_worker_evictions = [];
        try {
            return await this.pool.roundTrip(request);
        } catch (err) {
            // retry-once-then-failed is decided at the SCAN level, not here: a per-call counter would keep resetting
            writeToErrorLog('sendToWorker', 'agent analyser worker round trip failed', err);
            // the pool reset drops every line cache, so a bookmark from this generation is stale; files are re-read whole
            this.pool.resetAll();
            this.worker_generation++;
            return undefined;
        }
    }

    // shared request_id generator, so a stray response from an earlier request can never be mismatched onto a later one
    private nextRequestId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    // --- folding the worker's answer with story binding and git state ---

    // each board's version this scan, bumped whenever its text differs from the last scan's
    private boardVersions(story_docs: ReadonlyArray<StoryDocument>): Map<string, number> {
        const versions = new Map<string, number>();
        for (const doc of story_docs) {
            const known = this.board_versions.get(doc.doc_path);
            const version = known === undefined ? 0 : (known.text === doc.text ? known.version : known.version + 1);
            this.board_versions.set(doc.doc_path, { text: doc.text, version });
            versions.set(doc.doc_path, version);
        }
        return versions;
    }

    /**
     * The signature one session's fold cache entry is judged against: the versions of only the boards
     * this session's write calls could bind to or unbind from (`isBoardPath`'s targets, paired with
     * `siblingBoardPath`, since a call to todo.md can still bind against done.md's current text). A
     * session touching no board gets a signature that stays valid however much other boards change.
     * Repository roots are not part of it: binding reads only board text, and a session's root is
     * resolved fresh on every fold.
     */
    private sessionFoldSignature(write_calls: ReadonlyArray<StoryBindingWriteCall>, board_versions: ReadonlyMap<string, number>): string {
        const relevant_paths = new Set<string>();
        for (const call of write_calls) {
            if (!isBoardPath(call.doc_path)) { continue; }
            relevant_paths.add(call.doc_path);
            const sibling = siblingBoardPath(call.doc_path);
            if (sibling) { relevant_paths.add(sibling); }
        }
        return [...relevant_paths]
            .filter(doc_path => board_versions.has(doc_path))
            .sort()
            .map(doc_path => `${doc_path}\u0000${board_versions.get(doc_path)}`)
            .join('\u0001');
    }

    /**
     * Folds one batch's session outputs into the scan's running accumulators and returns the updated
     * sessions map. Story binding is per-session and self-contained, so a session's card is final the
     * moment its batch is folded; only cross-session file/commit attribution settles further as later
     * batches add write calls.
     *
     * The per-call extraction loop always runs, cache hit or miss - it's cheap, and its output is
     * what `sessionFoldSignature` needs. Only story binding and the usage-by-turn split, genuinely
     * expensive on a session with many turns, are skipped on a `session_fold_cache` hit.
     * `binding_cache_hits`/`misses` count this so a scan's log line says whether the cache helps at all.
     */
    private foldBatch(
        outputs: AgentAnalyserWorkerSessionOutput[],
        story_docs: StoryDocument[],
        reads: HashMapOf<RepositoryRead>,
        sessions_acc: HashMapOf<ActivitySessionState>,
        write_calls_by_repo: Map<string, AgentWriteCall[]>,
        commit_calls_by_repo: Map<string, AgentCommitCall[]>,
        reused_ids: ReadonlySet<string>,
        board_versions: ReadonlyMap<string, number>,
        phases: ScanPhaseTotals,
    ): HashMapOf<ActivitySessionState> {
        const sessions: HashMapOf<ActivitySessionState> = { ...sessions_acc };
        for (const output of outputs) {
            const root = this.repositoryRootFor(output.cwd, reads);
            const write_calls: StoryBindingWriteCall[] = [];
            const timed_write_calls: TimedWriteCall[] = [];
            const repo_write_calls: AgentWriteCall[] = [];
            const repo_commit_calls: AgentCommitCall[] = [];
            for (const call of output.calls) {
                if (call.is_commit) {
                    if (root) { repo_commit_calls.push({ session_id: output.session_id, at_ms: Date.parse(call.at) }); }
                    continue;
                }
                if (!call.absolute_path) { continue; }
                const workspace_relative = this.workspaceRelative(call.absolute_path);
                if (workspace_relative) {
                    const write_call: StoryBindingWriteCall = { doc_path: workspace_relative, edits: call.edits, whole_file: call.whole_file };
                    write_calls.push(write_call);
                    timed_write_calls.push({ at_ms: Date.parse(call.at), call: write_call });
                }
                if (root) {
                    const repo_relative = path.posix.relative(root, call.absolute_path);
                    if (!repo_relative.startsWith('..')) { repo_write_calls.push({ session_id: output.session_id, repo_relative_path: repo_relative, at_ms: Date.parse(call.at) }); }
                }
            }
            if (root) {
                (write_calls_by_repo.get(root) ?? write_calls_by_repo.set(root, []).get(root)!).push(...repo_write_calls);
                (commit_calls_by_repo.get(root) ?? commit_calls_by_repo.set(root, []).get(root)!).push(...repo_commit_calls);
            }
            const signature = this.sessionFoldSignature(write_calls, board_versions);
            const cached = reused_ids.has(output.session_id) ? this.session_fold_cache.get(output.session_id) : undefined;
            if (cached && cached.signature === signature) {
                phases.binding_cache_hits++;
                sessions[output.session_id] = { root_path: root, session: this.toActivitySessionFromCache(output, cached) };
                continue;
            }
            phases.binding_cache_misses++;
            // each call is bound once; the session's stories and its usage-by-turn split both read these
            const edit_events = timed_write_calls.map(entry => ({ at_ms: entry.at_ms, stories: storiesForWriteCall(entry.call, story_docs) }));
            const stories = unionStories(edit_events);
            const session = this.toActivitySession(output, stories, edit_events);
            sessions[output.session_id] = { root_path: root, session };
            this.session_fold_cache.set(output.session_id, { signature, stories, story_usage: session.story_usage });
        }
        return sessions;
    }

    /**
     * Splits a session's priced usage across the stories it is bound to by the turn each usage entry
     * happened in: turns before the session's first story-editing write call count toward that
     * call's own story (or stories, split evenly, if it touched more than one);
     * after that, each usage entry counts toward whichever write call most recently preceded it (its
     * own timestamp included, so a call and the usage on its own turn resolve to each other), split
     * evenly across that call's own stories.
     *
     * `edit_events` and `priced_calls` are each sorted here rather than trusted to arrive in order: a
     * subagent transcript's own calls are appended after the main transcript's, in `claudecodeops.ts`,
     * rather than merged by timestamp, so neither list is guaranteed chronological on arrival. Once
     * both are sorted, one forward pass finds each entry's governing call.
     */
    private splitUsageByTurn(
        priced_calls: ReadonlyArray<AgentPricedUsageEntry>,
        all_edit_events: ReadonlyArray<EditEvent>,
        stories: ReadonlyArray<ActivityStoryRef>,
    ): ActivityStoryUsage[] | undefined {
        if (stories.length === 0) { return undefined; }
        const edit_events = all_edit_events.filter(event => event.stories.length > 0).sort((a, b) => a.at_ms - b.at_ms);
        if (edit_events.length === 0) {
            // unreachable in practice, since a non-empty `stories` implies at least one edit_event; kept as a defensive fallback
            const earliest = priced_calls.reduce<string | undefined>((first, entry) => (first === undefined || Date.parse(entry.at) < Date.parse(first) ? entry.at : first), undefined);
            return this.splitUsageEvenly(priced_calls.reduce((total, entry) => addActivityUsage(total, entry.usage), emptyActivityUsage()), stories, earliest);
        }
        const timed_events = edit_events.filter(event => !Number.isNaN(event.at_ms));
        const key = (ref: ActivityStoryRef): string => `${ref.doc_path}\u0000${ref.id}`;
        const totals = new Map<string, ActivityUsage>();
        const first_at = new Map<string, string>();
        const sorted_calls = priced_calls.map(entry => ({ entry, at_ms: Date.parse(entry.at) })).sort((a, b) => a.at_ms - b.at_ms);
        let governing_index = -1;
        for (const { entry, at_ms } of sorted_calls) {
            while (governing_index + 1 < timed_events.length && timed_events[governing_index + 1].at_ms <= at_ms) { governing_index++; }
            // an entry before every call, or with no parseable time, counts toward the first call
            const governing = governing_index >= 0 && !Number.isNaN(at_ms) ? timed_events[governing_index] : edit_events[0];
            const share = this.divideUsage(entry.usage, governing.stories.length);
            for (const ref of governing.stories) {
                const k = key(ref);
                totals.set(k, addActivityUsage(totals.get(k) ?? emptyActivityUsage(), share));
                if (!first_at.has(k)) { first_at.set(k, entry.at); }
            }
        }
        return stories.map(story => ({ story, usage: totals.get(key(story)) ?? emptyActivityUsage(), first_at: first_at.get(key(story)) }));
    }

    // an even split of one usage total across every story, for when there is no per-call timeline to place usage against
    private splitUsageEvenly(usage: ActivityUsage, stories: ReadonlyArray<ActivityStoryRef>, first_at: string | undefined): ActivityStoryUsage[] {
        const share = this.divideUsage(usage, stories.length);
        return stories.map(story => ({ story, usage: share, first_at }));
    }

    private divideUsage(usage: ActivityUsage, by: number): ActivityUsage {
        const share = 1 / by;
        return {
            input_tokens: Math.round(usage.input_tokens * share),
            output_tokens: Math.round(usage.output_tokens * share),
            cache_read_tokens: Math.round(usage.cache_read_tokens * share),
            cache_write_tokens: Math.round(usage.cache_write_tokens * share),
            cost_usd: usage.cost_usd === undefined ? undefined : usage.cost_usd * share,
            is_estimate: usage.is_estimate,
        };
    }

    private toActivitySession(
        output: AgentAnalyserWorkerSessionOutput,
        stories: ActivityStoryRef[],
        edit_events: ReadonlyArray<EditEvent>,
    ): ActivitySession {
        return {
            session_id: output.session_id,
            vendor: output.vendor,
            project: path.posix.basename(output.cwd) || output.cwd,
            story_binding: stories.length > 0 ? 'bound' : 'none',
            stories: stories.length > 0 ? stories : undefined,
            story_usage: this.splitUsageByTurn(output.priced_calls, edit_events, stories),
            started_at: output.started_at,
            updated_at: output.updated_at,
            ended_at: output.ended_at,
            state: output.state,
            capabilities: output.capabilities,
            current: output.current,
            question: output.question,
            model: output.model,
            usage: output.usage,
        };
    }

    /**
     * The same shape `toActivitySession` builds, but for a `session_fold_cache` hit: story binding and
     * usage-by-turn come from the cache, while every other field - `state`/`current`/`question`/
     * `ended_at` in particular - is taken fresh off this scan's own output, since `overlayLiveState`
     * can still move those for a transcript that never changes at all.
     */
    private toActivitySessionFromCache(output: AgentAnalyserWorkerSessionOutput, cached: SessionFoldCache): ActivitySession {
        return {
            session_id: output.session_id,
            vendor: output.vendor,
            project: path.posix.basename(output.cwd) || output.cwd,
            story_binding: cached.stories.length > 0 ? 'bound' : 'none',
            stories: cached.stories.length > 0 ? cached.stories : undefined,
            story_usage: cached.story_usage,
            started_at: output.started_at,
            updated_at: output.updated_at,
            ended_at: output.ended_at,
            state: output.state,
            capabilities: output.capabilities,
            current: output.current,
            question: output.question,
            model: output.model,
            usage: output.usage,
        };
    }

    /**
     * Every open repository's tree, in parallel: a multi-project workspace can have a dozen or more
     * repositories open at once, and each one's `applyLineDiffs` can mean a real git-extension round
     * trip, so awaiting them one at a time would multiply N roots by one root's latency for nothing.
     */
    private async attributeTrees(
        reads: HashMapOf<RepositoryRead>,
        write_calls_by_repo: Map<string, AgentWriteCall[]>,
        commit_calls_by_repo: Map<string, AgentCommitCall[]>,
        compute_fresh_line_diffs: boolean,
        phases: ScanPhaseTotals,
    ): Promise<HashMapOf<ActivityTreeState>> {
        const started_ms = Date.now();
        let attribution_ms = 0;
        const entries = await Promise.all(Object.entries(reads).map(async ([root_path, read]): Promise<readonly [string, ActivityTreeState]> => {
            const attribution_started_ms = Date.now();
            const attributed_uncommitted = attributeFilesToSessions(read.tree.uncommitted, write_calls_by_repo.get(root_path) ?? []);
            const committed = attributeCommitsToSessions(read.reflog, commit_calls_by_repo.get(root_path) ?? []);
            attribution_ms += Date.now() - attribution_started_ms;
            const uncommitted = await this.applyLineDiffs(root_path, read.repository, attributed_uncommitted, compute_fresh_line_diffs);
            return [root_path, { root_path, root_relative: read.root_relative, tree: { ...read.tree, uncommitted, committed } }];
        }));
        // attribution is synchronous, so its spans never overlap; line diffs overlap across roots and take the remaining wall time
        phases.attribution_ms += attribution_ms;
        phases.line_diff_ms += Date.now() - started_ms - attribution_ms;
        const attributed: HashMapOf<ActivityTreeState> = {};
        for (const [root_path, tree_state] of entries) { attributed[root_path] = tree_state; }
        return attributed;
    }

    /**
     * Adds `added`/`removed` line counts to the uncommitted files this scan is willing to diff: every
     * file credited to a session, plus enough of the rest to reach
     * `AGENT_LINE_DIFF_MAX_FILES_PER_REPO`. A file left out, or one this scan's diff declines, keeps
     * `added`/`removed` off rather than publishing a guessed count.
     *
     * `compute_fresh` false skips the whole cache-miss path and answers from the LAST scan's cached
     * pass, since this git-IO step is the one expensive enough that holding a post for it would undo
     * batching's point. The pass after the scan's live post recomputes fresh, so a changed file still
     * catches up within one scan.
     */
    private async applyLineDiffs(root_path: string, repository: GitRepository, files: ActivityChangedFile[], compute_fresh: boolean): Promise<ActivityChangedFile[]> {
        if (!compute_fresh) {
            return files.map(file => {
                const cached = this.line_diff_cache.get(`${root_path}\u0000${file.path}`);
                return cached?.result ? { ...file, added: cached.result.added, removed: cached.result.removed } : file;
            });
        }
        this.pruneLineDiffCacheForRepo(root_path, files);
        const credited = files.filter(file => file.session_id !== undefined);
        const uncredited = files.filter(file => file.session_id === undefined);
        const extra_budget = Math.max(0, AGENT_LINE_DIFF_MAX_FILES_PER_REPO - credited.length);
        const to_diff = [...credited, ...uncredited.slice(0, extra_budget)];
        const results = await this.lineDiffBatch(root_path, repository, to_diff);
        return files.map(file => {
            const result = results.get(file.path);
            return result ? { ...file, added: result.added, removed: result.removed } : file;
        });
    }

    // the working-tree side's mtime/size, the cache key's other half; undefined for a deleted file or a stat miss
    private async lineDiffIdentity(repository: GitRepository, file: ActivityChangedFile): Promise<{ mtime?: number; size?: number } | undefined> {
        if (file.change === 'deleted') { return {}; }
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(repository.rootUri, file.path));
            return { mtime: stat.mtime, size: stat.size };
        } catch {
            return undefined;
        }
    }

    /**
     * The cache pass over one repository's selected files: every unchanged file is answered from
     * `line_diff_cache` with no read, and every cache miss goes to `computeLineDiffs` in one batch
     * rather than one round trip per file.
     */
    private async lineDiffBatch(root_path: string, repository: GitRepository, files: ActivityChangedFile[]): Promise<Map<string, LineDiffCounts | undefined>> {
        const results = new Map<string, LineDiffCounts | undefined>();
        const head_commit = repository.state.HEAD?.commit ?? '';
        const identities = await Promise.all(files.map(file => this.lineDiffIdentity(repository, file)));
        const to_compute: ActivityChangedFile[] = [];
        const identity_by_path = new Map<string, { mtime?: number; size?: number }>();
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const identity = identities[i];
            if (!identity) { continue; }
            const key = `${root_path}\u0000${file.path}`;
            const cached = this.line_diff_cache.get(key);
            const unchanged = cached
                && cached.change === file.change
                && cached.previous_path === file.previous_path
                && cached.mtime === identity.mtime
                && cached.size === identity.size
                && cached.head_commit === head_commit;
            if (unchanged) { results.set(file.path, cached.result); continue; }
            to_compute.push(file);
            identity_by_path.set(file.path, identity);
        }
        if (to_compute.length === 0) { return results; }
        const computed = await this.computeLineDiffs(repository, to_compute);
        for (const file of to_compute) {
            const identity = identity_by_path.get(file.path)!;
            const result = computed.get(file.path);
            this.line_diff_cache.set(`${root_path}\u0000${file.path}`, { change: file.change, previous_path: file.previous_path, mtime: identity.mtime, size: identity.size, head_commit, result });
            results.set(file.path, result);
        }
        return results;
    }

    /**
     * Reads both sides of every file's diff (host-only: `vscode.workspace.fs`, including the git
     * extension's `git:` provider), then hands the bytes to the worker's nested thread in one round
     * trip so the O(a*b) LCS count never runs on the extension host - a 256KB/6,400-line pair
     * measures at ~700ms, long enough to stall this thread's event loop for the whole scan. A failed
     * round trip falls back to computing this batch with `lineDiffFromBytes` on the host instead of
     * losing the counts for this scan.
     */
    private async computeLineDiffs(repository: GitRepository, files: ActivityChangedFile[]): Promise<Map<string, LineDiffCounts | undefined>> {
        const results = new Map<string, LineDiffCounts | undefined>();
        const sides = await this.mapWithConcurrency(files, AGENT_LINE_DIFF_READ_CONCURRENCY, file => readLineDiffSides(repository.rootUri, file));
        const jobs: AgentLineDiffJob[] = [];
        for (let i = 0; i < files.length; i++) {
            const side = sides[i];
            if (side === 'declined') { results.set(files[i].path, undefined); continue; }
            // copied, never transferred: a failed round trip can still compute from these bytes on the host without re-reading them
            jobs.push({ key: files[i].path, head_bytes: side.head_bytes?.slice().buffer, working_bytes: side.working_bytes?.slice().buffer });
        }
        if (jobs.length === 0) { return results; }
        try {
            const response = await this.pool.roundTrip({ request_id: this.nextRequestId(), jobs: [], line_diff_jobs: jobs });
            for (const result of response.line_diff_results ?? []) { results.set(result.key, result.counts); }
        } catch (err) {
            writeToErrorLog('computeLineDiffs', 'agent line-diff worker round trip failed, computing this batch on the host instead', err);
            this.pool.resetAll();
            this.worker_generation++;
            for (let i = 0; i < files.length; i++) {
                const side = sides[i];
                if (side === 'declined') { continue; }
                results.set(files[i].path, lineDiffFromBytes(side.head_bytes, side.working_bytes));
            }
        }
        return results;
    }

    // a file no longer in this repository's uncommitted band has nothing left to invalidate a stale entry, so it is dropped
    private pruneLineDiffCacheForRepo(root_path: string, files: ActivityChangedFile[]): void {
        const valid = new Set(files.map(file => `${root_path}\u0000${file.path}`));
        const prefix = `${root_path}\u0000`;
        for (const key of this.line_diff_cache.keys()) {
            if (key.startsWith(prefix) && !valid.has(key)) { this.line_diff_cache.delete(key); }
        }
    }

    // --- resolving cwd/write paths against the workspace and its repositories ---

    private repositoryRootFor(cwd: string, reads: HashMapOf<RepositoryRead>): string | undefined {
        let best: string | undefined;
        for (const root_path of Object.keys(reads)) {
            if (cwd !== root_path && !cwd.startsWith(`${root_path}/`)) { continue; }
            if (!best || root_path.length > best.length) { best = root_path; }
        }
        return best;
    }

    private workspaceRelative(absolute_path: string): string | undefined {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const root = folder.uri.path;
            if (absolute_path === root) { return ''; }
            if (absolute_path.startsWith(`${root}/`)) { return absolute_path.slice(root.length + 1); }
        }
        return undefined;
    }

    private async readStoryDocuments(): Promise<StoryDocument[]> {
        const docs: StoryDocument[] = [];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            for (const project_uri of await this.projectRootsUnder(folder.uri)) {
                for (const name of ['todo.md', 'done.md']) {
                    const found = await this.findStoryBoards(project_uri, name);
                    docs.push(...found);
                }
            }
        }
        return docs;
    }

    /**
     * The project roots a workspace folder holds boards for: the folder itself when it carries its
     * own `docstech/users`, otherwise each of its immediate child directories, for a workspace folder
     * that holds several projects side by side. A project nested two or more levels down is not
     * searched.
     */
    private async projectRootsUnder(folder_uri: vscode.Uri): Promise<vscode.Uri[]> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder_uri, 'docstech', 'users'));
            return [folder_uri];
        } catch { /* not a project root itself; its immediate children are, under the umbrella layout */ }
        let entries: Array<[string, vscode.FileType]>;
        try { entries = await vscode.workspace.fs.readDirectory(folder_uri); }
        catch { return []; }
        return entries.filter(([, type]) => type === vscode.FileType.Directory).map(([name]) => vscode.Uri.joinPath(folder_uri, name));
    }

    // a story board lives at <project>/docstech/users/<username>/todo.md or done.md; every user's board is read
    private async findStoryBoards(folder_uri: vscode.Uri, file_name: string): Promise<StoryDocument[]> {
        const docs: StoryDocument[] = [];
        try {
            const users_uri = vscode.Uri.joinPath(folder_uri, 'docstech', 'users');
            const users = await vscode.workspace.fs.readDirectory(users_uri);
            for (const [user_name] of users) {
                const doc_uri = vscode.Uri.joinPath(users_uri, user_name, file_name);
                try {
                    const bytes = await vscode.workspace.fs.readFile(doc_uri);
                    const doc_path = this.workspaceRelative(doc_uri.path);
                    if (doc_path) { docs.push({ doc_path, text: new TextDecoder().decode(bytes) }); }
                } catch { /* this user has no board of this name, which is normal */ }
            }
        } catch { /* this workspace folder is not a project with a docstech/users directory */ }
        return docs;
    }

    private async readRepositoryTrees(now_ms: number): Promise<HashMapOf<RepositoryRead>> {
        const reads: HashMapOf<RepositoryRead> = {};
        this.git_api = this.git_api ?? await resolveGitApi();
        if (!this.git_api) {
            writeToLogAtLevel('debug', 'readRepositoryTrees', 'the vscode.git extension commands are not registered this scan, so no working tree or commit data can be read for any repository');
            return reads;
        }
        let repositories: GitRepository[];
        try { repositories = await this.git_api.readRepositories(); }
        catch (err) {
            // logged once, since a failure here repeats every scan and would otherwise grow a shipped build's log
            if (!this.git_failure_logged) { writeToErrorLog('readRepositoryTrees', 'the vscode.git extension commands failed', err); }
            this.git_failure_logged = true;
            return reads;
        }
        writeToLogAtLevel('debug', 'readRepositoryTrees', `git api reports ${repositories.length} repositor${repositories.length === 1 ? 'y' : 'ies'}: ${repositories.map(repo => repo.rootUri.path).join(', ') || '(none)'}`);
        for (const repository of repositories) {
            try {
                const read = await readRepositoryTree(repository, now_ms);
                const root_path = repository.rootUri.path;
                reads[root_path] = { tree: read.tree, reflog: read.reflog, root_relative: this.workspaceRelative(root_path) ?? '', repository };
            } catch (err) {
                writeToErrorLog('readRepositoryTrees', `failed to read git state for ${repository.rootUri.path}`, err);
            }
        }
        return reads;
    }

    // --- vendor discovery ---

    private async discoverJobs(now_ms: number, window_start_ms: number): Promise<DiscoveryResult> {
        if (!this.vendor_home) { return { candidates: [], reused: [] }; }
        const empty: DiscoveryResult = { candidates: [], reused: [] };
        const [claude, codex, grok] = await Promise.all([
            this.discoverClaudeCode(this.vendor_home.claudeCode, now_ms, window_start_ms).catch(err => { writeToErrorLog('discoverJobs', 'claude-code discovery failed', err); return empty; }),
            this.discoverCodex(this.vendor_home.codex, now_ms, window_start_ms).catch(err => { writeToErrorLog('discoverJobs', 'codex discovery failed', err); return empty; }),
            this.discoverGrok(this.vendor_home.grok, now_ms, window_start_ms).catch(err => { writeToErrorLog('discoverJobs', 'grok discovery failed', err); return empty; }),
        ]);
        return {
            candidates: [...claude.candidates, ...codex.candidates, ...grok.candidates],
            reused: [...claude.reused, ...codex.reused, ...grok.reused],
            live_status: claude.live_status,
            // three vendors run in parallel, so discovery time is bounded by the slowest, not their sum
            stat_ms: Math.max(claude.stat_ms ?? 0, codex.stat_ms ?? 0, grok.stat_ms ?? 0),
        };
    }

    /**
     * Runs `fn` over `items` with at most `limit` in flight at once, each result landing at its own
     * index regardless of finishing order. Overlaps a batch's whole-file reads, since
     * `vscode.workspace.fs.readFile` is I/O bound: several at a time finish in roughly (count / limit)
     * round trips' worth of wall time rather than one round trip per session.
     */
    private async mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
        const results: R[] = new Array(items.length);
        let next_index = 0;
        const runNext = async (): Promise<void> => {
            for (;;) {
                const index = next_index++;
                if (index >= items.length) { return; }
                results[index] = await fn(items[index]);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
        return results;
    }

    // bytes stay a Uint8Array to the worker; nothing in the extension host decodes a whole transcript
    private async readBytes(uri: vscode.Uri): Promise<Uint8Array | undefined> {
        try { return await vscode.workspace.fs.readFile(uri); }
        catch { return undefined; }
    }

    // a session file listed but unreadable, warned once per path so it cannot fill the log on every rescan
    private warnUnreadable(uri: vscode.Uri): void {
        if (this.warned_unreadable.has(uri.path)) { return; }
        this.warned_unreadable.add(uri.path);
        writeToLogAtLevel('warn', 'warnUnreadable', `listed but could not be read: ${uri.path}`);
    }

    private async statFile(uri: vscode.Uri): Promise<{ mtime: number; size: number } | undefined> {
        try { const stat = await vscode.workspace.fs.stat(uri); return { mtime: stat.mtime, size: stat.size }; }
        catch { return undefined; }
    }

    // a bounded text peek at the start of a file, for routing decisions only, never for the job the worker parses
    private peekText(bytes: Uint8Array, max_bytes: number): string {
        return new TextDecoder().decode(bytes.length > max_bytes ? bytes.subarray(0, max_bytes) : bytes);
    }

    private rawFile(path: string, bytes: Uint8Array, mode: 'whole' | 'tail' | 'none'): AgentAnalyserRawFile {
        return { path, bytes: bytes.slice().buffer as ArrayBuffer, mode };
    }

    private makeJob(vendor: AgentVendorId, session_id: string, cwd: string, vendor_live: boolean, transcript: AgentAnalyserRawFile, extra: AgentAnalyserRawFile[], now_ms: number, window_start_ms: number, identity: AgentFileIdentity[], cacheable: boolean): DiscoveredJob {
        return { vendor, session_id, cwd, vendor_live, now_ms, window_start_ms, transcript, extra_files: extra, identity, cacheable };
    }

    // reads every extra file this session's identity names, once re-reading is known needed; an unreadable one is dropped
    private async readExtraFileBytes(extra_identity: ReadonlyArray<AgentFileIdentity>): Promise<Array<{ identity: AgentFileIdentity; bytes: Uint8Array }>> {
        const files: Array<{ identity: AgentFileIdentity; bytes: Uint8Array }> = [];
        for (const entry of extra_identity) {
            const bytes = await this.readBytes(vscode.Uri.file(entry.path));
            if (bytes !== undefined) { files.push({ identity: entry, bytes }); }
        }
        return files;
    }

    /**
     * Turns this session's own freshly-read files (the transcript plus whichever extras were
     * actually readable) into the job's `AgentAnalyserRawFile`s, running each through
     * `resolveSessionTailPlan` so a growing transcript transfers only its new tail rather than its
     * whole current content (follow transcripts incrementally). Returns the whole-file bytes actually
     * read from disk too, for the scan's own bytes-read-versus-transferred log line.
     */
    private buildJobFiles(session_id: string, entries: ReadonlyArray<{ identity: AgentFileIdentity; bytes: Uint8Array }>, cacheable: boolean): { transcript: AgentAnalyserRawFile; extra_files: AgentAnalyserRawFile[]; bytes_read: number } {
        const bytes_read = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
        const planned = this.resolveSessionTailPlan(session_id, entries, cacheable);
        const [transcript_plan, ...extra_plan] = planned;
        return {
            transcript: this.rawFile(transcript_plan.path, transcript_plan.bytes, transcript_plan.mode),
            extra_files: extra_plan.map(entry => this.rawFile(entry.path, entry.bytes, entry.mode)),
            bytes_read,
        };
    }

    /**
     * Stat-only: every candidate session is stat'd and sorted into reused vs. changed, but a changed
     * session's bytes are never read here - `read` is a closure over what `readClaudeCodeCandidate`
     * needs, called only once its batch is chosen. This keeps discovery cheap regardless of how large
     * the changed set is, since recency (from sorting every vendor's candidates together) decides
     * what reads first.
     *
     * Two concurrent passes, not one project directory at a time: every project directory's listing
     * first, then every session's stat-and-classify step, both at `AGENT_DISCOVERY_STAT_CONCURRENCY`.
     * `AGENT_FILE_STAT_MAX_ENTRIES` is checked at the start of each session's turn in the second pass,
     * so up to `AGENT_DISCOVERY_STAT_CONCURRENCY` sessions already past that check can still land - a
     * small, bounded overshoot traded for not serialising the stat pass to one session at a time.
     */
    private async discoverClaudeCode(home: string, now_ms: number, window_start_ms: number): Promise<DiscoveryResult> {
        const stat_started_ms = Date.now();
        const live = await this.claudeLiveSessions(home);
        const projects_uri = vscode.Uri.file(`${home}/projects`);
        let project_dirs: Array<[string, vscode.FileType]>;
        try { project_dirs = await vscode.workspace.fs.readDirectory(projects_uri); }
        catch { return { candidates: [], reused: [] }; }
        const dir_names = project_dirs.filter(([, type]) => type === vscode.FileType.Directory).map(([dir_name]) => dir_name);
        const listings = await this.mapWithConcurrency(dir_names, AGENT_DISCOVERY_STAT_CONCURRENCY, async dir_name => {
            const project_uri = vscode.Uri.joinPath(projects_uri, dir_name);
            try {
                const entries = await vscode.workspace.fs.readDirectory(project_uri);
                return entries
                    .filter(([file_name, entry_type]) => entry_type === vscode.FileType.File && file_name.endsWith('.jsonl'))
                    .map(([file_name]) => ({ project_uri, dir_name, file_name }));
            } catch { return []; }
        });
        const session_files = listings.flat();
        const reused: AgentAnalyserWorkerSessionOutput[] = [];
        const candidates: DiscoveryCandidate[] = [];
        await this.mapWithConcurrency(session_files, AGENT_DISCOVERY_STAT_CONCURRENCY, async ({ project_uri, dir_name, file_name }) => {
            if (candidates.length + reused.length >= fileStatMaxEntries()) { return; }
            // a session's files are its main transcript plus every subagent transcript; any one changing re-parses the whole session
            const session_id = file_name.slice(0, -'.jsonl'.length);
            const transcript_uri = vscode.Uri.joinPath(project_uri, file_name);
            const transcript_stat = await this.statFile(transcript_uri);
            if (transcript_stat === undefined || transcript_stat.mtime < window_start_ms) { return; }
            const extra_identity = await this.claudeSubagentFileStats(project_uri, session_id);
            const transcript_identity: AgentFileIdentity = { path: transcript_uri.path, ...transcript_stat, appendable: true };
            const identity: AgentFileIdentity[] = [transcript_identity, ...extra_identity];
            const vendor_live = live.has(session_id);
            if (this.sessionUnchanged(session_id, identity)) {
                this.reconcileCacheability(session_id, vendor_live, identity, now_ms);
                reused.push(this.overlayLiveState(this.file_cache.get(session_id)!.output, { live: vendor_live, status: live.get(session_id)?.status }));
                return;
            }
            const claude_candidate: ClaudeCodeCandidate = { session_id, dir_name, transcript_uri, transcript_identity, extra_identity, identity, vendor_live };
            candidates.push({ vendor: 'claude-code', session_id, identity, read: () => this.readClaudeCodeCandidate(claude_candidate, live, now_ms, window_start_ms) });
        });
        const stat_ms = Date.now() - stat_started_ms;
        const live_status = new Map<string, ActivityState>();
        for (const [session_id, entry] of live) {
            if (entry.status !== undefined) { live_status.set(session_id, entry.status); }
        }
        return { candidates, reused, live_status, stat_ms };
    }

    // one changed session's read-and-build step; undefined when the transcript can't be read (a race with its writer)
    private async readClaudeCodeCandidate(candidate: ClaudeCodeCandidate, live: Map<string, { cwd: string; status?: ActivityState }>, now_ms: number, window_start_ms: number): Promise<{ job: DiscoveredJob; bytes_read: number } | undefined> {
        const bytes = await this.readBytes(candidate.transcript_uri);
        if (bytes === undefined) { this.warnUnreadable(candidate.transcript_uri); return undefined; }
        const cwd = live.get(candidate.session_id)?.cwd ?? this.guessCwd(bytes) ?? candidate.dir_name;
        const extra_read = await this.readExtraFileBytes(candidate.extra_identity);
        const cacheable = this.reconcileCacheability(candidate.session_id, candidate.vendor_live, candidate.identity, now_ms);
        const built = this.buildJobFiles(candidate.session_id, [{ identity: candidate.transcript_identity, bytes }, ...extra_read], cacheable);
        const job = this.makeJob('claude-code', candidate.session_id, cwd, candidate.vendor_live, built.transcript, built.extra_files, now_ms, window_start_ms, candidate.identity, cacheable);
        return { job, bytes_read: built.bytes_read };
    }

    // `status` is the pid file's own field mapped by CLAUDE_PID_STATUS_STATES, undefined for an unrecognised value
    private async claudeLiveSessions(home: string): Promise<Map<string, { cwd: string; status?: ActivityState }>> {
        const map = new Map<string, { cwd: string; status?: ActivityState }>();
        const sessions_uri = vscode.Uri.file(`${home}/sessions`);
        let entries: Array<[string, vscode.FileType]>;
        try { entries = await vscode.workspace.fs.readDirectory(sessions_uri); }
        catch { return map; }
        for (const [file_name, type] of entries) {
            if (type !== vscode.FileType.File || !file_name.endsWith('.json')) { continue; }
            // this per-session metadata file is small and host-only, never sent to the worker, so decoding it here is cheap
            const bytes = await this.readBytes(vscode.Uri.joinPath(sessions_uri, file_name));
            if (!bytes) { continue; }
            try {
                const parsed = JSON.parse(this.peekText(bytes, bytes.length)) as { sessionId?: string; cwd?: string; status?: string };
                if (parsed.sessionId && parsed.cwd) {
                    const status = parsed.status !== undefined && Object.hasOwn(CLAUDE_PID_STATUS_STATES, parsed.status) ? CLAUDE_PID_STATUS_STATES[parsed.status] : undefined;
                    map.set(parsed.sessionId, { cwd: parsed.cwd, status });
                }
            } catch { /* a session file written mid-update is skipped this scan and re-read next time */ }
        }
        return map;
    }

    private guessCwd(transcript_bytes: Uint8Array): string | undefined {
        const match = /"cwd":"([^"]+)"/.exec(this.peekText(transcript_bytes, 8192));
        return match?.[1];
    }

    // stats every subagent transcript under a session without reading any, so an unchanged session is skipped early
    private async claudeSubagentFileStats(project_uri: vscode.Uri, session_id: string): Promise<AgentFileIdentity[]> {
        const subagents_uri = vscode.Uri.joinPath(project_uri, session_id, 'subagents');
        let entries: Array<[string, vscode.FileType]>;
        try { entries = await vscode.workspace.fs.readDirectory(subagents_uri); }
        catch { return []; }
        const identity: AgentFileIdentity[] = [];
        for (const [file_name, type] of entries) {
            if (type !== vscode.FileType.File || !file_name.endsWith('.jsonl')) { continue; }
            const uri = vscode.Uri.joinPath(subagents_uri, file_name);
            const stat = await this.statFile(uri);
            if (stat !== undefined) { identity.push({ path: uri.path, ...stat, appendable: true }); }
        }
        return identity;
    }

    // two concurrent passes: every date's listing first (a fixed 30, most empty), then each rollout's stat-and-classify step
    private async discoverCodex(home: string, now_ms: number, window_start_ms: number): Promise<DiscoveryResult> {
        const stat_started_ms = Date.now();
        const dates = this.datesInWindow(window_start_ms, now_ms);
        const listings = await this.mapWithConcurrency(dates, AGENT_DISCOVERY_STAT_CONCURRENCY, async date => {
            const day_uri = vscode.Uri.file(`${home}/sessions/${date}`);
            try {
                const entries = await vscode.workspace.fs.readDirectory(day_uri);
                return entries
                    .filter(([file_name, type]) => type === vscode.FileType.File && file_name.endsWith('.jsonl'))
                    .map(([file_name]) => ({ day_uri, file_name }));
            } catch { return []; }
        });
        const files = listings.flat();
        const candidates: DiscoveryCandidate[] = [];
        const reused: AgentAnalyserWorkerSessionOutput[] = [];
        await this.mapWithConcurrency(files, AGENT_DISCOVERY_STAT_CONCURRENCY, async ({ day_uri, file_name }) => {
            const uri = vscode.Uri.joinPath(day_uri, file_name);
            const stat = await this.statFile(uri);
            if (stat === undefined || stat.mtime < window_start_ms) { return; }
            const session_id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file_name)?.[1] ?? file_name;
            // codex has no extra files, so its identity is just the rollout's own stat
            const identity: AgentFileIdentity = { path: uri.path, ...stat, appendable: true };
            // "live" is a pure clock check on the stat's mtime, recomputed every scan whether reused or freshly read
            const vendor_live = now_ms - stat.mtime < 5 * 60 * 1000;
            if (this.sessionUnchanged(session_id, [identity])) {
                this.reconcileCacheability(session_id, vendor_live, [identity], now_ms);
                reused.push(this.overlayLiveState(this.file_cache.get(session_id)!.output, { live: vendor_live }));
                return;
            }
            candidates.push({ vendor: 'codex', session_id, identity: [identity], read: () => this.readCodexCandidate(uri, identity, session_id, vendor_live, now_ms, window_start_ms) });
        });
        return { candidates, reused, stat_ms: Date.now() - stat_started_ms };
    }

    // one changed Codex session's own read-and-build step, called once this candidate's batch is chosen
    private async readCodexCandidate(uri: vscode.Uri, identity: AgentFileIdentity, session_id: string, vendor_live: boolean, now_ms: number, window_start_ms: number): Promise<{ job: DiscoveredJob; bytes_read: number } | undefined> {
        const bytes = await this.readBytes(uri);
        if (bytes === undefined) { this.warnUnreadable(uri); return undefined; }
        const cwd = this.guessCwd(bytes) ?? '';
        const cacheable = this.reconcileCacheability(session_id, vendor_live, [identity], now_ms);
        const built = this.buildJobFiles(session_id, [{ identity, bytes }], cacheable);
        const job = this.makeJob('codex', session_id, cwd, vendor_live, built.transcript, built.extra_files, now_ms, window_start_ms, [identity], cacheable);
        return { job, bytes_read: built.bytes_read };
    }

    /**
     * Codex's own `YYYY/MM/DD` session folders are the host machine's local calendar, not UTC: the
     * directory a rollout sits under, and its filename timestamp, are both built from the same local
     * `Date` at the same moment, offset from the rollout's own `session_meta.timestamp` (UTC) by
     * whatever the host's current UTC offset is. Walking UTC dates here would miss or misplace a
     * rollout written near local midnight.
     */
    private datesInWindow(window_start_ms: number, now_ms: number): string[] {
        const dates: string[] = [];
        const cursor = new Date(window_start_ms);
        cursor.setHours(0, 0, 0, 0);
        while (cursor.getTime() <= now_ms) {
            const y = cursor.getFullYear();
            const m = String(cursor.getMonth() + 1).padStart(2, '0');
            const d = String(cursor.getDate()).padStart(2, '0');
            dates.push(`${y}/${m}/${d}`);
            cursor.setDate(cursor.getDate() + 1);
        }
        return dates;
    }

    // two concurrent passes: every cwd's directory listed first, then each session's stats and classify step
    private async discoverGrok(home: string, now_ms: number, window_start_ms: number): Promise<DiscoveryResult> {
        const stat_started_ms = Date.now();
        const live = await this.grokLiveSessionIds(home);
        const sessions_uri = vscode.Uri.file(`${home}/sessions`);
        let project_dirs: Array<[string, vscode.FileType]>;
        try { project_dirs = await vscode.workspace.fs.readDirectory(sessions_uri); }
        catch { return { candidates: [], reused: [] }; }
        const encoded_cwds = project_dirs.filter(([, type]) => type === vscode.FileType.Directory).map(([encoded_cwd]) => encoded_cwd);
        const listings = await this.mapWithConcurrency(encoded_cwds, AGENT_DISCOVERY_STAT_CONCURRENCY, async encoded_cwd => {
            const project_uri = vscode.Uri.joinPath(sessions_uri, encoded_cwd);
            const cwd = this.decodeUriComponentSafe(encoded_cwd);
            try {
                const entries = await vscode.workspace.fs.readDirectory(project_uri);
                return entries
                    .filter(([, entry_type]) => entry_type === vscode.FileType.Directory)
                    .map(([session_id]) => ({ project_uri, cwd, session_id }));
            } catch { return []; }
        });
        const session_dirs = listings.flat();
        const candidates: DiscoveryCandidate[] = [];
        const reused: AgentAnalyserWorkerSessionOutput[] = [];
        await this.mapWithConcurrency(session_dirs, AGENT_DISCOVERY_STAT_CONCURRENCY, async ({ project_uri, cwd, session_id }) => {
            const events_uri = vscode.Uri.joinPath(project_uri, session_id, 'events.jsonl');
            const events_stat = await this.statFile(events_uri);
            if (events_stat === undefined || events_stat.mtime < window_start_ms) { return; }
            const usage_uri = vscode.Uri.joinPath(project_uri, session_id, 'usage.json');
            const usage_stat = await this.statFile(usage_uri);
            // events.jsonl is tail-sliceable; usage.json is rewritten whole each turn, so it never carries a bookmark
            const events_identity: AgentFileIdentity = { path: events_uri.path, ...events_stat, appendable: true };
            const identity: AgentFileIdentity[] = [events_identity, ...(usage_stat ? [{ path: usage_uri.path, ...usage_stat, appendable: false }] : [])];
            const vendor_live = live.has(session_id);
            if (this.sessionUnchanged(session_id, identity)) {
                this.reconcileCacheability(session_id, vendor_live, identity, now_ms);
                reused.push(this.overlayLiveState(this.file_cache.get(session_id)!.output, { live: vendor_live }));
                return;
            }
            candidates.push({ vendor: 'grok', session_id, identity, read: () => this.readGrokCandidate(events_uri, identity, session_id, cwd, vendor_live, now_ms, window_start_ms) });
        });
        return { candidates, reused, stat_ms: Date.now() - stat_started_ms };
    }

    // one changed Grok session's own read-and-build step, called once this candidate's batch is chosen
    private async readGrokCandidate(events_uri: vscode.Uri, identity: AgentFileIdentity[], session_id: string, cwd: string, vendor_live: boolean, now_ms: number, window_start_ms: number): Promise<{ job: DiscoveredJob; bytes_read: number } | undefined> {
        const events_identity = identity[0];
        const bytes = await this.readBytes(events_uri);
        if (bytes === undefined) { this.warnUnreadable(events_uri); return undefined; }
        const usage_identity = identity[1];
        const usage_read = usage_identity !== undefined ? await this.readExtraFileBytes([usage_identity]) : [];
        const cacheable = this.reconcileCacheability(session_id, vendor_live, identity, now_ms);
        const built = this.buildJobFiles(session_id, [{ identity: events_identity, bytes }, ...usage_read], cacheable);
        const job = this.makeJob('grok', session_id, cwd, vendor_live, built.transcript, built.extra_files, now_ms, window_start_ms, identity, cacheable);
        return { job, bytes_read: built.bytes_read };
    }

    private async grokLiveSessionIds(home: string): Promise<Set<string>> {
        // this per-host metadata file is small and host-only, never sent to the worker, so decoding it here is cheap
        const bytes = await this.readBytes(vscode.Uri.file(`${home}/active_sessions.json`));
        if (!bytes) { return new Set(); }
        try {
            const parsed = JSON.parse(this.peekText(bytes, bytes.length)) as Array<{ session_id?: string }>;
            return new Set(parsed.map(entry => entry.session_id).filter((id): id is string => !!id));
        } catch { return new Set(); }
    }

    private decodeUriComponentSafe(value: string): string {
        try { return decodeURIComponent(value); }
        catch { return value; }
    }

    // --- posting ---

    private currentMessage(): Record<string, unknown> {
        const snapshot = buildActivitySnapshot(this.state, this.sessions, this.trees);
        return { type: 'activity', activity: snapshot };
    }

    private postToAll(): void {
        const message = this.currentMessage();
        const serialised = JSON.stringify(message);
        if (serialised === this.last_posted) { return; }
        this.last_posted = serialised;
        for (const post of this.subscribers) { post(message); }
    }
}

// re-derives session ids the worker could not read at all, so the card can count them beyond the refusal objects
export function unreadableIdsFrom(state: ActivityAnalyserState): string[] {
    return unreadableSessionIds(state.refusals);
}

export type { AgentVendorId };
