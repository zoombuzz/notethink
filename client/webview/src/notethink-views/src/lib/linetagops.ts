import Debug from "debug";
import { noteOrder } from "./noteops";
import type {LineTag, NoteProps} from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:linetagops");

type HashMapOf<S> = { [key: string]: S };

// NoteThink's internal linetag namespace. `nt_` is the prefix we write going forward; `ng_` is the accepted legacy synonym (read-only, forever). Ordered nt_-first so the canonical prefix wins when both forms are present.
export const NOTETHINK_PREFIXES = ['nt_', 'ng_'] as const;

/** true if key is in NoteThink's internal namespace (any accepted prefix) */
export function isNamespacedKey(key: string): boolean {
    return NOTETHINK_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** resolve a namespaced linetag by bare name (e.g. 'view'), preferring nt_ then ng_ */
export function resolveNamespacedTag(linetags: HashMapOf<LineTag> | undefined, name: string): LineTag | undefined {
    if (!linetags) { return undefined; }
    for (const prefix of NOTETHINK_PREFIXES) {
        const tag = linetags[prefix + name];
        if (tag) { return tag; }
    }
    return undefined;
}

/**
 * @param input
 * @return string all the linetags ([...))$ in a single string
 * Regex copes with additional characters around first/last linetag, e.g. ('doing' story for Alex)
 */
export function findLineTags(input: string): string {
    // use String.match() with regex to pull out all linetags together (https://regexr.com/) if bracketed ([]()) or ('[]()')
    const bracketed_matches = input.match(new RegExp('(\\([^\\]]*\\[.*\\]\\(\\?[^\\)]*\\)[^\\]]*\\))[\\n]*$'));
    if (bracketed_matches && bracketed_matches?.length >= 2) {
        return bracketed_matches[1];
    }
    // use String.match() with regex to pull out all linetags together if unbracketed [](?...) - requires '?' to distinguish from markdown links
    const brackless_matches = input.match(new RegExp('(\\[.*\\]\\(\\?[^\\)]*\\)[^\\]]*)[\\n]*$'));
    if (brackless_matches && brackless_matches?.length >= 2) {
        return brackless_matches[1];
    }
    return '';
}

/**
 * @param input complete linetags, of the form ([]()<any separator>[]()<any separator>[]()<any separator>...)
 * @return object many linetags
 */
export function parseLineTags(input: string, note_seq: number): HashMapOf<LineTag> | undefined {
    // create empty linetags object which can accept dynamic keys of any type
    const linetags: HashMapOf<LineTag> = {};
    // use RegExp.exec() to pull out all links with position information (https://regexr.com/)
    const regex = RegExp('\\[(?<text>[^\\]]*)\\]\\((?<href>[^\\)]*)\\)', 'dg');
    let matches: RegExpExecArray | null;
    while ((matches = regex.exec(input) as RegExpExecArray | null) !== null) {
        if (matches.groups && matches.groups.href) {
            // skip markdown links - linetags always start with '?' (e.g. [](?key=value))
            if (!matches.groups.href.startsWith('?')) { continue; }
            const link_text = matches.groups?.text;
            const link_queryparams = new URLSearchParams(matches.groups?.href);
            const link_querykeys = link_queryparams.keys();
            // use array as intermediary so as not to require `--downlevelIteration` compiler option
            for (const key of Array.from(link_querykeys)) {
                const value = link_queryparams.get(key);
                if (value === null) { continue; }
                // offsets are relative to the note's linetags_offset
                const linetag: LineTag = {
                    key: key,
                    value: value,
                    note_seq: note_seq,
                    // always capture linktext_offset even if there's no linktext
                    linktext_offset: matches?.indices?.groups?.text?.[0] || 0,
                    // define temporary values to avoid linetag type error
                    key_offset: 0,
                    value_offset: 0,
                };
                const href_offset = matches?.indices?.groups?.href?.[0];
                if (href_offset !== undefined) {
                    if (matches.groups?.href.indexOf(key) !== -1) {
                        linetag.key_offset = href_offset + (matches.groups?.href.indexOf(key) ?? 0);
                    }
                    if (matches.groups?.href.indexOf(value) !== -1) {
                        linetag.value_offset = href_offset + (matches.groups?.href.indexOf(value) ?? 0);
                    }
                }
                // if this value is numeric, store number version of it
                if (!isNaN(parseFloat(value))) {
                    Object.assign(linetag, {
                        value_numeric: Number(value),
                    });
                }
                // if this link has link_text that's identical to this attribute's value, store it
                if (link_text && link_text === value) {
                    Object.assign(linetag, {
                        linktext: link_text,
                    });
                }
                // store this linetag in linetags object
                linetags[key] = linetag;
            }
        }
    }
    // if there are no attributes, leave linetags? undefined
    const keys = Object.keys(linetags);
    if (keys.length === 0) { return undefined; }
    return linetags;
}

/**
 * a change record produced by the ordering algorithm. Matches the shape
 * `calculateTextChangesForNewLinetagValue` already returns: `{from, to?, insert}`.
 */
export interface OrderingChange {
    from: number;
    to?: number;
    insert: string;
}

/**
 * per-doc partitioned change set returned by `calculateTextChangesForOrdering`.
 * `doc_path` is the `origin.doc_path` of every note that contributed a change in
 * this batch; `undefined` is the single-file (no-origin) bucket. The extension
 * applies each batch atomically against the corresponding file.
 */
export interface OrderingChangeSet {
    doc_path: string | undefined;
    changes: Array<OrderingChange>;
}

/**
 * decide whether the column shares a single origin file (or has no origins at all). that is the byte-identical single-file path; anything else activates the cross-file algorithm.
 */
function columnIsSingleFile(column_children: Array<NoteProps>): boolean {
    let seen: string | undefined;
    let seen_any = false;
    for (const note of column_children) {
        const dp = note.origin?.doc_path;
        if (!seen_any) {
            seen = dp;
            seen_any = true;
            continue;
        }
        if (seen !== dp) { return false; }
    }
    return true;
}

/**
 * calculate the text changes needed so that, after applying them and re-sorting
 * by `kanbanNoteOrder`, `column_children` holds the order the caller passed in.
 *
 * The caller MUST pre-sort `column_children` into the desired user-facing order
 * (e.g. by filtering the dragged note out and splicing it at the drop index).
 * This function decides how to encode that order into `nt_kanban_ordering_weight`
 * values, and partitions the resulting text edits by `origin.doc_path`.
 *
 * Return shape: `Array<OrderingChangeSet>` — one entry per touched doc, with
 * `doc_path` set to that file's path (or `undefined` in single-file mode).
 * Empty array means no edits are needed (sequence/seq ordering already matches).
 *
 * Single-file contract: when every child shares one `origin.doc_path` (or all
 * are undefined) the output is byte-identical to the pre-refactor algorithm —
 * see `singleFileOrderingChanges`. Cross-file ordering is handled by
 * `crossFileOrderingChanges`. Single-file callers can flatten the result with
 * `flattenOrderingChangeSets()`.
 */
export function calculateTextChangesForOrdering(
    column_children: Array<NoteProps>,
    new_child_position: number,
    ordering_weight_key_name: string,
): Array<OrderingChangeSet> {
    if (column_children.length === 0) { return []; }
    if (!column_children[new_child_position]) { return []; }
    if (columnIsSingleFile(column_children)) {
        return singleFileOrderingChanges(column_children, ordering_weight_key_name);
    }
    return crossFileOrderingChanges(column_children, new_child_position, ordering_weight_key_name);
}

/**
 * single-file ordering with MINIMAL, self-removing weights. Recomputes the whole column's
 * weighting from the desired order rather than nudging one note: the longest leading run that is
 * already in implicit (`noteOrder`) order stays UNWEIGHTED, and only the remaining suffix is
 * weighted 1..k (per `kanbanNoteOrder` the unweighted run sorts first, the weighted suffix floats
 * below it in weight order). Each note's target weight is diffed against its current weight, so:
 *
 *   - a note that should be unweighted but still carries a weight has it REMOVED (the key goal —
 *     weights live only as long as they are needed to force a non-implicit order);
 *   - when the desired order already equals implicit order the prefix is the whole column and every
 *     stale weight is stripped (drag a note out of place then back, and the column ends weight-free);
 *   - notes whose weight is already correct produce no edit.
 */
function singleFileOrderingChanges(
    column_children: Array<NoteProps>,
    key: string,
): Array<OrderingChangeSet> {
    const doc_path = column_children[0]?.origin?.doc_path;
    // the longest leading run that is already in implicit order can stay unweighted
    let prefix_len = column_children.length === 0 ? 0 : 1;
    while (prefix_len < column_children.length
        && noteOrder(column_children[prefix_len - 1], column_children[prefix_len]) < 0) {
        prefix_len++;
    }
    const changes: Array<OrderingChange> = [];
    for (let i = 0; i < column_children.length; ++i) {
        const note = column_children[i];
        const current = note.linetags?.[key]?.value_numeric || 0;
        // unweighted prefix → 0 (removes any stale weight); weighted suffix → 1, 2, 3, …
        const target = i < prefix_len ? 0 : (i - prefix_len + 1);
        if (target === current) { continue; }
        changes.push(...calculateTextChangesForNewLinetagValue(note, key, `${target}`, '0'));
    }
    return changes.length ? [{ doc_path, changes }] : [];
}

/**
 * cross-file ordering: the chosen weight value carries the user's order, so the
 * comparator never needs `seq`. Tries a gap insertion (a weight strictly between
 * the weighted neighbours) and falls back to a same-file cascade. A gap insert is
 * only valid when neither neighbour is unweighted — per `kanbanNoteOrder` case-2 a
 * weighted note sorts after an unweighted one, so a weighted new_child would jump
 * ahead of an unweighted successor and invert the requested order.
 */
function crossFileOrderingChanges(
    column_children: Array<NoteProps>,
    new_child_position: number,
    key: string,
): Array<OrderingChangeSet> {
    const new_child = column_children[new_child_position];
    const predecessor = column_children[new_child_position - 1];
    const successor = column_children[new_child_position + 1];
    const predecessor_weight = predecessor?.linetags?.[key]?.value_numeric;
    const successor_weight = successor?.linetags?.[key]?.value_numeric;
    const new_child_weight = new_child.linetags?.[key]?.value_numeric;
    /*
     * restraint guard: a drop into an unweighted neighbourhood cannot be honoured by
     * weighting the dragged card. Per kanbanNoteOrder case 2 a weighted card always
     * sorts AFTER every unweighted one, so minting a weight here would sink the card
     * below its unweighted successor — the opposite of the requested placement (the
     * top-drop-goes-to-bottom bug). Forcing the order would instead require weighting
     * every OTHER card, which contradicts the minimal, self-removing weights design.
     * Implicit relevance order already expresses this region — the just-saved file's
     * bumped mtime floats it up — so mint nothing and let noteOrder govern. Weights
     * are reserved for drops a weighted neighbour makes genuinely expressive.
     */
    const successor_unweighted = successor !== undefined && successor_weight === undefined;
    const predecessor_unweighted = predecessor === undefined || predecessor_weight === undefined;
    if (successor_unweighted && predecessor_unweighted) { return []; }
    const blocks_gap = (predecessor !== undefined && predecessor_weight === undefined)
        || (successor !== undefined && successor_weight === undefined);
    if (!blocks_gap) {
        const candidate = pickGapWeight(predecessor_weight, successor_weight);
        if (candidate !== undefined && candidate === new_child_weight) { return []; }
        if (candidate !== undefined) {
            const changes = calculateTextChangesForNewLinetagValue(new_child, key, `${candidate}`, '0');
            return changes.length ? groupChangesByDocPath([{ note: new_child, changes }]) : [];
        }
    }
    return cascadeSameFileWeights(column_children, new_child_position, key, predecessor_weight);
}

/**
 * pick an integer weight strictly between the predecessor and successor weights,
 * treating absent neighbours as ±infinity. Returns undefined when no integer fits
 * and the caller must cascade.
 */
function pickGapWeight(predecessor_weight: number | undefined, successor_weight: number | undefined): number | undefined {
    const lower = predecessor_weight ?? Number.NEGATIVE_INFINITY;
    const upper = successor_weight ?? Number.POSITIVE_INFINITY;
    if (lower === Number.NEGATIVE_INFINITY && upper === Number.POSITIVE_INFINITY) { return 1; }
    if (lower === Number.NEGATIVE_INFINITY) { return upper - 1; }
    if (upper === Number.POSITIVE_INFINITY) { return lower + 1; }
    if (upper - lower >= 2) {
        const mid = Math.floor((lower + upper) / 2);
        return (mid === lower || mid === upper) ? lower + 1 : mid;
    }
    return undefined;
}

/**
 * cascade increasing weights from the inserted position to the end of the column,
 * emitting edits only for notes sharing the inserted note's origin file. Other-file
 * notes are stepped over — the counter leapfrogs their existing weight so same-file
 * notes still sort above them — and never rewritten.
 */
function cascadeSameFileWeights(
    column_children: Array<NoteProps>,
    new_child_position: number,
    key: string,
    predecessor_weight: number | undefined,
): Array<OrderingChangeSet> {
    const new_child_doc_path = column_children[new_child_position].origin?.doc_path;
    let weight_counter = (predecessor_weight ?? 0) + 1;
    const grouped: Array<{ note: NoteProps; changes: Array<OrderingChange> }> = [];
    for (let i = new_child_position; i < column_children.length; ++i) {
        const note = column_children[i];
        if (note.origin?.doc_path !== new_child_doc_path) {
            const note_weight = note.linetags?.[key]?.value_numeric;
            if (note_weight !== undefined && note_weight >= weight_counter) { weight_counter = note_weight + 1; }
            continue;
        }
        const note_changes = calculateTextChangesForNewLinetagValue(note, key, `${weight_counter}`, '0');
        if (note_changes.length > 0) { grouped.push({ note, changes: note_changes }); }
        ++weight_counter;
    }
    return grouped.length ? groupChangesByDocPath(grouped) : [];
}

/**
 * partition a flat list of (note, changes) pairs into per-doc_path buckets,
 * preserving the order in which changes were generated within each bucket.
 */
function groupChangesByDocPath(
    items: Array<{ note: NoteProps; changes: Array<OrderingChange> }>,
): Array<OrderingChangeSet> {
    const buckets = new Map<string | undefined, Array<OrderingChange>>();
    const key_order: Array<string | undefined> = [];
    for (const item of items) {
        const key = item.note.origin?.doc_path;
        if (!buckets.has(key)) {
            buckets.set(key, []);
            key_order.push(key);
        }
        buckets.get(key)!.push(...item.changes);
    }
    return key_order.map(key => ({ doc_path: key, changes: buckets.get(key)! }));
}

/**
 * flatten partitioned ordering changes into a single array — for callers that
 * are still single-file aware. Folder-mode DnD consumes the partitioned shape
 * directly via the multi-doc `editText` payload.
 */
export function flattenOrderingChangeSets(change_sets: Array<OrderingChangeSet>): Array<OrderingChange> {
    const out: Array<OrderingChange> = [];
    for (const set of change_sets) {
        out.push(...set.changes);
    }
    return out;
}

// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export function calculateTextChangesForNewLinetagValue(note: NoteProps, key_name: string, new_value: string, default_value: string): Array<OrderingChange> {
    const changes: Array<OrderingChange> = [];
    const setting_as_default = (new_value === default_value);

    // if the existing linetag is inherited (from a parent's nt_child_* attribute), treat it as if the note has no linetag for this key - either generate a new one or skip if setting back to default (inherited value handles it)
    const existing_tag = note.linetags?.[key_name];
    if (existing_tag?.inherited) {
        if (setting_as_default) { return []; }
        // already carries this exact value via inheritance — materialising it would be a redundant write (e.g. reordering a card within the column it already inherits status= from)
        if (existing_tag.value === new_value) { return []; }
        // write a real linetag: if note has other (non-inherited) linetags, append to them; otherwise generate a fresh linetag block
        const has_real_linetags = note.linetags && Object.keys(note.linetags).some(k => !note.linetags![k].inherited);
        if (has_real_linetags) {
            const first_real_key = Object.keys(note.linetags!).find(k => !note.linetags![k].inherited)!;
            const first_real_tag = note.linetags![first_real_key];
            const first_position = (note.linetags_from || 0) + first_real_tag.key_offset;
            changes.push({
                from: first_position,
                insert: `${key_name}=${new_value}&`,
            });
            return changes;
        }
        // no real linetags at all - generate a new linetag block
        changes.push({
            from: note.position.start.offset + note.headline_raw.length,
            insert: ` [](?${key_name}=${new_value})`,
        });
        return changes;
    }

    if (!note.linetags && !setting_as_default) {
        // generate linetag completely of the form
        const new_linetags = ` [](?${key_name}=${new_value})`;

        changes.push({
            from: note.position.start.offset + note.headline_raw.length,
            insert: new_linetags,
        });
    }
    else if (note.linetags && !note.linetags[key_name] && !setting_as_default) {
        /*
         * add the field to the first REAL (non-inherited) linetag
         * guard: when every linetag is inherited (parent nt_child_*) there is no real block — inherited tags carry key_offset 0 and no linetags_from, so appending would land at document offset 0 and corrupt the parent heading; fall back to a fresh linetag block
         */
        const first_real_key = Object.keys(note.linetags).find(k => !note.linetags![k].inherited);
        if (first_real_key) {
            const first_position = (note.linetags_from || 0) + note.linetags[first_real_key].key_offset;
            changes.push({
                from: first_position,
                insert: `${key_name}=${new_value}&`,
            });
        } else {
            changes.push({
                from: note.position.start.offset + note.headline_raw.length,
                insert: ` [](?${key_name}=${new_value})`,
            });
        }
    }
    // if we're removing an existing linetag key (dragging back to default)
    else if (note.linetags && note.linetags[key_name] && setting_as_default) {
        const linetags_base = note.linetags_from || 0;
        const linetag_keys = Object.keys(note.linetags);
        if (linetag_keys.length === 1 && linetag_keys[0] === key_name) {
            /*
             * sole key - remove the entire linetag including the leading space
             * headline_raw ends at start.offset + headline_raw.length; the linetag string starts at linetags_from
             */
            const linetag_start = linetags_base;
            const headline_end = note.position.start.offset + note.headline_raw.length;
            // include the leading space before the linetag if present
            const remove_from = (linetag_start > 0 && linetag_start > note.position.start.offset)
                ? linetag_start - 1 : linetag_start;
            changes.push({
                from: remove_from,
                to: headline_end,
                insert: '',
            });
        } else {
            // multiple keys - remove just this key=value (and the & separator)
            const removing = note.linetags[key_name];
            const key_abs = linetags_base + removing.key_offset;
            const value_end_abs = linetags_base + removing.value_offset + removing.value.length;
            // check if there's a '&' after the value (this key is not last)
            const headline_text = note.headline_raw;
            const rel_value_end = removing.value_offset + removing.value.length;
            const linetags_str = headline_text.slice(linetags_base - note.position.start.offset);
            if (rel_value_end < linetags_str.length && linetags_str[rel_value_end] === '&') {
                // remove key=value& (key is before the separator)
                changes.push({ from: key_abs, to: value_end_abs + 1, insert: '' });
            } else {
                // last key - remove &key=value (separator is before the key)
                changes.push({ from: key_abs - 1, to: value_end_abs, insert: '' });
            }
            // also remove linktext if it duplicated the value
            if (removing.linktext) {
                const linktext_position = linetags_base + (removing.linktext_offset || 0);
                changes.push({
                    from: linktext_position,
                    to: linktext_position + removing.linktext.length,
                    insert: '',
                });
            }
        }
    }
    // if we're updating an existing linetag
    else if (note.linetags && note.linetags[key_name]) {
        const updating_linetag = note.linetags[key_name];
        const value_position = (note.linetags_from || 0) + updating_linetag.value_offset;
        changes.push({
            from: value_position,
            to: value_position + updating_linetag.value.length,
            insert: new_value,
        });
        if (updating_linetag.linktext) {
            // also update linktext if it's a duplication
            const linktext_position = (note.linetags_from || 0) + (updating_linetag.linktext_offset || 0);
            changes.push({
                from: linktext_position,
                to: linktext_position + updating_linetag.linktext.length,
                insert: new_value,
            });
        }
    }
    return changes;
}
