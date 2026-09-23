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
import type { LineDiffCounts } from '../lib/agentlinediffops';
import type { AgentPricedUsageEntry } from '../lib/agentpricingops';
import { lineDiffForFile, readRepositoryTree, resolveGitApi, type GitApi, type GitRepository } from './agentgitops';
import type { GitReflogCommit } from '../lib/agentgitreflogops';
import { bindSessionToStory, storiesForWriteCall, type StoryBindingWriteCall, type StoryDocument } from '../lib/agentstorybindingops';
import { sliceTail, type TailBookmark } from '../lib/agenttailparseops';
import type { AgentAnalyserRawFile, AgentAnalyserWorkerJob, AgentAnalyserWorkerRequest, AgentAnalyserWorkerResponse, AgentAnalyserWorkerSessionOutput, AgentVendorId } from './AgentAnalyserWorker';
import { addActivityUsage, emptyActivityUsage, type ActivityChangedFile, type ActivitySession, type ActivityState, type ActivityStoryRef, type ActivityStoryUsage, type ActivityUsage } from '../types/AgentActivity';
import type { HashMapOf } from '../types/general';

// only sessions with activity inside this window count toward what a story's card draws
const AGENT_WINDOW_DAYS = 30;
// the periodic poll behind the watchers below, so a change no watcher caught still lands within this long
const AGENT_RESCAN_INTERVAL_MS = 15_000;
// a burst of writes to a session's files (the transcript, then its usage figures) triggers one scan, not one per file; short enough that a live tool call still reaches the card in about a second
const AGENT_WATCH_DEBOUNCE_MS = 300;
// toggling the agent card type on and off in quick succession must not thrash the analyser, so a withdrawal waits this long before it actually stops
const AGENT_STOP_GRACE_MS = 5_000;
// a batch the worker has not answered inside this long is treated as a crash
const AGENT_WORKER_TIMEOUT_MS = 20_000;
// a Claude Code scan opens no further project directory once it holds this many sessions, so an unusually large history cannot make one scan unbounded
const AGENT_FILE_STAT_MAX_ENTRIES = 4_000;
// a scan started by a rescan request queued during the previous scan waits at least this long after that scan ended, so a constantly-changing file cannot drive the analyser to restart back to back; short enough that activity still reaches the card within about a second once unchanged files are skipped
const AGENT_MIN_SCAN_SPACING_MS = 1_000;
// a file credited to a session is always diffed; an uncredited one is diffed only until a repository's uncommitted band reaches this many diffed files, so a large unattributed change set cannot make every scan slow
const AGENT_LINE_DIFF_MAX_FILES_PER_REPO = 20;
// the worker retains a session's own parsed lines (for the next scan's tail continuation) only while it is live, or one of its files changed within this long; a session neither live nor touched this recently is unlikely to change again soon, so its lines are built and thrown away rather than held in the worker's memory on the chance it does - the bound that keeps a first scan over every session in the 30 day window (hundreds of them, most long ended) from leaving the worker holding every one of their transcripts at once
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

/**
 * What one scan found for one vendor: fresh jobs to send the worker, and, for each session whose own
 * files all match the last successful scan's stat, the cached output from that scan, reused with no
 * read and no worker round trip.
 * - bytes_read: whole-file bytes actually read from disk this scan, before any tail-slicing;
 *   `vscode.workspace.fs` has no ranged read, so this is unaffected by incremental parsing and is
 *   reported alongside the (usually much smaller) bytes actually transferred to the worker
 * - live_status: the state each live session's vendor reports directly, by session id, applied to
 *   fresh and reused outputs alike; only Claude Code writes one
 */
interface DiscoveryResult {
    jobs: DiscoveredJob[];
    reused: AgentAnalyserWorkerSessionOutput[];
    bytes_read: number;
    live_status?: Map<string, ActivityState>;
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
interface LiveOverlay {
    live: boolean;
    status?: ActivityState;
}

// Claude Code's pid-file `status` values, mapped to the card's states; a value outside this table leaves the transcript's own reading in place
const CLAUDE_PID_STATUS_STATES: Readonly<Record<string, ActivityState>> = { busy: 'working', idle: 'idle', waiting: 'waiting' };

// one session's own write call, paired with its own timestamp: storiesForWriteCall answers which story it bound, but not when, which splitUsageByTurn needs to place a priced usage entry against the right turn
interface TimedWriteCall {
    at_ms: number;
    call: StoryBindingWriteCall;
}

// one repository's tree and its reflog, kept together only long enough for attributeTrees to consume the reflog's timestamps before they are discarded; `repository` survives into attributeTrees too, since line-diffing needs its rootUri and HEAD commit
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
    private scan_in_progress = false;
    // a trigger that landed while a scan was already running, so exactly one follow-up scan runs once this one ends rather than a second one starting on top of it
    private rescan_requested = false;
    private last_scan_ended_ms = 0;
    private worker: Worker | undefined;
    private worker_failures = 0;
    private readonly vendor_home: AgentVendorHome | undefined;
    private git_api: GitApi | undefined;
    private git_failure_logged = false;
    private readonly warned_unreadable = new Set<string>();
    // one entry per session still in the last successful scan's result, keyed by session_id: the file stat(s) that produced `output`, so the next scan can skip re-reading and re-parsing a session whose files are unchanged
    private readonly file_cache = new Map<string, { files: AgentFileIdentity[]; output: AgentAnalyserWorkerSessionOutput }>();
    // one bookmark per appendable file still being followed incrementally, keyed by `${session_id}\0${path}`; a file with no entry here is read whole the next time it changes
    private readonly tail_state = new Map<string, TailBookmark & { worker_generation: number }>();
    // bumped every time the worker instance is replaced (a fresh start or a post-crash restart), so a bookmark recorded under an earlier instance's own line cache is never trusted - that cache no longer exists, and trusting the bookmark would silently drop everything before it
    private worker_generation = 0;
    // session ids the last scan's pruneFileCache dropped, flushed onto the next AgentAnalyserWorkerRequest so the worker frees their cached lines too
    private pending_worker_evictions: string[] = [];
    // one entry per uncommitted file line-diffed at least once, keyed by `${root_path}\0${file_path}`, so an unchanged file's added/removed counts are reused rather than re-read and re-diffed every scan
    private readonly line_diff_cache = new Map<string, LineDiffCacheEntry>();
    private readonly watchers: vscode.FileSystemWatcher[] = [];
    private watch_debounce_timer: ReturnType<typeof setTimeout> | undefined;

