import Debug from "debug";
import type { NoteProps, MdastNode, TextSelection, ClickPositionInfo, LineTag } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:noteops");

/**
 * generic shallow element-wise equality for two ordered arrays of any primitive
 * comparable by `===` (string, number, boolean). Returns true when both inputs
 * are undefined, false when exactly one is, and a length+element-wise comparison
 * otherwise. Lives in noteops alongside the note-tree comparators because the
 * codebase's only consumers (MarkdownNote memo compare, kanban columnops) are
 * note-adjacent; if a second non-note caller appears, lift to its own file
 */
export function arraysEqual<T>(a: T[] | undefined, b: T[] | undefined): boolean {
    if (a === b) { return true; }
    if (!a || !b) { return false; }
    if (a.length !== b.length) { return false; }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
}

/**
 * Check if a position is within a note headline or body.
 */
export function withinNoteHeadlineOrBody(pos: number | undefined, note: NoteProps): boolean {
    if (pos === undefined) { return false; }
    return (pos >= note.position.start.offset) && (pos <= (note.position.end_body?.offset || note.position.end.offset));
}

/**
 * Check if a position is within a note headline or body (up to a point).
 */
export function withinNoteHeadlineOrBodyUpTo(pos: number | undefined, note: NoteProps, end_offset: number): boolean {
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
 * find the deepest note whose source-file offset range contains caret_pos, among
 * notes whose origin.doc_path matches active_doc_path. unified matcher used by
 * the editor-caret → note-focus derivation in both current_file mode (every
 * visible note's origin.doc_path matches the active doc) and folder mode (per-doc
 * filter, then match by source_position preserved through mergeAggregateRoot's
 * re-stamping). notes without an origin or source_position match nothing — the
 * caller falls back to the in-tree findDeepestNote path
 */
export function findDeepestNoteByOriginPosition(notes: Array<NoteProps>, active_doc_path: string, caret_pos: number): NoteProps | undefined {
    let best: NoteProps | undefined;
    let best_start = -1;
    for (const note of notes) {
        if (note.origin?.doc_path !== active_doc_path) { continue; }
        const sp = note.origin?.source_position;
        if (!sp) { continue; }
        const end_offset = sp.end_body?.offset ?? sp.end.offset;
        if (caret_pos < sp.start.offset || caret_pos > end_offset) { continue; }
        // prefer the deepest (most specific) note — the one with the latest start offset, mirroring findDeepestNote's right-to-left walk
        if (sp.start.offset > best_start) {
            best = note;
            best_start = sp.start.offset;
        }
    }
    return best;
}

/**
 * find all notes within the active editor's source doc whose source_position is
 * spanned by the editor's range selection (lo..hi). mirrors
 * findDeepestNoteByOriginPosition's per-doc + source_position contract for the
 * selection path. notes without source_position fall back to the in-tree
 * withinNoteHeadlineOrBody predicate, which is coordinate-coherent only when the
 * merged tree shares offsets with the editor (single-file case)
 */
export function findSelectedNotesByOriginPosition(
    notes: Array<NoteProps>,
    active_doc_path: string,
    head: number,
    anchor: number,
): Array<NoteProps> {
    const lo = Math.min(head, anchor);
    const hi = Math.max(head, anchor);
    const same_doc_notes = notes.filter(n => !n.origin || n.origin.doc_path === active_doc_path);
    return same_doc_notes.filter(n => {
        const sp = n.origin?.source_position;
        if (!sp) {
            return withinNoteHeadlineOrBody(head, n) && withinNoteHeadlineOrBody(anchor, n);
        }
        const end = sp.end_body?.offset ?? sp.end.offset;
        return lo <= sp.start.offset && hi >= end;
    });
}

/**
 * resolve the focused note. latest-click-wins with the editor as tiebreaker —
 * the editor-derived caret match wins whenever it produces a note (almost all
 * real editing happens in the editor and the view is a real-time visualisation).
 * view_focused_seqs is the immediate-feedback source for the brief window between
 * a view click and the editor's selectionChanged round-trip, and the fallback
 * when the editor has no opinion (active editor on a doc outside the aggregated
 * set, or caret outside every matched note)
 */
export function resolveFocusedNote(
    view_focused_seqs: number[] | undefined,
    notes: Array<NoteProps>,
    editor_derived_match: NoteProps | undefined,
): NoteProps | undefined {
    if (editor_derived_match) { return editor_derived_match; }
    if (view_focused_seqs?.length) {
        const deepest_seq = view_focused_seqs[view_focused_seqs.length - 1];
        const found = notes.find(n => n.seq === deepest_seq);
        if (found) { return found; }
    }
    return undefined;
}

/**
 * detect whether the root parent_context is a synthetic aggregate root — one
 * whose direct children carry note.origin with multiple distinct doc_ids (or a
 * single origin under an empty synthetic seq-0 root). pure document mode has
 * either no origins or a single origin under a real headline
 */
export function isAggregateRoot(parent_context: NoteProps | undefined): boolean {
    if (!parent_context) { return false; }
    const children = parent_context.child_notes || [];
    const distinct_doc_ids = new Set<string>();
    for (const c of children) {
        if (c.origin?.doc_id) { distinct_doc_ids.add(c.origin.doc_id); }
    }
    return distinct_doc_ids.size >= 2 || (distinct_doc_ids.size === 1 && parent_context.seq === 0 && parent_context.headline_raw === '');
}

/**
 * majority-vote ng_view across the originating files in an aggregate tree. one
 * vote per file, taken from origin.file_view_type (captured from each file's H1).
 * ties or no votes return undefined; caller falls back to 'document'
 */
export function majorityNgView(notes: NoteProps[] | undefined): string | undefined {
    if (!notes?.length) { return undefined; }
    const file_votes = new Map<string, string>();
    for (const n of notes) {
        if (!n.origin?.doc_id || !n.origin?.file_view_type) { continue; }
        if (!file_votes.has(n.origin.doc_id)) {
            file_votes.set(n.origin.doc_id, n.origin.file_view_type);
        }
    }
    if (file_votes.size === 0) { return undefined; }
    const tally = new Map<string, number>();
    for (const v of file_votes.values()) {
        tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    let best_type: string | undefined;
    let best_count = 0;
    let tied = false;
    for (const [type, count] of tally.entries()) {
        if (count > best_count) { best_type = type; best_count = count; tied = false; }
        else if (count === best_count) { tied = true; }
    }
    return tied ? undefined : best_type;
}

/**
 * find the neighbour note (previous/next) of the currently-focused note within
 * a flat list. direction = -1 walks back, +1 walks forward; the result clamps at
 * the edges (no wraparound). when the focused seq isn't in the list, treats the
 * implicit index as -1 so up → first, down → first. used by useViewNavigation's
 * up/down keyboard handlers — identical computation for both directions
 */
export function navigateToNeighbour(notes: Array<NoteProps>, focused_seqs: number[] | undefined, direction: -1 | 1): NoteProps | undefined {
    if (!notes?.length) { return undefined; }
    const seqs = focused_seqs || [];
    const deepest_focused_seq = seqs.length > 0 ? seqs[seqs.length - 1] : -1;
    const current_index = notes.findIndex(n => n.seq === deepest_focused_seq);
    let target_index: number;
    if (direction === -1) {
        target_index = current_index > 0 ? current_index - 1 : 0;
    } else {
        target_index = current_index < notes.length - 1 ? current_index + 1 : current_index;
    }
    return notes[target_index];
}

/**
 * flatten a NoteProps tree into a flat array (root at index 0, children follow
 * in seq order). skips items without a positive numeric seq (mdast leaf nodes
 * that didn't get assigned one). cross-file lib used by both tree composers
 */
export function flattenAllNotes(root: NoteProps): NoteProps[] {
    const result: NoteProps[] = [root];
    function walk(items: Array<unknown>): void {
        for (const item of items) {
            if (item && typeof item === 'object' && 'seq' in item && typeof (item as NoteProps).seq === 'number' && (item as NoteProps).seq > 0) {
                const note = item as NoteProps;
                result.push(note);
                if (note.children_body?.length) {
                    walk(note.children_body);
                }
            }
        }
    }
    if (root.children_body) { walk(root.children_body); }
    return result;
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
export function noteIsVisible(note_element: HTMLElement, view_element: HTMLElement, partial_visibility: boolean = true): boolean {
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
 * Build a focused-chain seq list for a note: every ancestor's seq followed by the note's own seq, in root-to-leaf order. Matches the shape useViewContext produces when deriving focused_seqs from the editor caret, so view-driven writes (click handler, keyboard navigation) and editor-driven derivations agree.
 */
export function focusedChainFor(note: NoteProps): number[] {
    return [...((note.parent_notes || []).map(p => p.seq)), note.seq];
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
export function calculateTextChangesForCheckbox(note: NoteProps, action_is_check: boolean, match_text: string, match_context: Array<string>): Array<{ from: number; to: number; insert: string }> {
    const content = note.body_raw;
    if (!content) { return []; }
    let content_start_position = note.position.end;
    if (!note.position.end_body) {
        content_start_position = note.position.start;
    }
    // find all checkbox patterns: `[x]` or `[ ]` preceded by `- ` on the same line
    const checkbox_re = /- \[([ xX])\]/g;
    let match: RegExpExecArray | null;
    while ((match = checkbox_re.exec(content)) !== null) {
        // check if the text after this checkbox matches match_text
        const bracket_close = match.index + match[0].length; // position after `]`
        const text_after = content.slice(bracket_close);
        if (match_text && (text_after.startsWith(match_text) || text_after.startsWith(` ${match_text}`))) {
            // bracket_start is the position of `[`, the char to replace is at bracket_start + 1
            const bracket_start = match.index + 2; // `- [`  →  index of `[`
            const from = content_start_position.offset + bracket_start + 1;
            const to = content_start_position.offset + bracket_start + 2;
            // validate: from < to and the replacement makes sense
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
