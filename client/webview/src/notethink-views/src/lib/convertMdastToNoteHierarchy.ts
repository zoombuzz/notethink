import type { LineTag, MdastNode, NoteProps, TextPosition } from "../types/NoteProps";
import { findLineTags, parseLineTags } from "./linetagops";

type MdastRoot = import("mdast").Root;
export type MdastInput = MdastNode | MdastRoot;

/**
 * Convert an MDAST tree + raw text into a NoteProps hierarchy suitable for DocumentView.
 *
 * Ports logic from notegit's Note class and fireNoteHierarchyUpdate,
 * replacing CodeMirror dependencies with text-based equivalents.
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
function makePosition(offset: number, _text: string, lineIndex: number[]): TextPosition {
    // binary search for the number of newlines before `offset`
    let lo = 0, hi = lineIndex.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (lineIndex[mid] < offset) { lo = mid + 1; } else { hi = mid; }
    }
    return { offset, line: lo + 1 };
}

/**
 * Compute end_body offset for a heading: the point where the heading's "section" ends.
 * Scans forward through siblings to find the next heading with depth <= this heading's depth.
 */
function computeHeadingEndBody(
    headingIndex: number,
    siblings: MdastNode[],
    parentEndOffset: number,
): number {
    const heading = siblings[headingIndex];
    const headingDepth = heading.depth ?? 0;
    for (let i = headingIndex + 1; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling.type === 'heading' && (sibling.depth ?? 0) <= headingDepth) {
            return sibling.position.start.offset;
        }
    }
    return parentEndOffset;
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
function extractBodyRaw(nodeEndOffset: number, endBodyOffset: number, text: string): string {
    return text.slice(nodeEndOffset, endBodyOffset);
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
function isListItemChildNote(node: MdastNode, parentType: string): boolean {
    if (parentType === 'listItem' && node.type === 'paragraph') {
        return true;
    }
    return isNoteNode(node);
}

/**
 * Recursively find child notes from MDAST children.
 * Returns flat array of all notes found (nesting done later by nestChildNotes).
 */
function findChildNotes(
    parentType: string,
    children: MdastNode[],
    text: string,
    seqCounter: SeqCounter,
    parentEndOffset: number,
    allNotes: NoteProps[],
    childrenBodyAccumulator: Array<NoteProps | MdastNode>,
    lineIndex: number[],
): void {
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const shouldBeNote = parentType === 'listItem'
            ? isListItemChildNote(child, parentType)
            : isNoteNode(child);

        if (!shouldBeNote) {
            // Non-note nodes go into children_body as raw MdastNode
            childrenBodyAccumulator.push(child);
            continue;
        }

        seqCounter.value++;
        const seq = seqCounter.value;

        let headline_raw = '';
        let body_raw = '';
        let end_body_offset: number | undefined;
        const noteChildrenBody: Array<NoteProps | MdastNode> = [];

        if (child.type === 'heading') {
            headline_raw = extractHeadlineRaw(child, text);
            end_body_offset = computeHeadingEndBody(i, children, parentEndOffset);
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
                start: makePosition(child.position.start.offset, text, lineIndex),
                end: makePosition(child.position.end.offset, text, lineIndex),
                ...(end_body_offset !== undefined ? {
                    end_body: makePosition(end_body_offset, text, lineIndex),
                } : {}),
            },
            children: child.children || [],
            children_body: noteChildrenBody,
            headline_raw,
            body_raw,
        };

        // Parse linetags from headline (port of Note.parseForLinetags)
        const linetags_str = findLineTags(headline_raw);
        if (linetags_str) {
            note.linetags_from = child.position.start.offset + headline_raw.length - linetags_str.length;
            note.linetags = parseLineTags(linetags_str, seq);
        }

        // Push to allNotes BEFORE recursing so parent appears before children in nestChildNotes
        allNotes.push(note);
        childrenBodyAccumulator.push(note);

        // Now recurse into section/list children
        if (child.type === 'heading' && end_body_offset !== undefined) {
            const sectionChildren: MdastNode[] = [];
            let consumed = 0;
            for (let j = i + 1; j < children.length; j++) {
                const sibling = children[j];
                if (sibling.position.start.offset >= end_body_offset) { break; }
                sectionChildren.push(sibling);
                consumed++;
            }
            // Skip consumed siblings in parent loop so they aren't double-processed
            i += consumed;
            if (sectionChildren.length > 0) {
                findChildNotes(
                    child.type,
                    sectionChildren,
                    text,
                    seqCounter,
                    end_body_offset,
                    allNotes,
                    noteChildrenBody,
                    lineIndex,
                );
            }
        } else if ((child.type === 'list' || child.type === 'listItem') && child.children?.length) {
            findChildNotes(
                child.type,
                child.children,
                text,
                seqCounter,
                child.position.end.offset,
                allNotes,
                noteChildrenBody,
                lineIndex,
            );
        }
    }
}

/**
 * Assign levels to notes based on position containment.
 * Uses an ancestor stack for O(n) instead of O(n²) backward scan.
 */
