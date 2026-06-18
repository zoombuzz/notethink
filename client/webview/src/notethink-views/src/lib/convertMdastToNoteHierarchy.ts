import Debug from "debug";
import type { Root as MdastRoot } from "mdast";
import { findLineTags, parseLineTags } from "./linetagops";
import { findFrontmatterNode, parseFrontmatterLinetags } from "./frontmatterops";
import type { LineTag, MdastNode, NoteProps, TextPosition } from "../types/NoteProps";

const debug = Debug("nodejs:notethink-views:convertMdastToNoteHierarchy");

export type MdastInput = MdastNode | MdastRoot;

/**
 * Convert an MDAST tree + raw text into a NoteProps hierarchy suitable for DocumentView.
 *
 * Derives the hierarchy from text offsets rather than editor state, so it runs outside any editor.
 */

interface SeqCounter {
    value: number;
}

/**
 * Pre-compute an array of newline offsets for O(1) offset→line lookup via binary search.
 * Returns an array where lineBreaks[i] is the offset of the i-th newline character.
 */
function buildLineIndex(text: string): number[] {
    const breaks: number[] = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') { breaks.push(i); }
    }
    return breaks;
}

/**
 * Convert a character offset to a TextPosition using a pre-computed line index.
 * Uses binary search: O(log n) instead of O(offset).
 */
function makePosition(offset: number, _text: string, line_index: number[]): TextPosition {
    // binary search for the number of newlines before offset
    let lo = 0, hi = line_index.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (line_index[mid] < offset) { lo = mid + 1; } else { hi = mid; }
    }
    return { offset, line: lo + 1 };
}

/**
 * Compute end_body offset for a heading: the point where the heading's "section" ends.
 * Scans forward through siblings to find the next heading with depth <= this heading's depth.
 */
function computeHeadingEndBody(
    heading_index: number,
    siblings: MdastNode[],
    parent_end_offset: number,
): number {
    const heading = siblings[heading_index];
    const heading_depth = heading.depth ?? 0;
    for (let i = heading_index + 1; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling.type === 'heading' && (sibling.depth ?? 0) <= heading_depth) {
            return sibling.position.start.offset;
        }
    }
    return parent_end_offset;
}

/**
 * Extract headline_raw from a heading node using the raw text.
 */
function extractHeadlineRaw(node: MdastNode, text: string): string {
    // headline_raw is the text of the heading line itself (from start to end of heading node)
    return text.slice(node.position.start.offset, node.position.end.offset);
}

/**
 * Extract body_raw for a heading section: text between end of heading node and end_body.
 */
function extractBodyRaw(node_end_offset: number, end_body_offset: number, text: string): string {
    return text.slice(node_end_offset, end_body_offset);
}

/**
 * Determine if an MDAST node should become a NoteProps.
 */
function isNoteNode(node: MdastNode): boolean {
    return node.type === 'heading'
        || node.type === 'code'
        || node.type === 'list'
        || node.type === 'listItem';
}

/**
 * Determine if a child of a listItem should become a NoteProps.
 * Paragraphs under listItems become notes (for task list rendering).
 */
function isListItemChildNote(node: MdastNode, parent_type: string): boolean {
    if (parent_type === 'listItem' && node.type === 'paragraph') {
        return true;
    }
    return isNoteNode(node);
}

