import Debug from "debug";
import type { NoteProps } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:columnorder");

/**
 * Shallow element-wise equality for two ordered string arrays.
 */
export function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) { return false; }
    return a.every((value, index) => value === b[index]);
}

/**
 * Natural Kanban column order: the distinct status values present in the notes,
 * sorted alphabetically, with the synthetic 'untagged' column always last.
 */
export function deriveNaturalColumnOrder(notes: Array<NoteProps>): string[] {
    const status_values = new Set<string>();
    for (const note of (notes || [])) {
        if (note.linetags?.status?.value) {
            status_values.add(note.linetags.status.value);
        }
    }
    return [...Array.from(status_values).sort(), 'untagged'];
}