function nestChildNotes(allNotes: NoteProps[], rootLevel: number): void {
    // Stack of open ancestors — each note's range must contain the current note
    const stack: NoteProps[] = [];
    for (const note of allNotes) {
        const noteStart = note.position.start.offset;
        // Pop ancestors whose range has ended (no longer contain this note)
        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            const topEnd = top.position.end_body?.offset ?? top.position.end.offset;
            if (noteStart < topEnd) { break; }
            stack.pop();
        }
        if (stack.length > 0) {
            const parent = stack[stack.length - 1];
            note.level = parent.level + 1;
            note.parent_notes = parent.parent_notes
                ? [...parent.parent_notes, parent]
                : [parent];
        } else {
            note.level = rootLevel + 1;
            note.parent_notes = undefined;
        }
        stack.push(note);
    }
}

/**
 * Extract inheritable linetags from a note's linetags matching the given prefix.
 * Returns entries with the prefix stripped (e.g. ng_child_status → status).
 */
function collectInheritableLinetags(note: NoteProps, prefix: string): Array<[string, LineTag]> {
    if (!note.linetags) { return []; }
    const result: Array<[string, LineTag]> = [];
    for (const key of Object.keys(note.linetags)) {
        if (key.startsWith(prefix)) {
            const stripped = key.slice(prefix.length);
            if (stripped) {
                result.push([stripped, note.linetags[key]]);
            }
        }
    }
    return result;
}

/**
 * Create an inherited LineTag from a source tag, with the key stripped to the child-facing name.
 */
function makeInheritedTag(strippedKey: string, source: LineTag, targetNoteSeq: number): LineTag {
    return {
        key: strippedKey,
        value: source.value,
        key_offset: 0,
        value_offset: 0,
        linktext_offset: 0,
        note_seq: targetNoteSeq,
        inherited: true,
        ...(source.value_numeric !== undefined ? { value_numeric: source.value_numeric } : {}),
    };
}

/**
 * Propagate ng_child_*, ng_child2y_*, and ng_childall_* linetags from parents to descendants.
 * Child's own linetags always take precedence over inherited ones.
 */
export function applyChildAttributeInheritance(allNotes: NoteProps[]): void {
    for (const note of allNotes) {
        if (!note.parent_notes?.length) { continue; }

        const directParent = note.parent_notes[note.parent_notes.length - 1];

        // ng_child_ → inherited by direct children only
        for (const [strippedKey, sourceTag] of collectInheritableLinetags(directParent, 'ng_child_')) {
            if (note.linetags?.[strippedKey]) { continue; }
            if (!note.linetags) { note.linetags = {}; }
            note.linetags[strippedKey] = makeInheritedTag(strippedKey, sourceTag, note.seq);
        }

        // ng_child2y_ → inherited by grandchildren only (parent_notes has at least 2 entries)
        if (note.parent_notes.length >= 2) {
            const grandparent = note.parent_notes[note.parent_notes.length - 2];
            for (const [strippedKey, sourceTag] of collectInheritableLinetags(grandparent, 'ng_child2y_')) {
                if (note.linetags?.[strippedKey]) { continue; }
                if (!note.linetags) { note.linetags = {}; }
                note.linetags[strippedKey] = makeInheritedTag(strippedKey, sourceTag, note.seq);
            }
        }

        // ng_childall_ → inherited from every ancestor in the chain
        for (const ancestor of note.parent_notes) {
            for (const [strippedKey, sourceTag] of collectInheritableLinetags(ancestor, 'ng_childall_')) {
                if (note.linetags?.[strippedKey]) { continue; }
                if (!note.linetags) { note.linetags = {}; }
                note.linetags[strippedKey] = makeInheritedTag(strippedKey, sourceTag, note.seq);
            }
        }
    }
}

/**
 * Main entry point: convert MDAST root + raw text to a NoteProps hierarchy.
 */
export function convertMdastToNoteHierarchy(mdast: MdastInput, text: string): NoteProps {
    const seqCounter: SeqCounter = { value: 0 };
    const allNotes: NoteProps[] = [];
    const rootChildrenBody: Array<NoteProps | MdastNode> = [];

    // Pre-compute line-offset index for O(log n) position lookups
    const lineIndex = buildLineIndex(text);

    // normalise children from either MdastRoot (typed) or MdastNode (local)
    const mdast_children = (mdast.children || []) as MdastNode[];
    const rootEndOffset = mdast.position?.end?.offset ?? text.length;

    // Find all child notes from the MDAST root
    findChildNotes(
        'root',
        mdast_children,
        text,
        seqCounter,
        rootEndOffset,
        allNotes,
        rootChildrenBody,
        lineIndex,
    );

    // Assign levels based on containment
    nestChildNotes(allNotes, 0);

    // Populate child_notes arrays (direct children only, used for kanban column assignment)
    for (const note of allNotes) {
        if (note.parent_notes?.length) {
            const direct_parent = note.parent_notes[note.parent_notes.length - 1];
            if (!direct_parent.child_notes) {
                direct_parent.child_notes = [];
            }
            direct_parent.child_notes.push(note);
        }
    }

    // Propagate ng_child_*, ng_child2y_*, ng_childall_* linetags to descendants
    applyChildAttributeInheritance(allNotes);

    // Build the root note
    const root: NoteProps = {
        seq: 0,
        level: 0,
        type: 'root',
        position: {
            start: makePosition(mdast.position?.start?.offset ?? 0, text, lineIndex),
            end: makePosition(rootEndOffset, text, lineIndex),
        },
        children: mdast_children,
        children_body: rootChildrenBody,
        child_notes: allNotes.filter(n => !n.parent_notes?.length),
        headline_raw: '',
        body_raw: text,
    };

    return root;
}
