import { useEffect, useRef } from 'react';
import { findBodyItemElement, kanbanDraggableId } from './noteops';
import { scrollVirtualLaneToNoteId } from './virtualScrollRegistry';
import type { NoteDisplayOptions, TextSelection } from '../types/NoteProps';

// small extra so the story sits clear of the sticky header rather than flush against it
const SCROLL_OCCLUDER_BUFFER_PX = 8;
/**
 * The focused/selected story draws a ring (offset 6px + 2px width, 8px when nested) that
 * getBoundingClientRect excludes; reserve this much clearance so it's never clipped against a
 * scroll container's edge.
 */
const SCROLL_FOCUS_RING_PX = 12;

/** Nearest scrollable ancestor of `el` along `axis`; falls back to the document scroller. */
export function findScrollParent(el: HTMLElement, axis: 'x' | 'y'): HTMLElement {
    const overflow_prop = axis === 'x' ? 'overflowX' : 'overflowY';
    let node: HTMLElement | null = el.parentElement;
    while (node) {
        const style = window.getComputedStyle(node);
        const scrollable = axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight;
        if (/(auto|scroll)/.test(style[overflow_prop]) && scrollable) { return node; }
        node = node.parentElement;
    }
    return (window.document.scrollingElement as HTMLElement | null) ?? window.document.body;
}

/**
 * The element that actually draws the focus/selection ring for this note: the outermost ancestor
 * (or self) with a visible outline. `focused_seqs` resolves to the deepest, often ringless,
 * sub-note, so this frames the ringed card above it instead. Falls back to the element itself when
 * nothing is outlined.
 */
function outermostRingedElement(deepest: HTMLElement): HTMLElement {
    let ringed = deepest;
    let node: HTMLElement | null = deepest;
    while (node) {
        const style = window.getComputedStyle(node);
        if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) { ringed = node; }
        node = node.parentElement;
    }
    return ringed;
}

/**
 * Viewport span `v` clips to along `axis`. The root scroller's own rect spans its full, often
 * taller, scrollable content rather than the visible window, so the root case uses
 * `window.innerWidth`/`innerHeight` instead.
 */
function scrollerViewportBounds(v: HTMLElement, axis: 'x' | 'y'): { start: number; end: number } {
    const root = (window.document.scrollingElement as HTMLElement | null) ?? window.document.body;
    if (v === root) { return axis === 'x' ? { start: 0, end: window.innerWidth } : { start: 0, end: window.innerHeight }; }
    const rect = v.getBoundingClientRect();
    return axis === 'x' ? { start: rect.left, end: rect.right } : { start: rect.top, end: rect.bottom };
}

/**
 * Signed scroll delta to frame [need_start, need_end] within [avail_start, avail_end]. When the
 * need fits, reveals whichever edge is off-screen (0 when already visible, so a framed story is
 * never yanked); when it doesn't fit, anchors the start edge per the focused-note framing rule.
 */
function frameDelta(need_start: number, need_end: number, avail_start: number, avail_end: number): number {
    const avail_size = avail_end - avail_start;
    const need_size = need_end - need_start;
    if (need_size <= avail_size) {
        if (need_start < avail_start) { return need_start - avail_start; }
        if (need_end > avail_end) { return need_end - avail_end; }
        return 0;
    }
    return need_start - avail_start;
}

/**
 * Resolve the focused note's DOM element and the body item containing the caret.
 * Returns undefined if the note element is not in the DOM.
 */
function resolveCaretTarget(
    focused_seqs: number[] | undefined,
    view_id: string,
    caret_offset: number | undefined,
): { note_element: HTMLElement; body_item: HTMLElement | undefined } | undefined {
    if (!focused_seqs?.length) { return undefined; }
    const focused_seq = focused_seqs[focused_seqs.length - 1];
    const note_element = window?.document?.getElementById(`v${view_id}-n${focused_seq}`);
    if (!note_element) { return undefined; }
    const body_item = caret_offset !== undefined ? findBodyItemElement(note_element, caret_offset) : undefined;
    return { note_element, body_item };
}

/**
 * Return the maximum bottom edge (viewport px) of the sticky header stack - the view's
 * toolbar plus any currently-open drawer. Used to set scroll-margin-top before
 * scrollIntoView so the caret line lands below the header instead of behind it, and to
 * decide whether the target is genuinely visible (vs technically on-screen but occluded).
 * Returns 0 if no occluders are found.
 */
function stickyOccluderBottomPx(view_id: string): number {
    const doc = window?.document;
    if (!doc) { return 0; }
    let max_bottom = 0;
    const toolbar = doc.querySelector<HTMLElement>('[data-testid="view-toolbar"]');
    if (toolbar) { max_bottom = Math.max(max_bottom, toolbar.getBoundingClientRect().bottom); }
    for (const suffix of ['-settings-drawer', '-files-drawer']) {
        const drawer = doc.getElementById(`v${view_id}${suffix}`);
        if (!drawer || drawer.dataset.open !== 'true') { continue; }
        max_bottom = Math.max(max_bottom, drawer.getBoundingClientRect().bottom);
    }
    return Math.max(0, max_bottom);
}

