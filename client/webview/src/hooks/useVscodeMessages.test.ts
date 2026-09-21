import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { useVscodeMessages, MESSAGE_FLUSH_FALLBACK_MS } from './useVscodeMessages';
import { usePersistedViewStates, type ViewState } from './usePersistedViewStates';
import { enableBoardCommitProbe, disableBoardCommitProbe, getBoardCommitEvents } from '../lib/boardCommitProbe';
import { anyViewInFolderMode, firstIntegrationPath } from '../notethink-views/src/lib/mergeAggregateRoot';
import { FOLDER_VIEW_STATE_ID } from '../notethink-views/src/lib/viewstateops';

type ViewStatesResult = RenderHookResult<Record<string, ViewState>, unknown>;
type MessagesResult = RenderHookResult<ReturnType<typeof useVscodeMessages>, unknown>;

interface QueueHarness {
    result: MessagesResult['result'];
    markPending: jest.Mock;
    clearPending: jest.Mock;
}

// drive the real view-state reducer behind the hook, so a seed is asserted through the same map NoteRenderer reads to choose folder mode
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

// run the frame the queue is waiting on: jsdom backs both requestAnimationFrame and the hook's fallback with timers, so yielding past the fallback covers whichever fires
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

    // a hidden or backgrounded webview can have its frames throttled to a stop; a message that never commits is worse than one that commits late
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

    // the spinner must not drop a frame before the board it was covering fills, so the sentinel rides the same queue as the docs
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
});
