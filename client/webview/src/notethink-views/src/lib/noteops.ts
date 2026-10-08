import Debug from "debug";
import type { NoteProps, MdastNode, TextSelection, ClickPositionInfo, LineTag } from "../types/NoteProps";
import type { GroupDisplayEntry } from "../types/Messages";
import { INTEGRATION_MODE_CURRENT_FILE } from "../types/IntegrationMode";
import { ABSENT_VALUE_BUCKET, FIRST_LEVEL_FOLDER_KEY, axisField, categoricalLaneFor, projectNoteOntoAxis, type Axis } from "./axisops";
import { projectNameFromRelativePath } from "./originops";
import { isVirtualNote } from "./virtualnoteops";

const debug = Debug("nodejs:notethink-views:noteops");

export interface StableIdCollision {
    slug: string;
    notes: NoteProps[];
}

export interface CollisionNoteLocation {
    headline: string;
    relative_path: string;
    line: number;
}

/**
 * Shallow element-wise equality for two ordered arrays of primitives. Lives here beside the
 * note-tree comparators since its only consumers (MarkdownNote memo compare, kanban columnops) are
 * note-adjacent; move it out if a non-note caller appears.
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

/** membership of a note's own stable_id in the view's manual-expansion list; a note with no stable_id can never be listed */
export function isNoteManuallyExpanded(note: NoteProps): boolean {
    const stable_id = note.stable_id;
    if (stable_id === undefined) { return false; }
    return note.display_options?.view_expanded_ids?.includes(stable_id) ?? false;
}

/** hand the view that owns the id list one expand/collapse; a note with no stable_id has no identity to key expansion on */
export function dispatchNoteExpanded(note: NoteProps, expanded: boolean): void {
    if (note.stable_id === undefined) { return; }
    note.handlers?.setNoteExpanded?.(note.stable_id, expanded);
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
 * Deepest note whose source_position spans caret_pos, restricted to origin.doc_path ===
 * active_doc_path. Works in both current_file and folder mode since source_position survives
 * mergeAggregateRoot's re-stamping; a note without one matches nothing and the caller falls back
 * to findDeepestNote.
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
        // prefers the deepest note: latest start offset, mirroring findDeepestNote's right-to-left walk
        if (sp.start.offset > best_start) {
            best = note;
            best_start = sp.start.offset;
        }
    }
    return best;
}

/**
 * Notes in the active doc whose source_position falls within the editor's [lo, hi] selection. A
 * note without source_position falls back to withinNoteHeadlineOrBody, which only agrees with the
 * editor's offsets in single-file mode.
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
 * Resolves the focused note: the editor-derived caret match wins whenever present, then the
 * latest view_focused_ids click, then the virtual view_caret against in-tree offsets - the last
 * resort so a note clicked without a stable_id still highlights.
 */
export function resolveFocusedNote(
    view_focused_ids: string[] | undefined,
    notes: Array<NoteProps>,
    editor_derived_match: NoteProps | undefined,
    view_caret?: number,
): NoteProps | undefined {
    if (editor_derived_match) { return editor_derived_match; }
    const last_id = view_focused_ids?.[view_focused_ids.length - 1];
    if (last_id) {
        const found = notes.find(n => n.stable_id === last_id);
        if (found) { return found; }
    }
    // no-editor / no-stable_id fallback: resolve the virtual caret against the in-tree offsets
    if (view_caret !== undefined) {
        const by_caret = findDeepestNote(notes, view_caret);
        if (by_caret) { return by_caret; }
    }
    return undefined;
}

/**
 * True when parent_context is a synthetic aggregate root: children carry origin with more than one
 * distinct doc_id, or a single origin under an empty synthetic seq-0 root. Pure document mode has
 * no origins, or one origin under a real headline.
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
 * Majority-vote a per-file attribute across an aggregate tree's originating files: one vote per
 * file (keyed on origin.doc_id), cast by `voteFor` from the first note seen for that file. Strict
 * plurality wins; ties or no votes return undefined. Shared by nt_view and nt_group_by
 * auto-resolution so both apply identical semantics.
 */
