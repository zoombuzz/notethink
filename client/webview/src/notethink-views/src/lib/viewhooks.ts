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
