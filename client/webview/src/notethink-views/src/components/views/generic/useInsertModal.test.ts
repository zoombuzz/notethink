import { renderHook, act, type RenderHookResult } from '@testing-library/react';
import { useInsertModal, type InsertModalState } from './useInsertModal';
import type { ViewProps, ViewApi } from '../../../types/ViewProps';

interface TextSelectionLike { main: { head: number } }
interface InsertSetup {
    result: RenderHookResult<InsertModalState, unknown>['result'];
    postMessage: jest.Mock;
}
interface EditTextChange { from: number; insert: string }

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

function makeProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        doc_text: '',
        ...overrides,
    } as ViewProps;
}

function selectionAt(head: number): TextSelectionLike {
    return { main: { head } };
}

/** render the hook and return the live state plus the postMessage spy */
function setup(props_overrides: Partial<ViewProps> = {}, handler_overrides: Partial<ViewApi> = {}): InsertSetup {
    const handlers = makeHandlers(handler_overrides);
    const { result } = renderHook(() => useInsertModal(makeProps(props_overrides), handlers));
    return { result, postMessage: handlers.postMessage as jest.Mock };
}

/** pull the single editText change dispatched by handle_insert */
function lastChange(postMessage: jest.Mock): EditTextChange {
    expect(postMessage).toHaveBeenCalledTimes(1);
    const message = postMessage.mock.calls[0][0];
    expect(message.type).toBe('editText');
    expect(message.changes).toHaveLength(1);
    return message.changes[0] as EditTextChange;
}

describe('useInsertModal', () => {

    describe('modal open state', () => {
        it('starts closed and opens/closes on demand', () => {
            const { result } = setup();
            expect(result.current.insert_modal_open).toBe(false);

            act(() => result.current.open_insert_modal());
            expect(result.current.insert_modal_open).toBe(true);

            act(() => result.current.close_insert_modal());
            expect(result.current.insert_modal_open).toBe(false);
        });
    });

    describe('insert point → offset resolution', () => {
        // doc layout (offsets):  "alpha\nbeta\ngamma"
        //   alpha  0..5   (newline at 5)
        //   beta   6..10  (newline at 10)
        //   gamma  11..16
        const DOC = 'alpha\nbeta\ngamma';

        it('currentCaret inserts at the caret head', () => {
            const { result, postMessage } = setup({ doc_text: DOC, selection: selectionAt(8) });
            act(() => result.current.handle_insert('X', 'currentCaret'));
            expect(lastChange(postMessage)).toEqual({ from: 8, insert: 'X' });
        });

        it('startOfLine inserts at the first char of the caret line', () => {
            // caret at 8 (inside "beta") → start of "beta" line is offset 6
            const { result, postMessage } = setup({ doc_text: DOC, selection: selectionAt(8) });
            act(() => result.current.handle_insert('X', 'startOfLine'));
            expect(lastChange(postMessage)).toEqual({ from: 6, insert: 'X' });
        });

        it('startOfLine on the first line resolves to offset 0', () => {
            const { result, postMessage } = setup({ doc_text: DOC, selection: selectionAt(3) });
            act(() => result.current.handle_insert('X', 'startOfLine'));
            expect(lastChange(postMessage)).toEqual({ from: 0, insert: 'X' });
        });

        it('endOfLine inserts at the newline terminating the caret line', () => {
            // caret at 8 (inside "beta") → end of "beta" line is the newline at offset 10
            const { result, postMessage } = setup({ doc_text: DOC, selection: selectionAt(8) });
            act(() => result.current.handle_insert('X', 'endOfLine'));
            expect(lastChange(postMessage)).toEqual({ from: 10, insert: 'X' });
        });

        it('endOfLine on the final (newline-less) line resolves to doc end', () => {
            // caret at 13 (inside "gamma", no trailing newline) → doc end is 16
            const { result, postMessage } = setup({ doc_text: DOC, selection: selectionAt(13) });
            act(() => result.current.handle_insert('X', 'endOfLine'));
            expect(lastChange(postMessage)).toEqual({ from: DOC.length, insert: 'X' });
        });

        it('endOfNote inserts at the document end regardless of caret', () => {
            const { result, postMessage } = setup({ doc_text: DOC, selection: selectionAt(2) });
            act(() => result.current.handle_insert('X', 'endOfNote'));
            expect(lastChange(postMessage)).toEqual({ from: DOC.length, insert: 'X' });
        });

        it('unknown insert points fall back to the caret head', () => {
            const { result, postMessage } = setup({ doc_text: DOC, selection: selectionAt(4) });
            act(() => result.current.handle_insert('X', 'somethingElse'));
            expect(lastChange(postMessage)).toEqual({ from: 4, insert: 'X' });
        });
    });

    describe('missing selection / empty document', () => {
        it('falls back to document end when there is no selection', () => {
            const { result, postMessage } = setup({ doc_text: 'hello world', selection: undefined });
            act(() => result.current.handle_insert('X', 'currentCaret'));
            expect(lastChange(postMessage)).toEqual({ from: 'hello world'.length, insert: 'X' });
        });

        it('resolves every insert point to 0 in an empty document', () => {
            for (const point of ['currentCaret', 'startOfLine', 'endOfLine', 'endOfNote']) {
                const { result, postMessage } = setup({ doc_text: '', selection: undefined });
                act(() => result.current.handle_insert('X', point));
                expect(lastChange(postMessage)).toEqual({ from: 0, insert: 'X' });
            }
        });

        it('tolerates an undefined doc_text', () => {
            const { result, postMessage } = setup({ doc_text: undefined, selection: undefined });
            act(() => result.current.handle_insert('# ', 'endOfNote'));
            expect(lastChange(postMessage)).toEqual({ from: 0, insert: '# ' });
        });
    });

    describe('dispatch payload', () => {
        it('forwards the template text verbatim, including multi-line content', () => {
            const template = '\n\n```mermaid\nflowchart TD\n    A[Start] --> E[End]\n```\n';
            const { result, postMessage } = setup({ doc_text: 'abc', selection: selectionAt(3) });
            act(() => result.current.handle_insert(template, 'endOfNote'));
            expect(lastChange(postMessage)).toEqual({ from: 3, insert: template });
        });

        it('does not dispatch when postMessage is unavailable', () => {
            // optional postMessage on ViewApi — guard must not throw.
            const { result } = renderHook(() => useInsertModal(
                makeProps({ doc_text: 'abc', selection: selectionAt(1) }),
                makeHandlers({ postMessage: undefined }),
            ));
            expect(() => act(() => result.current.handle_insert('X', 'currentCaret'))).not.toThrow();
        });
    });
});
