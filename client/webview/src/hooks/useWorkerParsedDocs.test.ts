import { act, renderHook } from '@testing-library/react';
import { useWorkerParsedDocs, parseModeProbe, resetParseModeProbe, releaseFolderDocContent, resetWorkerParsedDocsCacheForTests } from './useWorkerParsedDocs';
import { parse } from '../lib/parseops';
import type { HashMapOf, Doc } from '../types/general';

// jsdom has no Worker/fetch, so every case here exercises the sync fallback path; Playwright covers the off-thread path
jest.mock('../lib/parseops', () => ({ parse: jest.fn((text: string) => ({ type: 'root', children: [], text_seen: text })) }));

const mocked_parse = parse as jest.MockedFunction<typeof parse>;

function textOnlyDoc(id: string, text: string, hash_sha256: string): Doc {
    return { id, path: `/workspace/${id}.md`, text, hash_sha256 };
}

function withContentDoc(id: string): Doc {
    return { id, path: `/workspace/${id}.md`, text: 'ignored', content: { type: 'root', children: [] } as unknown as Doc['content'] };
}

async function flush(): Promise<void> {
    // let the fallback parse's microtask and its resulting state update settle
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
    mocked_parse.mockClear();
    resetParseModeProbe();
    // the parse/release cache is module-level, so a resolved id/hash would otherwise leak into the next test
    resetWorkerParsedDocsCacheForTests();
});

test('a doc that already carries content passes through unchanged', () => {
    const docs: HashMapOf<Doc> = { a: withContentDoc('a') };
    const { result } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    expect(result.current).toBe(docs);
    expect(mocked_parse).not.toHaveBeenCalled();
});

test('a text-only doc is parsed via the fallback and gains content', async () => {
    const docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    expect(result.current?.a.content).toBeUndefined();
    await flush();
    rerender({ docs });
    expect(mocked_parse).toHaveBeenCalledWith('hello');
    expect(result.current?.a.content).toBeDefined();
});

test('an unchanged doc (same hash) is never re-parsed on a later render', async () => {
    let docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    expect(mocked_parse).toHaveBeenCalledTimes(1);
    // a fresh doc object, same hash - what a fresh 'update' message would carry - must not trigger a re-parse
    docs = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    rerender({ docs });
    await flush();
    expect(mocked_parse).toHaveBeenCalledTimes(1);
    expect(result.current?.a.content).toBeDefined();
});

test('a changed doc (new hash) is re-parsed', async () => {
    let docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    expect(mocked_parse).toHaveBeenCalledTimes(1);
    docs = { a: textOnlyDoc('a', 'hello world', 'hash-2') };
    rerender({ docs });
    await flush();
    rerender({ docs });
    expect(mocked_parse).toHaveBeenCalledTimes(2);
    expect(mocked_parse).toHaveBeenLastCalledWith('hello world');
    expect(result.current?.a.content).toBeDefined();
});

// jsdom has no Worker, so every parse here counts as fallback; the perf harness asserts the opposite in a real browser
test('a fallback parse is counted on the parse-mode probe', async () => {
    const docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    expect(parseModeProbe()).toEqual({ worker_parses: 0, fallback_parses: 1 });
});

test('every linetag-bearing doc in a batch gets parsed, not just the first', async () => {
    const docs: HashMapOf<Doc> = {
        a: textOnlyDoc('a', 'file a', 'hash-a'),
        b: textOnlyDoc('b', 'file b', 'hash-b'),
        c: withContentDoc('c'),
    };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    expect(mocked_parse).toHaveBeenCalledTimes(2);
    expect(result.current?.a.content).toBeDefined();
    expect(result.current?.b.content).toBeDefined();
    expect(result.current?.c).toBe(docs.c);
});

// releaseFolderDocContent sheds a doc's parsed mdast once mergeAggregateRoot's stamp cache has digested it
test('a released doc goes back to content-less on the next docs change, without a fresh parse', async () => {
    let docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    expect(result.current?.a.content).toBeDefined();
    releaseFolderDocContent('a', 'hash-1');
    // same hash, so a fresh docs object still reads as content-less rather than triggering a re-parse
    docs = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    rerender({ docs });
    await flush();
    expect(result.current?.a.content).toBeUndefined();
    expect(mocked_parse).toHaveBeenCalledTimes(1);
});

test('releasing a doc does not stop a later, genuine hash change from being parsed', async () => {
    let docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    releaseFolderDocContent('a', 'hash-1');
    docs = { a: textOnlyDoc('a', 'hello world', 'hash-2') };
    rerender({ docs });
    await flush();
    rerender({ docs });
    expect(mocked_parse).toHaveBeenCalledTimes(2);
    expect(mocked_parse).toHaveBeenLastCalledWith('hello world');
    expect(result.current?.a.content).toBeDefined();
});

test('releasing with a stale content_key is a no-op', async () => {
    const docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { result, rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    releaseFolderDocContent('a', 'hash-stale');
    rerender({ docs });
    expect(result.current?.a.content).toBeDefined();
});

test('a doc that leaves the board and returns is parsed fresh, even if it was released before leaving', async () => {
    let docs: HashMapOf<Doc> = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    const { rerender } = renderHook(({ docs }) => useWorkerParsedDocs(docs), { initialProps: { docs } });
    await flush();
    rerender({ docs });
    releaseFolderDocContent('a', 'hash-1');
    docs = {};
    rerender({ docs });
    docs = { a: textOnlyDoc('a', 'hello', 'hash-1') };
    rerender({ docs });
    await flush();
    expect(mocked_parse).toHaveBeenCalledTimes(2);
});
