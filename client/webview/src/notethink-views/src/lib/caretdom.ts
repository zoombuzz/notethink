/**
 * DOM helpers for the virtual caret prototype (dev builds only): they map between a rendered offset
 * (a count of characters in an element's text) and a place on screen, with no knowledge of markdown.
 */

/** The viewport rectangle a caret is drawn in: its left edge, top and height. */
export interface CaretRect {
    left: number;
    top: number;
    height: number;
}

function textNodesOf(container: Node): Text[] {
    const nodes: Text[] = [];
    const walker = container.ownerDocument!.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) { nodes.push(node as Text); }
    return nodes;
}

/** The rendered offset of a DOM position inside a container: characters of text before it. */
export function textOffsetWithin(container: Node, node: Node, offset: number): number {
    let total = 0;
    for (const text of textNodesOf(container)) {
        if (text === node) { return total + Math.min(offset, text.data.length); }
        total += text.data.length;
    }
    // a position on an element boundary: count the text up to that child
    if (container.contains(node) || container === node) {
        const range = container.ownerDocument!.createRange();
        range.selectNodeContents(container);
        try {
            range.setEnd(node, offset);
            return range.toString().length;
        } catch {
            return total;
        }
    }
    return total;
}

/** The rendered offset under a viewport point, or undefined when the point is not over this container's text. */
export function renderedOffsetFromPoint(container: HTMLElement, x: number, y: number): number | undefined {
    const doc = container.ownerDocument;
    const position = (doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(x, y);
    if (position && container.contains(position.offsetNode)) { return textOffsetWithin(container, position.offsetNode, position.offset); }
    const range = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);
    if (range && container.contains(range.startContainer)) { return textOffsetWithin(container, range.startContainer, range.startOffset); }
    return undefined;
}

/**
 * Where to draw a caret at a rendered offset: the left edge of the character after it, else the right
 * edge of the character before it, else the container's own left edge for an empty field.
 */
export function rectAtRenderedOffset(container: HTMLElement, rendered_offset: number): CaretRect | undefined {
    const nodes = textNodesOf(container);
    const total = nodes.reduce((sum, node) => sum + node.data.length, 0);
    const doc = container.ownerDocument;
    function characterRect(at: number): DOMRect | undefined {
        let seen = 0;
        for (const node of nodes) {
            if (at < seen + node.data.length) {
                const range = doc.createRange();
                range.setStart(node, at - seen);
                range.setEnd(node, at - seen + 1);
                const rects = range.getClientRects();
                return rects.length > 0 ? rects[0] : undefined;
            }
            seen += node.data.length;
        }
        return undefined;
    }
    const offset = Math.max(0, Math.min(rendered_offset, total));
    if (offset < total) {
        const after = characterRect(offset);
        if (after) { return { left: after.left, top: after.top, height: after.height }; }
    }
    if (offset > 0) {
        const before = characterRect(offset - 1);
        if (before) { return { left: before.right, top: before.top, height: before.height }; }
    }
    const own = container.getBoundingClientRect();
    return { left: own.left, top: own.top, height: own.height };
}
