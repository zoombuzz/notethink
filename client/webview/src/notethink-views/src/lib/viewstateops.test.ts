import {
    FOLDER_VIEW_STATE_ID,
    MAX_EXPANDED_IDS,
    anyViewInFolderMode,
    buildIntegrationDispatch,
    nextExpandedIds,
    reconcileAutoIntegrationMode,
    resolveIntegrationMode,
    resolveViewStateId,
    writeViewExpandedIds,
    writeViewInteractionState,
    findFolderViewState,
    type ViewStateLike,
} from './viewstateops';
import { INTEGRATION_MODE_AUTO, INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER } from '../types/IntegrationMode';
import type { ViewApi, ViewProps } from '../types/ViewProps';

function makeProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'view-doc-a',
        type: 'document',
        display_options: { integration_mode: INTEGRATION_MODE_CURRENT_FILE },
        ...overrides,
    };
}

function makeHandlers(): { handlers: ViewApi; set_view_managed_state: jest.Mock } {
    const set_view_managed_state = jest.fn();
    const handlers: ViewApi = {
        setViewManagedState: set_view_managed_state,
        deleteViewFromManagedState: jest.fn(),
        revertAllViewsToDefaultState: jest.fn(),
    };
    return { handlers, set_view_managed_state };
}

describe('resolveIntegrationMode', () => {
    it('treats undefined display_options / mode as current_file (back-compat, no migration)', () => {
        expect(resolveIntegrationMode(undefined)).toBe(INTEGRATION_MODE_CURRENT_FILE);
        expect(resolveIntegrationMode({})).toBe(INTEGRATION_MODE_CURRENT_FILE);
    });

    it('passes concrete folder / current_file through unchanged', () => {
        expect(resolveIntegrationMode({ integration_mode: 'folder', integration_path: '/repo' })).toBe(INTEGRATION_MODE_FOLDER);
        expect(resolveIntegrationMode({ integration_mode: 'current_file' })).toBe(INTEGRATION_MODE_CURRENT_FILE);
    });

    it('resolves auto to folder when an integration_path was seeded, else current_file', () => {
        expect(resolveIntegrationMode({ integration_mode: 'auto', integration_path: '/repo/portfolio' })).toBe(INTEGRATION_MODE_FOLDER);
        expect(resolveIntegrationMode({ integration_mode: 'auto' })).toBe(INTEGRATION_MODE_CURRENT_FILE);
    });

    it('treats an absent mode with a stray path as folder (auto default + path)', () => {
        expect(resolveIntegrationMode({ integration_path: '/repo' })).toBe(INTEGRATION_MODE_FOLDER);
    });
});

describe('reconcileAutoIntegrationMode', () => {
    it('returns auto when the navigation lands on the file-declared mode (congruent)', () => {
        expect(reconcileAutoIntegrationMode(INTEGRATION_MODE_FOLDER, INTEGRATION_MODE_FOLDER)).toBe(INTEGRATION_MODE_AUTO);
        expect(reconcileAutoIntegrationMode(INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_CURRENT_FILE)).toBe(INTEGRATION_MODE_AUTO);
    });

    it('pins the concrete resulting mode when navigation diverges from the file', () => {
        expect(reconcileAutoIntegrationMode(INTEGRATION_MODE_FOLDER, INTEGRATION_MODE_CURRENT_FILE)).toBe(INTEGRATION_MODE_FOLDER);
        expect(reconcileAutoIntegrationMode(INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER)).toBe(INTEGRATION_MODE_CURRENT_FILE);
    });

    it('treats an undeclared file as current_file, so only current_file navigation returns auto', () => {
        expect(reconcileAutoIntegrationMode(INTEGRATION_MODE_CURRENT_FILE, undefined)).toBe(INTEGRATION_MODE_AUTO);
        expect(reconcileAutoIntegrationMode(INTEGRATION_MODE_FOLDER, undefined)).toBe(INTEGRATION_MODE_FOLDER);
    });
});

