import {
    FOLDER_VIEW_STATE_ID,
    anyViewInFolderMode,
    resolveViewStateId,
    writeViewInteractionState,
    findFolderViewState,
    type ViewStateLike,
} from './viewstateops';
import { INTEGRATION_MODE_CURRENT_FILE, INTEGRATION_MODE_FOLDER } from '../types/IntegrationMode';
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
    it('dispatches to the view id in current_file mode with both seq lists', () => {
        const props = makeProps({ id: 'view-cf' });
        const { handlers, set_view_managed_state } = makeHandlers();
        writeViewInteractionState(props, handlers, [3, 5], [5]);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: 'view-cf',
            type: props.type,
            display_options: { view_focused_seqs: [3, 5], view_selected_seqs: [5] },
        }]);
    });

    it('dispatches to FOLDER_VIEW_STATE_ID in folder mode regardless of props.id', () => {
        const props = makeProps({
            id: '/repo/a.md',
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: '/repo' },
        });
        const { handlers, set_view_managed_state } = makeHandlers();
        writeViewInteractionState(props, handlers, [7], []);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            type: props.type,
            display_options: { view_focused_seqs: [7], view_selected_seqs: [] },
        }]);
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
