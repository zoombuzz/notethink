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

    it('click on a non-focused, non-selected note writes view_focused_seqs and posts revealRange', () => {
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
        const note = makeNote({ seq: 5 });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), note, click_profile);
        // view-driven state-of-truth: focused = [seq], selected = []
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_seqs: [5], view_selected_seqs: [] },
        }]);
        // editor reveal still posts so the cursor follows opportunistically
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', from: 10 }));
    });

    it('clicking a focused note promotes to selected: writes view_selected_seqs and posts selectRange', () => {
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
        const note = makeNote({ seq: 5, focused: true, position: { start: { offset: 10, line: 1 }, end: { offset: 20, line: 1 }, end_body: { offset: 50, line: 5 } } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), note, click_profile);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_seqs: [5], view_selected_seqs: [5] },
        }]);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'selectRange', from: 10, to: 50 }));
    });

    it('click on a different note replaces focused seqs and drops any selection', () => {
        const set_view_managed_state = jest.fn();
        const props = makeProps({
            handlers: {
                setViewManagedState: set_view_managed_state,
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: jest.fn(),
            },
        });
        const other = makeNote({ seq: 7, focused: false, selected: false });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), other, click_profile);
        // new focused note = [7], selected dropped to []
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_seqs: [7], view_selected_seqs: [] },
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
        const note = makeNote({ seq: 3, origin: { doc_id: 'a', doc_path: origin_doc_path } });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent(), note, click_profile);
        // state writes go to the canonical folder key
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            type: props.type,
            display_options: { view_focused_seqs: [3], view_selected_seqs: [] },
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
        const note = makeNote({ seq: 9 });
        const { result } = renderHook(() => useViewHandlers(props, makeSelectionRef(undefined)));
        result.current.handlers.click!(mockClickEvent({ detail: 2 }), note, click_profile);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_seqs: [9], view_selected_seqs: [9] },
        }]);
        expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ type: 'selectRange', from: 10, to: 50 }));
    });
});

describe('useViewHandlers getClearHandler', () => {
    it('clears view-driven seqs so the view-driven-wins policy in useViewContext does not pin focus after a clear gesture', () => {
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
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: props.id,
            type: props.type,
            display_options: { view_focused_seqs: [], view_selected_seqs: [] },
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
    it('writes focused/selected seqs to the canonical key for the integration mode', () => {
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
        result.current.handlers.setViewInteractionState!([3, 7], [7]);
        expect(set_view_managed_state).toHaveBeenCalledWith([{
            id: FOLDER_VIEW_STATE_ID,
            type: props.type,
            display_options: { view_focused_seqs: [3, 7], view_selected_seqs: [7] },
        }]);
    });
});
