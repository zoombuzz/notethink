import * as vscode from 'vscode';
import { writeToLogAtLevel, writeToErrorLog } from '../lib/errorops';
import { parse } from '../lib/parseops';
import type { ParseWorkerRequest, ParseWorkerResponse } from './ParseWorker';
import type { Root as MdastRoot } from 'mdast';

// caps parallelism regardless of core count: load is already bounded by MAX_AGGREGATE_FILES, not hardware
const POOL_SIZE_CAP = 4;
// defensive backstop: supersede() keeps the real number of distinct queued keys far below this
const QUEUE_MAX_LENGTH = 512;
let queue_max_length_override: number | undefined;
// test-only: lets the overflow path be exercised without pushing hundreds of real jobs
export function setQueueMaxLengthForTest(length: number | undefined): void { queue_max_length_override = length; }
function queueMaxLength(): number { return queue_max_length_override ?? QUEUE_MAX_LENGTH; }

// half the reported cores, clamped to [1, POOL_SIZE_CAP]: leaves the other half of the machine free
function defaultPoolSize(): number {
    const hardware_concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const cores = hardware_concurrency && hardware_concurrency > 0 ? hardware_concurrency : 4;
    return Math.max(1, Math.min(POOL_SIZE_CAP, Math.floor(cores / 2)));
}

let request_sequence = 0;
function nextRequestId(): string { return `parse-${++request_sequence}`; }

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

interface PoolJob {
    key: string;
    text: string;
    resolve: (mdast: MdastRoot) => void;
    reject: (err: unknown) => void;
}

interface WorkerSlot {
    worker: Worker;
    current: PoolJob | undefined;
}

/**
 * A small pool of parse workers, spawned lazily up to `pool_size` and kept warm across calls, shared
 * per extension host. `key` identifies the doc being parsed: a newer parse for the same key supersedes
 * whatever older one is still queued or in flight (`supersede`), rather than race it to the caller.
 * Feature detection has no upfront `typeof Worker` check: the first `new Worker(...)` either succeeds
 * or throws, and `spawnSlot`'s own catch is what falls back to inline parsing - so a test can inject a
 * fake factory and exercise the real dispatch path with no `Worker` global present.
 */
export class ParsePool {
    private readonly slots: WorkerSlot[] = [];
    private readonly queue: PoolJob[] = [];
    // set once a worker fails to spawn at all; every later call falls back to inline parsing rather than retrying
    private spawn_failed = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly worker_factory: () => Worker = () => new Worker(vscode.Uri.joinPath(context.extensionUri, 'client/extension/dist/parseWorker.js').toString()),
        private readonly pool_size: number = defaultPoolSize(),
    ) {}

    /** Parse `text` off the host thread, keyed by `key`. Rejects with ParseStaleError if a later call for the same key arrives before this one settles. */
    public parse(key: string, text: string): Promise<MdastRoot> {
        if (this.spawn_failed) { return Promise.resolve(parse(text)); }
        this.supersede(key);
        return new Promise<MdastRoot>((resolve, reject) => {
            const job: PoolJob = { key, text, resolve, reject };
            if (this.queue.length >= queueMaxLength()) {
                // drop the oldest queued job: an overflow this deep means something is submitting far faster than usual
                this.queue.shift()?.reject(new Error('ParsePool: queue overflow'));
            }
            this.queue.push(job);
            this.pump();
        });
    }

    /** Stops every worker and rejects whatever is still queued; called once, on extension host deactivation. */
    public dispose(): void {
        for (const slot of this.slots) { this.terminateSlot(slot); }
        this.slots.length = 0;
        for (const job of this.queue) { job.reject(new Error('ParsePool: disposed')); }
        this.queue.length = 0;
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
    private freeSlot(): WorkerSlot | undefined {
        const idle = this.slots.find(slot => slot.current === undefined);
        if (idle) { return idle; }
        if (this.slots.length >= this.pool_size) { return undefined; }
        return this.spawnSlot();
    }

    private spawnSlot(): WorkerSlot | undefined {
        try {
            const worker = this.worker_factory();
            // proof-of-spawn for manual verification: a real worker vs. the inline fallback otherwise look identical from outside
            writeToLogAtLevel('debug', 'ParsePool', `spawned parse worker ${this.slots.length + 1}/${this.pool_size}`);
            const slot: WorkerSlot = { worker, current: undefined };
            this.slots.push(slot);
            return slot;
        } catch (err) {
            // spawning won't succeed retroactively in this host, so every future call falls back to inline parsing
            this.spawn_failed = true;
            writeToErrorLog('ParsePool', 'worker unavailable, falling back to inline parsing', err);
            this.drainQueueInline();
            return undefined;
        }
    }

    // resolves whatever was already queued inline, so a spawn failure mid-pump can't strand it
    private drainQueueInline(): void {
        const pending = this.queue.splice(0, this.queue.length);
        for (const job of pending) {
            try { job.resolve(parse(job.text)); }
            catch (err) { job.reject(err); }
        }
    }

    private dispatch(slot: WorkerSlot, job: PoolJob): void {
        slot.current = job;
        const worker = slot.worker;
        worker.onmessage = (event: MessageEvent<ParseWorkerResponse>): void => { this.settle(slot, event.data); };
        worker.onerror = (event: ErrorEvent): void => { this.recoverFromWorkerError(slot, event); };
        const request: ParseWorkerRequest = { request_id: nextRequestId(), text: job.text };
        worker.postMessage(request);
    }

    private settle(slot: WorkerSlot, response: ParseWorkerResponse): void {
        const job = slot.current;
        slot.current = undefined;
        if (job) {
            // resolve/reject on an already-superseded job is a harmless no-op: a settled promise ignores it
            if ('error' in response) { job.reject(new Error(response.error)); }
            else { job.resolve(response.mdast); }
        }
        this.pump();
    }

    // a crashed worker is replaced, never reused; its in-flight job still gets a real answer, computed inline
    private recoverFromWorkerError(slot: WorkerSlot, event: ErrorEvent): void {
        const job = slot.current;
        this.slots.splice(this.slots.indexOf(slot), 1);
        this.terminateSlot(slot);
        writeToErrorLog('ParsePool', 'parse worker crashed, falling back to inline parse for the in-flight job', event.error ?? new Error(event.message || 'parse worker error'));
        if (job) {
            try { job.resolve(parse(job.text)); }
            catch (err) { job.reject(err); }
        }
        this.pump();
    }

    private terminateSlot(slot: WorkerSlot): void {
        try { slot.worker.terminate(); }
        catch { /* already gone */ }
    }
}
