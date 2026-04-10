import type { MouseEvent } from "react";
import type { NoteProps, ClickPositionInfo, NoteDisplayOptions } from "../types/NoteProps";
import type { ViewProps } from "../types/ViewProps";
import view_specific_styles from "../components/ViewRenderer.module.scss";

/**
 * Build the standard CSS class list for a note element.
 * Used by MarkdownNote, CodeNote, and MermaidNote.
 */
export function buildNoteStyles(note: NoteProps, extra_classes?: string[]): string[] {
    const styles = [view_specific_styles.note].concat(extra_classes || []);
    if (note.focused) { styles.push(view_specific_styles.focused); }
    if (note.selected) { styles.push(view_specific_styles.selected); }
    if (note.display_options?.settings?.show_line_numbers) { styles.push(view_specific_styles.addGutter); }
    return styles;
}

/**
 * Build a ClickPositionInfo for a headline click.
 */
export function headlineClickPosition(note: NoteProps): ClickPositionInfo {
    const selectable = note.display_options?.deepest?.selectable_note;
    return {
        from: note.position.start.offset,
        to: note.position.end.offset,
        selection_from: selectable?.position?.start?.offset,
        selection_to: selectable?.position?.end_body?.offset ?? selectable?.position?.end?.offset,
        type: 'note_headline',
    };
}

/**
 * Build a ClickPositionInfo for a body click.
 */
export function bodyClickPosition(note: NoteProps): ClickPositionInfo {
    const selectable = note.display_options?.deepest?.selectable_note;
    return {
        from: note.position.end.offset,
        to: note.position.end_body?.offset,
        selection_from: selectable?.position?.start?.offset,
        selection_to: selectable?.position?.end_body?.offset ?? selectable?.position?.end?.offset,
        type: 'note_body',
    };
}

const MAX_ANCESTOR_DEPTH = 20;

/**
 * Walk up from the click target to find the nearest ancestor (up to currentTarget)
 * that has a data-offset-start attribute. Returns the element, or undefined.
 */
function findOffsetAncestor(event: MouseEvent<HTMLElement>): HTMLElement | undefined {
    let el = event.target as HTMLElement | null;
    const boundary = event.currentTarget as HTMLElement;
    for (let depth = 0; el && depth < MAX_ANCESTOR_DEPTH; depth++) {
        if ((el as HTMLElement).dataset?.offsetStart !== undefined) {
            return el as HTMLElement;
        }
        if (el === boundary) { break; }
        el = el.parentElement;
    }
    return undefined;
}

/**
 * Walk up from the click target to find the nearest ancestor (up to currentTarget)
 * that has a data-offset-start attribute. Returns the parsed offset, or undefined.
 */
export function extractOffsetFromClickTarget(event: MouseEvent<HTMLElement>): number | undefined {
    const wrapper = findOffsetAncestor(event);
    if (!wrapper) { return undefined; }
    const offset = Number(wrapper.dataset.offsetStart);
    return isNaN(offset) ? undefined : offset;
}

/**
 * Count text characters from the start of root up to (but not including) the
 * target_offset-th character in target_node. Used to approximate the character
 * position within a rendered body item from a browser Selection.
 */
export function countTextCharsUpTo(root: Node, target_node: Node, target_offset: number): number {
    const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    if (!walker) { return 0; }
    let count = 0;
    while (walker.nextNode()) {
        if (walker.currentNode === target_node) {
            return count + target_offset;
        }
        count += (walker.currentNode as Text).length;
    }
    return count;
}

/**
 * Within a single text node, find the character index at the click point using
 * binary search on Y (to find the line) then binary search on X (to find the char).
 * Returns the index within this text node, or -1 if the click is not on any line.
 */
function findCharInTextNode(range: Range, text_node: Text, node_len: number, clientX: number, clientY: number): number {
    // binary search on Y - character Y positions are monotonically non-decreasing in normal text flow
    let lo = 0, hi = node_len - 1;
    let line_char = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        range.setStart(text_node, mid);
        range.setEnd(text_node, mid + 1);
        const mid_rect = range.getBoundingClientRect();
        if (clientY < mid_rect.top) {
            hi = mid - 1;
        } else if (clientY > mid_rect.bottom) {
            lo = mid + 1;
        } else {
            line_char = mid;
            break;
        }
    }
    if (line_char < 0) { return -1; }

    // scan outward from line_char to find line boundaries
    const line_rect = range.getBoundingClientRect();
    const line_top = line_rect.top;
    let line_start = line_char, line_end = line_char;
    while (line_start > 0) {
        range.setStart(text_node, line_start - 1);
        range.setEnd(text_node, line_start);
        if (range.getBoundingClientRect().top !== line_top) { break; }
        line_start--;
    }
    while (line_end < node_len - 1) {
        range.setStart(text_node, line_end + 1);
        range.setEnd(text_node, line_end + 2);
        if (range.getBoundingClientRect().top !== line_top) { break; }
        line_end++;
    }

    // binary search on X within the line
    lo = line_start;
    hi = line_end;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        range.setStart(text_node, mid);
        range.setEnd(text_node, mid + 1);
        const char_rect = range.getBoundingClientRect();
        if (clientX < char_rect.left + char_rect.width / 2) {
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return lo;
}

