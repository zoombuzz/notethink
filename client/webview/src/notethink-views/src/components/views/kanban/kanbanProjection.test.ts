import { applyKanbanMove, projectionSatisfied } from './kanbanProjection';
import type { NoteProps, LineTag } from '../../../types/NoteProps';
import type { KanbanMove } from './kanbanProjection';

// --- fixture helpers ---

function makeNote(overrides: Partial<NoteProps> & { seq: number; stable_id: string }): NoteProps {
    return {
        level: 3,
        children_body: [],
        children: [],
        headline_raw: `note-${overrides.seq}`,
        body_raw: '',
        position: {
            start: { offset: overrides.seq * 100, line: overrides.seq * 5 },
            end: { offset: overrides.seq * 100 + 50, line: overrides.seq * 5 + 2 },
        },
        ...overrides,
    };
}

function withStatus(note: NoteProps, status: string): NoteProps {
    const tag: LineTag = {
        key: 'status',
        value: status,
        key_offset: 0,
        value_offset: 0,
        linktext_offset: 0,
        note_seq: note.seq,
    };
    return { ...note, linetags: { ...(note.linetags ?? {}), status: tag } };
}

function withWeight(note: NoteProps, weight: number): NoteProps {
    const tag: LineTag = {
        key: 'nt_kanban_ordering_weight',
        value: String(weight),
        value_numeric: weight,
        key_offset: 0,
        value_offset: 0,
        linktext_offset: 0,
        note_seq: note.seq,
    };
    return { ...note, linetags: { ...(note.linetags ?? {}), nt_kanban_ordering_weight: tag } };
}

// --- fixtures ---

const NOTE_A = makeNote({ seq: 1, stable_id: 'a' });                  // untagged
const NOTE_B = withStatus(makeNote({ seq: 2, stable_id: 'b' }), 'doing');
const NOTE_C = withStatus(makeNote({ seq: 3, stable_id: 'c' }), 'doing');
const NOTE_D = withStatus(makeNote({ seq: 4, stable_id: 'd' }), 'done');

// deep-clone a note's linetags object so the fixture stays immutable between tests
function captureLinetags(note: NoteProps): Record<string, LineTag> {
    return JSON.parse(JSON.stringify(note.linetags ?? {}));
}

// --- cross-column move ---

describe('applyKanbanMove — cross-column move', () => {
    const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
    const move: KanbanMove = {
        dragged_stable_id: 'a',       // untagged note_A → 'done'
        destination_column_value: 'done',
        destination_index: 0,
    };

    it('dragged note lands in destination column', () => {
        const result = applyKanbanMove(notes, move);
        const moved = result.find(n => n.stable_id === 'a');
        expect(moved?.linetags?.status?.value).toBe('done');
    });

    it('source column no longer contains the dragged note', () => {
        const result = applyKanbanMove(notes, move);
        const untagged = result.filter(n => !n.linetags?.status);
        expect(untagged.find(n => n.stable_id === 'a')).toBeUndefined();
    });

    it('dragged note is placed at the requested index', () => {
        const result = applyKanbanMove(notes, move);
        const done_col = result
            .filter(n => n.linetags?.status?.value === 'done')
            .sort((a, b) => (a.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0) - (b.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0));
        expect(done_col[0].stable_id).toBe('a');
        expect(done_col[1].stable_id).toBe('d');
    });

    it('result array has the same length as input', () => {
        const result = applyKanbanMove(notes, move);
        expect(result.length).toBe(notes.length);
    });

    it('notes outside the destination column are passed through by reference', () => {
        const result = applyKanbanMove(notes, move);
        // NOTE_B and NOTE_C are in 'doing' — unaffected; must be the same reference
        expect(result.find(n => n.stable_id === 'b')).toBe(NOTE_B);
        expect(result.find(n => n.stable_id === 'c')).toBe(NOTE_C);
    });
});

// --- within-column reorder ---

describe('applyKanbanMove — within-column reorder', () => {
    // both B and C are in 'doing'; move C before B
    const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
    const move: KanbanMove = {
        dragged_stable_id: 'c',       // 'doing' note_C → index 0 in 'doing'
        destination_column_value: 'doing',
        destination_index: 0,
    };

    it('new order within the column reflects the dropped position', () => {
        const result = applyKanbanMove(notes, move);
        const doing_col = result
            .filter(n => n.linetags?.status?.value === 'doing')
            .sort((a, b) => (a.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0) - (b.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0));
        expect(doing_col[0].stable_id).toBe('c');
        expect(doing_col[1].stable_id).toBe('b');
    });

    it('synthetic weights are distinct and non-zero', () => {
        const result = applyKanbanMove(notes, move);
        const doing_col = result.filter(n => n.linetags?.status?.value === 'doing');
        const weights = doing_col.map(n => n.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0);
        const all_nonzero = weights.every(w => w > 0);
        const all_distinct = new Set(weights).size === weights.length;
        expect(all_nonzero).toBe(true);
        expect(all_distinct).toBe(true);
    });
});

// --- drop into 'untagged' ---

describe('applyKanbanMove — drop into untagged', () => {
    const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
    const move: KanbanMove = {
        dragged_stable_id: 'b',       // 'doing' note_B → 'untagged'
        destination_column_value: 'untagged',
        destination_index: 0,
    };

    it('dragged note has no status linetag after the move', () => {
        const result = applyKanbanMove(notes, move);
        const moved = result.find(n => n.stable_id === 'b');
        expect(moved?.linetags?.status).toBeUndefined();
    });

    it('dragged note appears in the untagged column', () => {
        const result = applyKanbanMove(notes, move);
        const untagged = result.filter(n => !n.linetags?.status);
        expect(untagged.some(n => n.stable_id === 'b')).toBe(true);
    });
});

