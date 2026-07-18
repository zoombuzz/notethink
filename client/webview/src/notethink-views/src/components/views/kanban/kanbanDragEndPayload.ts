import Debug from 'debug';
import { calculateTextChangesForNewLinetagValue, calculateTextChangesForOrdering } from '../../../lib/linetagops';
import { ABSENT_VALUE_BUCKET } from '../../../lib/axisops';
import type { NoteProps } from '../../../types/NoteProps';
import type { EditTextChange, EditTextMessage } from '../../../types/Messages';

const debug = Debug("nodejs:notethink-views:kanbanDragEndPayload");

/**
 * inputs for the pure drag-end payload builder.
 *
 * - dragged_note: the note being dropped; never null (caller validates)
 * - destination_column_value: the lane value the note lands in on the group axis (e.g. 'done', 'untagged')
 * - destination_column_children: the existing notes in that lane (the dragged note may already be present and is filtered out internally)
 * - destination_column_position: zero-based insertion index within the destination lane
 * - group_field: the axis field the drop writes; defaults to 'status' so kanban is unchanged. This is
 *   the inverse projection - the drop lands in a lane and writes `group_field := lane value` (or deletes
 *   the linetag for the absent-value lane)
 */
export interface KanbanDragEndPayloadInput {
    dragged_note: NoteProps;
    destination_column_value: string;
    destination_column_children: Array<NoteProps>;
    destination_column_position: number;
    group_field?: string;
}

/**
 * build the post-message payload for a kanban drag-drop.
 *
 * Assemble the edits for a drop and route them per origin file. The group-field change
 * always targets the dragged note's origin file; the ordering cascade returns per-doc
 * partitioned change sets which are merged by docPath. When every change lands on one
 * file (or there is no origin at all - pure single-file mode) the legacy single-doc
 * `editText` shape is returned so single-file behaviour stays byte-identical and the
 * extension takes its fast path; when the cascade spills across files the partitioned
 * `changes_by_doc` shape is returned instead.
 *
 * Pure: no React, no side effects, no postMessage. Returns `null` when there is
 * nothing to post (e.g. drop produced no edits at all).
 */
export function buildKanbanDragEndPayload(input: KanbanDragEndPayloadInput): EditTextMessage | null {
    const { dragged_note, destination_column_value, destination_column_children, destination_column_position } = input;
    const group_field = input.group_field ?? 'status';
    const dragged_doc_path = dragged_note.origin?.doc_path;

    // inverse projection: write the group field to the dropped lane's value, or delete it for the absent lane
    const field_changes: Array<EditTextChange> = calculateTextChangesForNewLinetagValue(
        dragged_note, group_field, destination_column_value, ABSENT_VALUE_BUCKET,
    );

    const destination_children_with_drop = destination_column_children
        .filter((note) => (dragged_note.seq !== note.seq));
    destination_children_with_drop.splice(destination_column_position, 0, dragged_note);
    const ordering_change_sets = calculateTextChangesForOrdering(
        destination_children_with_drop, destination_column_position, 'nt_kanban_ordering_weight',
    );

    // group-field change goes under the dragged file; each ordering change-set under its own doc_path
    const changes_by_doc: Record<string, Array<EditTextChange>> = {};
    if (field_changes.length > 0 && dragged_doc_path !== undefined) {
        changes_by_doc[dragged_doc_path] = (changes_by_doc[dragged_doc_path] || []).concat(field_changes);
    }
    for (const set of ordering_change_sets) {
        if (set.doc_path === undefined) { continue; }
        if (set.changes.length === 0) { continue; }
        changes_by_doc[set.doc_path] = (changes_by_doc[set.doc_path] || []).concat(set.changes);
    }
    for (const key of Object.keys(changes_by_doc)) {
        if (changes_by_doc[key].length === 0) { delete changes_by_doc[key]; }
    }

    // pure single-file mode: no origin to key on, flatten into the legacy single-doc shape
    if (dragged_doc_path === undefined) {
        const flat: Array<EditTextChange> = [...field_changes];
        for (const set of ordering_change_sets) { flat.push(...set.changes); }
        if (flat.length === 0) { return null; }
        debug('single-file mode payload: %d changes', flat.length);
        return { type: 'editText', changes: flat, docPath: undefined };
    }

    const doc_paths = Object.keys(changes_by_doc);
    if (doc_paths.length === 0) { return null; }

    // every change targets one file - legacy single-doc shape
    if (doc_paths.length === 1) {
        const only_doc = doc_paths[0];
        debug('single-doc payload: docPath=%s, %d changes', only_doc, changes_by_doc[only_doc].length);
        return { type: 'editText', changes: changes_by_doc[only_doc], docPath: only_doc };
    }

    // cascade spilled across files - partitioned shape
    debug('multi-doc payload: %d files', doc_paths.length);
    return { type: 'editText', changes_by_doc };
}
