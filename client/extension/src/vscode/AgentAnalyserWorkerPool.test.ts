import { AgentAnalyserWorkerPool } from './AgentAnalyserWorkerPool';
import { handleAgentAnalyserRequest, type AgentAnalyserRawFile, type AgentAnalyserWorkerJob, type AgentAnalyserWorkerRequest, type AgentAnalyserWorkerResponse } from './AgentAnalyserWorker';

/**
 * Exercises `AgentAnalyserWorkerPool` directly, with a fake `Worker` standing in for the nested
 * thread: which session routes to which worker, how buckets merge, and worker spawn/crash
 * handling. `AgentAnalyser.ts`'s own batching and progressive posting are tested separately.
 */

function emptyFile(path = '/t.jsonl'): AgentAnalyserRawFile {
    return { path, bytes: new ArrayBuffer(0), mode: 'none' };
}

function jobFor(session_id: string): AgentAnalyserWorkerJob {
    return {
        vendor: 'claude-code',
        session_id,
        cwd: '/mnt/secure/home/alex/git/github.com/active_development/notethink',
        vendor_live: false,
        now_ms: Date.now(),
        window_start_ms: 0,
        transcript: emptyFile(),
        extra_files: [],
        cacheable: false,
    };
}

// answers via the real handler and records every request sent, so tests can trace worker-to-session
function recordingWorkerFactory(): { factory: () => Worker; workers: AgentAnalyserWorkerRequest[][] } {
    const workers: AgentAnalyserWorkerRequest[][] = [];
    const factory = (): Worker => {
        const own_requests: AgentAnalyserWorkerRequest[] = [];
        workers.push(own_requests);
        const worker = {
            onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
            onerror: null as ((event: ErrorEvent) => void) | null,
            postMessage: (message: AgentAnalyserWorkerRequest) => {
                own_requests.push(message);
                Promise.resolve().then(() => { worker.onmessage?.({ data: handleAgentAnalyserRequest(message) } as MessageEvent<AgentAnalyserWorkerResponse>); });
            },
            terminate: () => {},
        };
        return worker as unknown as Worker;
    };
    return { factory, workers };
}

// a fake Worker whose every postMessage fails, so a mid-request crash can be driven deterministically
function failingWorkerFactory(): { factory: () => Worker; terminate_calls: number } {
    let terminate_calls = 0;
    const factory = (): Worker => {
        const worker = {
            onmessage: null as ((event: MessageEvent<AgentAnalyserWorkerResponse>) => void) | null,
            onerror: null as ((event: ErrorEvent) => void) | null,
            postMessage: () => { Promise.resolve().then(() => { worker.onerror?.({ message: 'boom' } as ErrorEvent); }); },
            terminate: () => { terminate_calls++; },
        };
        return worker as unknown as Worker;
    };
    return { factory, get terminate_calls() { return terminate_calls; } };
}

