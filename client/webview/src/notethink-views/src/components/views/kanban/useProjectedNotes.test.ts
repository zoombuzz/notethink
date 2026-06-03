import { renderHook, act } from '@testing-library/react';
import { useProjectedNotes } from './useProjectedNotes';
import type { NoteProps } from '../../../types/NoteProps';
import type { KanbanMove } from './kanbanProjection';

// sentinel array returned by the mock applyKanbanMove
const SENTINEL_NOTES: Array<NoteProps> = [
    {
        seq: 99,
        level: 2,
        children_body: [],
        children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: '## Sentinel',
        body_raw: '',
    },
];

// per-test control over whether projectionSatisfied returns true
let mock_satisfied = false;

jest.mock('./kanbanProjection', () => ({
    applyKanbanMove: (_notes: Array<NoteProps>, _move: KanbanMove) => SENTINEL_NOTES,
    projectionSatisfied: (_notes: Array<NoteProps>, _move: KanbanMove) => mock_satisfied,
}));

function makeNote(seq: number): NoteProps {
    return {
        seq,
        level: 2,
        children_body: [],
        children: [],
        position: { start: { offset: seq * 60, line: seq }, end: { offset: seq * 60 + 10, line: seq } },
        headline_raw: `## Note ${seq}`,
        body_raw: '',
    };
}

const SAMPLE_MOVE: KanbanMove = {
    dragged_stable_id: 'doc:slug',
    destination_column_value: 'done',
    destination_index: 0,
};

describe('useProjectedNotes', () => {

    beforeEach(() => {
        jest.useFakeTimers();
        mock_satisfied = false;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('returns authoritative notes unchanged when no move applied', () => {
        const authoritative = [makeNote(1), makeNote(2)];
        const { result } = renderHook(() => useProjectedNotes(authoritative));
        expect(result.current.notes_to_render).toBe(authoritative);
    });

    it('returns empty array when authoritative_notes is undefined and no move applied', () => {
        const { result } = renderHook(() => useProjectedNotes(undefined));
        expect(result.current.notes_to_render).toEqual([]);
    });

    it('returns sentinel array after applyOptimisticMove is called', () => {
        const authoritative = [makeNote(1)];
        const { result } = renderHook(() => useProjectedNotes(authoritative));

        act(() => { result.current.applyOptimisticMove(SAMPLE_MOVE); });

        expect(result.current.notes_to_render).toBe(SENTINEL_NOTES);
    });

    it('reverts to authoritative notes after safety timeout elapses', () => {
        const authoritative = [makeNote(1)];
        const { result } = renderHook(() => useProjectedNotes(authoritative));

        act(() => { result.current.applyOptimisticMove(SAMPLE_MOVE); });
        expect(result.current.notes_to_render).toBe(SENTINEL_NOTES);

        act(() => { jest.advanceTimersByTime(1500); });

        expect(result.current.notes_to_render).toBe(authoritative);
    });

    it('does not revert before KANBAN_PROJECTION_MAX_MS elapses', () => {
        const authoritative = [makeNote(1)];
        const { result } = renderHook(() => useProjectedNotes(authoritative));

        act(() => { result.current.applyOptimisticMove(SAMPLE_MOVE); });

        act(() => { jest.advanceTimersByTime(1499); });
        expect(result.current.notes_to_render).toBe(SENTINEL_NOTES);
    });

    it('drops projection when projectionSatisfied returns true on re-render', () => {
        const authoritative_v1 = [makeNote(1)];
        const authoritative_v2 = [makeNote(1), makeNote(2)];
        let authoritative = authoritative_v1;

        const { result, rerender } = renderHook(() => useProjectedNotes(authoritative));

        act(() => { result.current.applyOptimisticMove(SAMPLE_MOVE); });
        expect(result.current.notes_to_render).toBe(SENTINEL_NOTES);

        // now the authoritative notes change and the mock reports satisfied
        mock_satisfied = true;
        authoritative = authoritative_v2;
        rerender();

        expect(result.current.notes_to_render).toBe(authoritative_v2);
    });

    it('replaces prior projection and resets timeout when a second move is applied', () => {
        const authoritative = [makeNote(1)];
        const { result } = renderHook(() => useProjectedNotes(authoritative));

        act(() => { result.current.applyOptimisticMove(SAMPLE_MOVE); });

        // advance almost to the timeout
        act(() => { jest.advanceTimersByTime(1400); });

        // apply a second move — should reset the safety timer
        act(() => { result.current.applyOptimisticMove({ ...SAMPLE_MOVE, destination_column_value: 'doing' }); });

        // advance by 200 more ms: the original timer would have fired by now but the new one hasn't
        act(() => { jest.advanceTimersByTime(200); });
        expect(result.current.notes_to_render).toBe(SENTINEL_NOTES);

        // advance remaining time so new timer fires
        act(() => { jest.advanceTimersByTime(1300); });
        expect(result.current.notes_to_render).toBe(authoritative);
    });
});
