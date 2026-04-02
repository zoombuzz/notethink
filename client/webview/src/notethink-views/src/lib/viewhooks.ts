import { useEffect, useRef } from 'react';
import { findBodyItemElement } from './noteops';
import type { NoteDisplayOptions, TextSelection } from '../types/NoteProps';

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
 * Check whether an element is clipped by an ancestor with overflow:hidden.
 * Returns true if the element's bottom extends beyond the ancestor's visible area.
 */
function isClippedByAncestor(el: HTMLElement): boolean {
    let ancestor = el.parentElement;
    while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
            const ancestor_rect = ancestor.getBoundingClientRect();
            const el_rect = el.getBoundingClientRect();
            if (el_rect.bottom > ancestor_rect.bottom || el_rect.top < ancestor_rect.top) {
                return true;
            }
        }
        ancestor = ancestor.parentElement;
    }
    return false;
}

/**
 * Find the nearest ancestor with overflow:hidden (the body container in a clipped note).
 */
function findOverflowAncestor(el: HTMLElement): HTMLElement | undefined {
    let ancestor = el.parentElement;
    while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
            return ancestor;
        }
        ancestor = ancestor.parentElement;
    }
    return undefined;
}

// fade overlay heights from ViewRenderer.module.scss — used as scroll padding
const FADE_TOP_PX = 64;   // 4em
const FADE_BOTTOM_PX = 96; // 6em

/**
 * Scroll a clipped body container so the target element is visible between the fade overlays.
 */
function scrollClippedBodyToTarget(target: HTMLElement): void {
    const body_container = findOverflowAncestor(target);
    if (!body_container) { return; }
    const body_rect = body_container.getBoundingClientRect();
    const target_rect = target.getBoundingClientRect();
    // target's position within the body's scrollable area
    const target_top_in_body = target_rect.top - body_rect.top + body_container.scrollTop;
    const target_bottom_in_body = target_rect.bottom - body_rect.top + body_container.scrollTop;
    const visible_top = body_container.scrollTop + FADE_TOP_PX;
    const visible_bottom = body_container.scrollTop + body_container.clientHeight - FADE_BOTTOM_PX;
    if (target_top_in_body < visible_top) {
        // target is above the visible area — scroll up
        body_container.scrollTop = Math.max(0, target_top_in_body - FADE_TOP_PX);
    } else if (target_bottom_in_body > visible_bottom) {
        // target is below the visible area — scroll down
        body_container.scrollTop = target_bottom_in_body - body_container.clientHeight + FADE_BOTTOM_PX;
    }
}

/**
 * Scroll the focused note (and body item) into view when the caret moves.
 */
export function useScrollToCaret(
    display_options: NoteDisplayOptions,
    view_id: string,
    selection: TextSelection | undefined,
) {
    const scroll_raf_ref = useRef<number>(0);
    useEffect(() => {
        if (!display_options.settings?.scroll_note_into_view || !display_options.focused_seqs?.length) { return; }
        const caret_offset = selection?.main.head;
        cancelAnimationFrame(scroll_raf_ref.current);
        scroll_raf_ref.current = requestAnimationFrame(() => {
            const resolved = resolveCaretTarget(display_options.focused_seqs, view_id, caret_offset);
            if (!resolved) { return; }
            const scroll_target = resolved.body_item || resolved.note_element;
            // if the body item is clipped (inside an abridged note), scroll the note into
            // view and adjust the body's internal scroll to reveal the caret target
            if (resolved.body_item && isClippedByAncestor(resolved.body_item)) {
                resolved.note_element.scrollIntoView({behavior: "smooth", block: "nearest", inline: "nearest"});
                scrollClippedBodyToTarget(resolved.body_item);
                return;
            }
            scroll_target.scrollIntoView({behavior: "smooth", block: "nearest", inline: "nearest"});
        });
        return () => cancelAnimationFrame(scroll_raf_ref.current);
    }, [
        display_options.settings?.scroll_note_into_view,
        display_options.focused_seqs?.length && display_options.focused_seqs[display_options.focused_seqs.length - 1],
        view_id,
        selection?.main.head,
    ]);
}

/**
 * Virtual caret indicator: pulse-highlight the body item containing the editor caret.
 * Only flashes a specific body item (paragraph, list item, code block) — never the
 * entire note element, to avoid distracting full-tree flashes when cursoring through
 * headings or whitespace.
 */
export function useCaretIndicator(
    display_options: NoteDisplayOptions,
    view_id: string,
    selection: TextSelection | undefined,
    caret_class: string,
) {
    const prev_target_ref = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const resolved = resolveCaretTarget(display_options.focused_seqs, view_id, selection?.main.head);
        if (!resolved) { return; }

        // only flash when the caret is within a specific content element (headline
        // or body item with data-offset-start/end); gaps between notes have no
        // rendered content so nothing should flash
        const target = resolved.body_item;
        if (!target) { return; }

        // if the target is clipped, scroll the body to reveal it, then flash
        if (isClippedByAncestor(target)) {
            scrollClippedBodyToTarget(target);
        }

        // skip re-flash if the caret moved within the same element
        if (target === prev_target_ref.current) { return; }
        prev_target_ref.current = target;

        // check if the target is already in the viewport
        const rect = target.getBoundingClientRect();
        const is_visible = rect.top < window.innerHeight && rect.bottom > 0;

        if (is_visible) {
            // already on screen — flash immediately
            target.classList.add(caret_class);
            return () => { target.classList.remove(caret_class); };
        }

        // off screen — a scroll is about to start; wait for it to finish + 150ms settle
        let timer: ReturnType<typeof setTimeout> | undefined;
        const apply = () => { target.classList.add(caret_class); };
        const on_scrollend = () => { clearTimeout(timer); timer = setTimeout(apply, 150); };
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
