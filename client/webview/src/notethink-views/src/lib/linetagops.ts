import type {LineTag, NoteProps} from "../types/NoteProps";

type HashMapOf<S> = { [key: string]: S };

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
 * This function decides how to encode that order into `kanban_ordering_weight`
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
        return singleFileOrderingChanges(column_children, new_child_position, ordering_weight_key_name);
    }
    return crossFileOrderingChanges(column_children, new_child_position, ordering_weight_key_name);
}

/**
 * single-file ordering, byte-identical to the pre-refactor algorithm: weight the
 * inserted note into the gap between its neighbours' weights, falling back to a
 * full incrementing cascade through the rest of the column when no gap exists.
 * The +1/-1 nudges keep the chosen weight consistent with document `seq` order.
 */
function singleFileOrderingChanges(
    column_children: Array<NoteProps>,
    new_child_position: number,
    key: string,
): Array<OrderingChangeSet> {
    const new_child = column_children[new_child_position];
    const doc_path = new_child.origin?.doc_path;
    const predecessor = column_children[new_child_position - 1];
    const successor = column_children[new_child_position + 1];
    const min_weight = predecessor
        ? (predecessor.linetags?.[key]?.value_numeric || 0) + (predecessor.seq > new_child.seq ? 1 : 0)
        : 0;
    const max_weight = successor
        ? (successor.linetags?.[key]?.value_numeric || 0) - (new_child.seq > successor.seq ? 1 : 0)
        : min_weight;
    const new_child_weight = new_child.linetags?.[key]?.value_numeric || 0;
    // sequence ordering already suffices — no weights needed
    if (min_weight === 0 && max_weight === 0 && new_child_weight === 0) { return []; }
    // room to weight only the new_child
    if (max_weight >= min_weight) {
        const changes = calculateTextChangesForNewLinetagValue(new_child, key, `${min_weight}`, '0');
        return changes.length ? [{ doc_path, changes }] : [];
    }
    // no gap — cascade incrementing weights through the rest of the column
    const changes: Array<OrderingChange> = [];
    for (let weight = min_weight, i = new_child_position; i < column_children.length; ++weight, ++i) {
        changes.push(...calculateTextChangesForNewLinetagValue(column_children[i], key, `${weight}`, '0'));
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

export function calculateTextChangesForNewLinetagValue(note: NoteProps, key_name: string, new_value: string, default_value: string) {
    const changes = [];
    const setting_as_default = (new_value === default_value);

    // If the existing linetag is inherited (from a parent's ng_child_* attribute),
    // treat it as if the note has no linetag for this key - either generate a new one
    // or skip if setting back to default (inherited value handles it)
    const existingTag = note.linetags?.[key_name];
    if (existingTag?.inherited) {
        if (setting_as_default) { return []; }
        // Write a real linetag: if note has other (non-inherited) linetags, append to them;
        // otherwise generate a fresh linetag block
        const hasRealLinetags = note.linetags && Object.keys(note.linetags).some(k => !note.linetags![k].inherited);
        if (hasRealLinetags) {
            const firstRealKey = Object.keys(note.linetags!).find(k => !note.linetags![k].inherited)!;
            const firstRealTag = note.linetags![firstRealKey];
            const first_position = (note.linetags_from || 0) + firstRealTag.key_offset;
            changes.push({
                from: first_position,
                insert: `${key_name}=${new_value}&`,
            });
            return changes;
        }
        // No real linetags at all - generate a new linetag block
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
        // add field to first linetag
        const first_linetag = note.linetags[Object.keys(note.linetags)[0]];
        const first_position = (note.linetags_from || 0) + first_linetag.key_offset;
        changes.push({
            from: first_position,
            insert: `${key_name}=${new_value}&`,
        });
    }
    // if we're removing an existing linetag key (dragging back to default)
    else if (note.linetags && note.linetags[key_name] && setting_as_default) {
        const linetags_base = note.linetags_from || 0;
        const linetag_keys = Object.keys(note.linetags);
        if (linetag_keys.length === 1 && linetag_keys[0] === key_name) {
            // sole key - remove the entire linetag including the leading space
            // headline_raw ends at start.offset + headline_raw.length; the linetag
            // string starts at linetags_from
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
            // Check if there's a '&' after the value (this key is not last)
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
