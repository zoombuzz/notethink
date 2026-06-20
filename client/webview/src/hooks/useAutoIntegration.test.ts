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

describe('useAutoIntegration reactive follow', () => {

    // a mutable-ref harness so a test can simulate the parent applying a dispatch (view_states_ref.current) then switch the active editor / edit the file via rerender
    function reactiveHarness(initial_doc: Doc) {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const view_states_ref: { current: Record<string, ViewState> } = { current: {} };
        const makeProps = (active_path: string, docs: HashMapOf<Doc>): Parameters<typeof useAutoIntegration>[0] => ({
            docs,
            active_editor_doc_path: active_path,
            workspace_root: '/repo',
            view_states_ref,
            postMessage: post_message,
            setViewManagedState: set_view_managed_state,
        });
        const { rerender } = renderHook((p: Parameters<typeof useAutoIntegration>[0]) => useAutoIntegration(p), {
            initialProps: makeProps(initial_doc.path!, { [initial_doc.id]: initial_doc }),
        });
        return { set_view_managed_state, post_message, view_states_ref, makeProps, rerender };
    }

    // persisted shape after an auto-resolution to folder@path (what the parent would write back)
    function folderState(path: string): Record<string, ViewState> {
        return { [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'auto', integration_path: path } } };
    }

    const mobile = () => parsedDoc('# Mobile [](?nt_integration_mode=folder)', { id: 'mobile', path: '/repo/portfolio/mobile-app.md', relative_path: 'portfolio/mobile-app.md', hash_sha256: 'h-mobile' });

    it('EXIT (the bug): switching the active editor to a plain file OUTSIDE the scope drops to current_file', () => {
        const h = reactiveHarness(mobile());
        // cold open entered folder@/repo/portfolio
        expect(h.post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/portfolio' });
        h.view_states_ref.current = folderState('/repo/portfolio');
        h.post_message.mockClear();
        h.set_view_managed_state.mockClear();
        // switch to intro.md (declares nothing, sits outside portfolio)
        const intro = parsedDoc('# Welcome', { id: 'intro', path: '/repo/intro.md', relative_path: 'intro.md', hash_sha256: 'h-intro' });
        h.rerender(h.makeProps('/repo/intro.md', { mobile: mobile(), intro }));
        expect(h.post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'current_file', path: undefined });
    });

    it('card-click gate: revealing a member file INSIDE the scope keeps the board', () => {
        const h = reactiveHarness(mobile());
        h.view_states_ref.current = folderState('/repo/portfolio');
        h.post_message.mockClear();
        h.set_view_managed_state.mockClear();
        const member = parsedDoc('# Member', { id: 'member', path: '/repo/portfolio/member.md', relative_path: 'portfolio/member.md', hash_sha256: 'h-member' });
        h.rerender(h.makeProps('/repo/portfolio/member.md', { mobile: mobile(), member }));
        expect(h.post_message).not.toHaveBeenCalled();
        expect(h.set_view_managed_state).not.toHaveBeenCalled();
    });

    it('reactive edit: removing the folder declaration from the active file exits to current_file', () => {
        const h = reactiveHarness(mobile());
        h.view_states_ref.current = folderState('/repo/portfolio');
        h.post_message.mockClear();
        // same doc id, new hash, declaration removed
        const edited = parsedDoc('# Mobile', { id: 'mobile', path: '/repo/portfolio/mobile-app.md', relative_path: 'portfolio/mobile-app.md', hash_sha256: 'h-mobile-2' });
        h.rerender(h.makeProps('/repo/portfolio/mobile-app.md', { mobile: edited }));
        expect(h.post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'current_file', path: undefined });
    });

    it('reactive edit: adding a folder declaration to a plain file enters folder mode', () => {
        const plain = parsedDoc('# Notes', { id: 'd', path: '/repo/portfolio/notes.md', relative_path: 'portfolio/notes.md', hash_sha256: 'p1' });
        const h = reactiveHarness(plain);
        // cold current_file: nothing dispatched
        expect(h.set_view_managed_state).not.toHaveBeenCalled();
        const edited = parsedDoc('# Notes [](?nt_integration_mode=folder)', { id: 'd', path: '/repo/portfolio/notes.md', relative_path: 'portfolio/notes.md', hash_sha256: 'p2' });
        h.rerender(h.makeProps('/repo/portfolio/notes.md', { d: edited }));
        expect(h.post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/portfolio' });
    });

    it('re-snap (D1): switching to a file declaring a DIFFERENT folder re-snaps the board', () => {
        const a = parsedDoc('# A [](?nt_integration_mode=folder)', { id: 'a', path: '/repo/folderA/a.md', relative_path: 'folderA/a.md', hash_sha256: 'ha' });
        const h = reactiveHarness(a);
        expect(h.post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/folderA' });
        h.view_states_ref.current = folderState('/repo/folderA');
        h.post_message.mockClear();
        const b = parsedDoc('# B [](?nt_integration_mode=folder)', { id: 'b', path: '/repo/folderB/b.md', relative_path: 'folderB/b.md', hash_sha256: 'hb' });
        h.rerender(h.makeProps('/repo/folderB/b.md', { a, b }));
        expect(h.post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: 'folder', path: '/repo/folderB' });
    });

    it('preserve (D2): a same-file re-derive does not yank back a breadcrumb descent', () => {
        const h = reactiveHarness(mobile());
        // user breadcrumb-navigates deeper within the SAME file
        h.view_states_ref.current = folderState('/repo/portfolio/sub');
        h.post_message.mockClear();
        h.set_view_managed_state.mockClear();
        // a content edit that does not touch the integration tags
        const edited = parsedDoc('# Mobile [](?nt_integration_mode=folder)', { id: 'mobile', path: '/repo/portfolio/mobile-app.md', relative_path: 'portfolio/mobile-app.md', hash_sha256: 'h-mobile-3' });
        h.rerender(h.makeProps('/repo/portfolio/mobile-app.md', { mobile: edited }));
        expect(h.post_message).not.toHaveBeenCalled();
        expect(h.set_view_managed_state).not.toHaveBeenCalled();
    });

});
