import Debug from "debug";
import { useCallback, useLayoutEffect, useState } from "react";
import { findBodyItemElement, findFirstIncompleteTaskSeq } from "../../../lib/noteops";
import type { MdastNode, NoteProps } from "../../../types/NoteProps";

const debug = Debug("nodejs:notethink-views:useMarkdownNoteBodyScroll");

// pixels of completed-task context to show above the first incomplete task when scrolled
const SCROLL_CONTEXT_PX = 40;
// 4em - matches .abridgeFadeTop height (used when caret target sits behind the top fade)
const FADE_TOP_PX = 64;
// 6em - matches .abridgeFade height (used when caret target sits behind the bottom fade)
const FADE_BOTTOM_PX = 96;
// scrollTop within 2px of scrollHeight - clientHeight counts as scrolled to bottom (sub-pixel layout)
const AT_BOTTOM_TOLERANCE_PX = 2;

export interface MarkdownNoteBodyScrollState {
    scrolled_top: number;
    at_bottom: boolean;
}

export interface UseMarkdownNoteBodyScrollArgs {
    body_ref: React.RefObject<HTMLDivElement | null>;
    should_clip: boolean;
    focused: boolean | undefined;
    children_body: Array<NoteProps | MdastNode> | undefined;
    body_raw: string | undefined;
    caret_offset: number | undefined;
}

/**
 * Manages the clipped body's scrollTop and the derived top/bottom state the fade overlays render
 * against. applyBodyScroll is the only write path and reads scrollTop back rather than trusting the
 * requested value, since the browser can clamp a write and the fades must describe where the body
 * actually is.
 *
 * One layout effect, in precedence order, resets to 0 when unclipped, frames a focused caret target
 * outside the visible window, or falls back to the first incomplete task; sharing one effect keeps the
 * task-aware branch from re-firing and stomping a caret position the caret-aware branch left alone.
 * first_incomplete_seq is deliberately not memoised: seq is reassigned on every re-parse, so a
 * content-keyed cache could resolve a stale seq to the wrong note in the same card.
 */
export function useMarkdownNoteBodyScroll(args: UseMarkdownNoteBodyScrollArgs): MarkdownNoteBodyScrollState {
    const { body_ref, should_clip, focused, children_body, body_raw, caret_offset } = args;
    const [scrolled_top, setScrolledTop] = useState(0);
    const [at_bottom, setAtBottom] = useState(false);
    const applyBodyScroll = useCallback((scroll_to: number): void => {
        const el = body_ref.current;
        if (!el) { return; }
        el.scrollTop = scroll_to;
        if (el.scrollTop !== scroll_to) {
            debug('body scroll clamped: requested %d, applied %d (scrollHeight %d, clientHeight %d)', scroll_to, el.scrollTop, el.scrollHeight, el.clientHeight);
        }
        setScrolledTop(el.scrollTop);
        setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_TOLERANCE_PX);
    }, [body_ref]);
    const first_incomplete_seq = findFirstIncompleteTaskSeq(children_body ?? []);
    useLayoutEffect(() => {
        const el = body_ref.current;
        if (!el) { return; }
        if (!should_clip) {
            applyBodyScroll(0);
            return;
        }
        if (focused && caret_offset !== undefined) {
            const target_el = findBodyItemElement(el, caret_offset);
            if (target_el) {
                const body_rect = el.getBoundingClientRect();
                const target_rect = target_el.getBoundingClientRect();
                const visible_top = body_rect.top + FADE_TOP_PX;
                const visible_bottom = body_rect.bottom - FADE_BOTTOM_PX;
                if (target_rect.top >= visible_top && target_rect.bottom <= visible_bottom) { return; }
                const target_offset_in_body = target_rect.top - body_rect.top + el.scrollTop;
                applyBodyScroll(Math.max(0, target_offset_in_body - FADE_TOP_PX));
                return;
            }
            debug('caret offset %d resolved to no body item, falling back to the task framing', caret_offset);
        }
        const task_el = first_incomplete_seq !== undefined
            ? el.querySelector<HTMLElement>(`[data-seq="${first_incomplete_seq}"]`)
            : null;
        if (first_incomplete_seq !== undefined && !task_el) {
            debug('first incomplete task seq %d is not in this body, framing the top instead', first_incomplete_seq);
        }
        applyBodyScroll(task_el ? Math.max(0, task_el.offsetTop - SCROLL_CONTEXT_PX) : 0);
        // body_raw is not read above; it re-runs the framing when the body DOM this measures changes under it
    }, [should_clip, focused, caret_offset, first_incomplete_seq, body_raw, applyBodyScroll]);
    return { scrolled_top, at_bottom };
}
