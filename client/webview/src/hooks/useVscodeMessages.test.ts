import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { useVscodeMessages, MESSAGE_FLUSH_FALLBACK_MS } from './useVscodeMessages';
import { usePersistedViewStates, type ViewState } from './usePersistedViewStates';
import { enableBoardCommitProbe, disableBoardCommitProbe, getBoardCommitEvents } from '../lib/boardCommitProbe';
import { anyViewInFolderMode, firstIntegrationPath } from '../notethink-views/src/lib/mergeAggregateRoot';
import { FOLDER_VIEW_STATE_ID } from '../notethink-views/src/lib/viewstateops';
import { usePendingWork, PENDING_WORK_SAFETY_NET_MS } from '../notethink-views/src/hooks/usePendingWork';

type ViewStatesResult = RenderHookResult<Record<string, ViewState>, unknown>;
type MessagesResult = RenderHookResult<ReturnType<typeof useVscodeMessages>, unknown>;

interface QueueHarness {
    result: MessagesResult['result'];
    markPending: jest.Mock;
    clearPending: jest.Mock;
}

// drives the real view-state reducer, so a seed is asserted through the same map NoteRenderer reads
function renderMessages(initial_view_states: Record<string, ViewState> = {}): ViewStatesResult {
    return renderHook(() => {
        const persisted = usePersistedViewStates(initial_view_states);
        useVscodeMessages({
            initial_docs: {},
            saved_view_states: undefined,
            postMessage: jest.fn(),
            markConnected: jest.fn(),
            setSettingsCascade: jest.fn(),
            updateAllViewStates: persisted.updateAllViewStates,
            setViewManagedState: persisted.handleSetViewManagedState,
            view_states_ref: persisted.view_states_ref,
            navigation_callback_ref: { current: undefined },
            markPending: jest.fn(),
            clearPending: jest.fn(),
            setJumpTargets: jest.fn(),
        });
        return persisted.view_states;
    });
}

function postToWebview(message: Record<string, unknown>): void {
    act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    });
}

// render the hook itself, with pending-work spies, so the coalescing tests can read the committed doc map
function renderMessageQueue(): QueueHarness {
    const markPending = jest.fn();
    const clearPending = jest.fn();
    const { result } = renderHook(() => {
        const persisted = usePersistedViewStates({});
        return useVscodeMessages({
            initial_docs: {},
            saved_view_states: undefined,
            postMessage: jest.fn(),
            markConnected: jest.fn(),
            setSettingsCascade: jest.fn(),
            updateAllViewStates: persisted.updateAllViewStates,
            setViewManagedState: persisted.handleSetViewManagedState,
            view_states_ref: persisted.view_states_ref,
            navigation_callback_ref: { current: undefined },
            markPending,
            clearPending,
            setJumpTargets: jest.fn(),
        });
    });
    return { result, markPending, clearPending };
}

// runs past the fallback timeout, covering whichever of rAF or the hook's own fallback timer fires first
async function flushMessageFrame(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, MESSAGE_FLUSH_FALLBACK_MS + 5));
    });
}

// one discovery-shaped merge update carrying a single doc
function mergeUpdate(doc_id: string): Record<string, unknown> {
    return {
        type: 'update',
        merge_strategy: 'merge',
        partial: { docs: { [doc_id]: { id: doc_id, path: `/workspace/${doc_id}.md`, hash_sha256: doc_id } } },
    };
}

function docIds(harness: QueueHarness): string[] {
    return Object.keys(harness.result.current.docs ?? {});
}