/**
 * Find the character index (within the wrapper's text content) at the given click
 * coordinates by walking text nodes and using Range.getBoundingClientRect() to
 * locate which character was clicked. Returns the character index, or undefined.
 *
 * Performance: O(T * log N) where T = number of text nodes (typically 1-3) and
 * N = characters in the matched node. Each text node gets one coarse bounding-rect
 * check; the matched node gets ~2*log(N) calls for the binary searches on Y then X.
 */
export function findCharAtPoint(wrapper: HTMLElement, clientX: number, clientY: number): number | undefined {
    const doc = wrapper.ownerDocument;
    if (!doc) { return undefined; }
    const walker = doc.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    let char_count = 0;

    while (walker.nextNode()) {
        const text_node = walker.currentNode as Text;
        const node_len = text_node.length;
        if (node_len === 0) { continue; }
        range.selectNodeContents(text_node);
        if (!range.getBoundingClientRect) { return undefined; }
        const node_rect = range.getBoundingClientRect();

        // skip text nodes whose bounding box doesn't contain the click at all
        if (node_rect.height === 0 || clientY < node_rect.top || clientY > node_rect.bottom) {
            char_count += node_len;
            continue;
        }

        // click is past this text node's right edge - skip to next inline element
        if (clientX > node_rect.right) {
            char_count += node_len;
            continue;
        }

        const index = findCharInTextNode(range, text_node, node_len, clientX, clientY);
        if (index >= 0) { return char_count + index; }

        char_count += node_len;
    }

    return undefined;
}

/**
 * Refine an element-level offset to a character-level offset using the click coordinates.
 * Walks text nodes within the body item wrapper and uses Range.getBoundingClientRect()
 * to find which character was clicked. Falls back to base_offset when unavailable.
 *
 * Note: this is approximate - markdown formatting characters (**, *, etc.) are not in the
 * DOM text, so the offset may be slightly past the true source position in formatted text.
 */
export function refineOffsetWithSelection(event: MouseEvent<HTMLElement>, base_offset: number): number {
    if (typeof document === 'undefined') { return base_offset; }
    const wrapper = findOffsetAncestor(event);
    if (!wrapper) { return base_offset; }
    const char_offset = findCharAtPoint(wrapper, event.clientX, event.clientY);
    if (char_offset === undefined || char_offset === 0) { return base_offset; }
    return base_offset + char_offset;
}

/**
 * Create an onClick handler that delegates to note.handlers.click with the appropriate position info.
 * Overrides position.from with the offset extracted from the click target's data-offset-start
 * attribute, refined with character-level precision via Range.getBoundingClientRect().
 */
export function createNoteClickHandler(
    note: NoteProps,
    position: ClickPositionInfo,
): (event: MouseEvent<HTMLElement>) => void {
    return (event: MouseEvent<HTMLElement>) => {
        let effective_position = position;
        const offset = extractOffsetFromClickTarget(event);
        if (offset !== undefined) {
            const refined = refineOffsetWithSelection(event, offset);
            effective_position = { ...position, from: refined };
        }
        note.handlers?.click?.(event, note.display_options?.deepest?.selectable_note || note, effective_position);
    };
}

/**
 * Build display_options for a GenericNote rendered inside a view (DocumentView, KanbanView).
 */
export function buildChildNoteDisplayOptions(
    view_display_options: NoteDisplayOptions,
    note: NoteProps,
    view: ViewProps,
): NoteDisplayOptions {
    return {
        ...view_display_options,
        ...note?.display_options,
        view_id: view.id,
        id: `v${view.id}-n${note.seq}`,
        deepest: {
            ...view.display_options?.deepest,
            ...note?.display_options?.deepest,
            // preserve the view-level selectable_level so only top-level notes
            // are selectable; subnotes delegate clicks to their selectable parent
            selectable_level: view.display_options?.deepest?.selectable_level ?? note.level,
        },
    };
}
