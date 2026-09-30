import Debug from 'debug';
import { useMemo } from 'react';
import { deriveNaturalColumnOrder, notesInKanbanColumn } from '../../../lib/noteops';
import type { Axis } from '../../../lib/axisops';
import type { NoteProps, NoteDisplayOptions } from '../../../types/NoteProps';

const debug = Debug("nodejs:notethink-views:useKanbanColumns");

/**
 * A kanban column derived from the notes currently visible in the view.
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
 * Derives the ordered kanban columns for the view, each populated with its matching notes (sorted by
 * `kanbanNoteOrder`; a note with no value for `axis` lands in the 'untagged' pseudo-lane). With
 * `custom_order` set, columns start in that order, then newly-seen values append alphabetically with
 * 'untagged' ensured last; otherwise columns are alphabetical with 'untagged' last. `axis` defaults to
 * status so kanban is unchanged, and a grouped view passes its own group-by axis.
 */
export function useKanbanColumns(
    notes: Array<NoteProps> | undefined,
    custom_order: Array<string> | undefined,
    axis: Axis = 'status',
): Array<KanbanColumnDescriptor> {
    return useMemo<Array<KanbanColumnDescriptor>>(() => {
        const columns = deriveColumnOrder(notes, custom_order, axis);
        for (const column of columns) {
            column.child_notes = notesInKanbanColumn(notes || [], column.value, axis);
        }
        debug('built %d lanes, total notes=%d', columns.length, (notes || []).length);
        return columns;
    }, [notes, custom_order, axis]);
}

/**
 * Derives the column descriptors, without note assignment, matching `useKanbanColumns`'s ordering
 * rules. Delegates base enumeration to `deriveNaturalColumnOrder` and layers `custom_order` on top.
 */
function deriveColumnOrder(
    notes: Array<NoteProps> | undefined,
    custom_order: Array<string> | undefined,
    axis: Axis = 'status',
): Array<KanbanColumnDescriptor> {
    const natural_order = deriveNaturalColumnOrder(notes || [], axis);
    if (custom_order && custom_order.length > 0) {
        const ordered: KanbanColumnDescriptor[] = custom_order.map((value, index) => ({
            seq: index,
            value,
            type: value === 'untagged' ? 'pseudo' : undefined,
        }));
        const ordered_values = new Set(custom_order);
        for (const value of natural_order) {
            if (ordered_values.has(value)) { continue; }
            const type = value === 'untagged' ? 'pseudo' : undefined;
            ordered.push({ seq: ordered.length, value, type });
        }
        return ordered;
    }
    return natural_order.map((value, index) => ({
        seq: index,
        value,
        type: value === 'untagged' ? 'pseudo' : undefined,
    }));
}