describe('anyViewInFolderMode', () => {
    it('returns false for undefined or empty view states', () => {
        expect(anyViewInFolderMode(undefined)).toBe(false);
        expect(anyViewInFolderMode({})).toBe(false);
    });

    it('returns true when the canonical key is tagged folder', () => {
        const view_states: Record<string, ViewStateLike> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(true);
    });

    it('returns true when the canonical key is auto with a seeded folder path', () => {
        const view_states: Record<string, ViewStateLike> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'auto', integration_path: '/repo/portfolio' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(true);
    });

    it('returns false when the canonical key is auto with no seeded path', () => {
        const view_states: Record<string, ViewStateLike> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'auto' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(false);
    });

    it('returns true via legacy fallback when only a doc-path key is tagged folder', () => {
        const view_states: Record<string, ViewStateLike> = {
            '/repo/a.md': { display_options: { integration_mode: 'folder' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(true);
    });

    it('returns false when no entry carries the folder tag', () => {
        const view_states: Record<string, ViewStateLike> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } },
            '/repo/a.md': { display_options: { integration_mode: 'current_file' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(false);
    });
});

describe('resolveViewStateId', () => {
    it('returns FOLDER_VIEW_STATE_ID when the view is in folder mode', () => {
        const props = makeProps({
            id: 'some-doc-path',
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER },
        });
        expect(resolveViewStateId(props)).toBe(FOLDER_VIEW_STATE_ID);
    });

    it('returns props.id when the view is in current_file mode', () => {
        const props = makeProps({ id: 'view-id-x' });
        expect(resolveViewStateId(props)).toBe('view-id-x');
    });

    it('returns props.id when display_options is undefined', () => {
        const props = makeProps({ id: 'view-id-y', display_options: undefined });
        expect(resolveViewStateId(props)).toBe('view-id-y');
    });
});

describe('writeViewInteractionState', () => {
    it('dispatches to the view id in current_file mode with both id lists', () => {
        const props = makeProps({ id: 'view-cf' });
        const { handlers, set_view_managed_state } = makeHandlers();
        writeViewInteractionState(props, handlers, ['doc:p', 'doc:c'], ['doc:c']);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: 'view-cf',
            type: props.type,
            display_options: { view_focused_ids: ['doc:p', 'doc:c'], view_selected_ids: ['doc:c'] },
        }]);
    });

    it('dispatches to FOLDER_VIEW_STATE_ID in folder mode regardless of props.id', () => {
        const props = makeProps({
            id: '/repo/a.md',
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: '/repo' },
        });
        const { handlers, set_view_managed_state } = makeHandlers();
        writeViewInteractionState(props, handlers, ['doc:x'], []);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            type: props.type,
            display_options: { view_focused_ids: ['doc:x'], view_selected_ids: [] },
        }]);
    });
});

describe('nextExpandedIds', () => {
    it('appends an expanded id to an empty or absent list', () => {
        expect(nextExpandedIds(undefined, 'doc:a', true)).toEqual(['doc:a']);
        expect(nextExpandedIds([], 'doc:a', true)).toEqual(['doc:a']);
    });

    it('removes a collapsed id and leaves the rest in order', () => {
        expect(nextExpandedIds(['doc:a', 'doc:b', 'doc:c'], 'doc:b', false)).toEqual(['doc:a', 'doc:c']);
    });

    it('is a no-op transition when collapsing an id that is not listed', () => {
        expect(nextExpandedIds(['doc:a'], 'doc:z', false)).toEqual(['doc:a']);
    });

    it('re-expanding a listed id moves it to the newest slot rather than duplicating it', () => {
        expect(nextExpandedIds(['doc:a', 'doc:b'], 'doc:a', true)).toEqual(['doc:b', 'doc:a']);
    });

    it('caps the list at MAX_EXPANDED_IDS, evicting the oldest first', () => {
        const full_list = Array.from({ length: MAX_EXPANDED_IDS }, (_unused, i) => `doc:${i}`);
        const next_ids = nextExpandedIds(full_list, 'doc:new', true);
        expect(next_ids).toHaveLength(MAX_EXPANDED_IDS);
        expect(next_ids[0]).toBe('doc:1');
        expect(next_ids[next_ids.length - 1]).toBe('doc:new');
        expect(next_ids).not.toContain('doc:0');
    });

    it('does not evict when the list is at the cap and an already-listed id is re-expanded', () => {
        const full_list = Array.from({ length: MAX_EXPANDED_IDS }, (_unused, i) => `doc:${i}`);
        const next_ids = nextExpandedIds(full_list, 'doc:0', true);
        expect(next_ids).toHaveLength(MAX_EXPANDED_IDS);
        expect(next_ids[0]).toBe('doc:1');
        expect(next_ids[next_ids.length - 1]).toBe('doc:0');
    });
});

