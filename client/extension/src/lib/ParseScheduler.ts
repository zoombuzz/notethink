/**
 * The scheduling core both parse pools share: the extension host's ParsePool and the webview's folder
 * parse pool. It owns lazy worker slots, the FIFO queue, pump/free-slot/spawn/dispatch, supersession by
 * key, queue overflow, inline fallback, crash recovery and disposal. It imports nothing runtime-specific
 * (no VS Code, no DOM, no logger), so each webpack bundle compiles its own copy of this one source.
 * Each adapter injects what differs: worker construction, request encoding, response matching and
 * decoding, the inline parse, and event logging. Every promise `submit` returns settles: with a result,
 * a ParseStaleError (superseded), an overflow error (evicted), a disposal error, or the inline parse's own error.
 */

// caps parallelism regardless of core count: load is already bounded by the aggregate file cap, not hardware
const POOL_SIZE_CAP = 4;
// defensive backstop: supersession keeps the real number of distinct queued keys far below this
export const DEFAULT_QUEUE_MAX_LENGTH = 512;

/** Half the reported cores, clamped to [1, POOL_SIZE_CAP]: leaves the other half of the machine free. */
export function defaultParsePoolSize(): number {
    const hardware_concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const cores = hardware_concurrency && hardware_concurrency > 0 ? hardware_concurrency : 4;
    return Math.max(1, Math.min(POOL_SIZE_CAP, Math.floor(cores / 2)));
}

/**
 * Thrown when a queued or in-flight parse is superseded by a newer request for the same key.
 * `isParseStaleError` lets callers log a superseded re-parse at debug level, not as an error.
 */
export class ParseStaleError extends Error {
    constructor(public readonly key: string) {
        super(`parse for ${key} superseded by a newer request before it settled`);
        this.name = 'ParseStaleError';
    }
}

export function isParseStaleError(err: unknown): err is ParseStaleError {
    return err instanceof ParseStaleError;
}

/**
 * What a scheduler reports to its adapter's logger.
 * - spawned: a worker slot was created (slot_count of pool_size now exist)
 * - spawn_failed: no worker can be created here, so every later job parses inline
 * - worker_crashed: a worker raised an error; its slot is replaced and its in-flight job parsed inline
 */
export type ParseSchedulerEvent =
    | { kind: 'spawned'; slot_count: number; pool_size: number }
    | { kind: 'spawn_failed'; error: unknown }
    | { kind: 'worker_crashed'; error: unknown };

/**
 * The adapter's side of the contract.
 * - createWorker: constructs one worker; throwing marks workers unavailable for good
 * - buildRequest: encodes a job's input as the message posted to the worker
 * - matchesRequest: optional; false ignores a response that does not belong to the job in flight
 * - decodeResponse: turns a worker response into the result, throwing for an error response
 * - parseInline: the synchronous parse used when workers are unavailable or one crashes
 * - onEvent: optional logging sink
 */
export interface ParseSchedulerHooks<Input, Result, Request, Response> {
    createWorker: () => Worker;
    buildRequest: (input: Input) => Request;
    matchesRequest?: (request: Request, response: Response) => boolean;
    decodeResponse: (response: Response) => Result;
    parseInline: (input: Input) => Result;
    onEvent?: (event: ParseSchedulerEvent) => void;
}

export interface ParseSchedulerOptions {
    pool_size?: number;
    queue_max_length?: number;
}

interface SchedulerJob<Input, Result> {
    key: string | undefined;
    input: Input;
    settled: boolean;
    resolve: (result: Result) => void;
    reject: (err: unknown) => void;
}

interface WorkerSlot<Input, Result, Request> {
    worker: Worker;
    current: SchedulerJob<Input, Result> | undefined;
    current_request: Request | undefined;
}

export class ParseScheduler<Input, Result, Request, Response> {
    private readonly slots: Array<WorkerSlot<Input, Result, Request>> = [];
    private readonly queue: Array<SchedulerJob<Input, Result>> = [];
    // set once a worker fails to spawn at all; every later call parses inline rather than retrying
    private spawn_failed = false;
    private disposed = false;
    private readonly pool_size: number;
    private readonly queue_max_length: number;

    constructor(
        private readonly hooks: ParseSchedulerHooks<Input, Result, Request, Response>,
        options: ParseSchedulerOptions = {},
    ) {
        this.pool_size = options.pool_size ?? defaultParsePoolSize();
        this.queue_max_length = options.queue_max_length ?? DEFAULT_QUEUE_MAX_LENGTH;
    }

    /**
     * Parses `input` off-thread when a slot is available, inline once workers are unavailable. A `key`
     * makes a newer submit for the same key supersede an older queued or in-flight one (ParseStaleError);
     * without a key a job is never superseded.
     */
    public submit(input: Input, key?: string): Promise<Result> {
        if (this.disposed) { return Promise.reject(new Error('ParseScheduler: disposed')); }
        if (this.spawn_failed) { return this.inline(input); }
        if (key !== undefined) { this.supersede(key); }
        return new Promise<Result>((resolve, reject) => {
            const job: SchedulerJob<Input, Result> = {
                key,
                input,
                settled: false,
                resolve: (result) => { job.settled = true; resolve(result); },
                reject: (err) => { job.settled = true; reject(err); },
            };
            if (this.queue.length >= this.queue_max_length) {
                // drop the oldest queued job: an overflow this deep means something is submitting far faster than usual
                this.queue.shift()?.reject(new Error('ParseScheduler: queue overflow'));
            }
            this.queue.push(job);
            this.pump();
        });
    }