// --- projectionSatisfied ---

describe('projectionSatisfied', () => {
    it('returns true when the authoritative notes already match the move', () => {
        // after an authoritative round-trip note_A has status 'done' and lands at index 0
        const authoritative_A = withWeight(
            { ...NOTE_A, linetags: { status: { key: 'status', value: 'done', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: NOTE_A.seq } } },
            1,
        );
        const authoritative_D = withWeight(NOTE_D, 2);
        const notes = [authoritative_A, NOTE_B, NOTE_C, authoritative_D];
        const move: KanbanMove = { dragged_stable_id: 'a', destination_column_value: 'done', destination_index: 0 };
        expect(projectionSatisfied(notes, move)).toBe(true);
    });

    it('returns false when the dragged note is in the wrong column', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const move: KanbanMove = { dragged_stable_id: 'a', destination_column_value: 'done', destination_index: 0 };
        expect(projectionSatisfied(notes, move)).toBe(false);
    });

    it('returns false when the dragged note is in the right column but at the wrong index', () => {
        // note_A has status 'done', note_D also has status 'done'; A should be at index 1 (after D) but we assert destination_index=0
        const done_A = withWeight(
            { ...NOTE_A, linetags: { status: { key: 'status', value: 'done', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: NOTE_A.seq } } },
            2,
        );
        const done_D = withWeight(NOTE_D, 1);
        const notes = [done_A, NOTE_B, NOTE_C, done_D];
        const move: KanbanMove = { dragged_stable_id: 'a', destination_column_value: 'done', destination_index: 0 };
        // done_D has weight 1, done_A has weight 2 → A is at index 1 after sort; destination_index=0 → mismatch
        expect(projectionSatisfied(notes, move)).toBe(false);
    });

    it('returns true when the dragged note is absent (removed from document)', () => {
        const notes = [NOTE_B, NOTE_C, NOTE_D];
        const move: KanbanMove = { dragged_stable_id: 'a', destination_column_value: 'done', destination_index: 0 };
        expect(projectionSatisfied(notes, move)).toBe(true);
    });
});

// --- immutability ---

describe('applyKanbanMove — no mutation of inputs', () => {
    it('does not mutate the input notes array', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const original_refs = [...notes];
        const move: KanbanMove = { dragged_stable_id: 'b', destination_column_value: 'done', destination_index: 0 };
        applyKanbanMove(notes, move);
        expect(notes).toEqual(original_refs);
    });

    it('does not mutate the linetags of the original dragged note', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const original_b_linetags = captureLinetags(NOTE_B);
        const move: KanbanMove = { dragged_stable_id: 'b', destination_column_value: 'done', destination_index: 0 };
        applyKanbanMove(notes, move);
        expect(captureLinetags(NOTE_B)).toEqual(original_b_linetags);
    });

    it('does not mutate the linetags of original destination-column notes', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const original_d_linetags = captureLinetags(NOTE_D);
        const move: KanbanMove = { dragged_stable_id: 'b', destination_column_value: 'done', destination_index: 0 };
        applyKanbanMove(notes, move);
        expect(captureLinetags(NOTE_D)).toEqual(original_d_linetags);
    });

    it('returns the original reference for notes not involved in the move', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const move: KanbanMove = { dragged_stable_id: 'b', destination_column_value: 'done', destination_index: 0 };
        const result = applyKanbanMove(notes, move);
        // NOTE_C is in 'doing' — unrelated to destination 'done'; pass-through reference
        expect(result.find(n => n.stable_id === 'c')).toBe(NOTE_C);
        // NOTE_A is untagged — unrelated; pass-through reference
        expect(result.find(n => n.stable_id === 'a')).toBe(NOTE_A);
    });
});

// --- edge cases ---

describe('applyKanbanMove — edge cases', () => {
    it('returns the input array unchanged when stable_id is not found', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const move: KanbanMove = { dragged_stable_id: 'nonexistent', destination_column_value: 'done', destination_index: 0 };
        const result = applyKanbanMove(notes, move);
        expect(result).toBe(notes);
    });

    it('clamps destination_index above members.length to end of column', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const move: KanbanMove = {
            dragged_stable_id: 'a',
            destination_column_value: 'doing',
            destination_index: 999,
        };
        const result = applyKanbanMove(notes, move);
        const doing_col = result
            .filter(n => n.linetags?.status?.value === 'doing')
            .sort((a, b) => (a.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0) - (b.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0));
        // A should be last (clamped to end)
        expect(doing_col[doing_col.length - 1].stable_id).toBe('a');
    });

    it('clamps destination_index below 0 to start of column', () => {
        const notes = [NOTE_A, NOTE_B, NOTE_C, NOTE_D];
        const move: KanbanMove = {
            dragged_stable_id: 'a',
            destination_column_value: 'doing',
            destination_index: -5,
        };
        const result = applyKanbanMove(notes, move);
        const doing_col = result
            .filter(n => n.linetags?.status?.value === 'doing')
            .sort((a, b) => (a.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0) - (b.linetags?.nt_kanban_ordering_weight?.value_numeric ?? 0));
        expect(doing_col[0].stable_id).toBe('a');
    });
});
