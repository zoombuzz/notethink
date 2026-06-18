import { renderHook } from '@testing-library/react';
import { useAutoIntegration } from './useAutoIntegration';
import { FOLDER_VIEW_STATE_ID } from '../notethink-views/src/lib/viewstateops';
import type { Doc, HashMapOf } from '../types/general';
import type { ViewState } from './usePersistedViewStates';

// build a Doc with manually-offset MDAST so resolveFileIntegrationDeclaration can read its H1
function parsedDoc(h1_line: string, overrides: Partial<Doc> = {}): Doc {
    const text = `${h1_line}\n`;
    return {
        id: 'doc-1',
        path: '/repo/portfolio/atlas.md',
        relative_path: 'portfolio/atlas.md',
        hash_sha256: 'h1',
        content: {
            type: 'root',
            position: { start: { offset: 0, line: 0 }, end: { offset: text.length, line: 0 } },
            children: [{ type: 'heading', depth: 1, position: { start: { offset: 0, line: 0 }, end: { offset: h1_line.length, line: 0 } }, children: [] }],
        } as unknown as Doc['content'],
        text,
        ...overrides,
    };
}

function makeDeps(doc: Doc, view_states: Record<string, ViewState>): { deps: Parameters<typeof useAutoIntegration>[0]; set_view_managed_state: jest.Mock; post_message: jest.Mock } {
    const set_view_managed_state = jest.fn();
    const post_message = jest.fn();
    const docs: HashMapOf<Doc> = { [doc.id]: doc };
    return {
        deps: {
            docs,
            active_editor_doc_path: doc.path,
            workspace_root: '/repo',
            view_states_ref: { current: view_states },
            postMessage: post_message,
            setViewManagedState: set_view_managed_state,
        },
        set_view_managed_state,
        post_message,
    };
}

describe('useAutoIntegration', () => {

    it('cold open: a folder-declaring file seeds auto + the folder path and posts setIntegration', () => {
        const { deps, set_view_managed_state, post_message } = makeDeps(
            parsedDoc('# Atlas [](?nt_integration_mode=folder)'),
            {},
        );
        const { result } = renderHook(() => useAutoIntegration(deps));
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: 'auto', integration_path: '/repo/portfolio' },
        }]);
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/portfolio' });
        expect(result.current).toEqual({ mode: 'folder', integration_path: '/repo/portfolio' });
    });

    it('does not override a concrete user pin (folder)', () => {
        const { deps, set_view_managed_state, post_message } = makeDeps(
            parsedDoc('# Atlas [](?nt_integration_mode=folder)'),
            { [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder', integration_path: '/repo' } } },
        );
        renderHook(() => useAutoIntegration(deps));
        expect(set_view_managed_state).not.toHaveBeenCalled();
        expect(post_message).not.toHaveBeenCalled();
    });

    it('does not override a concrete user pin (current_file)', () => {
        const { deps, set_view_managed_state, post_message } = makeDeps(
            parsedDoc('# Atlas [](?nt_integration_mode=folder)'),
            { [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } } },
        );
        renderHook(() => useAutoIntegration(deps));
        expect(set_view_managed_state).not.toHaveBeenCalled();
        expect(post_message).not.toHaveBeenCalled();
    });

    it('reload: an auto state already resolved to the folder is not re-dispatched (navigated path preserved)', () => {
        const { deps, set_view_managed_state, post_message } = makeDeps(
            parsedDoc('# Atlas [](?nt_integration_mode=folder)'),
            { [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'auto', integration_path: '/repo/elsewhere' } } },
        );
        renderHook(() => useAutoIntegration(deps));
        expect(set_view_managed_state).not.toHaveBeenCalled();
        expect(post_message).not.toHaveBeenCalled();
    });

    it('a file that declares nothing dispatches nothing and resolves to current_file', () => {
        const { deps, set_view_managed_state, post_message } = makeDeps(parsedDoc('# Atlas'), {});
        const { result } = renderHook(() => useAutoIntegration(deps));
        expect(set_view_managed_state).not.toHaveBeenCalled();
        expect(post_message).not.toHaveBeenCalled();
        expect(result.current).toEqual({ mode: 'current_file' });
    });

    it('returns undefined and dispatches nothing when there are no docs', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const { result } = renderHook(() => useAutoIntegration({
            docs: undefined,
            active_editor_doc_path: undefined,
            workspace_root: '/repo',
            view_states_ref: { current: {} },
            postMessage: post_message,
            setViewManagedState: set_view_managed_state,
        }));
        expect(result.current).toBeUndefined();
        expect(set_view_managed_state).not.toHaveBeenCalled();
    });

});
