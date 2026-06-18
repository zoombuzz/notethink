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
        // view-driven state-of-truth: focused = [stable_id], selected = []
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: ['n5'], view_selected_ids: [] },
        }]);
        // editor reveal still posts so the cursor follows opportunistically
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', from: 10 }));
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
            display_options: { view_focused_ids: ['n5'], view_selected_ids: ['n5'] },
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
        // new focused note = ['n7'], selected dropped to []
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_ids: ['n7'], view_selected_ids: [] },
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
            display_options: { view_focused_ids: ['n3'], view_selected_ids: [] },
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
            display_options: { view_focused_ids: ['n9'], view_selected_ids: ['n9'] },
        }]);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'selectRange', from: 10, to: 50 }));
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