/**
 * Recursively find child notes from MDAST children.
 * Returns flat array of all notes found (nesting done later by nestChildNotes).
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
function findChildNotes(
    parent_type: string,
    children: MdastNode[],
    text: string,
    seq_counter: SeqCounter,
    parent_end_offset: number,
    all_notes: NoteProps[],
    children_body_accumulator: Array<NoteProps | MdastNode>,
    line_index: number[],
): void {
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const should_be_note = parent_type === 'listItem'
            ? isListItemChildNote(child, parent_type)
            : isNoteNode(child);

        if (!should_be_note) {
            // non-note nodes go into children_body as raw MdastNode
            children_body_accumulator.push(child);
            continue;
        }

        seq_counter.value++;
        const seq = seq_counter.value;

        let headline_raw = '';
        let body_raw = '';
        let end_body_offset: number | undefined;
        const note_children_body: Array<NoteProps | MdastNode> = [];

        if (child.type === 'heading') {
            headline_raw = extractHeadlineRaw(child, text);
            end_body_offset = computeHeadingEndBody(i, children, parent_end_offset);
            body_raw = extractBodyRaw(child.position.end.offset, end_body_offset, text);
        } else if (child.type === 'code') {
            headline_raw = child.lang || 'code';
            body_raw = child.value || '';
        } else if (child.type === 'list' || child.type === 'listItem') {
            headline_raw = text.slice(child.position.start.offset, child.position.end.offset);
            body_raw = '';
        } else if (child.type === 'paragraph') {
            // paragraph under listItem
            headline_raw = text.slice(child.position.start.offset, child.position.end.offset);
            body_raw = '';
        }

        const note: NoteProps = {
            seq,
            level: 0, // level assigned later by nestChildNotes
            type: child.type,
            depth: child.depth,
            lang: child.lang,
            value: child.value,
            checked: child.checked,
            position: {
                start: makePosition(child.position.start.offset, text, line_index),
                end: makePosition(child.position.end.offset, text, line_index),
                ...(end_body_offset !== undefined ? {
                    end_body: makePosition(end_body_offset, text, line_index),
                } : {}),
            },
            children: child.children || [],
            children_body: note_children_body,
            headline_raw,
            body_raw,
        };

        // parse linetags from headline (port of Note.parseForLinetags)
        const linetags_str = findLineTags(headline_raw);
        if (linetags_str) {
            note.linetags_from = child.position.start.offset + headline_raw.length - linetags_str.length;
            note.linetags = parseLineTags(linetags_str, seq);
        }

        // push to all_notes before recursing so parent appears before children in nestChildNotes
        all_notes.push(note);
        children_body_accumulator.push(note);

        // recurse into section/list children
        if (child.type === 'heading' && end_body_offset !== undefined) {
            const section_children: MdastNode[] = [];
            let consumed = 0;
            for (let j = i + 1; j < children.length; j++) {
                const sibling = children[j];
                if (sibling.position.start.offset >= end_body_offset) { break; }
                section_children.push(sibling);
                consumed++;
            }
            // skip consumed siblings in parent loop so they aren't double-processed
            i += consumed;
            if (section_children.length > 0) {
                findChildNotes(
                    child.type,
                    section_children,
                    text,
                    seq_counter,
                    end_body_offset,
                    all_notes,
                    note_children_body,
                    line_index,
                );
            }
        } else if ((child.type === 'list' || child.type === 'listItem') && child.children?.length) {
            findChildNotes(
                child.type,
                child.children,
                text,
                seq_counter,
                child.position.end.offset,
                all_notes,
                note_children_body,
                line_index,
            );
        }
    }
}

/**
 * Assign levels to notes based on position containment.
 * Uses an ancestor stack for O(n) instead of O(n²) backward scan.
 */
function nestChildNotes(all_notes: NoteProps[], root_level: number): void {
    // stack of open ancestors - each note's range must contain the current note
    const stack: NoteProps[] = [];
    for (const note of all_notes) {
        const note_start = note.position.start.offset;
        // pop ancestors whose range has ended (no longer contain this note)
        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            const top_end = top.position.end_body?.offset ?? top.position.end.offset;
            if (note_start < top_end) { break; }
            stack.pop();
        }
        if (stack.length > 0) {
            const parent = stack[stack.length - 1];
            note.level = parent.level + 1;
            note.parent_notes = parent.parent_notes
                ? [...parent.parent_notes, parent]
                : [parent];
        } else {
            note.level = root_level + 1;
            note.parent_notes = undefined;
        }
        stack.push(note);
    }
}

/**
 * Extract inheritable linetags from an ancestor's linetags matching the given prefix.
 * Returns entries with the prefix stripped (e.g. nt_child_status → status). The
 * ancestor only needs a `linetags` field, so the document root (front matter) can be
 * wrapped in a minimal holder and treated as the broadest ancestor.
 */
function collectInheritableLinetags(ancestor: Pick<NoteProps, 'linetags'>, prefix: string): Array<[string, LineTag]> {
    if (!ancestor.linetags) { return []; }
    const result: Array<[string, LineTag]> = [];
    for (const key of Object.keys(ancestor.linetags)) {
        if (key.startsWith(prefix)) {
            const stripped = key.slice(prefix.length);
            if (stripped) {
                result.push([stripped, ancestor.linetags[key]]);
            }
        }
    }
    return result;
}

/**
 * Create an inherited LineTag from a source tag, with the key stripped to the child-facing name.
 */
function makeInheritedTag(stripped_key: string, source: LineTag, target_note_seq: number): LineTag {
    return {
        key: stripped_key,
        value: source.value,
        key_offset: 0,
        value_offset: 0,
        linktext_offset: 0,
        note_seq: target_note_seq,
        inherited: true,
        ...(source.value_numeric !== undefined ? { value_numeric: source.value_numeric } : {}),
    };
}

/**
 * Apply an ancestor's inheritable linetags (already prefix-stripped) onto a note,
 * minting inherited copies. The note's own / a closer ancestor's tag always wins,
 * so an already-present key is left untouched (the broadest source only fills gaps).
 */
function applyInheritedTags(note: NoteProps, ancestor: Pick<NoteProps, 'linetags'>, prefix: string): void {
    for (const [stripped_key, source_tag] of collectInheritableLinetags(ancestor, prefix)) {
        if (note.linetags?.[stripped_key]) { continue; }
        if (!note.linetags) { note.linetags = {}; }
        note.linetags[stripped_key] = makeInheritedTag(stripped_key, source_tag, note.seq);
    }
}

/**
 * In-tree inheritance: propagate nt_child_*, nt_child2y_*, and nt_childall_*
 * linetags from a note's ancestors. nt_childall_ is applied root-most first so a
 * higher ancestor's value wins when several declare the same key.
 */