export function majorityFileVote(notes: NoteProps[] | undefined, voteFor: (note: NoteProps) => string | undefined): string | undefined {
    if (!notes?.length) { return undefined; }
    const file_votes = new Map<string, string>();
    for (const n of notes) {
        const doc_id = n.origin?.doc_id;
        const vote = voteFor(n);
        if (!doc_id || !vote) { continue; }
        if (!file_votes.has(doc_id)) { file_votes.set(doc_id, vote); }
    }
    if (file_votes.size === 0) { return undefined; }
    const tally = new Map<string, number>();
    for (const v of file_votes.values()) {
        tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    let best_value: string | undefined;
    let best_count = 0;
    let tied = false;
    for (const [value, count] of tally.entries()) {
        if (count > best_count) { best_value = value; best_count = count; tied = false; }
        else if (count === best_count) { tied = true; }
    }
    return tied ? undefined : best_value;
}

/**
 * Majority-vote nt_view across the originating files, one vote per file from
 * origin.file_view_type as captured from each file's H1. Ties or no votes return undefined;
 * the caller falls back to 'document'.
 */
export function majorityNgView(notes: NoteProps[] | undefined): string | undefined {
    return majorityFileVote(notes, n => n.origin?.file_view_type);
}

/**
 * Majority-vote nt_card across the originating files, one vote per file from
 * origin.file_card_type as captured from each file's H1. Ties or no votes return undefined;
 * the caller falls back to the resolved view's declared default card type.
 */
export function majorityCardType(notes: NoteProps[] | undefined): string | undefined {
    return majorityFileVote(notes, n => n.origin?.file_card_type);
}

/**
 * Majority-vote nt_group_by across the originating files, one vote per file from
 * origin.file_group_by. Ties or no votes return undefined; the Line view falls back to the
 * first-level folder default.
 */
export function majorityGroupBy(notes: NoteProps[] | undefined): string | undefined {
    return majorityFileVote(notes, n => n.origin?.file_group_by);
}

/**
 * Neighbour note (previous/next) of the focused note in a flat list; direction -1 walks back, +1
 * forward, clamped at the edges (no wraparound). An unmatched focused seq is treated as index -1,
 * so both up and down land on the first note.
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
 * Flattens a NoteProps tree into an array (root at index 0, children in seq order), skipping items
 * without a positive numeric seq (unassigned mdast leaf nodes).
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
 * The document root note (notes[0], type 'root') when it should drive a
 * document-level front-matter strip: single-file mode only - the merged folder
 * root carries no front matter - and only when the root actually has linetags.
 * Returns undefined otherwise so callers can render `{root && <strip/>}` without a
 * second guard. Shared by DocumentView and KanbanView so the gate and root
 * selection stay identical across both views.
 */
export function documentRootForStrip(notes: Array<NoteProps> | undefined, integration_mode: string | undefined): NoteProps | undefined {
    if (integration_mode !== INTEGRATION_MODE_CURRENT_FILE) { return undefined; }
    const root = notes?.[0];
    if (!root || root.type !== 'root' || !root.linetags) { return undefined; }
    return root;
}

/**
 * Based on a text selection, find the set of notes that it comprehensively spans.
 * Operates on a text-offset TextSelection rather than an editor-bound selection.
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
export function resolveCaretPosition(ncp: ClickPositionInfo, _note?: NoteProps): number {
    return ncp.from;
}

/**
 * Build a focused-chain seq list for a note: every ancestor's seq followed by the note's own seq, in root-to-leaf order. Matches the shape useViewContext produces when deriving focused_seqs from the editor caret, so view-driven writes (click handler, keyboard navigation) and editor-driven derivations agree.
 */
export function focusedChainFor(note: NoteProps): number[] {
    return [...((note.parent_notes || []).map(p => p.seq)), note.seq];
}

/**
 * Build a focused-chain stable_id list for a note: every ancestor's stable_id followed by the note's own, in root-to-leaf order, dropping any undefined. The stable_id mirror of focusedChainFor, used for the view-driven interaction state that must survive re-parse.
 */
export function focusedChainIdsFor(note: NoteProps): string[] {
    return [...(note.parent_notes || []).map(p => p.stable_id), note.stable_id].filter((id): id is string => id !== undefined);
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
 * Searches for `- [ ] text` / `+ [x] text` / `* [ ] text` task list patterns in
 * the note's body_raw, using a regex to avoid matching linetags or markdown links.
 * All three GFM unordered-list markers are accepted because this repo's todo files
 * use `+` bullets while standard markdown uses `-`.
 */
export function calculateTextChangesForCheckbox(note: NoteProps, action_is_check: boolean, match_text: string, _match_context: Array<string>): Array<{ from: number; to: number; insert: string }> {
    const content = note.body_raw;
    if (!content) { return []; }
    let content_start_position = note.position.end;
    if (!note.position.end_body) {
        content_start_position = note.position.start;
    }
    // match a `[x]`/`[ ]` checkbox preceded by any unordered-list marker (- + *) and a space
    const checkbox_re = /[-+*] \[([ xX])\]/g;
    let match: RegExpExecArray | null;
    while ((match = checkbox_re.exec(content)) !== null) {
        // check if the text after this checkbox matches match_text
        const bracket_close = match.index + match[0].length; // position after `]`
        const text_after = content.slice(bracket_close);
        if (match_text && (text_after.startsWith(match_text) || text_after.startsWith(` ${match_text}`))) {
            // locate `[` within the matched marker so the offset is marker-agnostic; the state char sits at bracket_start + 1
            const bracket_start = match.index + match[0].indexOf('[');
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
 * Resolves an `nt_breadcrumb_last` epic/story label to the first heading note whose stripped
 * headline matches it, for seeding `parent_context_id`. Only heading notes are considered; returns
 * the note itself since its seq would not survive the next parse.
 */
export function breadcrumbNoteForLabel(label: string, notes: Array<NoteProps> | undefined): NoteProps | undefined {
    if (!label || !notes?.length) { return undefined; }
    for (const note of notes) {
        if (note.type !== 'heading') { continue; }
        if (stripHeadlineLinetags(note.headline_raw ?? '') === label) { return note; }
    }
    return undefined;
}

/**
 * Looks a note up by its seq in the flat note list a view receives.
 *
 * Use this rather than `notes.at(seq)`. The two agree for a plain parse, where seqs match array
 * index, but they diverge after flattenSingleFileStories: it lifts `###` stories out from under
 * their `##` epics without renumbering, so the dropped epic headings leave gaps and every later
 * note's index falls below its seq. Indexing by seq there returns a different note.
 */
export function findNoteBySeq(notes: Array<NoteProps> | undefined, seq: number): NoteProps | undefined {
    if (!notes?.length) { return undefined; }
    return notes.find(n => n.seq === seq);
}

/**
 * Resolves the persisted `parent_context_id` to the note the view should scope to, against the
 * current parse. Mirrors resolveFocusedNote's precedence: an exact `stable_id` match first, then
 * the authored `nt_breadcrumb_last` label (no stable_id yet at that point). Undefined means the id
 * no longer resolves (a renamed or deleted story), so the caller scopes to the root instead of
 * pinning to whatever note inherited the number.
 */
export function resolveParentContextNote(parent_context_id: string | undefined, notes: Array<NoteProps> | undefined): NoteProps | undefined {
    if (!parent_context_id || !notes?.length) { return undefined; }
    const by_stable_id = notes.find(n => n.stable_id === parent_context_id);
    if (by_stable_id) { return by_stable_id; }
    const by_label = breadcrumbNoteForLabel(parent_context_id, notes);
    if (by_label) { return by_label; }
    debug('parent_context_id %s matched no note in the current parse, scoping to the root', parent_context_id);
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
 * Formats a kanban column name for display: dashes become spaces, each word is title-cased, so the
 * raw slug `code-review` renders as `Code Review`. Empty input returns empty.
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
 * Natural lane order for an axis: the distinct lane values present in the notes, sorted alphabetically,
 * with the synthetic absent-value bucket always last. `axis` selects the categorical field to group by
 * and defaults to the status axis, so a bare call orders kanban's status columns (untagged is the absent bucket).
 */
export function deriveNaturalColumnOrder(notes: Array<NoteProps>, axis: Axis = 'status'): string[] {
    const lane_values = new Set<string>();
    for (const note of (notes || [])) {
        const value = kanbanColumnValue(note, axis);
        if (value !== ABSENT_VALUE_BUCKET) { lane_values.add(value); }
    }
    return [...Array.from(lane_values).sort(), ABSENT_VALUE_BUCKET];
}

/**
 * The lane order AND visibility the settings drawer edits: the saved entries first, then every live
 * lane the saved list does not name, appended as shown, so a status added since the order was saved is
 * still reachable and defaults to visible. This is the same layering `useKanbanColumns` applies when it
 * builds the board's lanes (over the entries' values alone), so the editor lists the lanes in the order
 * the board draws them. A hidden lane stays in this list, still reorderable, while the board leaves it out.
 */
export function mergeSavedGroupDisplay(saved: GroupDisplayEntry[] | undefined, natural: string[]): GroupDisplayEntry[] {
    if (!saved || saved.length === 0) { return natural.map(value => ({ value, shown: true })); }
    const saved_values = new Set(saved.map(entry => entry.value));
    const appended = natural.filter(value => !saved_values.has(value)).map(value => ({ value, shown: true }));
    return [...saved, ...appended];
}

/** `entries` with one lane's `shown` flipped, reading a missing flag as shown; an absent value changes nothing */
export function toggleShownInDisplay(entries: GroupDisplayEntry[], value: string): GroupDisplayEntry[] {
    return entries.map(entry => (entry.value === value ? { ...entry, shown: entry.shown === false } : entry));
}

/** the order with one entry moved to another index; an index outside the list returns the order unchanged */
export function moveInOrder<T>(order: T[], from_index: number, to_index: number): T[] {
    if (from_index === to_index) { return order; }
    if (from_index < 0 || to_index < 0 || from_index >= order.length || to_index >= order.length) { return order; }
    const next = [...order];
    const [moved] = next.splice(from_index, 1);
    next.splice(to_index, 0, moved);
    return next;
}

/**
 * The lane a note belongs to on an axis: its linetag value for the axis field, or the absent-value
 * bucket when it has none (empty also falls through). Single source of truth for the note->lane
 * rule, shared by the lane builder, drag projection, and natural lane order.
 */
export function kanbanColumnValue(note: NoteProps, axis: Axis = 'status'): string {
    // the first-level-folder axis is computed from origin, not a linetag; every other axis reads its linetag
    if (axisField(axis) === FIRST_LEVEL_FOLDER_KEY) {
        return categoricalLaneFor(projectNameFromRelativePath(note.origin?.relative_path));
    }
    return projectNoteOntoAxis(note, axis);
}

/**
 * Notes in one lane on an axis, in display order: selected by `kanbanColumnValue`, sorted by
 * `kanbanNoteOrder`. Shared so the lane builder and drag projection agree on membership and order.
 */
export function notesInKanbanColumn(notes: Array<NoteProps>, column_value: string, axis: Axis = 'status'): Array<NoteProps> {
    return notes.filter(note => kanbanColumnValue(note, axis) === column_value).sort(kanbanNoteOrder);
}

/**
 * Standard note ordering: by seq (the canonical reading order - document order
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
 * of its band naturally - no separate "active file" signal is required. For
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
 * Kanban ordering: explicit `nt_kanban_ordering_weight` linetag is decisive,
 * including across files. The weight's *value* is what carries the user-chosen
 * cross-file order, so the comparator never consults `file_rank` / `file_mtime`
 * when either side carries a weight - that would let relevance shove a
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
    const weight_a = a?.linetags?.nt_kanban_ordering_weight?.value_numeric;
    const weight_b = b?.linetags?.nt_kanban_ordering_weight?.value_numeric;
    const has_a = weight_a !== undefined && weight_a !== 0;
    const has_b = weight_b !== undefined && weight_b !== 0;
    // case 1: both weighted - pure numeric compare, seq tiebreak only
    if (has_a && has_b) {
        if (weight_a !== weight_b) {
            return (weight_a! > weight_b! ? 1 : -1);
        }
        return (a.seq > b.seq ? 1 : -1);
    }
    // case 2: exactly one weighted - weighted sorts AFTER unweighted
    if (has_a) { return 1; }
    if (has_b) { return -1; }
    // case 3: neither weighted - implicit relevance order
    return noteOrder(a, b);
}

/**
 * Identity string for a note in column views: the @hello-pangea/dnd draggableId and React key.
 * Prefers stable_id, invariant across re-parse, so a card keeps its DOM node through a round-trip;
 * falls back to seq when stable_id is absent.
 */
export function kanbanDraggableId(note: NoteProps): string {
    return note.stable_id ?? `${note.seq}`;
}

// lowercase kebab-case: non-alphanumeric runs become one hyphen, leading/trailing hyphens stripped
export function slugify(text: string): string {
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Derives the story-level stable_id slug from headline + linetags: the explicit `[](?id=...)`
 * linetag when present, else slugify() of the stripped headline, so implicit and future explicit
 * ids coincide. The caller namespaces with `doc_id` and disambiguates duplicates within the file.
 */
export function storyStableIdSlug(story: NoteProps): string {
    const id_value = story.linetags?.id?.value;
    if (id_value) { return id_value; }
    const stripped = stripHeadlineLinetags(story.headline_raw ?? '');
    return slugify(stripped) || `headline-${story.position?.start?.line ?? 0}`;
}

/**
 * True for a heading with a positive seq (excludes the synthetic root) and a non-empty stripped
 * headline - the set mergeAggregateRoot stamps as `${doc_id}:${slug}`. Virtual notes are excluded
 * too: their stable_id comes from session identity, so grouping by headline would falsely flag two
 * agents that describe themselves alike.
 */
function isStoryLevelNote(note: NoteProps): boolean {
    if (isVirtualNote(note)) { return false; }
    if (note.type !== 'heading') { return false; }
    if (!(note.seq > 0)) { return false; }
    return stripHeadlineLinetags(note.headline_raw ?? '') !== '';
}

// 1-based source line of a note: folder-mode origin source line, else the in-tree position line
function collisionNoteLine(note: NoteProps): number {
    return note.origin?.source_position?.start.line ?? note.position?.start?.line ?? 0;
}

/**
 * Groups the flat note list by the slug each story-level heading would receive (storyStableIdSlug),
 * keeping only slugs shared by >=2 notes so genuinely blank-slug notes still surface. Notes within
 * a group are ordered by source line, groups by their first note's seq, for a deterministic result.
 */
export function findStableIdCollisions(notes: NoteProps[]): StableIdCollision[] {
    const by_slug = new Map<string, NoteProps[]>();
    for (const note of notes) {
        if (!isStoryLevelNote(note)) { continue; }
        const slug = storyStableIdSlug(note);
        const group = by_slug.get(slug);
        if (group) { group.push(note); } else { by_slug.set(slug, [note]); }
    }
    const collisions: StableIdCollision[] = [];
    for (const [slug, group] of by_slug) {
        if (group.length < 2) { continue; }
        const ordered = [...group].sort((a, b) => collisionNoteLine(a) - collisionNoteLine(b) || a.seq - b.seq);
        collisions.push({ slug, notes: ordered });
    }
    collisions.sort((a, b) => a.notes[0].seq - b.notes[0].seq);
    debug("found %d stable_id collision group(s)", collisions.length);
    return collisions;
}

/**
 * Display origin for a colliding note: stripped headline plus source file and 1-based line.
 * Prefers folder-mode `origin.source_position`/`relative_path`, else the in-tree `position` +
 * `doc_path` (empty path in single-file mode).
 */
export function collisionNoteLocation(note: NoteProps): CollisionNoteLocation {
    const headline = stripHeadlineLinetags(note.headline_raw ?? '');
    const relative_path = note.origin?.relative_path ?? note.origin?.doc_path ?? '';
    return { headline, relative_path, line: collisionNoteLine(note) };
}
