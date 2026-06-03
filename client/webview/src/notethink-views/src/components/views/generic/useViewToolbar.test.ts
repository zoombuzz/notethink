import { renderHook, act } from '@testing-library/react';
import { useViewToolbar } from './useViewToolbar';
import { FOLDER_VIEW_STATE_ID } from '../../../lib/mergeAggregateRoot';
import type { NoteDisplayOptions, NoteProps } from '../../../types/NoteProps';
import type { ViewApi, ViewProps } from '../../../types/ViewProps';

function makeHandlers(): { handlers: ViewApi; set_view_managed_state: jest.Mock; post_message: jest.Mock } {
    const set_view_managed_state = jest.fn();
    const post_message = jest.fn();
    const handlers: ViewApi = {
        setViewManagedState: set_view_managed_state,
        deleteViewFromManagedState: jest.fn(),
        revertAllViewsToDefaultState: jest.fn(),
        postMessage: post_message,
    };
    return { handlers, set_view_managed_state, post_message };
}

function makeProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'doc-id-1',
        type: 'document',
        doc_path: '/repo/sub/file.md',
        display_options: { integration_mode: 'folder' },
        ...overrides,
    };
}

describe('useViewToolbar.handle_integration_change', () => {

    it('flipping to current_file sets the canonical key explicitly to current_file', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids: [FOLDER_VIEW_STATE_ID] }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('current_file'); });
        expect(set_view_managed_state).toHaveBeenCalledTimes(1);
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        const canonical = updates.find((u) => u.id === FOLDER_VIEW_STATE_ID);
        expect(canonical).toBeDefined();
        expect((canonical!.display_options as NoteDisplayOptions).integration_mode).toBe('current_file');
        expect((canonical!.display_options as NoteDisplayOptions).integration_path).toBeUndefined();
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'current_file' });
    });

    it('flipping integration mode clears per-view focused/selected interaction state on every persisted view key', () => {
        const { handlers, set_view_managed_state } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const view_state_ids = [FOLDER_VIEW_STATE_ID, '/repo/sub/file.md', '__default'];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('current_file'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        // every dispatched update carries an explicit undefined for the interaction-state ids, so the persisted state's stale focused/selected from the previous mode is cleared on the flip
        for (const update of updates) {
            const dopts = update.display_options as NoteDisplayOptions;
            expect(dopts.view_focused_ids).toBeUndefined();
            expect(dopts.view_selected_ids).toBeUndefined();
        }
    });

    it('flipping to current_file also clears stranded folder tags on every non-canonical viewState key', () => {
        const { handlers, set_view_managed_state } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'folder' };
        const notes: NoteProps[] = [];
        const view_state_ids = [FOLDER_VIEW_STATE_ID, '/repo/sub/file.md', '/repo/sub/other.md', '__default'];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('current_file'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        // simulate the dispatcher's shallow merge over the supplied updates against a starting state that has stranded folder tags on every non-canonical key
        const starting_state: Record<string, { display_options?: NoteDisplayOptions }> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
            '/repo/sub/file.md': { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
            '/repo/sub/other.md': { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
            '__default': { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
        };
        const next: Record<string, { display_options?: NoteDisplayOptions }> = { ...starting_state };
        for (const update of updates) {
            const id = update.id as string;
            next[id] = {
                ...next[id],
                display_options: {
                    ...next[id]?.display_options,
                    ...(update.display_options as NoteDisplayOptions | undefined),
                },
            };
        }
        for (const id of Object.keys(next)) {
            expect(next[id].display_options?.integration_mode).not.toBe('folder');
        }
    });

    it('flipping to folder dispatches the canonical-key integration update plus per-view interaction-state clears (no integration-mode tag sweep)', () => {
        const { handlers, set_view_managed_state, post_message } = makeHandlers();
        const display_options: NoteDisplayOptions = { integration_mode: 'current_file' };
        const notes: NoteProps[] = [];
        const view_state_ids = [FOLDER_VIEW_STATE_ID, '/repo/sub/file.md'];
        const { result } = renderHook(() =>
            useViewToolbar(makeProps({ view_state_ids }), handlers, display_options, notes),
        );
        act(() => { result.current.handle_integration_change('folder'); });
        const updates = set_view_managed_state.mock.calls[0][0] as Array<Record<string, unknown>>;
        // canonical key sets integration_mode/path + clears interaction state; non-canonical keys clear interaction state only (no integration_mode tag written)
        const canonical = updates.find((u) => u.id === FOLDER_VIEW_STATE_ID);
        expect(canonical).toBeDefined();
        expect((canonical!.display_options as NoteDisplayOptions).integration_mode).toBe('folder');
        expect((canonical!.display_options as NoteDisplayOptions).integration_path).toBe('/repo/sub');
        expect((canonical!.display_options as NoteDisplayOptions).view_focused_ids).toBeUndefined();
        expect((canonical!.display_options as NoteDisplayOptions).view_selected_ids).toBeUndefined();
        // non-canonical key: no integration_mode tag set (no stranded-tag sweep), only interaction-state clearance
        const non_canonical = updates.find((u) => u.id === '/repo/sub/file.md');
        expect(non_canonical).toBeDefined();
        const non_canonical_dopts = non_canonical!.display_options as NoteDisplayOptions;
        expect(non_canonical_dopts.integration_mode).toBeUndefined();
        expect(non_canonical_dopts.integration_path).toBeUndefined();
        expect(non_canonical_dopts.view_focused_ids).toBeUndefined();
        expect(non_canonical_dopts.view_selected_ids).toBeUndefined();
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/sub' });
    });

});
