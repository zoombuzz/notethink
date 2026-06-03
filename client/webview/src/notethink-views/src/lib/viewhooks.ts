import Debug from "debug";
import { useEffect, useRef } from 'react';
import { findBodyItemElement } from './noteops';
import type { NoteDisplayOptions, TextSelection } from '../types/NoteProps';

const debug = Debug("nodejs:notethink-views:viewhooks");

// small extra so the story sits clear of the sticky header rather than flush against it
const SCROLL_OCCLUDER_BUFFER_PX = 8;
// the focused/selected story draws a dashed/solid outline ring (offset 6px + 2px width, 8px when nested) that getBoundingClientRect excludes
// reserve this much clearance on every edge so the ring is never clipped against a scroll container's edge
const SCROLL_FOCUS_RING_PX = 12;

/**
 * nearest scrollable ancestor in the given axis — the element scrollIntoView would scroll.
 * Falls back to the document scroller (the webview body scrolls the page). Walks ancestors
 * (including body) so the kanban board (overflow-x) and the page (overflow-y) each resolve.
 */
function findScrollParent(el: HTMLElement, axis: 'x' | 'y'): HTMLElement {
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
 * the element that actually draws the focus/selection marquee for this note: the OUTERMOST
 * ancestor (or self) carrying a visible outline. focused_seqs is root-to-leaf, so the resolved
 * note element is the *deepest* focused note (the caret's sub-note, often indented and ringless);
 * the visible ring lives on the top-level story card above it. We frame the card, not the sub-note,
 * so its ring is what gets the clearance. Falls back to the element itself when nothing is outlined.
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
 * signed scroll delta to frame [need_start, need_end] within [avail_start, avail_end].
 * When the need fits, reveal whichever edge is off-screen (and 0 when already wholly visible,
 * so an already-framed story is never yanked). When it doesn't fit, anchor the start edge —
 * top for the vertical axis, left for the horizontal — per the focused-note framing rule.
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
 * Return the maximum bottom edge (viewport px) of the sticky header stack — the view's
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
        scroll_raf_ref.current = requestAnimationFrame(() => {
            const resolved = resolveCaretTarget(display_options.focused_seqs, view_id, undefined);
            if (!resolved) { return; }
            // frame the top-level story card (the element with the visible ring), not the deepest focused sub-note — the card's outline is what must stay clear of edges
            const story = outermostRingedElement(resolved.note_element);
            const rect = story.getBoundingClientRect();
            const ring = SCROLL_FOCUS_RING_PX;
            // sticky toolbar (and any open drawer) eat the top of the vertical scrollport
            const occluder_top = stickyOccluderBottomPx(view_id) + SCROLL_OCCLUDER_BUFFER_PX;

            // vertical (page scroller): reserve the ring top/bottom, keep the top clear of the sticky header, anchor the top when the story is taller than the available room
            const v = findScrollParent(story, 'y');
            const v_rect = v.getBoundingClientRect();
            const dy = frameDelta(rect.top - ring, rect.bottom + ring, Math.max(v_rect.top, occluder_top), v_rect.bottom);
            if (dy !== 0) { v.scrollBy({ top: dy, behavior: 'smooth' }); }

            // horizontal (kanban board): reserve the ring left/right so the halo isn't clipped against the board edge, anchor the left when too wide
            // a document view has no horizontal scroller, so dx resolves to 0 (no-op)
            const h = findScrollParent(story, 'x');
            const h_rect = h.getBoundingClientRect();
            const dx = frameDelta(rect.left - ring, rect.right + ring, h_rect.left, h_rect.right);
            if (dx !== 0) { h.scrollBy({ left: dx, behavior: 'smooth' }); }
        });
        return () => cancelAnimationFrame(scroll_raf_ref.current);
    }, [
        display_options.settings?.scrollNoteIntoView,
        display_options.focused_seqs?.length && display_options.focused_seqs[display_options.focused_seqs.length - 1],
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

        // only flash when the caret is within a specific content element (headline
        // or body item with data-offset-start/end); gaps between notes have no
        // rendered content so nothing should flash
        const target = resolved.body_item;
        if (!target) { return; }

        // skip re-flash if the caret moved within the same element
        if (target === prev_target_ref.current) { return; }
        prev_target_ref.current = target;

        // check if the target is already in the viewport; treat the sticky header stack as the effective top edge so a target hidden behind the toolbar/drawer counts as off-screen and we wait for the scroll
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
        // fallback if no scroll happens (scrollend never fires);
        // 1000ms allows for long smooth scrolls in case scrollend is missed
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
