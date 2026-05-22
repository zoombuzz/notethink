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
    if (!items?.length) { return undefined; }
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
 * Strip the heading prefix (`#+\s*`) and any trailing linetag blocks
 * (`\s*\[[^\]]*\]\(\?[^)]*\)\s*$`, repeated) from a raw headline string.
 * Used to derive epic names from `##` headings and breadcrumb labels.
 */
export function stripHeadlineLinetags(headline_raw: string): string {
    let stripped = headline_raw.replace(/^#+\s*/, '');
    // strip repeated trailing linetag blocks
    const trailing = /\s*\[[^\]]*\]\(\?[^)]*\)\s*$/;
    while (trailing.test(stripped)) {
        stripped = stripped.replace(trailing, '');
    }
    return stripped.trim();
}

/**
 * format a kanban column name for display: replace dashes with spaces and title-case each word. The raw status slug (`code-review`) is what lives in the data; this produces the user-facing label (`Code Review`). Empty input returns empty.
 */
export function formatColumnLabel(value: string): string {
    if (!value) { return ''; }
    return value
        .replace(/-/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 0)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Standard note ordering: by seq (the canonical reading order — document order
 * for a single file, the round-robin cross-file interleave in folder mode), with
 * the document offset as a tiebreak when seqs are equal. This is the single
 * source of truth for implicit (non-drag) ordering across every view.
 */
export function standardNoteOrder(a: NoteProps, b: NoteProps): number {
    if (a.seq !== b.seq) { return a.seq - b.seq; }
    return a.position.start.offset - b.position.start.offset;
}

/**
 * Relevance-aware implicit order. Identical to standardNoteOrder, except that
 * among stories of the SAME per-file rank (`origin.file_rank`) stories from
 * more recently modified files sort first. The rank-equality gate keeps this a
 * pure tiebreak: it never lifts a story above one of a better (lower) rank, so
 * the round-robin cross-file interleave is preserved. Saving the file you
 * currently have open bumps its on-disk mtime to now, so it floats to the top
 * of its band naturally — no separate "active file" signal is required. For
 * notes without an origin (single-file mode) or without `file_mtime` it is
 * exactly standardNoteOrder.
 */
export function noteOrder(a: NoteProps, b: NoteProps): number {
    const rank_a = a.origin?.file_rank;
    const rank_b = b.origin?.file_rank;
    if (rank_a !== undefined && rank_a === rank_b) {
        const mt_a = a.origin?.file_mtime;
        const mt_b = b.origin?.file_mtime;
        if (mt_a !== undefined && mt_b !== undefined && mt_a !== mt_b) {
            // newer first
            return mt_b - mt_a;
        }
    }
    return standardNoteOrder(a, b);
}

/**
 * Kanban ordering: explicit `kanban_ordering_weight` linetag is decisive,
 * including across files. The weight's *value* is what carries the user-chosen
 * cross-file order, so the comparator never consults `file_rank` / `file_mtime`
 * when either side carries a weight — that would let relevance shove a
 * deliberately-placed weighted card past another weighted card from a different
 * file.
 *
 * Order of precedence:
 *   1. both weighted: numeric weight comparison; ties broken purely by seq
 *   2. exactly one weighted: unweighted cards sort first (weighted card
 *      represents a user override and lives below the implicit-order block)
 *   3. neither weighted: fall through to noteOrder (file_rank → file_mtime → seq)
 *
 * The cross-file payoff requires `calculateTextChangesForOrdering` to mint
 * globally monotonic weight values that encode the user's order.
 *
 * A `value_numeric` of 0 counts as unweighted (the pre-refactor convention),
 * which keeps single-file behaviour byte-identical.
 */
export function kanbanNoteOrder(a: NoteProps, b: NoteProps): number {
    const weight_a = a?.linetags?.kanban_ordering_weight?.value_numeric;
    const weight_b = b?.linetags?.kanban_ordering_weight?.value_numeric;
    const has_a = weight_a !== undefined && weight_a !== 0;
    const has_b = weight_b !== undefined && weight_b !== 0;
    // case 1: both weighted — pure numeric compare, seq tiebreak only
    if (has_a && has_b) {
        if (weight_a !== weight_b) {
            return (weight_a! > weight_b! ? 1 : -1);
        }
        return (a.seq > b.seq ? 1 : -1);
    }
    // case 2: exactly one weighted — weighted sorts AFTER unweighted
    if (has_a) { return 1; }
    if (has_b) { return -1; }
    // case 3: neither weighted — implicit relevance order
    return noteOrder(a, b);
}
