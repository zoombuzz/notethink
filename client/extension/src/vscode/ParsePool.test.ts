import type * as vscode from 'vscode';
import { Uri } from '../__mocks__/vscode';
import { parse } from '../lib/parseops';
import { isParseStaleError, ParsePool, setQueueMaxLengthForTest } from './ParsePool';
import { handleParseWorkerRequest, type ParseWorkerRequest, type ParseWorkerResponse } from './ParseWorker';

/**
 * ParsePool has no `Worker` global in Jest, so every test here injects its own factory: one that
 * answers through the real `handleParseWorkerRequest`, or one that fails/holds/crashes on demand.
 */

function mockContext(): vscode.ExtensionContext {
    return { extensionUri: Uri.file('/mock/extension') } as unknown as vscode.ExtensionContext;
}

// answers every postMessage on the next microtask through the real handler, no real worker thread needed
function fakeWorkerFactory(): { factory: () => Worker; spawn_count: () => number } {
    let spawn_count = 0;
    const factory = (): Worker => {
        spawn_count++;
        const worker = {
            onmessage: null as ((event: MessageEvent<ParseWorkerResponse>) => void) | null,
            onerror: null as ((event: ErrorEvent) => void) | null,
            postMessage: (message: ParseWorkerRequest) => {
                Promise.resolve().then(() => {
                    worker.onmessage?.({ data: handleParseWorkerRequest(message) } as MessageEvent<ParseWorkerResponse>);
                });
            },
            terminate: () => {},
        };
        return worker as unknown as Worker;
    };
    return { factory, spawn_count: () => spawn_count };
}

// every attempt to construct this Worker fails, driving the permanent inline-fallback path
function failingWorkerFactory(): () => Worker {
    return (): Worker => { throw new Error('worker unavailable in this test host'); };
}

// postMessage responses are held back FIFO until release(), the shape a pool_size:1 slot needs to hold one job open
function controllableWorkerFactory(): { factory: () => Worker; release: () => void; pending_count: () => number } {
    const releasers: Array<() => void> = [];
    const factory = (): Worker => {
        const worker = {
            onmessage: null as ((event: MessageEvent<ParseWorkerResponse>) => void) | null,
            onerror: null as ((event: ErrorEvent) => void) | null,
            postMessage: (message: ParseWorkerRequest) => {
                releasers.push(() => { worker.onmessage?.({ data: handleParseWorkerRequest(message) } as MessageEvent<ParseWorkerResponse>); });
            },
            terminate: () => {},
        };
        return worker as unknown as Worker;
    };
    return { factory, release: () => { releasers.shift()?.(); }, pending_count: () => releasers.length };
}

// a fake Worker whose postMessage always crashes (onerror) on the next microtask
function crashingWorkerFactory(): () => Worker {
    return (): Worker => {
        const worker = {
            onmessage: null as ((event: MessageEvent<ParseWorkerResponse>) => void) | null,
            onerror: null as ((event: ErrorEvent) => void) | null,
            postMessage: () => { Promise.resolve().then(() => { worker.onerror?.({ message: 'boom' } as ErrorEvent); }); },
            terminate: () => {},
        };
        return worker as unknown as Worker;
    };
}

const FIXTURE_CORPUS = [
    '# Heading\n\nSome paragraph text.',
    '---\ntitle: Front matter doc\n---\n\n## Section\n\n- item one\n- item two\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n',
    '',
];

