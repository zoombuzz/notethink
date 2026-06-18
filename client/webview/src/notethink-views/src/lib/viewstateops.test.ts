import {
    FOLDER_VIEW_STATE_ID,
    anyViewInFolderMode,
    reconcileAutoIntegrationMode,
    resolveIntegrationMode,
    resolveViewStateId,
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
