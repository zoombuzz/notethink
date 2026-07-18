import { buildKanbanDragEndPayload } from './kanbanDragEndPayload';
import type { NoteProps } from '../../../types/NoteProps';

// a story `## Task [](?<field>=<value>)` with the linetag offsets calculated so the linetag-edit helpers resolve correctly
function noteWithLinetag(field: string, value: string): NoteProps {
    const prefix = '## Task ';
    const linetag_str = `[](?${field}=${value})`;
    const headline_raw = prefix + linetag_str;
    return {
        seq: 1,
        level: 3,
        children_body: [],
        children: [],
        headline_raw,
        body_raw: '',
        position: { start: { offset: 0, line: 1 }, end: { offset: headline_raw.length, line: 1 } },
        linetags_from: prefix.length,
        linetags: {
            [field]: { key: field, value, key_offset: linetag_str.indexOf(field), value_offset: linetag_str.indexOf(value), linktext_offset: 0, note_seq: 1 },
        },
    } as NoteProps;
}

describe('buildKanbanDragEndPayload group-key inverse projection', () => {
    it('writes the group field to the destination lane value (group by an arbitrary attribute)', () => {
        const dragged = noteWithLinetag('assignee', 'alex');
        const payload = buildKanbanDragEndPayload({
            dragged_note: dragged,
            destination_column_value: 'sam',
            destination_column_children: [],
            destination_column_position: 0,
            group_field: 'assignee',
        });
        expect(payload).not.toBeNull();
        const changes = (payload as { changes: Array<{ insert: string }> }).changes;
        expect(changes.some(c => c.insert === 'sam')).toBe(true);
    });

    it('deletes the group linetag when dropped on the absent-value lane', () => {
        const dragged = noteWithLinetag('assignee', 'alex');
        const payload = buildKanbanDragEndPayload({
            dragged_note: dragged,
            destination_column_value: 'untagged',
            destination_column_children: [],
            destination_column_position: 0,
            group_field: 'assignee',
        });
        expect(payload).not.toBeNull();
        const changes = (payload as { changes: Array<{ from: number; to?: number; insert: string }> }).changes;
        // the absent lane removes the linetag: a deletion (empty insert spanning a range)
        expect(changes.some(c => c.insert === '' && c.to !== undefined && c.to > c.from)).toBe(true);
    });

    it('defaults to the status field so kanban is unchanged', () => {
        const dragged = noteWithLinetag('status', 'doing');
        const payload = buildKanbanDragEndPayload({
            dragged_note: dragged,
            destination_column_value: 'done',
            destination_column_children: [],
            destination_column_position: 0,
        });
        const changes = (payload as { changes: Array<{ insert: string }> }).changes;
        expect(changes.some(c => c.insert === 'done')).toBe(true);
    });
});