describe('writeViewExpandedIds', () => {
    it('dispatches to the view id in current_file mode carrying only view_expanded_ids', () => {
        const props = makeProps({ id: 'view-cf' });
        const { handlers, set_view_managed_state } = makeHandlers();
        writeViewExpandedIds(props, handlers, ['doc:a', 'doc:b']);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: 'view-cf',
            type: props.type,
            display_options: { view_expanded_ids: ['doc:a', 'doc:b'] },
        }]);
    });

    it('dispatches to FOLDER_VIEW_STATE_ID in folder mode regardless of props.id', () => {
        const props = makeProps({
            id: '/repo/a.md',
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: '/repo' },
        });
        const { handlers, set_view_managed_state } = makeHandlers();
        writeViewExpandedIds(props, handlers, []);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            type: props.type,
            display_options: { view_expanded_ids: [] },
        }]);
    });

    it('carries no focused/selected keys, so the merge cannot clobber them', () => {
        const { handlers, set_view_managed_state } = makeHandlers();
        writeViewExpandedIds(makeProps(), handlers, ['doc:a']);
        const dispatched = set_view_managed_state.mock.calls[0][0][0].display_options;
        expect(Object.keys(dispatched)).toEqual(['view_expanded_ids']);
    });
});

describe('findFolderViewState', () => {
    it('returns undefined for undefined or empty view states', () => {
        expect(findFolderViewState<ViewStateLike>(undefined)).toBeUndefined();
        expect(findFolderViewState<ViewStateLike>({})).toBeUndefined();
    });

    it('returns the canonical entry when it is tagged folder', () => {
        const canonical: ViewStateLike = { display_options: { integration_mode: 'folder', integration_path: '/repo' } };
        const view_states: Record<string, ViewStateLike> = {
            [FOLDER_VIEW_STATE_ID]: canonical,
            '/repo/a.md': { display_options: { integration_mode: 'folder', integration_path: '/legacy' } },
        };
        expect(findFolderViewState(view_states)).toBe(canonical);
    });

    it('falls back to the first stranded folder-tagged entry when the canonical is not folder', () => {
        const stranded: ViewStateLike = { display_options: { integration_mode: 'folder', integration_path: '/legacy' } };
        const view_states: Record<string, ViewStateLike> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } },
            '/repo/a.md': stranded,
        };
        expect(findFolderViewState(view_states)).toBe(stranded);
    });

    it('returns undefined when no entry is tagged folder', () => {
        const view_states: Record<string, ViewStateLike> = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } },
            '/repo/a.md': { display_options: { integration_mode: 'current_file' } },
        };
        expect(findFolderViewState(view_states)).toBeUndefined();
    });
});

