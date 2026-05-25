import Debug from 'debug';
import { useMemo } from 'react';
import { kanbanNoteOrder } from '../../../lib/noteops';
import type { NoteProps, NoteDisplayOptions } from '../../../types/NoteProps';

const debug = Debug("nodejs:notethink-views:useKanbanColumns");

/**
 * a kanban column derived from the set of notes currently visible in the view.
 * - seq: stable position index used as the droppable id; populated as columns are appended
 * - value: the status linetag value the column represents ('done', 'doing', 'untagged', ...)
 * - type: 'pseudo' marks the synthetic 'untagged' bucket; undefined for real status values
 * - child_notes / display_options: filled in later by the consumer; the hook leaves them undefined
 */
export interface KanbanColumnDescriptor {
    seq?: number;
    value: string;
    type?: string;
    child_notes?: Array<NoteProps>;
    display_options?: NoteDisplayOptions;
}

/**
 * derive the ordered list of kanban columns for the current view, each populated
 * with the notes that belong to that column.
 *
 * inputs:
 * - notes: the notes visible within the parent context (typically `props.notes_within_parent_context`)
 * - custom_order: optional explicit ordering of column values (typically `display_options.settings?.column_order`)
 *
 * column ordering:
 * - when `custom_order` is set: columns start in that order, then any newly-seen status values are appended alphabetically;
 *   the synthetic 'untagged' bucket is ensured at the end if not already named.
 * - otherwise: named columns alphabetically followed by 'untagged' last.
 *
 * note assignment: every column carries the matching subset of `notes` sorted by `kanbanNoteOrder`.
 * A note with no `linetags.status` lands in the 'untagged' pseudo-column.
 */
export function useKanbanColumns(
    notes: Array<NoteProps> | undefined,
    custom_order: Array<string> | undefined,
): Array<KanbanColumnDescriptor> {
    return useMemo<Array<KanbanColumnDescriptor>>(() => {
        const columns = deriveColumnOrder(notes, custom_order);
        for (const column of columns) {
            column.child_notes = (notes || [])
                .filter((note: NoteProps) => (
                    (note?.linetags?.status && note?.linetags?.status.value === column.value)
                    || (!note?.linetags?.status && column.value === 'untagged')
                ))
                .sort(kanbanNoteOrder);
        }
        debug('built %d columns, total notes=%d', columns.length, (notes || []).length);
        return columns;
    }, [notes, custom_order]);
}

/**
 * derive the column descriptors (without note assignment) — pulled out so the hook body stays a short
 * sequence of named steps. Behaviour matches the column-ordering rules documented on `useKanbanColumns`.
 */
function deriveColumnOrder(
    notes: Array<NoteProps> | undefined,
    custom_order: Array<string> | undefined,
): Array<KanbanColumnDescriptor> {
    const status_values = new Set<string>();
    for (const note of (notes || [])) {
        if (note.linetags?.status?.value) {
            status_values.add(note.linetags.status.value);
        }
    }
    if (custom_order && custom_order.length > 0) {
        const ordered: KanbanColumnDescriptor[] = custom_order.map((value, index) => ({
            seq: index,
            value,
            type: value === 'untagged' ? 'pseudo' : undefined,
        }));
        const ordered_values = new Set(custom_order);
        for (const value of Array.from(status_values).sort()) {
            if (!ordered_values.has(value)) {
                ordered.push({ seq: ordered.length, value });
            }
        }
        if (!ordered_values.has('untagged')) {
            ordered.push({ seq: ordered.length, value: 'untagged', type: 'pseudo' });
        }
        return ordered;
    }
    const result: KanbanColumnDescriptor[] = [];
    Array.from(status_values).sort().forEach((value, index) => {
        result.push({ seq: index, value });
    });
    result.push({ seq: result.length, value: "untagged", type: "pseudo" });
    return result;
}
