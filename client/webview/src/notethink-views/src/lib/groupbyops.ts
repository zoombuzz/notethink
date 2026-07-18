import Debug from "debug";
import { HIDDEN_ATTRIBUTES, isNamespacedKey, resolveNamespacedTag } from "./linetagops";
import { projectNameFromRelativePath } from "./originops";
import { aggregateNoteLinetags, majorityGroupBy } from "./noteops";
import { FIRST_LEVEL_FOLDER_KEY, type AxisKind, type AxisSpec } from "./axisops";
import type { LineTag, NoteProps } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:groupbyops");

// re-exported from axisops (its neutral home, shared with the lane helpers) so group-by consumers keep one import site
export { FIRST_LEVEL_FOLDER_KEY };

/**
 * GroupByCandidate, one key a view can group its notes by, plus everything the axis machinery needs to
 * offer it: its distinct values, its axis kind, whether a drop may write it, and whether it is an
 * implicit computed key.
 * - key: an authored attribute name (e.g. 'status', 'assignee') or the implicit FIRST_LEVEL_FOLDER_KEY
 * - values: the distinct values across the notes, sorted alphabetically
 * - kind: 'continuous' when every collected value is numeric, otherwise 'categorical'
 * - writable: authored attributes are writable; implicit keys are read-only (a drop can't move a file)
 * - implicit: true only for computed keys (the first-level folder); absent for authored attributes
 */
export interface GroupByCandidate {
    key: string;
    values: string[];
    kind: AxisKind;
    writable: boolean;
    implicit?: boolean;
}

interface CandidateAccumulator {
    values: Set<string>;
    all_numeric: boolean;
}

// memoises the sweep against the notes array identity - a new merge output re-sweeps, an unchanged one is served from cache
const candidate_cache = new WeakMap<object, GroupByCandidate[]>();

/**
 * a linetag value counts as numeric only when value_numeric was stored AND is a real number. LineTag
 * stores value_numeric as Number(value), so "5px" yields NaN - which must read as non-numeric here.
 */
export function isNumericTag(tag: LineTag): boolean {
    return tag.value_numeric !== undefined && !isNaN(tag.value_numeric);
}

/**
 * fold one note's authored linetags into the per-key accumulator: collect each tag's value into the
 * key's distinct-value set (inherited tags included) and AND the key's all-numeric flag with whether
 * this tag's value is numeric. Namespaced (nt_/ng_) keys and the hidden noise keys are skipped.
 */
function foldNoteLinetags(note: NoteProps, accumulator: Map<string, CandidateAccumulator>): void {
    const linetags = note.linetags ?? {};
    for (const key of Object.keys(linetags)) {
        if (isNamespacedKey(key)) { continue; }
        if (HIDDEN_ATTRIBUTES.includes(key)) { continue; }
        const tag = linetags[key];
        let entry = accumulator.get(key);
        if (!entry) {
            entry = { values: new Set<string>(), all_numeric: true };
            accumulator.set(key, entry);
        }
        entry.values.add(tag.value);
        entry.all_numeric = entry.all_numeric && isNumericTag(tag);
    }
}

/**
 * finalise the per-key accumulator into authored candidates: each key becomes a writable candidate,
 * continuous when every collected value was numeric and categorical otherwise, with values sorted.
 */
function finaliseAuthoredCandidates(accumulator: Map<string, CandidateAccumulator>): GroupByCandidate[] {
    const candidates: GroupByCandidate[] = [];
    for (const [key, entry] of accumulator) {
        candidates.push({
            key,
            values: Array.from(entry.values).sort(),
            kind: entry.all_numeric ? 'continuous' : 'categorical',
            writable: true,
        });
    }
    return candidates;
}

/**
 * build the implicit first-level-folder candidate from the notes' origins: the distinct non-empty
 * project names (first segment of each origin.relative_path). returns undefined when no note carries a
 * folder (single-file mode), so the key simply does not appear.
 */
function buildFolderCandidate(notes: Array<NoteProps>): GroupByCandidate | undefined {
    const folders = new Set<string>();
    for (const note of notes) {
        const folder = projectNameFromRelativePath(note.origin?.relative_path);
        if (folder) { folders.add(folder); }
    }
    if (folders.size === 0) { return undefined; }
    return {
        key: FIRST_LEVEL_FOLDER_KEY,
        values: Array.from(folders).sort(),
        kind: 'categorical',
        writable: false,
        implicit: true,
    };
}

/**
 * enumerate the group-by candidate keys across the rendered notes: every authored (non-namespaced,
 * non-hidden) attribute plus the implicit first-level-folder key computed from each note's origin. each
 * candidate reports its distinct sorted values, its axis kind (continuous when every value is numeric,
 * categorical otherwise), and its writability (authored attributes writable, the folder key read-only).
 * results are sorted by key for determinism and memoised on the notes array identity.
 */
export function enumerateGroupByCandidates(notes: Array<NoteProps> | undefined): GroupByCandidate[] {
    if (!notes || notes.length === 0) { return []; }
    const cached = candidate_cache.get(notes);
    if (cached) { return cached; }
    const accumulator = new Map<string, CandidateAccumulator>();
    for (const note of notes) {
        foldNoteLinetags(note, accumulator);
    }
    const candidates = finaliseAuthoredCandidates(accumulator);
    const folder_candidate = buildFolderCandidate(notes);
    if (folder_candidate) { candidates.push(folder_candidate); }
    candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    candidate_cache.set(notes, candidates);
    return candidates;
}

/**
 * resolve which key a Line view groups by, with the same auto semantics as nt_view. An explicit selection
 * (a non-'auto' value picked in the group-by select) wins; otherwise a focused note's `nt_group_by`
 * overrides, then the majority `nt_group_by` vote across files, and finally the first-level-folder default.
 * `selection` is the persisted per-view choice ('auto' / undefined means auto-resolve).
 */
export function resolveGroupByAxisKey(
    notes: Array<NoteProps> | undefined,
    focused_notes: Array<NoteProps> | undefined,
    selection: string | undefined,
): string {
    if (selection && selection !== 'auto') { return selection; }
    if (focused_notes?.length) {
        const focused_tag = resolveNamespacedTag(aggregateNoteLinetags(focused_notes), 'group_by');
        if (focused_tag?.value) { return focused_tag.value; }
    }
    const majority = majorityGroupBy(notes);
    if (majority) { return majority; }
    return FIRST_LEVEL_FOLDER_KEY;
}

/**
 * build the categorical Axis for a resolved group-by key. Writability comes from the enumerated
 * candidate (authored attributes writable, the implicit folder key read-only); when the key is not yet
 * present in the notes it falls back to writable unless it is the read-only first-level-folder key.
 */
export function axisForGroupByKey(key: string, notes: Array<NoteProps> | undefined): AxisSpec {
    const candidate = enumerateGroupByCandidates(notes).find(c => c.key === key);
    const writable = candidate ? candidate.writable : key !== FIRST_LEVEL_FOLDER_KEY;
    debug('axisForGroupByKey %s writable=%s', key, writable);
    return { field: key, kind: 'categorical', writable };
}