    private state: ActivityAnalyserState = emptyAnalyserState('scanning');
    private sessions: HashMapOf<ActivitySessionState> = {};
    private trees: HashMapOf<ActivityTreeState> = {};
    private last_posted: string | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly worker_factory: () => Worker = () => new Worker(vscode.Uri.joinPath(context.extensionUri, 'client/extension/dist/agentAnalyserWorker.js').toString()),
    ) {
        this.vendor_home = context.logUri ? agentVendorHomeFrom(context.logUri.path) : undefined;
    }

    /** register a panel's demand for activity; the first demand starts the analyser */
    public demand(post: PostFn): void {
        this.subscribers.add(post);
        this.demand_count++;
        if (this.stop_timer !== undefined) { clearTimeout(this.stop_timer); this.stop_timer = undefined; }
        if (!this.running) { this.startRunning(); }
        else { post(this.currentMessage()); }
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

    private startRunning(): void {
        this.running = true;
        if (!this.vendor_home) {
            this.state = emptyAnalyserState('unavailable', 'This host has no local file access the analyser recognises (a web host, or an unrecognised user-data layout).');
            this.postToAll();
            return;
        }
        this.state = emptyAnalyserState('scanning');
        this.postToAll();
        this.armWatchers(this.vendor_home);
        this.scheduleScan(0);
    }

    private stopRunning(): void {
        this.running = false;
        if (this.rescan_timer !== undefined) { clearTimeout(this.rescan_timer); this.rescan_timer = undefined; }
        if (this.watch_debounce_timer !== undefined) { clearTimeout(this.watch_debounce_timer); this.watch_debounce_timer = undefined; }
        for (const watcher of this.watchers) { watcher.dispose(); }
        this.watchers.length = 0;
        if (this.worker) { writeToLogAtLevel('debug', 'stopRunning', 'agent analyser worker stopped'); }
        this.worker?.terminate();
        this.worker = undefined;
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
                // a host that cannot watch outside the workspace still has the poll; the scan just lands up to AGENT_RESCAN_INTERVAL_MS later
                writeToErrorLog('armWatchers', `agent activity watcher unavailable for ${glob.base}`, err);
            }
        }
    }

    private debounceScan(): void {
        if (this.watch_debounce_timer !== undefined) { clearTimeout(this.watch_debounce_timer); }
        this.watch_debounce_timer = setTimeout(() => {
            this.watch_debounce_timer = undefined;
            this.scheduleScan(0);
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
     * A scan that threw rather than returned. A first scan that never finishes would leave every panel
     * told the analyser is still scanning, its card banner and toolbar spinner with it, so it says failed
     * instead; a later scan that succeeds puts it back to live. The poll is re-armed either way, because
     * the success path is what normally re-arms it and one bad read must not be the analyser's last.
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
     * The single-flight guard: at most one scan runs at a time. Without it, a watcher-driven scan
     * starting while the previous one's discovery or worker round trip is still awaited shares this
     * instance's single `worker`/`worker_failures`/`onmessage` state with it, and the two corrupt each
     * other (a second `roundTripWorker` call overwrites the first's `onmessage`, so the first response
     * is silently discarded, and either scan's failure terminates the worker out from under the other).
     * A trigger that arrives mid-scan sets `rescan_requested` instead of starting a second scan; the
     * `finally` below runs exactly one follow-up once the current scan ends, no matter how many
     * triggers landed while it was busy.
     */
    private async runScan(): Promise<void> {
        if (!this.running || !this.vendor_home) { return; }
        if (this.scan_in_progress) { this.rescan_requested = true; return; }
        this.scan_in_progress = true;
        try {
            await this.runScanOnce(this.vendor_home);
        } finally {
            this.scan_in_progress = false;
            this.last_scan_ended_ms = Date.now();
            if (this.rescan_requested) {
                this.rescan_requested = false;
                this.scheduleScan(this.minScanDelayMs());
            }
        }
    }

    // the floor a queued follow-up scan waits from the moment the previous scan ended, so a constantly-changing file cannot drive back-to-back scans once unchanged files are cheap to skip
    private minScanDelayMs(): number {
        return Math.max(0, AGENT_MIN_SCAN_SPACING_MS - (Date.now() - this.last_scan_ended_ms));
    }

    private async runScanOnce(vendor_home: AgentVendorHome): Promise<void> {
        const scan_started_ms = Date.now();
        const now_ms = scan_started_ms;
        const window_start_ms = now_ms - AGENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const { jobs, reused, bytes_read, live_status } = await this.discoverJobs(now_ms, window_start_ms);
        const bytes_transferred = jobs.reduce((sum, job) => sum + job.transcript.bytes.byteLength + job.extra_files.reduce((s, f) => s + f.bytes.byteLength, 0), 0);
        // logged even when nothing was found at all, so "found nothing" is distinguishable from "never ran"; read/skipped breaks out how many of this scan's sessions were actually re-read versus reused unchanged from the last scan; bytes_read is whole-file disk reads (no ranged read is available), bytes_transferred is what incremental tail-slicing actually sent the worker, usually much smaller once a session is past its first scan
        writeToLogAtLevel('debug', 'runScan', `scanned ${vendor_home.claudeCode}, ${vendor_home.codex}, ${vendor_home.grok}: ${jobs.length + reused.length} session(s) (${jobs.length} read, ${reused.length} skipped), ${bytes_read} byte(s) read, ${bytes_transferred} byte(s) transferred, ${Date.now() - scan_started_ms}ms`);
        const response = await this.sendToWorker(jobs);
        if (!response) {
            if (this.worker_failures === 1) {
                // a worker crash is logged and restarted once: re-discover fresh bytes rather than resending the failed attempt's buffers, which postMessage has already transferred away
                this.scheduleScan(0);
                return;
            }
            // the restart also failed; keep whatever the last good scan knew rather than wiping the board, and fall back to the normal interval
            this.state = emptyAnalyserState('failed', 'The agent analyser worker crashed and its restart also failed.');
            this.postToAll();
            this.scheduleScan(AGENT_RESCAN_INTERVAL_MS);
            return;
        }
        this.updateFileCache(jobs, response.sessions);
        // the worker's own byte cap can evict a session this host still believes is cached (AgentAnalyserWorker.ts's enforceCacheByteCap); dropping its bookmark here, not just relying on the next reconcileCacheability pass, is what keeps a tail job from ever being sent against a cache that is already gone
        for (const session_id of response.evicted_session_ids ?? []) { this.evictTailStateFor(session_id); }
        // the cache keeps the transcript's own reading, so a fresh output takes the vendor's reported status here, as a reused one did in discovery
        const fresh = response.sessions.map(output => (output.state === 'ended' ? output : this.overlayLiveState(output, { live: true, status: live_status?.get(output.session_id) })));
        const merged: AgentAnalyserWorkerResponse = { request_id: response.request_id, sessions: [...fresh, ...reused] };
        this.pruneFileCache(merged.sessions);
        const previous_sessions = this.sessions;
        await this.foldResponse(merged, now_ms);
        this.logSessionChanges(previous_sessions, this.sessions);
        this.state = emptyAnalyserState('live');
        this.state.refusals = this.collectRefusals(merged);
        this.postToAll();
        if (this.running) { this.scheduleScan(AGENT_RESCAN_INTERVAL_MS); }
    }

    // records this scan's freshly-read sessions against the file identity that produced them, so an unchanged session is skipped on the next scan
    private updateFileCache(jobs: DiscoveredJob[], outputs: AgentAnalyserWorkerSessionOutput[]): void {
        for (let i = 0; i < jobs.length; i++) { this.file_cache.set(jobs[i].session_id, { files: jobs[i].identity, output: outputs[i] }); }
    }

    // a session neither freshly read nor reused this scan is gone (dropped out of the window, or its file was deleted); its cached identity and output are evicted rather than kept forever, and so is every tail bookmark it held - queued onto pending_worker_evictions so the worker frees its own cached lines on the next request rather than holding them for a session that no longer exists
    private pruneFileCache(sessions_seen: AgentAnalyserWorkerSessionOutput[]): void {
        const seen = new Set(sessions_seen.map(s => s.session_id));
        for (const session_id of this.file_cache.keys()) {
            if (seen.has(session_id)) { continue; }
            this.file_cache.delete(session_id);
            this.evictTailStateFor(session_id);
            this.pending_worker_evictions.push(session_id);
        }
    }

    private evictTailStateFor(session_id: string): void {
        const prefix = `${session_id}\u0000`;
        for (const key of this.tail_state.keys()) { if (key.startsWith(prefix)) { this.tail_state.delete(key); } }
    }

    // true when this session has at least one tail bookmark, the host's own proxy for "the worker is believed to be retaining this session's lines right now"
    private sessionTracked(session_id: string): boolean {
        const prefix = `${session_id}\u0000`;
        for (const key of this.tail_state.keys()) { if (key.startsWith(prefix)) { return true; } }
        return false;
    }

    // true when every one of this session's own files (transcript plus extras) matches the stat the last successful scan cached, so its output can be reused with no read and no worker round trip
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
        // going idle clears whatever tool call was last pending; working or waiting cannot fabricate one without re-reading, so it keeps the transcript's own
        return { ...output, state, current: state === 'idle' ? undefined : output.current };
    }

    // one line per session that appeared, bound to a story, or changed state since the previous scan; never one per transcript append, since a scan already folds a whole file's worth of appends into one before/after comparison
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

    private collectRefusals(response: AgentAnalyserWorkerResponse): ActivityRefusal[] {
        return response.sessions
            .filter(s => s.refusal)
            .map(s => ({ file: `${s.vendor} transcript for ${s.session_id.slice(0, 8)}`, code: s.refusal!.code, reason: s.refusal!.reason, session_id: s.session_id }));
    }

    // --- the worker round trip ---

    private async sendToWorker(jobs: DiscoveredJob[]): Promise<AgentAnalyserWorkerResponse | undefined> {
        // deduped: pruneFileCache and reconcileCacheability can both queue the same session_id in one scan (a session dropping out of the window is also, trivially, no longer cacheable)
        const evict_session_ids = [...new Set(this.pending_worker_evictions)];
        const request: AgentAnalyserWorkerRequest = {
            request_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            jobs,
            evict_session_ids: evict_session_ids.length > 0 ? evict_session_ids : undefined,
        };
        this.pending_worker_evictions = [];
        try {
            const response = await this.roundTripWorker(request);
            this.worker_failures = 0;
            return response;
        } catch (err) {
            this.worker_failures++;
            writeToErrorLog('sendToWorker', `agent analyser worker attempt ${this.worker_failures} failed`, err);
            this.worker?.terminate();
            this.worker = undefined;
            // this worker instance's own line cache is gone with it, so every bookmark recorded against this generation is stale as of now; the next discovery pass re-reads every appendable file whole rather than risk resuming against a cache that no longer exists - after a worker restart, state is rebuilt by a whole parse
            this.worker_generation++;
            return undefined;
        }
    }

    private roundTripWorker(request: AgentAnalyserWorkerRequest): Promise<AgentAnalyserWorkerResponse> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                try { this.worker = this.worker_factory(); writeToLogAtLevel('debug', 'roundTripWorker', 'agent analyser worker started'); }
                catch (err) { reject(err); return; }
            }
            const worker = this.worker;
            const timeout = setTimeout(() => reject(new Error('agent analyser worker timed out')), AGENT_WORKER_TIMEOUT_MS);
            // onmessage/onerror rather than addEventListener: every Worker implementation supports the property form, and it is the one a test double needs to implement
            worker.onmessage = (event: MessageEvent<AgentAnalyserWorkerResponse>): void => {
                if (event.data.request_id !== request.request_id) { return; }
                clearTimeout(timeout);
                worker.onmessage = null;
                resolve(event.data);
            };
            worker.onerror = (event: ErrorEvent): void => {
                clearTimeout(timeout);
                const inner = event.error instanceof Error ? event.error : new Error(event.message ?? 'agent analyser worker error');
                // filename/lineno are the ErrorEvent's own fields, not the inner Error's; attach them so the file log shows where the worker died instead of just its message
                reject(Object.assign(inner, { filename: event.filename, lineno: event.lineno }));
            };
            // every file's ArrayBuffer is listed as transferable, so postMessage moves ownership instead of structured-cloning a copy of a potentially large transcript
            worker.postMessage(request, this.transferListFor(request));
        });
    }

    private transferListFor(request: AgentAnalyserWorkerRequest): ArrayBuffer[] {
        const buffers: ArrayBuffer[] = [];
        for (const job of request.jobs) {
            buffers.push(job.transcript.bytes);
            for (const extra of job.extra_files) { buffers.push(extra.bytes); }
        }
        return buffers;
    }

    // --- folding the worker's answer with story binding and git state ---

    private async foldResponse(response: AgentAnalyserWorkerResponse, now_ms: number): Promise<void> {
        const story_docs = await this.readStoryDocuments();
        const reads = await this.readRepositoryTrees(now_ms);
        const sessions: HashMapOf<ActivitySessionState> = {};
        const write_calls_by_repo = new Map<string, AgentWriteCall[]>();
        const commit_calls_by_repo = new Map<string, AgentCommitCall[]>();
        for (const output of response.sessions) {
            const root = this.repositoryRootFor(output.cwd, reads);
            const write_calls: StoryBindingWriteCall[] = [];
            const timed_write_calls: TimedWriteCall[] = [];
            for (const call of output.calls) {
                if (call.is_commit) {
                    if (root) { (commit_calls_by_repo.get(root) ?? commit_calls_by_repo.set(root, []).get(root)!).push({ session_id: output.session_id, at_ms: Date.parse(call.at) }); }
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
                    if (!repo_relative.startsWith('..')) { (write_calls_by_repo.get(root) ?? write_calls_by_repo.set(root, []).get(root)!).push({ session_id: output.session_id, repo_relative_path: repo_relative, at_ms: Date.parse(call.at) }); }
                }
            }
            const stories = bindSessionToStory(write_calls, story_docs);
            sessions[output.session_id] = { root_path: root, session: this.toActivitySession(output, stories, timed_write_calls, story_docs) };
        }
        this.sessions = sessions;
        this.trees = await this.attributeTrees(reads, write_calls_by_repo, commit_calls_by_repo);
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
     * rather than merged by timestamp, so neither list is guaranteed chronological on arrival.
     */
    private splitUsageByTurn(
        priced_calls: ReadonlyArray<AgentPricedUsageEntry>,
        timed_write_calls: ReadonlyArray<TimedWriteCall>,
        story_docs: ReadonlyArray<StoryDocument>,
        stories: ReadonlyArray<ActivityStoryRef>,
    ): ActivityStoryUsage[] | undefined {
        if (stories.length === 0) { return undefined; }
        const edit_events = timed_write_calls
            .map(entry => ({ at_ms: entry.at_ms, stories: storiesForWriteCall(entry.call, story_docs) }))
            .filter(event => event.stories.length > 0)
            .sort((a, b) => a.at_ms - b.at_ms);
        if (edit_events.length === 0) {
            // unreachable in practice: `stories` is itself the union of every timed_write_calls entry's own storiesForWriteCall result (bindSessionToStory), so a non-empty `stories` means at least one edit_event exists too. Kept as a defensive fallback rather than an assumption a future caller relies on
            const earliest = priced_calls.reduce<string | undefined>((first, entry) => (first === undefined || Date.parse(entry.at) < Date.parse(first) ? entry.at : first), undefined);
            return this.splitUsageEvenly(priced_calls.reduce((total, entry) => addActivityUsage(total, entry.usage), emptyActivityUsage()), stories, earliest);
        }
        const key = (ref: ActivityStoryRef): string => `${ref.doc_path}\u0000${ref.id}`;
        const totals = new Map<string, ActivityUsage>();
        const first_at = new Map<string, string>();
        for (const entry of [...priced_calls].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
            const at_ms = Date.parse(entry.at);
            const governing = [...edit_events].reverse().find(event => event.at_ms <= at_ms) ?? edit_events[0];
            const share = this.divideUsage(entry.usage, governing.stories.length);
            for (const ref of governing.stories) {
                const k = key(ref);
                totals.set(k, addActivityUsage(totals.get(k) ?? emptyActivityUsage(), share));
                if (!first_at.has(k)) { first_at.set(k, entry.at); }
            }
        }
        return stories.map(story => ({ story, usage: totals.get(key(story)) ?? emptyActivityUsage(), first_at: first_at.get(key(story)) }));
    }

    // an even split of one usage total across every story, the shape splitUsageByTurn's defensive fallback needs when it has no per-call timeline to place usage against
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
        timed_write_calls: ReadonlyArray<TimedWriteCall>,
        story_docs: ReadonlyArray<StoryDocument>,
    ): ActivitySession {
        return {
            session_id: output.session_id,
            vendor: output.vendor,
            project: path.posix.basename(output.cwd) || output.cwd,
            story_binding: stories.length > 0 ? 'bound' : 'none',
            stories: stories.length > 0 ? stories : undefined,
            story_usage: this.splitUsageByTurn(output.priced_calls, timed_write_calls, story_docs, stories),
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

    private async attributeTrees(
        reads: HashMapOf<RepositoryRead>,
        write_calls_by_repo: Map<string, AgentWriteCall[]>,
        commit_calls_by_repo: Map<string, AgentCommitCall[]>,
    ): Promise<HashMapOf<ActivityTreeState>> {
        const attributed: HashMapOf<ActivityTreeState> = {};
        for (const [root_path, read] of Object.entries(reads)) {
            const attributed_uncommitted = attributeFilesToSessions(read.tree.uncommitted, write_calls_by_repo.get(root_path) ?? []);
            const uncommitted = await this.applyLineDiffs(root_path, read.repository, attributed_uncommitted);
            const committed = attributeCommitsToSessions(read.reflog, commit_calls_by_repo.get(root_path) ?? []);
            attributed[root_path] = { root_path, root_relative: read.root_relative, tree: { ...read.tree, uncommitted, committed } };
        }
        return attributed;
    }

    /**
     * Adds `added`/`removed` line counts to the uncommitted files this scan is willing to diff: every
     * file credited to a session, plus enough of the rest to reach `AGENT_LINE_DIFF_MAX_FILES_PER_REPO`
     * for this repository. A file left out of that selection, or one `lineDiffForFile` itself declines,
     * keeps `added`/`removed` off rather than publishing a guessed or partial count.
     */
    private async applyLineDiffs(root_path: string, repository: GitRepository, files: ActivityChangedFile[]): Promise<ActivityChangedFile[]> {
        this.pruneLineDiffCacheForRepo(root_path, files);
        const credited = files.filter(file => file.session_id !== undefined);
        const uncredited = files.filter(file => file.session_id === undefined);
        const extra_budget = Math.max(0, AGENT_LINE_DIFF_MAX_FILES_PER_REPO - credited.length);
        const to_diff = new Set([...credited, ...uncredited.slice(0, extra_budget)].map(file => file.path));
        return Promise.all(files.map(file => to_diff.has(file.path) ? this.lineDiffCached(root_path, repository, file) : file));
    }

    // the working-tree side's own mtime/size, the cache key's other half alongside the repository's HEAD commit; undefined for a deleted file, which has no working-tree side to stat, and undefined (declining this file for this scan) when the tree just listed a path stat can no longer find
    private async lineDiffIdentity(repository: GitRepository, file: ActivityChangedFile): Promise<{ mtime?: number; size?: number } | undefined> {
        if (file.change === 'deleted') { return {}; }
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(repository.rootUri, file.path));
            return { mtime: stat.mtime, size: stat.size };
        } catch {
            return undefined;
        }
    }

    private async lineDiffCached(root_path: string, repository: GitRepository, file: ActivityChangedFile): Promise<ActivityChangedFile> {
        const identity = await this.lineDiffIdentity(repository, file);
        if (!identity) { return file; }
        const head_commit = repository.state.HEAD?.commit ?? '';
        const key = `${root_path}\u0000${file.path}`;
        const cached = this.line_diff_cache.get(key);
        const unchanged = cached
            && cached.change === file.change
            && cached.previous_path === file.previous_path
            && cached.mtime === identity.mtime
            && cached.size === identity.size
            && cached.head_commit === head_commit;
        const result = unchanged ? cached.result : await lineDiffForFile(repository.rootUri, file);
        if (!unchanged) {
            this.line_diff_cache.set(key, { change: file.change, previous_path: file.previous_path, mtime: identity.mtime, size: identity.size, head_commit, result });
        }
        return result ? { ...file, added: result.added, removed: result.removed } : file;
    }

    // a file no longer in this repository's uncommitted band (committed, reverted, or dropped out of the selection this scan) has nothing left to invalidate it on a later reappearance, so its stale entry is dropped rather than kept forever
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

    // a story board lives at <project>/docstech/users/<username>/todo.md or done.md; every user's board is read, since any of them may be the session's own
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
        if (!this.vendor_home) { return { jobs: [], reused: [], bytes_read: 0 }; }
        const empty: DiscoveryResult = { jobs: [], reused: [], bytes_read: 0 };
        const [claude, codex, grok] = await Promise.all([
            this.discoverClaudeCode(this.vendor_home.claudeCode, now_ms, window_start_ms).catch(err => { writeToErrorLog('discoverJobs', 'claude-code discovery failed', err); return empty; }),
            this.discoverCodex(this.vendor_home.codex, now_ms, window_start_ms).catch(err => { writeToErrorLog('discoverJobs', 'codex discovery failed', err); return empty; }),
            this.discoverGrok(this.vendor_home.grok, now_ms, window_start_ms).catch(err => { writeToErrorLog('discoverJobs', 'grok discovery failed', err); return empty; }),
        ]);
        return {
            jobs: [...claude.jobs, ...codex.jobs, ...grok.jobs],
            reused: [...claude.reused, ...codex.reused, ...grok.reused],
            bytes_read: claude.bytes_read + codex.bytes_read + grok.bytes_read,
            live_status: claude.live_status,
        };
    }

    // the bytes stay a Uint8Array all the way to the worker; nothing in the extension host decodes a whole transcript, which is the point of running decode in the worker at all
    private async readBytes(uri: vscode.Uri): Promise<Uint8Array | undefined> {
        try { return await vscode.workspace.fs.readFile(uri); }
        catch { return undefined; }
    }

    // a session file this scan found by directory listing but could not then read; warned once per path, so a file stuck this way cannot fill a shipped NoteThink.log on every rescan
    private warnUnreadable(uri: vscode.Uri): void {
        if (this.warned_unreadable.has(uri.path)) { return; }
        this.warned_unreadable.add(uri.path);
        writeToLogAtLevel('warn', 'warnUnreadable', `listed but could not be read: ${uri.path}`);
    }

    private async statFile(uri: vscode.Uri): Promise<{ mtime: number; size: number } | undefined> {
        try { const stat = await vscode.workspace.fs.stat(uri); return { mtime: stat.mtime, size: stat.size }; }
        catch { return undefined; }
    }

    // a small, bounded text peek at the START of a file, for the host's own routing decisions (which cwd a job belongs to); never used to build the job the worker decodes and parses in full
    private peekText(bytes: Uint8Array, max_bytes: number): string {
        return new TextDecoder().decode(bytes.length > max_bytes ? bytes.subarray(0, max_bytes) : bytes);
    }

    private rawFile(path: string, bytes: Uint8Array, mode: 'whole' | 'tail' | 'none'): AgentAnalyserRawFile {
        return { path, bytes: bytes.slice().buffer as ArrayBuffer, mode };
    }

    private makeJob(vendor: AgentVendorId, session_id: string, cwd: string, vendor_live: boolean, transcript: AgentAnalyserRawFile, extra: AgentAnalyserRawFile[], now_ms: number, window_start_ms: number, identity: AgentFileIdentity[], cacheable: boolean): DiscoveredJob {
        return { vendor, session_id, cwd, vendor_live, now_ms, window_start_ms, transcript, extra_files: extra, identity, cacheable };
    }

    // the bytes of every extra file this session's identity names, read only once the session is known to need re-reading; a file listed but not readable (a race with its own writer) is silently dropped, the same tolerance the transcript itself gets via warnUnreadable
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

    private async discoverClaudeCode(home: string, now_ms: number, window_start_ms: number): Promise<DiscoveryResult> {
        const live = await this.claudeLiveSessions(home);
        const projects_uri = vscode.Uri.file(`${home}/projects`);
        let project_dirs: Array<[string, vscode.FileType]>;
        try { project_dirs = await vscode.workspace.fs.readDirectory(projects_uri); }
        catch { return { jobs: [], reused: [], bytes_read: 0 }; }
        const jobs: DiscoveredJob[] = [];
        const reused: AgentAnalyserWorkerSessionOutput[] = [];
        let bytes_read = 0;
        for (const [dir_name, type] of project_dirs) {
            if (type !== vscode.FileType.Directory || jobs.length + reused.length >= AGENT_FILE_STAT_MAX_ENTRIES) { continue; }
            const project_uri = vscode.Uri.joinPath(projects_uri, dir_name);
            let entries: Array<[string, vscode.FileType]>;
            try { entries = await vscode.workspace.fs.readDirectory(project_uri); }
            catch { continue; }
            for (const [file_name, entry_type] of entries) {
                if (entry_type !== vscode.FileType.File || !file_name.endsWith('.jsonl')) { continue; }
                // a session's own files are its main transcript plus every subagent transcript under it; any one of them changing means the whole session is re-parsed
                const session_id = file_name.slice(0, -'.jsonl'.length);
                const transcript_uri = vscode.Uri.joinPath(project_uri, file_name);
                const transcript_stat = await this.statFile(transcript_uri);
                if (transcript_stat === undefined || transcript_stat.mtime < window_start_ms) { continue; }
                const extra_identity = await this.claudeSubagentFileStats(project_uri, session_id);
                const transcript_identity: AgentFileIdentity = { path: transcript_uri.path, ...transcript_stat, appendable: true };
                const identity: AgentFileIdentity[] = [transcript_identity, ...extra_identity];
                const vendor_live = live.has(session_id);
                if (this.sessionUnchanged(session_id, identity)) {
                    this.reconcileCacheability(session_id, vendor_live, identity, now_ms);
                    reused.push(this.overlayLiveState(this.file_cache.get(session_id)!.output, { live: vendor_live, status: live.get(session_id)?.status }));
                    continue;
                }
                const bytes = await this.readBytes(transcript_uri);
                if (bytes === undefined) { this.warnUnreadable(transcript_uri); continue; }
                const cwd = live.get(session_id)?.cwd ?? this.guessCwd(bytes) ?? dir_name;
                const extra_read = await this.readExtraFileBytes(extra_identity);
                const cacheable = this.reconcileCacheability(session_id, vendor_live, identity, now_ms);
                const built = this.buildJobFiles(session_id, [{ identity: transcript_identity, bytes }, ...extra_read], cacheable);
                bytes_read += built.bytes_read;
                jobs.push(this.makeJob('claude-code', session_id, cwd, vendor_live, built.transcript, built.extra_files, now_ms, window_start_ms, identity, cacheable));
            }
        }
        const live_status = new Map<string, ActivityState>();
        for (const [session_id, entry] of live) {
            if (entry.status !== undefined) { live_status.set(session_id, entry.status); }
        }
        return { jobs, reused, bytes_read, live_status };
    }

    // `status` is the pid file's own `status` field mapped by CLAUDE_PID_STATUS_STATES, undefined for a value this analyser does not recognise
    private async claudeLiveSessions(home: string): Promise<Map<string, { cwd: string; status?: ActivityState }>> {
        const map = new Map<string, { cwd: string; status?: ActivityState }>();
        const sessions_uri = vscode.Uri.file(`${home}/sessions`);
        let entries: Array<[string, vscode.FileType]>;
        try { entries = await vscode.workspace.fs.readDirectory(sessions_uri); }
        catch { return map; }
        for (const [file_name, type] of entries) {
            if (type !== vscode.FileType.File || !file_name.endsWith('.json')) { continue; }
            // this per-session metadata file is small and host-only (never sent to the worker), so decoding it here is not the cost decode-in-the-worker exists to avoid
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

    // stats every subagent transcript under a session without reading any of them, so an unchanged session can be recognised (and skipped) before a single byte is read
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

    private async discoverCodex(home: string, now_ms: number, window_start_ms: number): Promise<DiscoveryResult> {
        const jobs: DiscoveredJob[] = [];
        const reused: AgentAnalyserWorkerSessionOutput[] = [];
        let bytes_read = 0;
        for (const date of this.datesInWindow(window_start_ms, now_ms)) {
            const day_uri = vscode.Uri.file(`${home}/sessions/${date}`);
            let entries: Array<[string, vscode.FileType]>;
            try { entries = await vscode.workspace.fs.readDirectory(day_uri); }
            catch { continue; }
            for (const [file_name, type] of entries) {
                if (type !== vscode.FileType.File || !file_name.endsWith('.jsonl')) { continue; }
                const uri = vscode.Uri.joinPath(day_uri, file_name);
                const stat = await this.statFile(uri);
                if (stat === undefined || stat.mtime < window_start_ms) { continue; }
                const session_id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file_name)?.[1] ?? file_name;
                // codex has no extra files, so its identity is just the rollout's own stat
                const identity: AgentFileIdentity = { path: uri.path, ...stat, appendable: true };
                // "live" is a pure clock check against the unchanged stat's own mtime, so it is recomputed every scan whether the session is reused or freshly read
                const vendor_live = now_ms - stat.mtime < 5 * 60 * 1000;
                if (this.sessionUnchanged(session_id, [identity])) {
                    this.reconcileCacheability(session_id, vendor_live, [identity], now_ms);
                    reused.push(this.overlayLiveState(this.file_cache.get(session_id)!.output, { live: vendor_live }));
                    continue;
                }
                const bytes = await this.readBytes(uri);
                if (bytes === undefined) { this.warnUnreadable(uri); continue; }
                const cwd = this.guessCwd(bytes) ?? '';
                const cacheable = this.reconcileCacheability(session_id, vendor_live, [identity], now_ms);
                const built = this.buildJobFiles(session_id, [{ identity, bytes }], cacheable);
                bytes_read += built.bytes_read;
                jobs.push(this.makeJob('codex', session_id, cwd, vendor_live, built.transcript, built.extra_files, now_ms, window_start_ms, [identity], cacheable));
            }
        }
        return { jobs, reused, bytes_read };
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

    private async discoverGrok(home: string, now_ms: number, window_start_ms: number): Promise<DiscoveryResult> {
        const live = await this.grokLiveSessionIds(home);
        const sessions_uri = vscode.Uri.file(`${home}/sessions`);
        let project_dirs: Array<[string, vscode.FileType]>;
        try { project_dirs = await vscode.workspace.fs.readDirectory(sessions_uri); }
        catch { return { jobs: [], reused: [], bytes_read: 0 }; }
        const jobs: DiscoveredJob[] = [];
        const reused: AgentAnalyserWorkerSessionOutput[] = [];
        let bytes_read = 0;
        for (const [encoded_cwd, type] of project_dirs) {
            if (type !== vscode.FileType.Directory) { continue; }
            const project_uri = vscode.Uri.joinPath(sessions_uri, encoded_cwd);
            let entries: Array<[string, vscode.FileType]>;
            try { entries = await vscode.workspace.fs.readDirectory(project_uri); }
            catch { continue; }
            const cwd = this.decodeUriComponentSafe(encoded_cwd);
            for (const [session_id, entry_type] of entries) {
                if (entry_type !== vscode.FileType.Directory) { continue; }
                const events_uri = vscode.Uri.joinPath(project_uri, session_id, 'events.jsonl');
                const events_stat = await this.statFile(events_uri);
                if (events_stat === undefined || events_stat.mtime < window_start_ms) { continue; }
                const usage_uri = vscode.Uri.joinPath(project_uri, session_id, 'usage.json');
                const usage_stat = await this.statFile(usage_uri);
                // events.jsonl is append-only and tail-sliceable; usage.json is rewritten whole each turn rather than appended, so it never carries a tail bookmark of its own
                const events_identity: AgentFileIdentity = { path: events_uri.path, ...events_stat, appendable: true };
                const identity: AgentFileIdentity[] = [events_identity, ...(usage_stat ? [{ path: usage_uri.path, ...usage_stat, appendable: false }] : [])];
                const vendor_live = live.has(session_id);
                if (this.sessionUnchanged(session_id, identity)) {
                    this.reconcileCacheability(session_id, vendor_live, identity, now_ms);
                    reused.push(this.overlayLiveState(this.file_cache.get(session_id)!.output, { live: vendor_live }));
                    continue;
                }
                const bytes = await this.readBytes(events_uri);
                if (bytes === undefined) { this.warnUnreadable(events_uri); continue; }
                const usage_identity = identity[1];
                const usage_read = usage_identity !== undefined ? await this.readExtraFileBytes([usage_identity]) : [];
                const cacheable = this.reconcileCacheability(session_id, vendor_live, identity, now_ms);
                const built = this.buildJobFiles(session_id, [{ identity: events_identity, bytes }, ...usage_read], cacheable);
                bytes_read += built.bytes_read;
                jobs.push(this.makeJob('grok', session_id, cwd, vendor_live, built.transcript, built.extra_files, now_ms, window_start_ms, identity, cacheable));
            }
        }
        return { jobs, reused, bytes_read };
    }

    private async grokLiveSessionIds(home: string): Promise<Set<string>> {
        // this per-host metadata file is small and host-only (never sent to the worker), so decoding it here is not the cost decode-in-the-worker exists to avoid
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

// re-derive session ids the worker could not read at all from the response, so the card can say N sessions could not be fully read rather than only the ones with a refusal object
export function unreadableIdsFrom(state: ActivityAnalyserState): string[] {
    return unreadableSessionIds(state.refusals);
}

export type { AgentVendorId };