describe('useVscodeMessages setIntegrationScope command', () => {

    // the docless-open path: the host originates the folder scope because nothing in the webview can derive one
    it('seeds the canonical folder view state and resolves folder mode', () => {
        const { result } = renderMessages();

        postToWebview({ type: 'command', command: 'setIntegrationScope', mode: 'folder', path: '/workspace' });

        expect(result.current[FOLDER_VIEW_STATE_ID]?.display_options).toMatchObject({
            integration_mode: 'folder',
            integration_path: '/workspace',
        });
        // what NoteRenderer reads to pick FolderTreeComposer over a single-file composer
        expect(anyViewInFolderMode(result.current)).toBe(true);
        expect(firstIntegrationPath(result.current)).toBe('/workspace');
    });

    it('seeds under the canonical key even when other view states already exist', () => {
        const { result } = renderMessages({ '/workspace/todo.md': { type: 'kanban' } });

        postToWebview({ type: 'command', command: 'setIntegrationScope', mode: 'folder', path: '/workspace' });

        expect(firstIntegrationPath(result.current)).toBe('/workspace');
        // the pre-existing per-doc view state keeps its own settings and gains no integration tag
        expect(result.current['/workspace/todo.md']?.type).toBe('kanban');
        expect(result.current['/workspace/todo.md']?.display_options?.integration_path).toBeUndefined();
    });

    // a reload restores its own scope before requestInitialState; the seed must not yank the board back to the root
    it('does not override a folder scope the webview already owns', () => {
        const { result } = renderMessages({
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder', integration_path: '/workspace/notes' } },
        });

        postToWebview({ type: 'command', command: 'setIntegrationScope', mode: 'folder', path: '/workspace' });

        expect(firstIntegrationPath(result.current)).toBe('/workspace/notes');
    });

    // an `auto` view state with a seeded path already resolves folder, so it counts as owned too
    it('does not override an auto-resolved folder scope', () => {
        const { result } = renderMessages({
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'auto', integration_path: '/workspace/notes' } },
        });

        postToWebview({ type: 'command', command: 'setIntegrationScope', mode: 'folder', path: '/workspace' });

        expect(firstIntegrationPath(result.current)).toBe('/workspace/notes');
    });

    it('ignores a scope command carrying no path', () => {
        const { result } = renderMessages();

        postToWebview({ type: 'command', command: 'setIntegrationScope', mode: 'folder' });

        expect(anyViewInFolderMode(result.current)).toBe(false);
        expect(result.current[FOLDER_VIEW_STATE_ID]).toBeUndefined();
    });

    it('ignores a scope command for any mode other than folder', () => {
        const { result } = renderMessages();

        postToWebview({ type: 'command', command: 'setIntegrationScope', mode: 'current_file', path: '/workspace' });

        expect(anyViewInFolderMode(result.current)).toBe(false);
    });
});