describe('ParsePool', () => {
    it('falls back to inline parsing when the default factory cannot construct a Worker (the real Jest environment)', async () => {
        const pool = new ParsePool(mockContext());
        for (const text of FIXTURE_CORPUS) {
            const mdast = await pool.parse('/doc.md', text);
            expect(mdast).toEqual(parse(text));
        }
    });

    it('dispatches through an injected worker and returns mdast identical to parsing inline, for a fixture corpus', async () => {
        const { factory } = fakeWorkerFactory();
        const pool = new ParsePool(mockContext(), factory, 1);
        for (const [index, text] of FIXTURE_CORPUS.entries()) {
            const mdast = await pool.parse(`/doc-${index}.md`, text);
            expect(mdast).toEqual(parse(text));
        }
    });

    it('reuses a spawned worker across sequential calls rather than spawning one per call', async () => {
        const { factory, spawn_count } = fakeWorkerFactory();
        const pool = new ParsePool(mockContext(), factory, 1);
        await pool.parse('/a.md', '# A');
        await pool.parse('/b.md', '# B');
        await pool.parse('/a.md', '# A again');
        expect(spawn_count()).toBe(1);
    });

    it('spawns up to pool_size workers under concurrent load, and queues the rest', async () => {
        const { factory, spawn_count } = fakeWorkerFactory();
        const pool = new ParsePool(mockContext(), factory, 2);
        const results = await Promise.all([
            pool.parse('/a.md', '# A'),
            pool.parse('/b.md', '# B'),
            pool.parse('/c.md', '# C'),
        ]);
        expect(spawn_count()).toBe(2);
        expect(results).toEqual([parse('# A'), parse('# B'), parse('# C')]);
    });

    it('permanently falls back to inline parsing after a spawn failure, without retrying the factory', async () => {
        let attempts = 0;
        const counting_factory = (): Worker => { attempts++; return failingWorkerFactory()(); };
        const pool = new ParsePool(mockContext(), counting_factory, 2);
        const first = await pool.parse('/a.md', '# A');
        const second = await pool.parse('/b.md', '# B');
        expect(first).toEqual(parse('# A'));
        expect(second).toEqual(parse('# B'));
        expect(attempts).toBe(1);
    });

    it('resolves every job still queued when a spawn fails mid-pump, rather than stranding them', async () => {
        const pool = new ParsePool(mockContext(), failingWorkerFactory(), 1);
        const results = await Promise.all([
            pool.parse('/a.md', '# A'),
            pool.parse('/b.md', '# B'),
            pool.parse('/c.md', '# C'),
        ]);
        expect(results).toEqual([parse('# A'), parse('# B'), parse('# C')]);
    });

    describe('stale-parse cancellation', () => {
        it('rejects a queued job with ParseStaleError when a newer request for the same key arrives before it is dispatched', async () => {
            const { factory, release } = controllableWorkerFactory();
            const pool = new ParsePool(mockContext(), factory, 1);
            // occupy the only slot with an unrelated key, so the next two calls both queue behind it
            const held = pool.parse('/busy.md', '# Busy');
            const superseded = pool.parse('/b.md', '# B first');
            const superseded_outcome = superseded.catch(err => err);
            const replacement = pool.parse('/b.md', '# B second');
            expect(isParseStaleError(await superseded_outcome)).toBe(true);
            release(); // answers the held /busy.md job; the slot frees and the pool dispatches the surviving /b.md replacement
            release(); // answers the replacement
            expect(await held).toEqual(parse('# Busy'));
            expect(await replacement).toEqual(parse('# B second'));
        });

        it('rejects an in-flight job with ParseStaleError when a newer request for the same key arrives, and still runs the newer one once the slot frees up', async () => {
            const { factory, release } = controllableWorkerFactory();
            const pool = new ParsePool(mockContext(), factory, 1);
            const first = pool.parse('/a.md', '# A first');
            const first_outcome = first.catch(err => err);
            const second = pool.parse('/a.md', '# A second');
            expect(isParseStaleError(await first_outcome)).toBe(true);
            // the worker's real answer for the superseded job still arrives; settling an already-rejected promise is a no-op
            release();
            // the worker is now free, so the pool dispatches the newer job onto it
            release();
            expect(await second).toEqual(parse('# A second'));
        });
    });

    it('falls back to an inline parse for the job in flight when its worker crashes, and keeps serving later calls from a replacement slot', async () => {
        const pool = new ParsePool(mockContext(), crashingWorkerFactory(), 1);
        const crashed = await pool.parse('/a.md', '# A');
        expect(crashed).toEqual(parse('# A'));
        // the crashed slot was dropped; a following call spawns a fresh one rather than reusing the dead worker
        const after = await pool.parse('/b.md', '# B');
        expect(after).toEqual(parse('# B'));
    });

    it('drops the oldest queued job past the queue length bound, rejecting it rather than growing without limit', async () => {
        setQueueMaxLengthForTest(2);
        try {
            const { factory } = controllableWorkerFactory();
            const pool = new ParsePool(mockContext(), factory, 1);
            const held = pool.parse('/busy.md', '# Busy'); // occupies the only slot
            const oldest = pool.parse('/a.md', '# A');
            const oldest_rejection = oldest.catch(err => err);
            pool.parse('/b.md', '# B'); // fills the 2-entry queue
            pool.parse('/c.md', '# C'); // pushes the queue past its bound, evicting the oldest queued entry (/a.md)
            const err = await oldest_rejection;
            expect(err).toBeInstanceOf(Error);
            expect(isParseStaleError(err)).toBe(false);
            void held;
        } finally {
            setQueueMaxLengthForTest(undefined);
        }
    });
});
