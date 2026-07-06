import { renderHook } from '@testing-library/react';
import { useViewHandlers } from './useViewHandlers';
import { FOLDER_VIEW_STATE_ID } from '../../../lib/mergeAggregateRoot';
import { INTEGRATION_MODE_FOLDER, INTEGRATION_MODE_CURRENT_FILE } from '../../../types/IntegrationMode';
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react';
import type { ClickPositionInfo, NoteProps, TextSelection } from '../../../types/NoteProps';
import type { ViewProps } from '../../../types/ViewProps';

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 0,
        level: 1,
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 50, line: 5 },
        },
        headline_raw: '',
        body_raw: '',
        ...overrides,
    };
}

function makeProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'view-doc-a',
        type: 'document',
        display_options: { integration_mode: INTEGRATION_MODE_CURRENT_FILE },
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
            postMessage: jest.fn(),
        },
        ...overrides,
    };
}

function mockClickEvent(overrides: Record<string, unknown> = {}): ReactMouseEvent<HTMLElement> {
    return {
        detail: 1,
        target: {},
        stopPropagation: jest.fn(),
        ...overrides,
    } as unknown as ReactMouseEvent<HTMLElement>;
}

function makeSelectionRef(selection: TextSelection | undefined): MutableRefObject<TextSelection | undefined> {
    return { current: selection };
}

describe('useViewHandlers click dispatcher', () => {

    const click_profile: ClickPositionInfo = {
        from: 10, to: 30,
        selection_from: 10, selection_to: 50,
        type: 'note_headline',
    };

    it('click on a non-focused, non-selected note writes view_focused_ids and posts revealRange', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeProps({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        const note = makeNote({ seq: 5, stable_id: 'n5' });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), note, click_profile);
        // view-driven state-of-truth: focused = [stable_id], selected = [], virtual caret = click offset (10)
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: ['n5'], view_selected_ids: [], view_caret: 10 },
        }]);
        // editor reveal still posts so the cursor follows opportunistically
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', from: 10, forceOpen: false }));
    });

    it('ctrl-click posts revealRange with forceOpen so the source opens even when openNewEditorIfNoneOpen is off', () => {
        const post_message = jest.fn();
        const props = makeProps({
            handlers: { setViewManagedState: jest.fn(), deleteViewFromManagedState: jest.fn(), revertAllViewsToDefaultState: jest.fn(), postMessage: post_message },
        });
        const note = makeNote({ seq: 5, stable_id: 'n5' });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent({ ctrlKey: true }), note, click_profile);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', forceOpen: true }));
    });

    it('cmd-click (metaKey) also forces the source open', () => {
        const post_message = jest.fn();
        const props = makeProps({
            handlers: { setViewManagedState: jest.fn(), deleteViewFromManagedState: jest.fn(), revertAllViewsToDefaultState: jest.fn(), postMessage: post_message },
        });
        const note = makeNote({ seq: 5, stable_id: 'n5' });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent({ metaKey: true }), note, click_profile);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', forceOpen: true }));
    });

    it('clicking a focused note promotes to selected: writes view_selected_ids and posts selectRange', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeProps({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        // note.focused = true simulates the GenericNote enrichment from a prior focus; position.start.offset matches click_profile.from (click on the note's own headline) so the "second-click promotes" rule triggers via the view-state path
        const note = makeNote({ seq: 5, stable_id: 'n5', focused: true, position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 1 }, end_body: { offset: 50, line: 5 } } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), note, click_profile);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: ['n5'], view_selected_ids: ['n5'], view_caret: 10 },
        }]);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'selectRange', from: 10, to: 50 }));
    });

    it('click on a different note replaces focused ids and drops any selection', () => {
        const set_view_managed_state = jest.fn();
        const props = makeProps({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: jest.fn(),
            },
        });
        const other = makeNote({ seq: 7, stable_id: 'n7', focused: false, selected: false });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), other, click_profile);
        // new focused note = ['n7'], selected dropped to [], virtual caret = click offset (10)
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: ['n7'], view_selected_ids: [], view_caret: 10 },
        }]);
    });

    it('folder mode: click writes to FOLDER_VIEW_STATE_ID and routes postMessage to the note origin doc', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeProps({
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: '/repo' },
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        const origin_doc_path = '/repo/a/todo.md';
        const note = makeNote({ seq: 3, stable_id: 'n3', origin: { doc_id: 'a', doc_path: origin_doc_path } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), note, click_profile);
        // state writes go to the canonical folder key
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            type: props.type,
            display_options: { view_focused_ids: ['n3'], view_selected_ids: [], view_caret: 10 },
        }]);
        // editor reveal targets the origin doc
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', docPath: origin_doc_path }));
    });

    it('double-click selects directly (skips the two-step focus → select gesture)', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeProps({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        const note = makeNote({ seq: 9, stable_id: 'n9' });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent({ detail: 2 }), note, click_profile);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: ['n9'], view_selected_ids: ['n9'], view_caret: 10 },
        }]);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'selectRange', from: 10, to: 50 }));
    });
});

