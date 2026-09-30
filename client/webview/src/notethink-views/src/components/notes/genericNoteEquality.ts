import type { NoteProps } from "../../types/NoteProps";

/** shallow value-equality over an object's own enumerable keys, for a caller (dnd) that hands back a fresh object with unchanged content every render */
function shallowEqualRecord(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
    if (a === b) { return true; }
    if (!a || !b) { return false; }
    const a_keys = Object.keys(a);
    const b_keys = Object.keys(b);
    if (a_keys.length !== b_keys.length) { return false; }
    return a_keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * `draggableProps`, one level deeper: `cardStyle` builds a fresh `style` object every call, so it
 * needs a shallow compare rather than the `Object.is` the other draggableProps keys get.
 */
function shallowEqualDraggableProps(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
    if (a === b) { return true; }
    if (!a || !b) { return false; }
    const a_keys = Object.keys(a);
    const b_keys = Object.keys(b);
    if (a_keys.length !== b_keys.length) { return false; }
    return a_keys.every((key) => {
        if (key === 'style') { return shallowEqualRecord(a.style as Record<string, unknown> | undefined, b.style as Record<string, unknown> | undefined); }
        return Object.is(a[key], b[key]);
    });
}

/** true when `note.seq` is present in `seqs`, the same test GenericNote applies to derive its own `focused`/`selected` flag */
function includesSeq(seqs: number[] | undefined, seq: number): boolean {
    return !!seqs?.length && seqs.includes(seq);
}

/**
 * True for a note GenericNote's own crop rule restricts, narrower than the raw
 * `focused_seqs`/`selected_seqs` this comparator otherwise reads. Undefined `selectable_level`
 * never crops.
 */
function isCropped(note: NoteProps): boolean {
    const selectable_level = note.display_options?.deepest?.selectable_level;
    return selectable_level !== undefined && note.level > selectable_level;
}

/**
 * `React.memo`'s comparator for `GenericNote`. The default shallow-prop compare never passes: every
 * caller builds a fresh `display_options` object per render, so this reaches past that wrapper to
 * the handful of fields that actually change what GenericNote renders.
 *
 * A field this function doesn't know about is a card that fails to update when it should - the
 * fallback below (any cropped note re-renders on any focus/selection change) is deliberately
 * over-inclusive; extend the field list here, never assume.
 */
export function genericNoteAreEqual(prev: NoteProps, next: NoteProps): boolean {
    if (prev.seq !== next.seq || prev.stable_id !== next.stable_id) { return false; }
    if (prev.type !== next.type || prev.lang !== next.lang || prev.level !== next.level) { return false; }
    // headline/body are rendered once at parse time; raw strings change only on a genuine content edit
    if (prev.headline_raw !== next.headline_raw || prev.body_raw !== next.body_raw) { return false; }
    if (prev.headline !== next.headline || prev.body !== next.body) { return false; }
    if (prev.children_body !== next.children_body || prev.child_notes !== next.child_notes) { return false; }
    if (prev.linetags !== next.linetags || prev.locked !== next.locked) { return false; }
    if (prev.handlers !== next.handlers || prev.selection !== next.selection) { return false; }
    const prev_do = prev.display_options;
    const next_do = next.display_options;
    if (prev_do === next_do) { return true; }
    if (isCropped(next)) {
        // a nested note's focus/selection depends on ancestors this doesn't walk - use the raw arrays as-is
        if (prev_do?.focused_seqs !== next_do?.focused_seqs || prev_do?.selected_seqs !== next_do?.selected_seqs) { return false; }
    } else {
        if (includesSeq(prev_do?.focused_seqs, prev.seq) !== includesSeq(next_do?.focused_seqs, next.seq)) { return false; }
        if (includesSeq(prev_do?.selected_seqs, prev.seq) !== includesSeq(next_do?.selected_seqs, next.seq)) { return false; }
    }
    if (prev_do?.card_target_height !== next_do?.card_target_height) { return false; }
    if (prev_do?.settings !== next_do?.settings) { return false; }
    if (prev_do?.deepest?.selectable_level !== next_do?.deepest?.selectable_level) { return false; }
    if (prev_do?.caret_offset !== next_do?.caret_offset) { return false; }
    if (prev_do?.additional_classes?.join(',') !== next_do?.additional_classes?.join(',')) { return false; }
    if (!shallowEqualDraggableProps(prev_do?.provided?.draggableProps, next_do?.provided?.draggableProps)) { return false; }
    if (!shallowEqualRecord(prev_do?.provided?.dragHandleProps, next_do?.provided?.dragHandleProps)) { return false; }
    return true;
}