describe('AgentAnalyserWorkerPool routing and merging', () => {
    it('spreads jobs across more than one worker when the pool is larger than one, and merges every bucket back into one response', async () => {
        const { factory, workers } = recordingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(factory, 4);
        const jobs = Array.from({ length: 20 }, (_, i) => jobFor(`s${i}`));
        const response = await pool.roundTrip({ request_id: 'r1', jobs });
        expect(response.request_id).toBe('r1');
        expect(response.sessions.map(s => s.session_id).sort()).toEqual(jobs.map(j => j.session_id).sort());
        // 20 ids across 4 buckets are vanishingly unlikely to collide into one; more than one worker should spawn
        expect(workers.length).toBeGreaterThan(1);
    });

    it('routes the same session id to the same worker instance on every round trip (sticky, for the tail cache)', async () => {
        const { factory, workers } = recordingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(factory, 4);
        const session_ids = ['a', 'b', 'c', 'd', 'e', 'f'];
        await pool.roundTrip({ request_id: 'r1', jobs: session_ids.map(jobFor) });
        await pool.roundTrip({ request_id: 'r2', jobs: session_ids.map(jobFor) });
        for (const session_id of session_ids) {
            const touched_worker_indices = workers
                .map((requests, index) => ({ index, touched: requests.some(request => request.jobs.some(job => job.session_id === session_id)) }))
                .filter(entry => entry.touched)
                .map(entry => entry.index);
            expect(touched_worker_indices).toHaveLength(1);
        }
    });

    it('a request with no jobs, evictions or line diffs still makes exactly one round trip', async () => {
        const { factory, workers } = recordingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(factory, 4);
        const response = await pool.roundTrip({ request_id: 'r1', jobs: [] });
        expect(response.sessions).toEqual([]);
        expect(workers).toHaveLength(1);
        expect(workers[0]).toHaveLength(1);
    });

    it('carries this pool\'s size on every bucket request, so each worker can size its own share of the tail cache', async () => {
        const { factory, workers } = recordingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(factory, 4);
        await pool.roundTrip({ request_id: 'r1', jobs: [jobFor('only-session')] });
        const sent = workers.flat();
        expect(sent).toHaveLength(1);
        expect(sent[0].pool_size).toBe(4);
    });

    it('routes evictions to the same bucket their session\'s jobs use, and a single line-diff job to bucket 0', async () => {
        const { factory, workers } = recordingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(factory, 4);
        const bucket_for_a = pool.bucketFor('a');
        await pool.roundTrip({ request_id: 'r1', jobs: [], evict_session_ids: ['a'], line_diff_jobs: [{ key: 'f.ts' }] });
        // each request's id carries its bucket index suffix, so this test can find requests by bucket
        const sent = workers.flat();
        const bucket_of = (request: AgentAnalyserWorkerRequest): number => Number(request.request_id.split('\u0000')[1]);
        const line_diff_request = sent.find(r => r.line_diff_jobs?.some(j => j.key === 'f.ts'));
        expect(line_diff_request).toBeDefined();
        // a single job's round-robin index (0) lands on bucket 0 - not sticky, just where it falls
        expect(bucket_of(line_diff_request!)).toBe(0);
        const eviction_request = sent.find(r => r.evict_session_ids?.includes('a'));
        expect(eviction_request).toBeDefined();
        expect(bucket_of(eviction_request!)).toBe(bucket_for_a);
    });

    // line-diff jobs have no session affinity, so round-robin spreads their cost across every bucket
    it('spreads a batch of line-diff jobs round-robin across every bucket, not all onto bucket 0', async () => {
        const { factory, workers } = recordingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(factory, 4);
        const line_diff_jobs = Array.from({ length: 8 }, (_, i) => ({ key: `f${i}.ts` }));
        await pool.roundTrip({ request_id: 'r1', jobs: [], line_diff_jobs });
        const sent = workers.flat();
        const bucket_of = (request: AgentAnalyserWorkerRequest): number => Number(request.request_id.split('\u0000')[1]);
        // round-robin over 4 buckets: each gets its own request of exactly 2 of the 8 jobs
        const requests_with_line_diffs = sent.filter(r => r.line_diff_jobs && r.line_diff_jobs.length > 0);
        expect(requests_with_line_diffs).toHaveLength(4);
        for (const request of requests_with_line_diffs) { expect(request.line_diff_jobs).toHaveLength(2); }
        expect(new Set(requests_with_line_diffs.map(bucket_of))).toEqual(new Set([0, 1, 2, 3]));
        // all 8 keys still accounted for, just spread across 4 requests instead of one
        const all_keys = requests_with_line_diffs.flatMap(r => r.line_diff_jobs!.map(j => j.key));
        expect(new Set(all_keys)).toEqual(new Set(line_diff_jobs.map(j => j.key)));
    });

    it('falls back to running a request inline when no worker can ever be spawned', async () => {
        const pool = new AgentAnalyserWorkerPool(() => { throw new Error('no Worker support on this host'); }, 2);
        const response = await pool.roundTrip({ request_id: 'r1', jobs: [jobFor('a'), jobFor('b')] });
        expect(response.sessions.map(s => s.session_id).sort()).toEqual(['a', 'b']);
    });

    it('rejects the whole round trip when any one bucket\'s worker crashes, so the caller retries the whole scan rather than trusting a partial merge', async () => {
        const failing = failingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(failing.factory, 1);
        await expect(pool.roundTrip({ request_id: 'r1', jobs: [jobFor('a')] })).rejects.toThrow();
    });

    it('resetAll terminates every spawned worker and forgets them, so the next round trip spawns fresh instances', async () => {
        const { factory, workers } = recordingWorkerFactory();
        const pool = new AgentAnalyserWorkerPool(factory, 1);
        await pool.roundTrip({ request_id: 'r1', jobs: [jobFor('a')] });
        expect(workers).toHaveLength(1);
        pool.resetAll();
        await pool.roundTrip({ request_id: 'r2', jobs: [jobFor('a')] });
        expect(workers).toHaveLength(2);
    });

    it('times out a bucket that never answers, so the caller is not left awaiting a round trip forever', async () => {
        jest.useFakeTimers();
        try {
            const factory = (): Worker => ({
                onmessage: null,
                onerror: null,
                postMessage: () => { /* never answers */ },
                terminate: () => {},
            } as unknown as Worker);
            const pool = new AgentAnalyserWorkerPool(factory, 1);
            const round_trip = pool.roundTrip({ request_id: 'r1', jobs: [jobFor('a')] });
            const assertion = expect(round_trip).rejects.toThrow('agent analyser worker timed out');
            await jest.advanceTimersByTimeAsync(20_000);
            await assertion;
        } finally {
            jest.useRealTimers();
        }
    });
});
