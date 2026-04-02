import type { NoteProps, MdastNode, TextSelection, ClickPositionInfo, LineTag } from "../types/NoteProps";

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
 * Within a note DOM element, find the body item (paragraph, list, etc.) whose
 * data-offset-start/data-offset-end range contains the given caret offset.
 * Returns the matching element, or undefined if the caret is in the headline.
 */
export function findBodyItemElement(note_element: HTMLElement, caret_offset: number): HTMLElement | undefined {
    const candidates = note_element.querySelectorAll<HTMLElement>('[data-offset-start]');
    for (let i = candidates.length - 1; i >= 0; --i) {
        const el = candidates[i];
        const start = Number(el.dataset.offsetStart);
        const end = Number(el.dataset.offsetEnd);
        if (!isNaN(start) && !isNaN(end) && caret_offset >= start && caret_offset <= end) {
            return el;
        }
    }
    return undefined;
}

/**
 * Calculate text changes for a checkbox action.
 * Searches for `- [ ] text` or `- [x] text` patterns in the note's body_raw,
 * using a regex to avoid matching linetags or markdown links.
 */
export function calculateTextChangesForCheckbox(note: NoteProps, action_is_check: boolean, match_text: string, match_context: Array<string>) {
    const content = note.body_raw;
    if (!content) { return []; }
    let content_start_position = note.position.end;
    if (!note.position.end_body) {
        content_start_position = note.position.start;
    }
    // Find all checkbox patterns: `[x]` or `[ ]` preceded by `- ` on the same line
    const checkbox_re = /- \[([ xX])\]/g;
    let match: RegExpExecArray | null;
    while ((match = checkbox_re.exec(content)) !== null) {
        // Check if the text after this checkbox matches match_text
        const bracket_close = match.index + match[0].length; // position after `]`
        const text_after = content.slice(bracket_close);
        if (match_text && (text_after.startsWith(match_text) || text_after.startsWith(` ${match_text}`))) {
            // bracket_start is the position of `[`, the char to replace is at bracket_start + 1
            const bracket_start = match.index + 2; // `- [`  →  index of `[`
            const from = content_start_position.offset + bracket_start + 1;
            const to = content_start_position.offset + bracket_start + 2;
            // Validate: from < to and the replacement makes sense
            if (from >= to || to - from !== 1) { return []; }
            return [{
                from,
                to,
                insert: action_is_check ? 'X' : ' ',
            }];
        }
    }
    return [];
}

/**
 * Find the seq of the first incomplete task (listItem with checked === false)
 * in a note's children_body tree. Returns undefined if no incomplete task found.
 */
export function findFirstIncompleteTaskSeq(items: Array<NoteProps | MdastNode>): number | undefined {
    for (const item of items) {
        if (!('seq' in item && item.seq !== undefined)) { continue; }
        const note = item as NoteProps;
        if (note.type === 'listItem' && note.checked === false) {
            return note.seq;
        }
        if (note.children_body?.length) {
            const found = findFirstIncompleteTaskSeq(note.children_body);
            if (found !== undefined) { return found; }
        }
    }
    return undefined;
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
