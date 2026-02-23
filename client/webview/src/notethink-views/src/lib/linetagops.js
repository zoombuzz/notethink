/**
 * @param input
 * @return string all the linetags ([...))$ in a single string
 * Regex copes with additional characters around first/last linetag, e.g. ('doing' story for Alex)
 */
export function findLineTags(input) {
    // use String.match() with regex to pull out all linetags together (https://regexr.com/) if bracketed ([]()) or ('[]()')
    const bracketed_matches = input.match(new RegExp('(\\([^\\]]*\\[.*\\)[^\\]]*\\))[\\n]*$'));
    if (bracketed_matches && bracketed_matches?.length >= 2) {
        return bracketed_matches[1];
    }
    // use String.match() with regex to pull out all linetags together if unbracketed []() (no hoover)
    const brackless_matches = input.match(new RegExp('(\\[.*\\)[^\\]]*)[\\n]*$'));
    if (brackless_matches && brackless_matches?.length >= 2) {
        return brackless_matches[1];
    }
    return '';
}
/**
 * @param input complete linetags, of the form ([]()<any separator>[]()<any separator>[]()<any separator>...)
 * @return object many linetags
 */
export function parseLineTags(input, note_seq) {
    // create empty linetags object which can accept dynamic keys of any type
    const linetags = {};
    // use RegExp.exec() to pull out all links with position information (https://regexr.com/)
    const regex = RegExp('\\[(?<text>[^\\]]*)\\]\\((?<href>[^\\)]*)\\)', 'dg');
    let matches;
    while ((matches = regex.exec(input)) !== null) {
        if (matches.groups && matches.groups.href) {
            const link_text = matches.groups?.text;
            const link_queryparams = new URLSearchParams(matches.groups?.href);
            const link_querykeys = link_queryparams.keys();
            // use array as intermediary so as not to require `--downlevelIteration` compiler option
            for (const key of Array.from(link_querykeys)) {
                const value = link_queryparams.get(key);
                if (value === null) {
                    continue;
                }
                // offsets are relative to the note's linetags_offset
                const linetag = {
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
    if (keys.length === 0) {
        return undefined;
    }
    return linetags;
}
export function calculateTextChangesForOrdering(column_children, new_child_position, ordering_weight_key_name) {
    // find the minimum weight the inserted node needs to go in beneath its predecessor
    const new_child = column_children[new_child_position];
    const predecessor = column_children[new_child_position - 1];
    const min_weight = (predecessor ?
        // min weight is the value of the predecessor, +1 if the sequence numbers don't give us order
        ((predecessor?.linetags && predecessor?.linetags[ordering_weight_key_name] && predecessor?.linetags[ordering_weight_key_name].value_numeric || 0)
            + (predecessor.seq > new_child.seq ? 1 : 0))
        // or 0 if there's no predecessor
        : 0);
    // find the maximum weight the inserted node can be to go in above its successor
    const successor = column_children[new_child_position + 1];
    const max_weight = (
    // max weight is either the weight of the successor, -1 if the sequence numbers don't give us order
    successor ?
        (successor?.linetags && successor?.linetags[ordering_weight_key_name] && successor?.linetags[ordering_weight_key_name].value_numeric || 0)
            - (new_child.seq > successor.seq ? 1 : 0)
        // or min_weight if there's no successor
        : min_weight);
    // first see if we can get away with making no ordering weight changes whatsoever
    if (min_weight === 0 && max_weight === 0 && (new_child?.linetags && new_child?.linetags[ordering_weight_key_name] && new_child?.linetags[ordering_weight_key_name].value_numeric || 0) === 0) {
        // predecessor seq is < x and successor seq is > x, so can leave to sequence ordering
        // so long as the new_child doesn't already have a weight
        return [];
    }
    // otherwise if there's room without reordering, apply a weight to only the new_child
    else if (max_weight >= min_weight) {
        return calculateTextChangesForNewLinetagValue(new_child, ordering_weight_key_name, `${min_weight}`, '0');
    }
    // otherwise cascade through rest of children list, setting same weight for all
    else {
        const changes = [];
        for (let weight_counter = min_weight, i = new_child_position; i < column_children.length; ++weight_counter, ++i) {
            const note = column_children[i];
            changes.push(...calculateTextChangesForNewLinetagValue(note, ordering_weight_key_name, `${weight_counter}`, '0'));
        }
        return changes;
    }
}
export function calculateTextChangesForNewLinetagValue(note, key_name, new_value, default_value) {
    const changes = [];
    const setting_as_default = (new_value === default_value);
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
            // sole key — remove the entire linetag including the leading space
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
        }
        else {
            // multiple keys — remove just this key=value (and the & separator)
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
            }
            else {
                // last key — remove &key=value (separator is before the key)
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
