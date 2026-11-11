import { act, renderHook } from '@testing-library/react';
import { useWorkerParsedDocs, parseModeProbe, resetParseModeProbe, resetWorkerParsedDocsCacheForTests } from './useWorkerParsedDocs';
import { parse } from '../lib/parseops';
import type { ParseWorkerRequest, ParseWorkerResponse } from '../parseWorker';
import type { HashMapOf, Doc } from '../types/general';

/*
 * The worker path of the folder parse pool: unlike useWorkerParsedDocs.test.ts, which runs every case
 * through the inline fallback because jsdom has no Worker, this file installs a controllable Worker
 * double and the globals the pool needs to prepare its blob URL, so the shared scheduler really drives it.
 */
jest.mock('../lib/parseops', () => ({ parse: jest.fn((text: string) => ({ type: 'root', children: [], text_seen: text })) }));

const mocked_parse = parse as jest.MockedFunction<typeof parse>;

type WorkerBehaviour = (worker: FakeWorker, request: ParseWorkerRequest) => void;

let behaviour: WorkerBehaviour;
// the pool is module-level and reuses idle workers across tests, so this list is never reset: tests read it by delta
const spawned_workers: FakeWorker[] = [];

class FakeWorker {
    onmessage: ((event: MessageEvent<ParseWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    posted: ParseWorkerRequest[] = [];
    constructor(public readonly url: string) { spawned_workers.push(this); }
    postMessage(request: ParseWorkerRequest): void {
        this.posted.push(request);
        behaviour(this, request);
    }
    terminate(): void { this.terminated = true; }
    answer(response: ParseWorkerResponse): void { this.onmessage?.({ data: response } as MessageEvent<ParseWorkerResponse>); }
    crash(): void { this.onerror?.({ message: 'boom' } as ErrorEvent); }
}

function answerWithContent(worker: FakeWorker, request: ParseWorkerRequest): void {
    Promise.resolve().then(() => worker.answer({ id: request.id, hash: request.hash, content: { type: 'root', children: [], text_seen: `worker:${request.text}` } as never }));
}

function textOnlyDoc(id: string, text: string, hash_sha256: string): Doc {
    return { id, path: `/workspace/${id}.md`, text, hash_sha256 };
}

async function flush(): Promise<void> {
    await act(async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); } });
}

beforeAll(() => {
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ text: async () => 'worker source' }));
    URL.createObjectURL = jest.fn(() => 'blob:parse-worker');
    (window as unknown as { __notethinkChunkConfig?: unknown }).__notethinkChunkConfig = { publicPath: 'https://webview.test/', nonce: '' };
});

beforeEach(() => {
    mocked_parse.mockClear();
    resetParseModeProbe();
    resetWorkerParsedDocsCacheForTests();
    behaviour = answerWithContent;
});

test('a doc is parsed by a real worker and counted as a worker parse', async () => {
    const docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    expect(spawned_workers).toHaveLength(1);
    expect(spawned_workers[0].url).toBe('blob:parse-worker');
    expect(parseModeProbe()).toEqual({ worker_parses: 1, fallback_parses: 0 });
    expect(mocked_parse).not.toHaveBeenCalled();
    expect((result.current?.a.content as unknown as { text_seen: string }).text_seen).toBe('worker:hello');
});

test('a worker crash parses the in-flight doc inline, replaces the worker and keeps later docs flowing', async () => {
    const before = spawned_workers.length;
    const crashing_worker = spawned_workers[0];
    behaviour = (worker) => { Promise.resolve().then(() => worker.crash()); };
    let docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'first', 'hash-a') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    expect(crashing_worker.terminated).toBe(true);
    expect(mocked_parse).toHaveBeenCalledWith('first');
    expect(result.current?.a.content).toBeDefined();
    expect(parseModeProbe()).toEqual({ worker_parses: 0, fallback_parses: 1 });
    // the crashed slot is gone, so the next doc spawns a fresh worker, which now answers normally
    behaviour = answerWithContent;
    docs = { a: docs.a, b: textOnlyDoc('b', 'second', 'hash-b') };
    rerender({ docs });
    await flush();
    rerender({ docs });
    expect(spawned_workers).toHaveLength(before + 1);
    expect((result.current?.b.content as unknown as { text_seen: string }).text_seen).toBe('worker:second');
});

test('a worker error answer releases the pending key, so the same doc is submitted again on its next appearance', async () => {
    behaviour = (worker, request) => {
        Promise.resolve().then(() => worker.answer({ id: request.id, hash: request.hash, error: 'bad parse' }));
    };
    let docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    expect(result.current?.a.content).toBeUndefined();
    const worker = spawned_workers[spawned_workers.length - 1];
    const posted_before = worker.posted.length;
    behaviour = answerWithContent;
    docs = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    rerender({ docs });
    await flush();
    rerender({ docs });
    expect(worker.posted).toHaveLength(posted_before + 1);
    expect(result.current?.a.content).toBeDefined();
});

test('a response for a different doc or hash is ignored and the doc stays in flight until its own answer arrives', async () => {
    let held: { worker: FakeWorker; request: ParseWorkerRequest } | undefined;
    behaviour = (worker, request) => { held = { worker, request }; };
    const docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    held!.worker.answer({ id: 'other', hash: 'hash-1', content: { type: 'root', children: [] } as never });
    held!.worker.answer({ id: 'a', hash: 'stale-hash', content: { type: 'root', children: [] } as never });
    await flush();
    rerender({ docs });
    expect(result.current?.a.content).toBeUndefined();
    held!.worker.answer({ id: 'a', hash: 'hash-1', content: { type: 'root', children: [], text_seen: 'right' } as never });
    await flush();
    rerender({ docs });
    expect((result.current?.a.content as unknown as { text_seen: string }).text_seen).toBe('right');
});
