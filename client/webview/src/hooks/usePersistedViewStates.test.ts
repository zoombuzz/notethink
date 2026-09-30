import { act, renderHook } from '@testing-library/react';
import { useVscodeStatePersistence, PERSIST_DEBOUNCE_MS, type ViewState } from './usePersistedViewStates';
import { enablePersistStateProbe, disablePersistStateProbe, getPersistStateEvents } from '../lib/persistStateProbe';
import type { HashMapOf, Doc } from '../types/general';

function buildDoc(id: string, overrides: Partial<Doc> = {}): Doc {
    return {
        id,
        path: `/workspace/${id}.md`,
        hash_sha256: `hash-${id}`,
        text: 'x'.repeat(1000),
        ...overrides,
    };
}

describe('useVscodeStatePersistence', () => {

    beforeEach(() => {
        jest.useFakeTimers();
        enablePersistStateProbe();
    });

    afterEach(() => {
        act(() => { jest.runOnlyPendingTimers(); });
        jest.useRealTimers();
        disablePersistStateProbe();
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

    it('does not persist while docs is empty or undefined', () => {
        const persist = jest.fn();
        const { rerender } = renderHook(
            ({ docs, view_states }: { docs: HashMapOf<Doc> | undefined; view_states: Record<string, ViewState> }) =>
                useVscodeStatePersistence(docs, view_states, persist),
            { initialProps: { docs: undefined, view_states: {} } },
        );
        act(() => { jest.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10); });
        expect(persist).not.toHaveBeenCalled();

        rerender({ docs: {}, view_states: {} });
        act(() => { jest.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10); });
        expect(persist).not.toHaveBeenCalled();
    });

    it('debounces a burst of docs/view_states changes into a single persist call', () => {
        const persist = jest.fn();
        const { rerender } = renderHook(
            ({ docs }: { docs: HashMapOf<Doc> }) => useVscodeStatePersistence(docs, {}, persist),
            { initialProps: { docs: { a: buildDoc('a') } } },
        );
        for (let i = 0; i < 5; i++) {
            act(() => { jest.advanceTimersByTime(50); });
            rerender({ docs: { a: buildDoc('a', { hash_sha256: `hash-${i}` }) } });
        }
        expect(persist).not.toHaveBeenCalled();
        act(() => { jest.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10); });
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('persists a metadata-only doc shape, dropping text and content', () => {
        const persist = jest.fn();
        renderHook(() => useVscodeStatePersistence({ a: buildDoc('a', { relative_path: 'a.md', mtime: 7 }) }, {}, persist));
        act(() => { jest.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10); });
        expect(persist).toHaveBeenCalledTimes(1);
        const state = persist.mock.calls[0][0];
        expect(state.docs.a).toEqual({ id: 'a', path: '/workspace/a.md', relative_path: 'a.md', hash_sha256: 'hash-a', mtime: 7 });
        expect(state.docs.a).not.toHaveProperty('text');
        expect(state.docs.a).not.toHaveProperty('content');
    });

    it('flushes immediately when the document becomes hidden, without waiting for the debounce', () => {
        const persist = jest.fn();
        renderHook(() => useVscodeStatePersistence({ a: buildDoc('a') }, {}, persist));
        act(() => { jest.advanceTimersByTime(50); }); // well within the debounce window
        expect(persist).not.toHaveBeenCalled();
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('a visibilitychange event while the document is still visible does not force a flush', () => {
        const persist = jest.fn();
        renderHook(() => useVscodeStatePersistence({ a: buildDoc('a') }, {}, persist));
        act(() => { jest.advanceTimersByTime(50); });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(persist).not.toHaveBeenCalled();
    });

    it('flushes any still-pending change on unmount so it is not lost to the debounce window', () => {
        const persist = jest.fn();
        const { unmount } = renderHook(() => useVscodeStatePersistence({ a: buildDoc('a') }, {}, persist));
        act(() => { jest.advanceTimersByTime(50); });
        expect(persist).not.toHaveBeenCalled();
        unmount();
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('does not persist again on unmount when nothing changed since the last flush', () => {
        const persist = jest.fn();
        const { unmount } = renderHook(() => useVscodeStatePersistence({ a: buildDoc('a') }, {}, persist));
        act(() => { jest.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10); });
        expect(persist).toHaveBeenCalledTimes(1);
        unmount();
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('records a probe event per persist call with the serialized payload size and doc count', () => {
        const persist = jest.fn();
        renderHook(() => useVscodeStatePersistence({ a: buildDoc('a'), b: buildDoc('b') }, {}, persist));
        act(() => { jest.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10); });
        const events = getPersistStateEvents();
        expect(events).toHaveLength(1);
        expect(events[0].docs).toBe(2);
        expect(events[0].bytes).toBeGreaterThan(0);
        // metadata-only, nowhere near the multi-KB text bodies buildDoc's fixtures carry
        expect(events[0].bytes).toBeLessThan(1000);
    });

    // each buildDoc carries a 50KB body; toPersistedDocs must strip it before persist() sees the payload
    it('a 200-file load in four bursts debounces to a handful of persist calls, each under the 100KB budget', () => {
        const persist = jest.fn();
        const { rerender } = renderHook(
            ({ docs }: { docs: HashMapOf<Doc> }) => useVscodeStatePersistence(docs, {}, persist),
            { initialProps: { docs: {} } },
        );
        let docs: HashMapOf<Doc> = {};
        for (let burst = 0; burst < 4; burst++) {
            for (let i = 0; i < 50; i++) {
                const idx = burst * 50 + i;
                docs = { ...docs, [`doc-${idx}`]: buildDoc(`doc-${idx}`, { text: 'x'.repeat(50000) }) };
                rerender({ docs });
                act(() => { jest.advanceTimersByTime(16); });
            }
            act(() => { jest.advanceTimersByTime(PERSIST_DEBOUNCE_MS + 10); });
        }
        expect(persist.mock.calls.length).toBeGreaterThan(0);
        expect(persist.mock.calls.length).toBeLessThanOrEqual(5);
        for (const [state] of persist.mock.calls) {
            expect(JSON.stringify(state).length).toBeLessThan(100 * 1024);
        }
    });

});
