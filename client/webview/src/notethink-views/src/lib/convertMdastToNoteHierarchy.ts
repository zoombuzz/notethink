import type { MdastNode, NoteProps, TextPosition } from "../types/NoteProps";
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

function makePosition(offset: number, text: string): TextPosition {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') { line++; }
    }
    return { offset, line };
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
                start: makePosition(child.position.start.offset, text),
                end: makePosition(child.position.end.offset, text),
                ...(end_body_offset !== undefined ? {
                    end_body: makePosition(end_body_offset, text),
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
            );
        }
    }
}

/**
 * Check if noteB is subsumed by noteA (noteB falls within noteA's range).
 */
function subsumedBy(noteA: NoteProps, noteB: NoteProps): boolean {
    const aStart = noteA.position.start.offset;
    const aEnd = noteA.position.end_body?.offset ?? noteA.position.end.offset;
    const bStart = noteB.position.start.offset;
    return bStart > aStart && bStart < aEnd;
}

/**
 * Assign levels to notes based on position containment.
 * Port of Note.nestChildNotes from notegit.
 */
function nestChildNotes(allNotes: NoteProps[], rootLevel: number): void {
    for (let i = 0; i < allNotes.length; i++) {
        const note = allNotes[i];
        // Find the closest ancestor (last note before this one that subsumes it)
        let parentLevel = rootLevel;
        const parentNotes: NoteProps[] = [];
        for (let j = i - 1; j >= 0; j--) {
            if (subsumedBy(allNotes[j], note)) {
                parentLevel = allNotes[j].level;
                // Build parent chain
                parentNotes.unshift(allNotes[j]);
                if (allNotes[j].parent_notes?.length) {
                    parentNotes.unshift(...allNotes[j].parent_notes!);
                }
                break;
            }
        }
        note.level = parentLevel + 1;
        note.parent_notes = parentNotes.length > 0 ? parentNotes : undefined;
    }
}

/**
 * Main entry point: convert MDAST root + raw text to a NoteProps hierarchy.
 */
export function convertMdastToNoteHierarchy(mdast: MdastInput, text: string): NoteProps {
    const seqCounter: SeqCounter = { value: 0 };
    const allNotes: NoteProps[] = [];
    const rootChildrenBody: Array<NoteProps | MdastNode> = [];

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

    // Build the root note
    const root: NoteProps = {
        seq: 0,
        level: 0,
        type: 'root',
        position: {
            start: makePosition(mdast.position?.start?.offset ?? 0, text),
            end: makePosition(rootEndOffset, text),
        },
        children: mdast_children,
        children_body: rootChildrenBody,
        child_notes: allNotes.filter(n => !n.parent_notes?.length),
        headline_raw: '',
        body_raw: text,
    };

    return root;
}