function applyInTreeInheritance(note: NoteProps): void {
    if (!note.parent_notes?.length) { return; }
    const direct_parent = note.parent_notes[note.parent_notes.length - 1];
    // nt_child_ → inherited by direct children only
    applyInheritedTags(note, direct_parent, 'nt_child_');
    // nt_child2y_ → inherited by grandchildren only (parent_notes has at least 2 entries)
    if (note.parent_notes.length >= 2) {
        const grandparent = note.parent_notes[note.parent_notes.length - 2];
        applyInheritedTags(note, grandparent, 'nt_child2y_');
    }
    // nt_childall_ → inherited from every ancestor in the chain
    for (const ancestor of note.parent_notes) {
        applyInheritedTags(note, ancestor, 'nt_childall_');
    }
}

/**
 * Root (front-matter) inheritance: the document root is the broadest ancestor.
 * Its depth-relative prefixes mirror the in-tree ones — nt_child_ reaches the
 * root's direct children, nt_child2y_ its grandchildren, nt_childall_ every note.
 * Runs AFTER in-tree inheritance, so any closer ancestor's tag already won.
 */
function applyRootInheritance(note: NoteProps, root_ancestor: Pick<NoteProps, 'linetags'>): void {
    const depth = note.parent_notes?.length ?? 0;
    if (depth === 0) {
        applyInheritedTags(note, root_ancestor, 'nt_child_');
    }
    if (depth === 1) {
        applyInheritedTags(note, root_ancestor, 'nt_child2y_');
    }
    applyInheritedTags(note, root_ancestor, 'nt_childall_');
}

/**
 * Propagate nt_child_*, nt_child2y_*, and nt_childall_* linetags from ancestors to
 * descendants. Child's own linetags always take precedence over inherited ones.
 *
 * `root_linetags` (optional) are the document root's front-matter linetags, treated
 * as the broadest, lowest-priority ancestor above the whole tree. When undefined the
 * pass behaves exactly as the in-tree-only inheritance did.
 */
export function applyChildAttributeInheritance(
    all_notes: NoteProps[],
    root_linetags?: { [key: string]: LineTag },
): void {
    const root_ancestor = root_linetags ? ({ linetags: root_linetags } as Pick<NoteProps, 'linetags'>) : undefined;
    for (const note of all_notes) {
        applyInTreeInheritance(note);
        if (root_ancestor) {
            applyRootInheritance(note, root_ancestor);
        }
    }
}

/**
 * Main entry point: convert MDAST root + raw text to a NoteProps hierarchy.
 */
export function convertMdastToNoteHierarchy(mdast: MdastInput, text: string): NoteProps {
    const seq_counter: SeqCounter = { value: 0 };
    const all_notes: NoteProps[] = [];
    const root_children_body: Array<NoteProps | MdastNode> = [];

    // pre-compute line-offset index for O(log n) position lookups
    const line_index = buildLineIndex(text);

    // normalise children from either MdastRoot (typed) or MdastNode (local)
    const mdast_children = (mdast.children || []) as MdastNode[];
    const root_end_offset = mdast.position?.end?.offset ?? text.length;

    // find all child notes from the MDAST root
    findChildNotes(
        'root',
        mdast_children,
        text,
        seq_counter,
        root_end_offset,
        all_notes,
        root_children_body,
        line_index,
    );

    // assign levels based on containment
    nestChildNotes(all_notes, 0);

    // populate child_notes arrays (direct children only, used for kanban column assignment)
    for (const note of all_notes) {
        if (note.parent_notes?.length) {
            const direct_parent = note.parent_notes[note.parent_notes.length - 1];
            if (!direct_parent.child_notes) {
                direct_parent.child_notes = [];
            }
            direct_parent.child_notes.push(note);
        }
    }

    /*
     * lift front matter into the document root as linetags — the broadest, document-scoped layer
     * computed before the inheritance pass so the root can act as the top ancestor; absent front matter leaves both fields undefined
     */
    const frontmatter_node = findFrontmatterNode(mdast_children);
    const root_frontmatter = frontmatter_node
        ? parseFrontmatterLinetags(frontmatter_node, text, 0)
        : {};

    // propagate nt_child_*, nt_child2y_*, nt_childall_* linetags to descendants, with the root front matter as the broadest ancestor above the whole tree
    applyChildAttributeInheritance(all_notes, root_frontmatter.linetags);

    // build the root note
    const root: NoteProps = {
        seq: 0,
        level: 0,
        type: 'root',
        position: {
            start: makePosition(mdast.position?.start?.offset ?? 0, text, line_index),
            end: makePosition(root_end_offset, text, line_index),
        },
        children: mdast_children,
        children_body: root_children_body,
        child_notes: all_notes.filter(n => !n.parent_notes?.length),
        linetags: root_frontmatter.linetags,
        linetags_from: root_frontmatter.linetags_from,
        headline_raw: '',
        body_raw: text,
    };

    return root;
}