describe('useVscodeMessages update coalescing', () => {

    beforeEach(() => {
        enableBoardCommitProbe();
    });

    afterEach(() => {
        disableBoardCommitProbe();
    });

    // the folder-load case: one board render for the whole burst, not one per message
    it('folds a burst of discovery updates into one board commit', async () => {
        const harness = renderMessageQueue();

        for (let index = 0; index < 12; index++) {
            postToWebview(mergeUpdate(`doc-${index}`));
        }
        // the burst is still queued: no commit has landed yet
        expect(docIds(harness)).toHaveLength(0);
        await flushMessageFrame();

        expect(docIds(harness)).toHaveLength(12);
        const commits = getBoardCommitEvents();
        expect(commits).toHaveLength(1);
        expect(commits[0]).toMatchObject({ messages: 12, docs: 12 });
    });

    // progressive fill: each frame commits what arrived in it, so the board grows in stages rather than revealing at the end
    it('commits each frame\'s arrivals separately, so the board fills progressively', async () => {
        const harness = renderMessageQueue();

        postToWebview(mergeUpdate('doc-a'));
        postToWebview(mergeUpdate('doc-b'));
        await flushMessageFrame();
        expect(docIds(harness)).toHaveLength(2);

        postToWebview(mergeUpdate('doc-c'));
        await flushMessageFrame();

        expect(docIds(harness)).toHaveLength(3);
        const commits = getBoardCommitEvents();
        expect(commits.map(commit => commit.docs)).toEqual([2, 3]);
    });

    // a backgrounded webview can throttle frames to a stop; a message that never commits is worse than a late one
    it('commits on the timeout fallback when no animation frame ever fires', async () => {
        const frame_spy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
        try {
            const harness = renderMessageQueue();

            postToWebview(mergeUpdate('doc-a'));
            postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: false });
            await flushMessageFrame();

            expect(docIds(harness)).toEqual(['doc-a']);
            // the sentinel rides the same queue, so the fallback has to carry it too or a hidden webview keeps spinning forever
            expect(harness.clearPending).toHaveBeenCalledWith('folderDiscovery');
        } finally {
            frame_spy.mockRestore();
        }
    });

    // ordering inside a flush must match the order the messages arrived, or a tombstone loses to the update it followed
    it('applies a tombstone that arrived behind an update in the same frame', async () => {
        const harness = renderMessageQueue();

        postToWebview(mergeUpdate('doc-a'));
        postToWebview(mergeUpdate('doc-b'));
        postToWebview({ type: 'docDeleted', docId: 'doc-a' });
        await flushMessageFrame();

        expect(docIds(harness)).toEqual(['doc-b']);
    });

    /*
     * The held doc here is metadata-only (no `text` or `content`), so useWorkerParsedDocs' own
     * fallback parse never fires and can't mask whether mergeUpdatedDocs itself accepted the resend.
     */
    it('updates a held doc when a same-hash resend carries more body (merge strategy)', async () => {
        const harness = renderMessageQueue();

        postToWebview({
            type: 'update',
            merge_strategy: 'merge',
            partial: { docs: { 'doc-a': { id: 'doc-a', path: '/workspace/doc-a.md', hash_sha256: 'h1' } } },
        });
        await flushMessageFrame();
        expect(harness.result.current.docs?.['doc-a']?.text).toBeUndefined();

        const wire_content = { type: 'root', children: [], marker: 'from-wire' };
        postToWebview({
            type: 'update',
            merge_strategy: 'merge',
            partial: { docs: { 'doc-a': { id: 'doc-a', path: '/workspace/doc-a.md', hash_sha256: 'h1', text: 'hello', content: wire_content } } },
        });
        await flushMessageFrame();

        expect(harness.result.current.docs?.['doc-a']?.text).toBe('hello');
        expect(harness.result.current.docs?.['doc-a']?.content).toBe(wire_content);
    });

    it('updates a held doc when a same-hash resend carries more body (replace strategy)', async () => {
        const harness = renderMessageQueue();

        postToWebview({
            type: 'update',
            partial: { docs: { 'doc-a': { id: 'doc-a', path: '/workspace/doc-a.md', hash_sha256: 'h1' } } },
        });
        await flushMessageFrame();
        expect(harness.result.current.docs?.['doc-a']?.text).toBeUndefined();

        const wire_content = { type: 'root', children: [], marker: 'from-wire' };
        postToWebview({
            type: 'update',
            partial: { docs: { 'doc-a': { id: 'doc-a', path: '/workspace/doc-a.md', hash_sha256: 'h1', text: 'hello', content: wire_content } } },
        });
        await flushMessageFrame();

        expect(harness.result.current.docs?.['doc-a']?.text).toBe('hello');
        expect(harness.result.current.docs?.['doc-a']?.content).toBe(wire_content);
    });

    // the sentinel rides the same queue as the docs, so the spinner never drops a frame before the board fills
    it('clears the discovery sentinel in the commit that lands its docs, not before', async () => {
        const harness = renderMessageQueue();

        postToWebview(mergeUpdate('doc-a'));
        postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: false });
        expect(harness.clearPending).not.toHaveBeenCalledWith('folderDiscovery');
        await flushMessageFrame();

        expect(harness.clearPending).toHaveBeenCalledWith('folderDiscovery');
        expect(docIds(harness)).toEqual(['doc-a']);
    });

    // only the doc stream is coalesced; an editor-driven message still lands as it arrives
    it('lands a selectionChanged without waiting for a frame', () => {
        const harness = renderMessageQueue();

        postToWebview({ type: 'selectionChanged', docPath: '/workspace/doc-a.md', selection: { head: 4, anchor: 4 } });

        expect(harness.result.current.selections['/workspace/doc-a.md']).toEqual({ main: { head: 4, anchor: 4 } });
        expect(harness.result.current.active_editor_doc_path).toBe('/workspace/doc-a.md');
    });

    // discovery_scanning is read straight off the folderDiscovery key, not through the pending-work hook's show-delay
    it('starts false, flips true on a folderDiscovery pendingChange, and clears on the matching off', async () => {
        const harness = renderMessageQueue();
        expect(harness.result.current.discovery_scanning).toBe(false);

        postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: true });
        await flushMessageFrame();
        expect(harness.result.current.discovery_scanning).toBe(true);

        postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: false });
        await flushMessageFrame();
        expect(harness.result.current.discovery_scanning).toBe(false);
    });

    // an unrelated pending key must not flip the discovery-specific signal
    it('ignores a pendingChange for a key other than folderDiscovery', async () => {
        const harness = renderMessageQueue();

        postToWebview({ type: 'pendingChange', key: 'settingsCascade', on: true });
        await flushMessageFrame();

        expect(harness.result.current.discovery_scanning).toBe(false);
    });

    describe('discovery_progress', () => {
        // rides the same queue as the doc stream and pendingChange (QUEUED_MESSAGE_TYPES), so a tick lands on flush, not before
        it('starts undefined and lands a discoveryProgress tick once the commit flushes', async () => {
            const harness = renderMessageQueue();
            expect(harness.result.current.discovery_progress).toBeUndefined();

            postToWebview({ type: 'discoveryProgress', phase: 'walking', dirs_walked: 120, files_found: 4 });
            await flushMessageFrame();

            expect(harness.result.current.discovery_progress).toEqual({
                phase: 'walking',
                dirs_walked: 120,
                files_found: 4,
                files_loaded: undefined,
                files_total: undefined,
            });
        });

        it('overwrites the previous tick with the latest one, loading phase included', async () => {
            const harness = renderMessageQueue();

            postToWebview({ type: 'discoveryProgress', phase: 'walking', dirs_walked: 10, files_found: 1 });
            postToWebview({ type: 'discoveryProgress', phase: 'loading', files_loaded: 1, files_total: 3 });
            await flushMessageFrame();

            expect(harness.result.current.discovery_progress).toEqual({
                phase: 'loading',
                dirs_walked: undefined,
                files_found: undefined,
                files_loaded: 1,
                files_total: 3,
            });
        });

        it('discards a discoveryProgress message carrying an unknown phase', async () => {
            const harness = renderMessageQueue();

            postToWebview({ type: 'discoveryProgress', phase: 'bogus', dirs_walked: 1 });
            await flushMessageFrame();

            expect(harness.result.current.discovery_progress).toBeUndefined();
        });

        // reset rides the same queue as discovery_scanning, so both clear in the commit that lands the matching pendingChange
        it('clears on the folderDiscovery pendingChange that starts a run, and on the one that ends it', async () => {
            const harness = renderMessageQueue();
            postToWebview({ type: 'discoveryProgress', phase: 'loading', files_loaded: 2, files_total: 3 });
            await flushMessageFrame();
            expect(harness.result.current.discovery_progress).toBeDefined();

            postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: false });
            await flushMessageFrame();
            expect(harness.result.current.discovery_progress).toBeUndefined();

            postToWebview({ type: 'discoveryProgress', phase: 'walking', dirs_walked: 1, files_found: 0 });
            await flushMessageFrame();
            expect(harness.result.current.discovery_progress).toBeDefined();

            postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: true });
            await flushMessageFrame();
            expect(harness.result.current.discovery_progress).toBeUndefined();
        });

        /*
         * Regression: PanelSession posts the bracketing pendingChange { on: true } before any tick, but a
         * tick arriving in the SAME commit as that pendingChange must still win, because the host's wire
         * order is reset-then-tick. Processing them out of that order - a queued pendingChange flushed
         * after an immediately-applied tick - would have the reset clobber a tick that arrived later.
         */
        it('keeps a tick that arrives in the same commit as the pendingChange that starts the run', async () => {
            const harness = renderMessageQueue();

            postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: true });
            postToWebview({ type: 'discoveryProgress', phase: 'walking', dirs_walked: 120, files_found: 4 });
            await flushMessageFrame();

            expect(harness.result.current.discovery_scanning).toBe(true);
            expect(harness.result.current.discovery_progress).toMatchObject({ phase: 'walking', dirs_walked: 120, files_found: 4 });
        });

        // an unrelated pending key must not clear a tick belonging to the live discovery run
        it('ignores a pendingChange for a key other than folderDiscovery', async () => {
            const harness = renderMessageQueue();
            postToWebview({ type: 'discoveryProgress', phase: 'walking', dirs_walked: 1, files_found: 0 });
            await flushMessageFrame();

            postToWebview({ type: 'pendingChange', key: 'settingsCascade', on: true });
            await flushMessageFrame();

            expect(harness.result.current.discovery_progress).toBeDefined();
        });

        /*
         * Root cause of the breadcrumb spinner dropping mid-scan: usePendingWork's safety net
         * (PENDING_WORK_SAFETY_NET_MS, 10 s) auto-clears a mark with no matching re-mark, which a
         * Remote-SSH walk past 10 s hit well before PanelSession's own pendingChange { on: false }
         * ever arrived. A live tick is proof the scan is still running, so every tick re-marks the
         * key - the same fix useAgentScanPending (activityhooks.ts) applies with its remark interval.
         */
        it('re-marks folderDiscovery on every tick, refreshing the safety net a long walk would otherwise outlive', async () => {
            const harness = renderMessageQueue();

            postToWebview({ type: 'pendingChange', key: 'folderDiscovery', on: true });
            await flushMessageFrame();
            harness.markPending.mockClear();

            postToWebview({ type: 'discoveryProgress', phase: 'walking', dirs_walked: 120, files_found: 4 });
            await flushMessageFrame();
            expect(harness.markPending).toHaveBeenCalledWith('folderDiscovery');

            harness.markPending.mockClear();
            postToWebview({ type: 'discoveryProgress', phase: 'loading', files_loaded: 2, files_total: 4 });
            await flushMessageFrame();
            expect(harness.markPending).toHaveBeenCalledWith('folderDiscovery');
        });
    });

    // sendAggregatePayload posts these snake_case, matching every other field the same message carries
    it('reads include_filter/exclude_filter off the wire, not the camelCase the message never sends', async () => {
        const harness = renderMessageQueue();

        postToWebview({
            type: 'update',
            partial: { docs: {} },
            include_filter: '**/{todo,done}.md',
            exclude_filter: '**/node_modules/**',
        });
        await flushMessageFrame();

        expect(harness.result.current.includeFilter).toBe('**/{todo,done}.md');
        expect(harness.result.current.excludeFilter).toBe('**/node_modules/**');
    });
});

