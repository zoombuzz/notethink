import type { NoteProps, TextSelection, ClickPositionInfo, LineTag } from "../types/NoteProps";

/**
 * Check if a position is within a note headline or body.
 */
export function withinNoteHeadlineOrBody(pos: number | undefined, note: NoteProps) {
    if (pos === undefined) { return false; }
    return (pos >= note.position.start.offset) && (pos <= (note.position.end_body?.offset || note.position.end.offset));
}

/**
 * Check if a position is within a note headline or body (up to a point).
 */
export function withinNoteHeadlineOrBodyUpTo(pos: number | undefined, note: NoteProps, end_offset: number) {
    if (pos === undefined) { return false; }
    return (pos >= note.position.start.offset) && (pos <= end_offset);
}

/**
 * Find the deepest note that bounds caret_position.
 */
export function findDeepestNote(notes: Array<NoteProps>, caret_position: number, max_level?: number): NoteProps | undefined {
    for (let n = notes.length - 1; n >= 0; --n) {
        const candidate_note = notes[n];
        if (withinNoteHeadlineOrBody(caret_position, candidate_note)) {
            if (max_level === undefined) {
                return candidate_note;
            } else if (candidate_note.level <= max_level) {
                return candidate_note;
            }
        }
    }
    return undefined;
}

/**
 * Based on a text selection, find the set of notes that it comprehensively spans.
 * Replaces notegit's EditorSelection-based version with TextSelection.
 */
export function findSelectedNotes(notes: Array<NoteProps>, selection: TextSelection): Array<NoteProps> {
    return notes
        .filter((note) => selectionSpans(selection, note.position.start.offset, note.position.end_body?.offset || note.position.end.offset));
}

/**
 * Check if a selection spans a given range.
 */
export function selectionSpans(selection: TextSelection | undefined, from: number | undefined, to: number | undefined): boolean {
    if (!selection) { return false; }
    if (from === undefined || to === undefined) { return false; }
    return (selection.main.anchor <= from && selection.main.head >= to) || (selection.main.head <= from && selection.main.anchor >= to);
}

/**
 * Aggregate linetags from a chain of ancestor notes (drives AutoView type selection).
 */
export function aggregateNoteLinetags(notes: Array<NoteProps>): { [key: string]: LineTag } {
    return notes.reduce((accumulator: { [key: string]: LineTag }, currentValue) => {
        if (currentValue?.linetags) {
            return Object.assign(accumulator, currentValue.linetags);
        }
        return accumulator;
    }, {});
}

/**
 * Checks if a note element is partially visible within a view element.
 */
export function noteIsVisible(note_element: HTMLElement, view_element: HTMLElement, partial_visibility: boolean = true) {
    const rect = note_element.getBoundingClientRect();
    const parent_rect = view_element.getBoundingClientRect();
    if (partial_visibility) {
        return !(
            rect.bottom < parent_rect.top ||
            rect.top > parent_rect.bottom ||
            rect.right < parent_rect.left ||
            rect.left > parent_rect.right
        );
    }
    return (
        rect.top >= parent_rect.top &&
        rect.left >= parent_rect.left &&
        rect.bottom <= parent_rect.bottom &&
        rect.right <= parent_rect.right
    );
}

/**
 * Work out where the caret position is based on a ClickPositionInfo.
 */
export function resolveCaretPosition(ncp: ClickPositionInfo, note?: NoteProps): number {
    return ncp.from;
}

/**
 * Calculate text changes for a checkbox action.
 */
export function calculateTextChangesForCheckbox(note: NoteProps, action_is_check: boolean, match_text: string, match_context: Array<string>) {
    const changes = [];
    const content = note.body_raw;
    let content_start_position = note.position.end;
    if (!note.position.end_body) {
        content_start_position = note.position.start;
    }
    let match_position = content.indexOf(`]${match_text}`);
    if (match_position === -1) {
        match_position = content.indexOf(`] ${match_text}`);
    }
    const checkbox_start_position = content.lastIndexOf('[', match_position - 1);
    if (match_position === -1 || checkbox_start_position === -1) { return []; }
    changes.push({
        from: content_start_position.offset + checkbox_start_position + 1,
        to: content_start_position.offset + match_position,
        insert: action_is_check ? 'x' : ' ',
    });
    return changes;
}

/**
 * Standard note ordering by document offset.
 */
export function standardNoteOrder(a: NoteProps, b: NoteProps): number {
    return a.position.start.offset - b.position.start.offset;
}

/**
 * Kanban-specific note ordering by ordering weight then seq.
 */
export function kanbanNoteOrder(a: NoteProps, b: NoteProps) {
    if (a?.linetags?.kanban_ordering_weight?.value_numeric) {
        if (b?.linetags?.kanban_ordering_weight?.value_numeric) {
            if (a.linetags.kanban_ordering_weight.value_numeric === b.linetags.kanban_ordering_weight.value_numeric) {
                return (a.seq > b.seq ? 1 : -1);
            }
            return (a.linetags.kanban_ordering_weight.value_numeric > b.linetags.kanban_ordering_weight.value_numeric ? 1 : -1);
        } else {
            return 1;
        }
    } else {
        if (b?.linetags?.kanban_ordering_weight?.value_numeric) {
            return -1;
        } else {
            return standardNoteOrder(a, b);
        }
    }
}