    /** Stops every worker and rejects everything queued or in flight; called once, at the owning runtime's teardown. */
    public dispose(): void {
        this.disposed = true;
        for (const slot of this.slots) {
            this.terminateSlot(slot);
            slot.current?.reject(new Error('ParseScheduler: disposed'));
            slot.current = undefined;
        }
        this.slots.length = 0;
        for (const job of this.queue) { job.reject(new Error('ParseScheduler: disposed')); }
        this.queue.length = 0;
    }

    private inline(input: Input): Promise<Result> {
        try { return Promise.resolve(this.hooks.parseInline(input)); }
        catch (err) { return Promise.reject(err); }
    }

    // settles a job inline unless it already settled (a superseded job needs no parse nobody will read)
    private settleInline(job: SchedulerJob<Input, Result>): void {
        if (job.settled) { return; }
        try { job.resolve(this.hooks.parseInline(job.input)); }
        catch (err) { job.reject(err); }
    }

    // rejects any older job sharing this key: a queued one is dropped, an in-flight one's eventual answer becomes a no-op
    private supersede(key: string): void {
        for (let i = this.queue.length - 1; i >= 0; i--) {
            if (this.queue[i].key === key) { this.queue.splice(i, 1)[0].reject(new ParseStaleError(key)); }
        }
        for (const slot of this.slots) {
            if (slot.current?.key === key) { slot.current.reject(new ParseStaleError(key)); }
        }
    }

    private pump(): void {
        while (this.queue.length > 0) {
            const slot = this.freeSlot();
            if (!slot) { return; }
            this.dispatch(slot, this.queue.shift()!);
        }
    }

    // an idle slot, or a freshly spawned one while under pool_size; undefined once every slot is busy or spawning has failed
    private freeSlot(): WorkerSlot<Input, Result, Request> | undefined {
        const idle = this.slots.find((slot) => slot.current === undefined);
        if (idle) { return idle; }
        if (this.slots.length >= this.pool_size) { return undefined; }
        return this.spawnSlot();
    }

    private spawnSlot(): WorkerSlot<Input, Result, Request> | undefined {
        try {
            const worker = this.hooks.createWorker();
            const slot: WorkerSlot<Input, Result, Request> = { worker, current: undefined, current_request: undefined };
            this.slots.push(slot);
            this.hooks.onEvent?.({ kind: 'spawned', slot_count: this.slots.length, pool_size: this.pool_size });
            return slot;
        } catch (err) {
            // spawning won't succeed retroactively here, so every future call parses inline and the queue drains now
            this.spawn_failed = true;
            this.hooks.onEvent?.({ kind: 'spawn_failed', error: err });
            this.drainQueueInline();
            return undefined;
        }
    }

    // settles whatever was already queued inline, so a spawn failure mid-pump can't strand it
    private drainQueueInline(): void {
        const pending = this.queue.splice(0, this.queue.length);
        for (const job of pending) { this.settleInline(job); }
    }

    private dispatch(slot: WorkerSlot<Input, Result, Request>, job: SchedulerJob<Input, Result>): void {
        let request: Request;
        try { request = this.hooks.buildRequest(job.input); }
        catch (err) { job.reject(err); return; }
        slot.current = job;
        slot.current_request = request;
        const worker = slot.worker;
        worker.onmessage = (event: MessageEvent<Response>): void => { this.settle(slot, event.data); };
        worker.onerror = (event: ErrorEvent): void => { this.recoverFromWorkerError(slot, event); };
        try { worker.postMessage(request); }
        catch (err) { this.recoverFromWorkerError(slot, { error: err, message: String(err) } as ErrorEvent); }
    }

    private settle(slot: WorkerSlot<Input, Result, Request>, response: Response): void {
        const job = slot.current;
        // a response for some other request (a stale reply on a reused worker) leaves the job in flight
        if (job && this.hooks.matchesRequest && !this.hooks.matchesRequest(slot.current_request as Request, response)) { return; }
        slot.current = undefined;
        slot.current_request = undefined;
        if (job) {
            // resolve/reject on an already-superseded job is a harmless no-op: a settled promise ignores it
            try { job.resolve(this.hooks.decodeResponse(response)); }
            catch (err) { job.reject(err); }
        }
        this.pump();
    }

    // a crashed worker is replaced, never reused; its in-flight job still gets a real answer, computed inline
    private recoverFromWorkerError(slot: WorkerSlot<Input, Result, Request>, event: ErrorEvent): void {
        const index = this.slots.indexOf(slot);
        if (index === -1) { return; }
        const job = slot.current;
        slot.current = undefined;
        this.slots.splice(index, 1);
        this.terminateSlot(slot);
        this.hooks.onEvent?.({ kind: 'worker_crashed', error: event.error ?? new Error(event.message || 'parse worker error') });
        if (job) { this.settleInline(job); }
        this.pump();
    }

    private terminateSlot(slot: WorkerSlot<Input, Result, Request>): void {
        try { slot.worker.terminate(); }
        catch { /* already gone */ }
    }
}
