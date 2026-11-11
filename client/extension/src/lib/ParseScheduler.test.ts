import { DEFAULT_QUEUE_MAX_LENGTH, ParseScheduler, defaultParsePoolSize, isParseStaleError, type ParseSchedulerEvent } from './ParseScheduler';

/**
 * The scheduler is runtime-neutral, so these cases drive it with plain worker doubles and a trivial
 * request/response protocol: the request is `{ id, text }` and the answer echoes the text upper-cased.
 */

interface Req { id: number; text: string }
interface Res { id: number; value?: string; error?: string }

class DoubleWorker {
    onmessage: ((event: MessageEvent<Res>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    posted: Req[] = [];
    constructor(private readonly on_post: (worker: DoubleWorker, request: Req) => void) {}
    postMessage(request: Req): void { this.posted.push(request); this.on_post(this, request); }
    terminate(): void { this.terminated = true; }
    answer(response: Res): void { this.onmessage?.({ data: response } as MessageEvent<Res>); }
    crash(): void { this.onerror?.({ message: 'boom' } as ErrorEvent); }
}

interface SchedulerHarness {
    scheduler: ParseScheduler<string, string, Req, Res>;
    workers: DoubleWorker[];
    events: ParseSchedulerEvent[];
}

function makeScheduler(options: {
    on_post?: (worker: DoubleWorker, request: Req) => void;
    create?: () => DoubleWorker;
    pool_size?: number;
    queue_max_length?: number;
    match?: boolean;
}): SchedulerHarness {
    const workers: DoubleWorker[] = [];
    const events: ParseSchedulerEvent[] = [];
    let next_id = 0;
    const on_post = options.on_post ?? ((worker, request) => { Promise.resolve().then(() => worker.answer({ id: request.id, value: request.text.toUpperCase() })); });
    const scheduler = new ParseScheduler<string, string, Req, Res>({
        createWorker: () => {
            const worker = options.create ? options.create() : new DoubleWorker(on_post);
            workers.push(worker);
            return worker as unknown as Worker;
        },
        buildRequest: (text) => ({ id: ++next_id, text }),
        matchesRequest: options.match ? (request, response) => response.id === request.id : undefined,
        decodeResponse: (response) => {
            if (response.error !== undefined) { throw new Error(response.error); }
            return response.value!;
        },
        parseInline: (text) => `inline:${text}`,
        onEvent: (event) => events.push(event),
    }, { pool_size: options.pool_size ?? 1, queue_max_length: options.queue_max_length });
    return { scheduler, workers, events };
}

describe('ParseScheduler', () => {
    it('resolves a job through a worker and reuses the worker for later jobs', async () => {
        const { scheduler, workers, events } = makeScheduler({});
        expect(await scheduler.submit('a')).toBe('A');
        expect(await scheduler.submit('b')).toBe('B');
        expect(workers).toHaveLength(1);
        expect(events).toEqual([{ kind: 'spawned', slot_count: 1, pool_size: 1 }]);
    });

    it('spawns up to pool_size workers under concurrent load and queues the rest', async () => {
        const { scheduler, workers } = makeScheduler({ pool_size: 2 });
        const results = await Promise.all([scheduler.submit('a'), scheduler.submit('b'), scheduler.submit('c')]);
        expect(results).toEqual(['A', 'B', 'C']);
        expect(workers).toHaveLength(2);
    });

    it('rejects when the worker answers with an error, and still serves a later job', async () => {
        let fail_next = true;
        const { scheduler } = makeScheduler({
            on_post: (worker, request) => {
                const error = fail_next ? 'bad' : undefined;
                fail_next = false;
                Promise.resolve().then(() => worker.answer({ id: request.id, value: request.text, error }));
            },
        });
        await expect(scheduler.submit('a')).rejects.toThrow('bad');
        expect(await scheduler.submit('b')).toBe('b');
    });

    it('falls back to inline for every job after a spawn failure, trying the factory once, and drains the queue', async () => {
        let attempts = 0;
        const { scheduler, events } = makeScheduler({ create: () => { attempts++; throw new Error('no workers here'); }, pool_size: 1 });
        const results = await Promise.all([scheduler.submit('a'), scheduler.submit('b'), scheduler.submit('c')]);
        expect(results).toEqual(['inline:a', 'inline:b', 'inline:c']);
        expect(await scheduler.submit('d')).toBe('inline:d');
        expect(attempts).toBe(1);
        expect(events.map((event) => event.kind)).toEqual(['spawn_failed']);
    });

    it('settles the in-flight job inline when its worker crashes, replaces the slot and completes later jobs', async () => {
        let crash_next = true;
        const { scheduler, workers, events } = makeScheduler({
            on_post: (worker, request) => {
                if (crash_next) { crash_next = false; Promise.resolve().then(() => worker.crash()); }
                else { Promise.resolve().then(() => worker.answer({ id: request.id, value: request.text.toUpperCase() })); }
            },
        });
        const crashed = scheduler.submit('a');
        const queued = scheduler.submit('b');
        expect(await crashed).toBe('inline:a');
        expect(await queued).toBe('B');
        expect(workers).toHaveLength(2);
        expect(workers[0].terminated).toBe(true);
        expect(events.map((event) => event.kind)).toEqual(['spawned', 'worker_crashed', 'spawned']);
    });

    it('rejects with the inline error when a crashed job cannot be parsed inline either', async () => {
        const worker_events: ParseSchedulerEvent[] = [];
        const scheduler = new ParseScheduler<string, string, Req, Res>({
            createWorker: () => new DoubleWorker((worker) => { Promise.resolve().then(() => worker.crash()); }) as unknown as Worker,
            buildRequest: (text) => ({ id: 1, text }),
            decodeResponse: (response) => response.value!,
            parseInline: () => { throw new Error('inline failed'); },
            onEvent: (event) => worker_events.push(event),
        }, { pool_size: 1 });
        await expect(scheduler.submit('a')).rejects.toThrow('inline failed');
    });

    it('ignores a response that does not match the request in flight until the matching one arrives', async () => {
        let held: DoubleWorker | undefined;
        let held_request: Req | undefined;
        const { scheduler } = makeScheduler({ match: true, on_post: (worker, request) => { held = worker; held_request = request; } });
        const outcome = scheduler.submit('a');
        let settled = false;
        void outcome.then(() => { settled = true; });
        held!.answer({ id: 999, value: 'STALE' });
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);
        held!.answer({ id: held_request!.id, value: 'A' });
        expect(await outcome).toBe('A');
    });

    it('supersedes a queued and an in-flight job for the same key, and every promise settles', async () => {
        const held: Array<() => void> = [];
        const { scheduler } = makeScheduler({
            on_post: (worker, request) => { held.push(() => worker.answer({ id: request.id, value: request.text.toUpperCase() })); },
        });
        const in_flight = scheduler.submit('first', 'k').catch((err) => err);
        const queued_other = scheduler.submit('other', 'other-key');
        const queued_same = scheduler.submit('queued', 'k').catch((err) => err);
        expect(isParseStaleError(await in_flight)).toBe(true);
        const newest = scheduler.submit('newest', 'k');
        expect(isParseStaleError(await queued_same)).toBe(true);
        // answer jobs one at a time as the single slot frees: the superseded in-flight one, then the survivors
        while (held.length > 0) { held.shift()!(); await Promise.resolve(); await Promise.resolve(); }
        expect(await queued_other).toBe('OTHER');
        expect(await newest).toBe('NEWEST');
    });

    it('never supersedes jobs submitted without a key', async () => {
        const { scheduler } = makeScheduler({ pool_size: 1 });
        const results = await Promise.all([scheduler.submit('a'), scheduler.submit('a'), scheduler.submit('a')]);
        expect(results).toEqual(['A', 'A', 'A']);
    });

    it('evicts the oldest queued job when the queue overflows, rejecting it with a non-stale error', async () => {
        const { scheduler } = makeScheduler({ on_post: () => {}, queue_max_length: 2 });
        void scheduler.submit('busy');
        const oldest = scheduler.submit('a').catch((err) => err);
        void scheduler.submit('b');
        void scheduler.submit('c');
        const err = await oldest;
        expect(err).toBeInstanceOf(Error);
        expect(isParseStaleError(err)).toBe(false);
        expect(String(err.message)).toContain('queue overflow');
    });

    it('dispose terminates workers and rejects queued and in-flight jobs, and rejects later submits', async () => {
        const { scheduler, workers } = makeScheduler({ on_post: () => {} });
        const in_flight = scheduler.submit('a').catch((err) => err);
        const queued = scheduler.submit('b').catch((err) => err);
        scheduler.dispose();
        expect((await in_flight).message).toContain('disposed');
        expect((await queued).message).toContain('disposed');
        expect(workers[0].terminated).toBe(true);
        await expect(scheduler.submit('c')).rejects.toThrow('disposed');
    });

    it('does not parse inline for a superseded job whose worker then crashes', async () => {
        let inline_calls = 0;
        let crash: (() => void) | undefined;
        const scheduler = new ParseScheduler<string, string, Req, Res>({
            createWorker: () => new DoubleWorker((worker) => { crash = () => worker.crash(); }) as unknown as Worker,
            buildRequest: (text) => ({ id: 1, text }),
            decodeResponse: (response) => response.value!,
            parseInline: (text) => { inline_calls++; return text; },
        }, { pool_size: 1 });
        const first = scheduler.submit('a', 'k').catch((err) => err);
        void scheduler.submit('b', 'k').catch(() => undefined);
        expect(isParseStaleError(await first)).toBe(true);
        crash!();
        // the superseded job already settled, so its crash costs no inline parse; the surviving job moves to a new worker
        expect(inline_calls).toBe(0);
    });

    it('sizes the default pool to half the cores within [1, DEFAULT cap]', () => {
        const size = defaultParsePoolSize();
        expect(size).toBeGreaterThanOrEqual(1);
        expect(size).toBeLessThanOrEqual(4);
        expect(DEFAULT_QUEUE_MAX_LENGTH).toBeGreaterThan(0);
    });
});