describe('useViewHandlers virtual-caret parity (no editor)', () => {

    // body click: caret offset (25) differs from the note headline start (0) so only the virtual caret, not the view-focused-headline path, can promote focus to select
    const body_click: ClickPositionInfo = { from: 25, to: 30, selection_from: 0, selection_to: 50, type: 'note_body' };

    it('a first click highlights the note and a second click at the same offset promotes to selected via the virtual caret', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const note = makeNote({ seq: 5, stable_id: 'n5', position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 }, end_body: { offset: 50, line: 5 } } });
        // first render: no editor and no prior virtual caret
        const first_props = makeProps({
            handlers: { setViewManagedState: set_view_managed_state, deleteViewFromManagedState: jest.fn(), revertAllViewsToDefaultState: jest.fn(), postMessage: post_message },
        });
        const { result, rerender } = renderHook(
            ({ p }: { p: ViewProps }) => useViewHandlers(p, makeSelectionRef(undefined)),
            { initialProps: { p: first_props } },
        );
        result.current.handlers.click!(mockClickEvent(), note, body_click);
        // first click highlights: focused set, selection empty, virtual caret stamped at the click offset (25)
        expect(set_view_managed_state).toHaveBeenLastCalledWith([{
            id: first_props.id,
            type: first_props.type,
            display_options: { view_focused_ids: ['n5'], view_selected_ids: [], view_caret: 25 },
        }]);
        // second render: the store now carries the virtual caret from click 1 and the note is enriched focused
        const second_props = makeProps({
            display_options: { integration_mode: INTEGRATION_MODE_CURRENT_FILE, view_caret: 25 },
            handlers: { setViewManagedState: set_view_managed_state, deleteViewFromManagedState: jest.fn(), revertAllViewsToDefaultState: jest.fn(), postMessage: post_message },
        });
        rerender({ p: second_props });
        result.current.handlers.click!(mockClickEvent(), { ...note, focused: true }, body_click);
        // effective_head = view_caret (25) === caret_pos (25), so the second click promotes to selected with no editor
        expect(set_view_managed_state).toHaveBeenLastCalledWith([{
            id: second_props.id,
            type: second_props.type,
            display_options: { view_focused_ids: ['n5'], view_selected_ids: ['n5'], view_caret: 25 },
        }]);
        expect(post_message).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'selectRange' }));
    });

    it('without a virtual caret and no editor, a body click on a focused note does not promote to selected', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        // focused note, but the store carries no virtual caret and there is no editor head
        const props = makeProps({
            handlers: { setViewManagedState: set_view_managed_state, deleteViewFromManagedState: jest.fn(), revertAllViewsToDefaultState: jest.fn(), postMessage: post_message },
        });
        const focused_note = makeNote({ seq: 5, stable_id: 'n5', focused: true, position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 }, end_body: { offset: 50, line: 5 } } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), focused_note, body_click);
        // caret (25) != headline start (0) and no virtual caret -> isAlreadyFocusedClick false -> first-click branch keeps selection empty
        expect(set_view_managed_state).toHaveBeenLastCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: ['n5'], view_selected_ids: [], view_caret: 25 },
        }]);
        expect(post_message).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'revealRange' }));
    });
});

describe('useViewHandlers getClearHandler', () => {
    it('clears view-driven ids so the view-driven-wins policy in useViewContext does not pin focus after a clear gesture', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeProps({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        const focused_note = makeNote({ seq: 5, stable_id: 'n5', position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 1 }, end_body: { offset: 50, line: 5 } } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        const clear_handler = result.current.handlers.getClearHandler!([focused_note]);
        clear_handler(mockClickEvent());
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: [], view_selected_ids: [] },
        }]);
    });

    it('still posts a revealRange past the focused note end so the editor caret leaves the note', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeProps({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        const focused_note = makeNote({ seq: 5, position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 1 }, end_body: { offset: 50, line: 5 } } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        const clear_handler = result.current.handlers.getClearHandler!([focused_note]);
        clear_handler(mockClickEvent());
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', from: 51 }));
    });
});

describe('useViewHandlers setViewInteractionState', () => {
    it('writes focused/selected stable_ids to the canonical key for the integration mode', () => {
        const set_view_managed_state = jest.fn();
        const props = makeProps({
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: '/repo' },
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: jest.fn(),
            },
        });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.setViewInteractionState!(['a', 'b'], ['b']);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            type: props.type,
            display_options: { view_focused_ids: ['a', 'b'], view_selected_ids: ['b'] },
        }]);
    });
});