/*
 * Wires the real usePendingWork hook (not a jest.fn() spy) behind useVscodeMessages, with fake timers,
 * to prove the breadcrumb spinner's underlying `pending` boolean survives a run slower than
 * PENDING_WORK_SAFETY_NET_MS - the scenario a mocked markPending can't demonstrate on its own.
 */
describe('folderDiscovery pending-work integration', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    function renderWithRealPendingWork(): RenderHookResult<{ pending: boolean }, unknown> {
        return renderHook(() => {
            const persisted = usePersistedViewStates({});
            const pending_api = usePendingWork();
            useVscodeMessages({
                initial_docs: {},
                saved_view_states: undefined,
                postMessage: jest.fn(),
                markConnected: jest.fn(),
                setSettingsCascade: jest.fn(),
                updateAllViewStates: persisted.updateAllViewStates,
                setViewManagedState: persisted.handleSetViewManagedState,
                view_states_ref: persisted.view_states_ref,
                navigation_callback_ref: { current: undefined },
                markPending: pending_api.markPending,
                clearPending: pending_api.clearPending,
                setJumpTargets: jest.fn(),
            });
            return { pending: pending_api.pending };
        });
    }

    function postAndFlush(message: Record<string, unknown>): void {
        act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); });
        act(() => { jest.advanceTimersByTime(MESSAGE_FLUSH_FALLBACK_MS + 5); });
    }

    it('stays pending through a run longer than the safety net, given a tick inside every window', () => {
        // the message queue's rAF path never fires under fake timers; every flush rides the fallback timer instead
        const frame_spy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
        try {
            const { result } = renderWithRealPendingWork();

            postAndFlush({ type: 'pendingChange', key: 'folderDiscovery', on: true });
            act(() => { jest.advanceTimersByTime(200); }); // past the show-delay
            expect(result.current.pending).toBe(true);

            // three ticks spaced PENDING_WORK_SAFETY_NET_MS apart - without the re-mark, the first one alone outlives the net
            for (let tick = 0; tick < 3; tick++) {
                act(() => { jest.advanceTimersByTime(PENDING_WORK_SAFETY_NET_MS - 1000); });
                postAndFlush({ type: 'discoveryProgress', phase: 'walking', dirs_walked: tick * 100, files_found: tick });
                expect(result.current.pending).toBe(true);
            }

            postAndFlush({ type: 'pendingChange', key: 'folderDiscovery', on: false });
            act(() => { jest.advanceTimersByTime(300); }); // past min-visibility
            expect(result.current.pending).toBe(false);
        } finally {
            frame_spy.mockRestore();
        }
    });

    it('drops pending after the safety net when no tick ever refreshes it (the bug this fix removes)', () => {
        const frame_spy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
        try {
            const { result } = renderWithRealPendingWork();

            postAndFlush({ type: 'pendingChange', key: 'folderDiscovery', on: true });
            act(() => { jest.advanceTimersByTime(200); });
            expect(result.current.pending).toBe(true);

            // no discoveryProgress tick arrives - the safety net alone governs
            act(() => { jest.advanceTimersByTime(PENDING_WORK_SAFETY_NET_MS + 500); });
            expect(result.current.pending).toBe(false);
        } finally {
            frame_spy.mockRestore();
        }
    });
});
