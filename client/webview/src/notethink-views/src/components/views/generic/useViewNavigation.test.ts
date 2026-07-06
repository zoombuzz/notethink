import { renderHook } from '@testing-library/react';
import { useViewNavigation } from './useViewNavigation';
import type { MutableRefObject } from 'react';
import type { NoteProps, NoteDisplayOptions } from '../../../types/NoteProps';
import type { ViewApi } from '../../../types/ViewProps';

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

function makeHandlers(overrides: Partial<ViewApi> = {}): ViewApi {
    return {
        setViewManagedState: jest.fn(),
        deleteViewFromManagedState: jest.fn(),
        revertAllViewsToDefaultState: jest.fn(),
        postMessage: jest.fn(),
        setViewInteractionState: jest.fn(),
        getClearHandler: jest.fn(() => jest.fn()),
        ...overrides,
    };
}

describe('useViewNavigation', () => {

    it('up navigation writes view interaction state for the previous note so view-driven-wins does not pin focus on the current note', () => {
        const navigation_command_ref: MutableRefObject<((direction: string) => void) | undefined> = { current: undefined };
        const note_a = makeNote({ seq: 1, stable_id: 'a', position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } } });
        const note_b = makeNote({ seq: 2, stable_id: 'b', position: { start: { offset: 20, line: 2 }, end: { offset: 30, line: 2 } } });
        const display_options: NoteDisplayOptions = { focused_seqs: [2], focused_notes: [note_b] };
        const handlers = makeHandlers();
        renderHook(() => useViewNavigation({
            display_options,
            notes_within_parent_context: [note_a, note_b],
            parent_context: undefined,
            parent_context_seq: 0,
            handlers,
            navigation_command_ref,
        }));
        navigation_command_ref.current!('up');
        // third arg is the virtual caret: the target note's start offset moves the board-as-editor caret with no editor
        expect(handlers.setViewInteractionState).toHaveBeenCalledWith(['a'], [], 0);
        expect(handlers.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', from: 0 }));
    });

    it('down navigation writes view interaction state for the next note', () => {
        const navigation_command_ref: MutableRefObject<((direction: string) => void) | undefined> = { current: undefined };
        const note_a = makeNote({ seq: 1, stable_id: 'a', position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } } });
        const note_b = makeNote({ seq: 2, stable_id: 'b', position: { start: { offset: 20, line: 2 }, end: { offset: 30, line: 2 } } });
        const display_options: NoteDisplayOptions = { focused_seqs: [1], focused_notes: [note_a] };
        const handlers = makeHandlers();
        renderHook(() => useViewNavigation({
            display_options,
            notes_within_parent_context: [note_a, note_b],
            parent_context: undefined,
            parent_context_seq: 0,
            handlers,
            navigation_command_ref,
        }));
        navigation_command_ref.current!('down');
        // third arg is the virtual caret: note_b's start offset (20)
        expect(handlers.setViewInteractionState).toHaveBeenCalledWith(['b'], [], 20);
        expect(handlers.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealRange', from: 20 }));
    });

    it('up navigation includes ancestor stable_ids in the target chain so the deeper focused state is preserved through useViewContext', () => {
        const navigation_command_ref: MutableRefObject<((direction: string) => void) | undefined> = { current: undefined };
        const parent = makeNote({ seq: 1, stable_id: 'p', position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } } });
        const child = makeNote({ seq: 2, stable_id: 'c', parent_notes: [parent], position: { start: { offset: 20, line: 2 }, end: { offset: 30, line: 2 } } });
        const display_options: NoteDisplayOptions = { focused_seqs: [99], focused_notes: [] };
        const handlers = makeHandlers();
        renderHook(() => useViewNavigation({
            display_options,
            notes_within_parent_context: [parent, child],
            parent_context: undefined,
            parent_context_seq: 0,
            handlers,
            navigation_command_ref,
        }));
        // current focused seq (99) isn't in the list, so findIndex returns -1; prev_index = 0; target = parent
        navigation_command_ref.current!('up');
        // third arg is the virtual caret: the parent's start offset (0)
        expect(handlers.setViewInteractionState).toHaveBeenCalledWith(['p'], [], 0);
    });

    it('clearFocus routes through getClearHandler', () => {
        const navigation_command_ref: MutableRefObject<((direction: string) => void) | undefined> = { current: undefined };
        const inner_clear = jest.fn();
        const handlers = makeHandlers({ getClearHandler: jest.fn(() => inner_clear) });
        renderHook(() => useViewNavigation({
            display_options: { focused_seqs: [1], focused_notes: [makeNote({ seq: 1 })] },
            notes_within_parent_context: [],
            parent_context: undefined,
            parent_context_seq: 0,
            handlers,
            navigation_command_ref,
        }));
        navigation_command_ref.current!('clearFocus');
        expect(handlers.getClearHandler).toHaveBeenCalled();
        expect(inner_clear).toHaveBeenCalled();
    });
});