describe('useViewHandlers handle_folder_click congruence', () => {
    function folderClick(file_declared_integration: ViewProps['file_declared_integration']): { set_view_managed_state: jest.Mock; post_message: jest.Mock } {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeProps({
            file_declared_integration,
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handle_folder_click('/repo/portfolio');
        return { set_view_managed_state, post_message };
    }

    it('stays auto when the destination folder is congruent with a folder-declaring file', () => {
        const { set_view_managed_state, post_message } = folderClick({ mode: INTEGRATION_MODE_FOLDER });
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: 'auto', integration_path: '/repo/portfolio' },
        }]);
        // the extension always receives the concrete folder mode
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: INTEGRATION_MODE_FOLDER, path: '/repo/portfolio' });
    });

    it('pins concrete folder when the file declares current_file (navigation diverges)', () => {
        const { set_view_managed_state } = folderClick({ mode: INTEGRATION_MODE_CURRENT_FILE });
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: 'folder', integration_path: '/repo/portfolio' },
        }]);
    });

    it('pins concrete folder when the file declares nothing (treated as current_file)', () => {
        const { set_view_managed_state } = folderClick(undefined);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: 'folder', integration_path: '/repo/portfolio' },
        }]);
    });
});

describe('useViewHandlers revealNote', () => {
    it('folder mode: reveals the origin source offset and origin doc_path', () => {
        const post_message = jest.fn();
        const props = makeProps({
            id: FOLDER_VIEW_STATE_ID,
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: '/repo' },
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        // the in-tree position is a synthetic merged offset (999); revealNote must use the pre-merge source_position offset (42) instead
        const note = makeNote({
            seq: 3,
            position: { start: { offset: 999, line: 1 }, end: { offset: 1000, line: 1 } },
            origin: { doc_id: 'a', doc_path: '/repo/a/todo.md', source_position: { start: { offset: 42, line: 4 }, end: { offset: 60, line: 4 } } },
        });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.revealNote!(note);
        expect(post_message).toHaveBeenCalledWith({ type: 'revealRange', from: 42, docPath: '/repo/a/todo.md' });
    });

    it('single-file mode: falls back to the in-tree position offset and the view doc_path', () => {
        const post_message = jest.fn();
        const props = makeProps({
            doc_path: '/ws/open.md',
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        // no origin in single-file mode: reveal must supply the view's own doc_path so the extension doesn't no-op
        const note = makeNote({ seq: 2, position: { start: { offset: 17, line: 3 }, end: { offset: 30, line: 3 } } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.revealNote!(note);
        expect(post_message).toHaveBeenCalledWith({ type: 'revealRange', from: 17, docPath: '/ws/open.md' });
    });
});

describe('useViewHandlers.handle_apply_filters', () => {

    function makeFolderProps(set_view_managed_state: jest.Mock, post_message: jest.Mock): ViewProps {
        return makeProps({
            id: 'folder-view',
            display_options: { integration_mode: INTEGRATION_MODE_FOLDER, integration_path: '/repo/notes' },
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
    }

    // the include/exclude globs are config-tier cascade settings with a single source of truth (VS Code config, echoed back). Writing them to per-view state would let the drawer drift from the globs discovery actually used and would shadow the config the Reset buttons clear, so handle_apply_filters must NOT persist them to viewState
    it('does not write include/exclude globs to per-view state (only the webview-side maxNotesPerFile cap)', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeFolderProps(set_view_managed_state, post_message);
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handle_apply_filters('**/todo.md', '**/{node_modules}/**', 7);
        expect(set_view_managed_state).toHaveBeenCalledTimes(1);
        const update = set_view_managed_state.mock.calls[0][0][0];
        expect(update.display_options).toEqual({ maxNotesPerFile: 7 });
        expect(update.display_options).not.toHaveProperty('includeFilter');
        expect(update.display_options).not.toHaveProperty('excludeFilter');
    });

    it('re-discovers via setIntegration and round-trips every filter to VS Code config', () => {
        const set_view_managed_state = jest.fn();
        const post_message = jest.fn();
        const props = makeFolderProps(set_view_managed_state, post_message);
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handle_apply_filters('**/todo.md', '**/{node_modules}/**', 7);
        expect(post_message).toHaveBeenCalledWith({ type: 'setIntegration', mode: INTEGRATION_MODE_FOLDER, path: '/repo/notes', include: '**/todo.md', exclude: '**/{node_modules}/**' });
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'includeFilter', value: '**/todo.md' });
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'excludeFilter', value: '**/{node_modules}/**' });
        expect(post_message).toHaveBeenCalledWith({ type: 'updateSetting', setting: 'maxNotesPerFile', value: 7 });
    });
});