describe('buildIntegrationDispatch', () => {
    it('auto reset to folder: persists auto + the scope path on the canonical key and posts setIntegration folder', () => {
        const { updates, message } = buildIntegrationDispatch({
            is_auto: true,
            resolved_mode: INTEGRATION_MODE_FOLDER,
            folder_path: '/repo/portfolio',
            view_id: 'doc-1',
            view_state_ids: [FOLDER_VIEW_STATE_ID, 'doc-1'],
        });
        expect(updates[0]).toEqual({
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: INTEGRATION_MODE_AUTO, integration_path: '/repo/portfolio', view_focused_ids: undefined, view_selected_ids: undefined },
        });
        // the canonical key is not re-listed in the clear loop; only the non-canonical id is, and it does not clear folder tags (this resolve is folder)
        expect(updates).toHaveLength(2);
        expect(updates[1]).toEqual({ id: 'doc-1', display_options: { view_focused_ids: undefined, view_selected_ids: undefined } });
        expect(message).toEqual({ type: 'setIntegration', mode: INTEGRATION_MODE_FOLDER, path: '/repo/portfolio' });
    });

    it('concrete folder pin: persists the concrete mode, not auto', () => {
        const { updates } = buildIntegrationDispatch({
            is_auto: false,
            resolved_mode: INTEGRATION_MODE_FOLDER,
            folder_path: '/repo',
            view_id: 'doc-1',
            view_state_ids: [],
        });
        expect((updates[0].display_options as Record<string, unknown>).integration_mode).toBe(INTEGRATION_MODE_FOLDER);
    });

    it('resolve to current_file: clears the canonical path and clears stranded folder tags on doc-path keys', () => {
        const { updates, message } = buildIntegrationDispatch({
            is_auto: true,
            resolved_mode: INTEGRATION_MODE_CURRENT_FILE,
            folder_path: undefined,
            view_id: 'doc-1',
            view_state_ids: [FOLDER_VIEW_STATE_ID, 'doc-1'],
        });
        expect(updates[0]).toEqual({
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: INTEGRATION_MODE_AUTO, integration_path: undefined, view_focused_ids: undefined, view_selected_ids: undefined },
        });
        expect(updates[1]).toEqual({
            id: 'doc-1',
            display_options: { view_focused_ids: undefined, view_selected_ids: undefined, integration_mode: undefined, integration_path: undefined },
        });
        expect(message).toEqual({ type: 'setIntegration', mode: INTEGRATION_MODE_CURRENT_FILE, path: undefined });
    });

    it('current_file with a target file (Files-drawer click) carries the file path in the message', () => {
        const { message } = buildIntegrationDispatch({
            is_auto: false,
            resolved_mode: INTEGRATION_MODE_CURRENT_FILE,
            folder_path: undefined,
            view_id: 'doc-1',
            view_state_ids: [],
            target_file_path: '/repo/other.md',
        });
        expect(message).toEqual({ type: 'setIntegration', mode: INTEGRATION_MODE_CURRENT_FILE, path: '/repo/other.md' });
    });

    it('auto reset to current_file with a declared note scope re-seeds parent_context_id on the view id', () => {
        const { updates } = buildIntegrationDispatch({
            is_auto: true,
            resolved_mode: INTEGRATION_MODE_CURRENT_FILE,
            folder_path: undefined,
            seed_parent_context_id: 'Backend',
            view_id: 'doc-1',
            view_state_ids: ['doc-1'],
        });
        expect(updates).toContainEqual({ id: 'doc-1', display_options: { parent_context_id: 'Backend' } });
    });

    it('clears view_expanded_ids on the canonical key and on every other key', () => {
        // folder and current_file address different id spaces, so manual expansion cannot survive the flip
        const { updates } = buildIntegrationDispatch({
            is_auto: true,
            resolved_mode: INTEGRATION_MODE_CURRENT_FILE,
            folder_path: undefined,
            view_id: 'doc-1',
            view_state_ids: [FOLDER_VIEW_STATE_ID, 'doc-1', '/repo/a.md'],
        });
        expect(updates).toHaveLength(3);
        for (const update of updates) {
            const dopts = update.display_options as Record<string, unknown>;
            expect('view_expanded_ids' in dopts).toBe(true);
            expect(dopts.view_expanded_ids).toBeUndefined();
        }
    });

    it('folder with no resolvable scope path posts no setIntegration message', () => {
        const { message } = buildIntegrationDispatch({
            is_auto: true,
            resolved_mode: INTEGRATION_MODE_FOLDER,
            folder_path: undefined,
            view_id: 'doc-1',
            view_state_ids: [],
        });
        expect(message).toBeUndefined();
    });
});
