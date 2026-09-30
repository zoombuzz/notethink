import { writeToErrorLog, writeToLogAtLevel } from '../lib/errorops';
import { handleAgentAnalyserRequest, type AgentAnalyserWorkerJob, type AgentAnalyserWorkerRequest, type AgentAnalyserWorkerResponse, type AgentLineDiffJob } from './AgentAnalyserWorker';

// a batch unanswered this long is treated as a crash
const AGENT_WORKER_TIMEOUT_MS = 20_000;
// half the reported cores, floored at 1: leaves room for everything else a scan competes with
const AGENT_WORKER_POOL_SIZE_CAP = 4;

// half the reported cores, never below 1 nor above AGENT_WORKER_POOL_SIZE_CAP
export function defaultAgentAnalyserPoolSize(): number {
    const hardware_concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const cores = hardware_concurrency && hardware_concurrency > 0 ? hardware_concurrency : 4;
    return Math.max(1, Math.min(AGENT_WORKER_POOL_SIZE_CAP, Math.floor(cores / 2)));
}

// djb2 hash, used only to pick a worker bucket - collisions across session ids are harmless here
function hashSessionId(id: string): number {
    let hash = 5381;
    for (let i = 0; i < id.length; i++) { hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0; }
    return hash >>> 0;
}

interface Bucket {
    jobs: AgentAnalyserWorkerJob[];
    evict_session_ids: string[];
    line_diff_jobs: AgentLineDiffJob[];
}

/**
 * A pool of up to `pool_size` nested `AgentAnalyserWorker.ts` instances, sharing scan work across
 * cores. Routing is STICKY: each session id always hashes to the same worker index, because a
 * worker's tail cache is per-instance and only helps if the same instance handles that session every
 * time. `line_diff_jobs` carry no session id, so they spread round-robin instead. Workers spawn
 * lazily, one per bucket on first use, and a round trip that fails on any bucket resets every worker
 * so the caller resends the whole scan.
 */
export class AgentAnalyserWorkerPool {
    private readonly slots: Array<Worker | undefined>;
    // true once a worker fails to spawn at all; every bucket then runs inline rather than retry a spawn unlikely to succeed
    private spawn_failed = false;

    constructor(
        private readonly worker_factory: () => Worker,
        public readonly pool_size: number = defaultAgentAnalyserPoolSize(),
    ) {
        this.slots = new Array(Math.max(1, pool_size)).fill(undefined);
    }

    // the worker index this session always routes to, so a tail job reaches the instance holding its cache
    public bucketFor(session_id: string): number {
        return hashSessionId(session_id) % this.slots.length;
    }

    /**
     * One logical request, partitioned by session id across the buckets it touches, dispatched in
     * parallel, and merged into one response. Throws (never resolves to undefined) on any bucket's
     * failure, so callers can handle it the same way as an unpooled round trip.
     */
    public async roundTrip(request: AgentAnalyserWorkerRequest): Promise<AgentAnalyserWorkerResponse> {
        const buckets = new Map<number, Bucket>();
        const ensure = (index: number): Bucket => {
            const existing = buckets.get(index);
            if (existing) { return existing; }
            const created: Bucket = { jobs: [], evict_session_ids: [], line_diff_jobs: [] };
            buckets.set(index, created);
            return created;
        };
        for (const job of request.jobs) { ensure(this.bucketFor(job.session_id)).jobs.push(job); }
        for (const session_id of request.evict_session_ids ?? []) { ensure(this.bucketFor(session_id)).evict_session_ids.push(session_id); }
        // round-robin, not bucketFor: a line-diff job has no session id to hash and needs no affinity
        (request.line_diff_jobs ?? []).forEach((job, i) => ensure(i % this.slots.length).line_diff_jobs.push(job));
        // an empty request still makes one round trip, so a worker failure is caught even with nothing to read
        if (buckets.size === 0) { ensure(0); }
        const bucket_indices = [...buckets.keys()];
        const responses = await Promise.all(bucket_indices.map(index => this.roundTripBucket(index, {
            request_id: `${request.request_id}\u0000${index}`,
            jobs: buckets.get(index)!.jobs,
            evict_session_ids: buckets.get(index)!.evict_session_ids.length > 0 ? buckets.get(index)!.evict_session_ids : undefined,
            line_diff_jobs: buckets.get(index)!.line_diff_jobs.length > 0 ? buckets.get(index)!.line_diff_jobs : undefined,
            pool_size: this.slots.length,
        })));
        return this.mergeResponses(request.request_id, responses);
    }

    private mergeResponses(request_id: string, responses: AgentAnalyserWorkerResponse[]): AgentAnalyserWorkerResponse {
        const sessions = responses.flatMap(response => response.sessions);
        const evicted_session_ids = [...new Set(responses.flatMap(response => response.evicted_session_ids ?? []))];
        const line_diff_results = responses.flatMap(response => response.line_diff_results ?? []);
        return {
            request_id,
            sessions,
            evicted_session_ids: evicted_session_ids.length > 0 ? evicted_session_ids : undefined,
            line_diff_results: line_diff_results.length > 0 ? line_diff_results : undefined,
        };
    }

    private async roundTripBucket(bucket: number, request: AgentAnalyserWorkerRequest): Promise<AgentAnalyserWorkerResponse> {
        if (this.spawn_failed) { return handleAgentAnalyserRequest(request); }
        let worker = this.slots[bucket];
        if (!worker) {
            try {
                worker = this.worker_factory();
                this.slots[bucket] = worker;
                writeToLogAtLevel('debug', 'AgentAnalyserWorkerPool', `spawned agent analyser worker for bucket ${bucket + 1}/${this.slots.length}`);
            } catch (err) {
                // spawning won't succeed retroactively: stop trying, and fall back to running every bucket inline from now on
                this.spawn_failed = true;
                writeToErrorLog('AgentAnalyserWorkerPool', 'worker unavailable, falling back to inline agent analysis', err);
                return handleAgentAnalyserRequest(request);
            }
        }
        return this.postToWorker(worker, request);
    }

    private postToWorker(worker: Worker, request: AgentAnalyserWorkerRequest): Promise<AgentAnalyserWorkerResponse> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('agent analyser worker timed out')), AGENT_WORKER_TIMEOUT_MS);
            // onmessage/onerror, not addEventListener: the property form every Worker impl (and test double) supports
            worker.onmessage = (event: MessageEvent<AgentAnalyserWorkerResponse>): void => {
                if (event.data.request_id !== request.request_id) { return; }
                clearTimeout(timeout);
                worker.onmessage = null;
                resolve(event.data);
            };
            worker.onerror = (event: ErrorEvent): void => {
                clearTimeout(timeout);
                const inner = event.error instanceof Error ? event.error : new Error(event.message ?? 'agent analyser worker error');
                // filename/lineno belong to the ErrorEvent, not the inner Error; attach them so the log shows where the worker died
                reject(Object.assign(inner, { filename: event.filename, lineno: event.lineno }));
            };
            // transferable ArrayBuffers move, not copy; line_diff_jobs stay behind so a retry can reuse them
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

    // terminates every spawned worker so the next round trip spawns fresh ones with empty caches
    public resetAll(): void {
        for (let i = 0; i < this.slots.length; i++) {
            const worker = this.slots[i];
            if (!worker) { continue; }
            try { worker.terminate(); } catch { /* already gone */ }
            this.slots[i] = undefined;
        }
    }

    public dispose(): void {
        this.resetAll();
    }
}