/**
 * Scroll the focused note (the whole story) into view when focus moves.
 * Frames the story rather than the caret's body item: within-note caret reveal
 * is owned by useMarkdownNoteBodyScroll (it scrolls the clipped body's own
 * scrollTop), so this hook only positions the story in the page and, for kanban,
 * its horizontal scroll container. The story's top and left edge are always
 * brought into view; its right and bottom follow when the story fits the
 * available space (see the block/inline choice below).
 */
export function useScrollToCaret(
    display_options: NoteDisplayOptions,
    view_id: string,
    selection: TextSelection | undefined,
): void {
    const scroll_raf_ref = useRef<number>(0);
    useEffect(() => {
        if (!display_options.settings?.scrollNoteIntoView || !display_options.focused_seqs?.length) { return; }
        cancelAnimationFrame(scroll_raf_ref.current);
        const frameStory = (): void => {
            const resolved = resolveCaretTarget(display_options.focused_seqs, view_id, undefined);
            if (!resolved) { return; }
            // frames the top-level story card (the visible ring), not the deepest focused sub-note
            const story = outermostRingedElement(resolved.note_element);
            const rect = story.getBoundingClientRect();
            const ring = SCROLL_FOCUS_RING_PX;
            // sticky toolbar (and any open drawer) eat the top of the vertical scrollport
            const occluder_top = stickyOccluderBottomPx(view_id) + SCROLL_OCCLUDER_BUFFER_PX;
            // vertical: keep the ring clear of the sticky header; findScrollParent finds a virtual lane's own scrollport or the page
            const v = findScrollParent(story, 'y');
            const v_bounds = scrollerViewportBounds(v, 'y');
            const dy = frameDelta(rect.top - ring, rect.bottom + ring, Math.max(v_bounds.start, occluder_top), v_bounds.end);
            if (dy !== 0) { v.scrollBy({ top: dy, behavior: 'smooth' }); }
            // horizontal: reserve the ring against the board edge; a document view has no x scroller, so dx is 0
            const h = findScrollParent(story, 'x');
            const h_bounds = scrollerViewportBounds(h, 'x');
            const dx = frameDelta(rect.left - ring, rect.right + ring, h_bounds.start, h_bounds.end);
            if (dx !== 0) { h.scrollBy({ left: dx, behavior: 'smooth' }); }
        };
        // a windowed-out card has no element yet: its lane scrolls it into range first, and frameStory waits a frame
        const focused_note = display_options.focused_notes?.[display_options.focused_notes.length - 1];
        const asked_virtualizer = focused_note !== undefined && scrollVirtualLaneToNoteId(view_id, kanbanDraggableId(focused_note));
        scroll_raf_ref.current = requestAnimationFrame(() => {
            if (!asked_virtualizer) { frameStory(); return; }
            scroll_raf_ref.current = requestAnimationFrame(frameStory);
        });
        return () => cancelAnimationFrame(scroll_raf_ref.current);
    }, [
        display_options.settings?.scrollNoteIntoView,
        display_options.focused_seqs?.length && display_options.focused_seqs[display_options.focused_seqs.length - 1],
        display_options.focused_notes,
        view_id,
        selection?.main.head,
    ]);
}

/**
 * Virtual caret indicator: pulse-highlight the body item containing the editor caret.
 * Only flashes a specific body item (paragraph, list item, code block) - never the
 * entire note element, to avoid distracting full-tree flashes when cursoring through
 * headings or whitespace.
 */
export function useCaretIndicator(
    display_options: NoteDisplayOptions,
    view_id: string,
    selection: TextSelection | undefined,
    caret_class: string,
): void {
    const prev_target_ref = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const resolved = resolveCaretTarget(display_options.focused_seqs, view_id, selection?.main.head);
        if (!resolved) { return; }
        // only flashes within a specific content element; gaps between notes render nothing to flash
        const target = resolved.body_item;
        if (!target) { return; }
        // skip re-flash if the caret moved within the same element
        if (target === prev_target_ref.current) { return; }
        prev_target_ref.current = target;
        // checks the viewport, treating the sticky header stack as the top edge so a hidden target counts as off-screen
        const rect = target.getBoundingClientRect();
        const occluder_bottom = stickyOccluderBottomPx(view_id);
        const is_visible = rect.top >= occluder_bottom && rect.top < window.innerHeight && rect.bottom > occluder_bottom;
        if (is_visible) {
            // already on screen - flash immediately
            target.classList.add(caret_class);
            return () => { target.classList.remove(caret_class); };
        }
        // off screen - a scroll is about to start; wait for it to finish + 150ms settle
        let timer: ReturnType<typeof setTimeout> | undefined;
        const apply = (): void => { target.classList.add(caret_class); };
        const on_scrollend = (): void => { clearTimeout(timer); timer = setTimeout(apply, 150); };
        document.addEventListener('scrollend', on_scrollend, { once: true });
        // fallback if no scroll happens (scrollend never fires); 1000ms allows for long smooth scrolls in case scrollend is missed
        timer = setTimeout(() => {
            document.removeEventListener('scrollend', on_scrollend);
            apply();
        }, 1000);
        return () => {
            target.classList.remove(caret_class);
            document.removeEventListener('scrollend', on_scrollend);
            clearTimeout(timer);
        };
    }, [
        display_options.focused_seqs?.length && display_options.focused_seqs[display_options.focused_seqs.length - 1],
        view_id,
        selection?.main.head,
        caret_class,
    ]);
}
