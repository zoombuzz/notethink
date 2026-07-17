import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { useVscodeMessages } from './useVscodeMessages';
import { usePersistedViewStates, type ViewState } from './usePersistedViewStates';
import { anyViewInFolderMode, firstIntegrationPath } from '../notethink-views/src/lib/mergeAggregateRoot';
import { FOLDER_VIEW_STATE_ID } from '../notethink-views/src/lib/viewstateops';

type ViewStatesResult = RenderHookResult<Record<string, ViewState>, unknown>;

// drive the real view-state reducer behind the hook, so a seed is asserted through the same map NoteRenderer reads to choose folder mode
function renderMessages(initial_view_states: Record<string, ViewState> = {}): ViewStatesResult {
    return renderHook(() => {
        const persisted = usePersistedViewStates(initial_view_states);
        useVscodeMessages({
            initial_docs: {},
            saved_view_states: undefined,
            postMessage: jest.fn(),
            markConnected: jest.fn(),
            setGlobalSettings: jest.fn(),
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
