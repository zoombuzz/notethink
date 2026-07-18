import Debug from "debug";
import { kanbanColumnValue, notesInKanbanColumn } from "../../../lib/noteops";
import { ABSENT_VALUE_BUCKET } from "../../../lib/axisops";
import type { NoteProps, LineTag } from "../../../types/NoteProps";

const debug = Debug("nodejs:notethink-views:kanbanProjection");

/**
 * KanbanMove: a single drag-and-drop move that applyKanbanMove and projectionSatisfied interpret.
 * - dragged_stable_id: the stable_id of the note being moved
 * - destination_column_value: the target lane's value on the group axis ('done', 'doing', 'untagged', …)
 * - destination_index: zero-based insertion slot within the destination lane (clamped to valid range)
 * - group_field: the axis field the lanes group by; defaults to 'status' so kanban is unchanged. The
 *   projection re-tags the dragged note on this field (or deletes it for the absent-value lane).
 */
export interface KanbanMove {
    dragged_stable_id: string;
    destination_column_value: string;
    destination_index: number;
    group_field?: string;
}

// --- helpers ---

/** produce a synthetic nt_kanban_ordering_weight LineTag for position i (1-based weight) */
function syntheticWeightTag(note_seq: number, i: number): LineTag {
    return {
        key: 'nt_kanban_ordering_weight',
        value: String(i + 1),
        value_numeric: i + 1,
        key_offset: 0,
        value_offset: 0,
        linktext_offset: 0,
        note_seq: note_seq,
        inherited: true,
    };
}

/** clone a note with a new linetags object merged with the supplied patch */
function cloneWithLinetags(note: NoteProps, linetags_patch: { [key: string]: LineTag }): NoteProps {
    return { ...note, linetags: { ...(note.linetags ?? {}), ...linetags_patch } };
}

/** clone a note without the named linetag key */
function cloneWithoutLinetag(note: NoteProps, key: string): NoteProps {
    const cloned_linetags = { ...(note.linetags ?? {}) };
    delete cloned_linetags[key];
    return { ...note, linetags: cloned_linetags };
}

/** build the dragged note clone with its destination-lane value applied to the group field (absent lane deletes it) */
function cloneDraggedWithFieldValue(note: NoteProps, group_field: string, destination_column_value: string): NoteProps {
    if (destination_column_value === ABSENT_VALUE_BUCKET) {
        return cloneWithoutLinetag(note, group_field);
    }
    const field_tag: LineTag = {
        key: group_field,
        value: destination_column_value,
        key_offset: 0,
        value_offset: 0,
        linktext_offset: 0,
        note_seq: note.seq,
        inherited: true,
    };
    return cloneWithLinetags(note, { [group_field]: field_tag });
}

/** clamp an index to [0, max] inclusive */
function clampIndex(index: number, max: number): number {
    return Math.max(0, Math.min(index, max));
}

// --- public API ---

/**
 * produce a NEW notes array reflecting the dropped layout. the dragged note is re-tagged
 * into destination_column_value and every note in the destination column receives a
 * synthetic monotonic nt_kanban_ordering_weight so kanbanNoteOrder reproduces the exact
 * dropped order. pure: never mutates input notes or their linetags objects.
 */
export function applyKanbanMove(notes: Array<NoteProps>, move: KanbanMove): Array<NoteProps> {
    const dragged_note = notes.find(n => n.stable_id === move.dragged_stable_id);
    if (!dragged_note) {
        debug('applyKanbanMove: dragged note not found, stable_id=%s', move.dragged_stable_id);
        return notes;
    }

    const dest_members = buildDestinationMembers(notes, dragged_note, move);
    const clone_map = buildCloneMap(dragged_note, dest_members, move);

    debug('applyKanbanMove: dest=%s index=%d members=%d', move.destination_column_value, move.destination_index, dest_members.length);
    return notes.map(n => clone_map.get(n.seq) ?? n);
}

/**
 * the destination column's ordered members after splicing the dragged note in at destination_index.
 * existing destination members exclude the dragged note (avoids duplication), sorted by kanbanNoteOrder.
 */
function buildDestinationMembers(
    notes: Array<NoteProps>,
    dragged_note: NoteProps,
    move: KanbanMove,
): Array<NoteProps> {
    const without_dragged = notes.filter(n => n.seq !== dragged_note.seq);
    const existing = notesInKanbanColumn(without_dragged, move.destination_column_value, move.group_field ?? 'status');
    const clamped = clampIndex(move.destination_index, existing.length);
    const ordered = [...existing];
    ordered.splice(clamped, 0, dragged_note);
    return ordered;
}

/**
 * build a map from note seq → clone for every note affected by the move.
 * the dragged note gets its status updated; every destination-column member gets a synthetic weight.
 */
function buildCloneMap(
    dragged_note: NoteProps,
    dest_members: Array<NoteProps>,
    move: KanbanMove,
): Map<number, NoteProps> {
    const clone_map = new Map<number, NoteProps>();
    // first pass: apply the destination lane's value to the dragged note's group field
    const dragged_clone = cloneDraggedWithFieldValue(dragged_note, move.group_field ?? 'status', move.destination_column_value);
    clone_map.set(dragged_note.seq, dragged_clone);

    // second pass: apply synthetic weight to every position in the ordered destination list
    for (let i = 0; i < dest_members.length; i++) {
        const member = dest_members[i];
        const weight_tag = syntheticWeightTag(member.seq, i);
        // the dragged clone already exists in the map; patch its weight rather than re-cloning from the original
        const base = clone_map.get(member.seq) ?? member;
        clone_map.set(member.seq, cloneWithLinetags(base, { nt_kanban_ordering_weight: weight_tag }));
    }
    return clone_map;
}

/**
 * return true when the authoritative notes already reflect the move. checks only the dragged note's
 * column membership and sorted position within that column; unrelated churn elsewhere is ignored.
 * returns true when the dragged note is absent (note was removed - adopt the authoritative state).
 */
export function projectionSatisfied(notes: Array<NoteProps>, move: KanbanMove): boolean {
    const dragged_note = notes.find(n => n.stable_id === move.dragged_stable_id);
    if (!dragged_note) {
        debug('projectionSatisfied: dragged note absent, treating as satisfied');
        return true;
    }

    const group_field = move.group_field ?? 'status';
    if (kanbanColumnValue(dragged_note, group_field) !== move.destination_column_value) {
        return false;
    }

    const dest_members = notesInKanbanColumn(notes, move.destination_column_value, group_field);

    const actual_index = dest_members.findIndex(n => n.stable_id === move.dragged_stable_id);
    const clamped = clampIndex(move.destination_index, dest_members.length - 1);

    debug('projectionSatisfied: actual_index=%d clamped=%d', actual_index, clamped);
    return actual_index === clamped;
}
