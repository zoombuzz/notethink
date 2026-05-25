import Debug from "debug";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { findFirstIncompleteTaskSeq } from "../../../lib/noteops";
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
 * manages the clipped body's scrollTop and reports the derived top/bottom state
 * the fade overlays render against.
 *
 * Owns scrolled_top and at_bottom useState pairs. The applyBodyScroll callback
 * is private — every scroll write goes through it so both pieces of state stay
 * in sync with the DOM. The hook runs two layout effects:
 *
 * 1. Task-aware default scroll. When clipped, scroll so the first incomplete
 *    task sits SCROLL_CONTEXT_PX from the top (showing some completed context
 *    above it). When not clipped, reset scrollTop to 0.
 *
 * 2. Caret-aware override. When the body is both clipped and focused and the
 *    caret target sits outside the visible window (between the top and bottom
 *    fades), scroll the body so the target is centred between the fades. When
 *    focus leaves, restore the task-aware position.
 *
 * Dependencies are all read-only; the hook never mutates props.
 */
export function useMarkdownNoteBodyScroll(args: UseMarkdownNoteBodyScrollArgs): MarkdownNoteBodyScrollState {
    const { body_ref, should_clip, focused, children_body, body_raw, caret_offset } = args;
    const [scrolled_top, setScrolledTop] = useState(0);
    const [at_bottom, setAtBottom] = useState(false);
    const applyBodyScroll = useCallback((scroll_to: number): void => {
        const el = body_ref.current;
        if (!el) { return; }
        el.scrollTop = scroll_to;
        setScrolledTop(scroll_to);
        setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_TOLERANCE_PX);
    }, [body_ref]);
    // body_raw is the canonical re-parse trigger; children_body identity is derived from it
    const first_incomplete_seq = useMemo(
        () => findFirstIncompleteTaskSeq(children_body ?? []),
        [body_raw],
    );
    useLayoutEffect(() => {
        const el = body_ref.current;
        if (!el) { return; }
        if (!should_clip) {
            applyBodyScroll(0);
            return;
        }
        if (first_incomplete_seq === undefined) {
            applyBodyScroll(0);
            return;
        }
        const task_el = el.querySelector(`[data-seq="${first_incomplete_seq}"]`) as HTMLElement | null;
        if (!task_el) {
            applyBodyScroll(0);
            return;
        }
        applyBodyScroll(Math.max(0, task_el.offsetTop - SCROLL_CONTEXT_PX));
    }, [should_clip, first_incomplete_seq, body_raw]);
    useLayoutEffect(() => {
        const el = body_ref.current;
        if (!el || !should_clip) { return; }
        if (!focused) {
            const task_el = first_incomplete_seq !== undefined
                ? el.querySelector(`[data-seq="${first_incomplete_seq}"]`) as HTMLElement | null
                : null;
            applyBodyScroll(task_el ? Math.max(0, task_el.offsetTop - SCROLL_CONTEXT_PX) : 0);
            return;
        }
        if (caret_offset === undefined) { return; }
        const target_el = findCaretTargetElement(el, caret_offset);
        if (!target_el) { return; }
        const body_rect = el.getBoundingClientRect();
        const target_rect = target_el.getBoundingClientRect();
        const visible_top = body_rect.top + FADE_TOP_PX;
        const visible_bottom = body_rect.bottom - FADE_BOTTOM_PX;
        if (target_rect.top >= visible_top && target_rect.bottom <= visible_bottom) { return; }
        const target_offset_in_body = target_rect.top - body_rect.top + el.scrollTop;
        applyBodyScroll(Math.max(0, target_offset_in_body - FADE_TOP_PX));
    }, [should_clip, focused, caret_offset]);
    return { scrolled_top, at_bottom };
}

/**
 * locate the deepest body-item element whose offset range contains caret_offset.
 * Walks candidates in reverse so the innermost match wins when ranges nest.
 */
function findCaretTargetElement(body_el: HTMLElement, caret_offset: number): HTMLElement | undefined {
    const candidates = body_el.querySelectorAll<HTMLElement>('[data-offset-start]');
    for (let i = candidates.length - 1; i >= 0; --i) {
        const el = candidates[i];
        const start = Number(el.dataset.offsetStart);
        const end = Number(el.dataset.offsetEnd);
        if (!isNaN(start) && !isNaN(end) && caret_offset >= start && caret_offset <= end) {
            return el;
        }
    }
    return undefined;
}
