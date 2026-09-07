import { useEffect, useState } from "react";

// abridge when rendered height exceeds this multiple of width (top-level notes only)
const HEIGHT_RATIO = 1;

// a card is never clipped below this, so one carrying an unusually tall headline still shows some body
const MIN_CLIP_HEIGHT = 48;

/**
 * Everything of the card that is not the body: the headline, the attribute rows, the padding and the
 * border. Read as the card's height minus the body's, which holds whether or not the body is currently
 * clipped and so cannot chase its own answer.
 */
function chromeHeightAround(body: HTMLElement): number {
    const card = body.closest('[data-column-card-id]') as HTMLElement | null;
    if (card === null) { return 0; }
    return Math.max(card.getBoundingClientRect().height - body.getBoundingClientRect().height, 0);
}

/**
 * The height a body clips at, and the single place that rule lives.
 *
 * Two callers need the same answer at two different moments - this module's passive effect, which drives
 * the Show-more bars, and `useSyncedBodyClip`'s layout effect, which lands the geometry before the kanban
 * FLIP samples it. They used to hold a copy each, and the copies disagreed the moment one of them learned
 * about `card_target_height`: the render applied the new clip and the layout effect erased it on the same
 * frame, using a rule that had not been told. One function, both callers.
 */
export function bodyClipHeight(body: HTMLElement, card_target_height?: number): number {
    if (card_target_height === undefined) { return body.offsetWidth * HEIGHT_RATIO; }
    return Math.max(card_target_height - chromeHeightAround(body), MIN_CLIP_HEIGHT);
}

export interface MarkdownNoteOverflowState {
    overflows: boolean;
    max_height: number;
}

/**
 * detects whether the body element has overflowed its width-bound height
 * threshold and exposes the computed max_height to apply when clipping.
 *
 * Owns the overflow_state useState pair. Watches body_ref via ResizeObserver,
 * recomputing only on width-change events. Skips measurement during drag
 * (the dragged element is position:fixed with wrong dimensions) and while
 * the element has zero width (during initial layout or a hidden tab - leaving
 * the previous reading in place rather than collapsing max_height to 0).
 *
 * `card_target_height` inverts which dimension decides the clip, and is what a stacked lane passes in.
 * Left off, the body clips at its own width, so a card is about as tall as it is wide and a lane of them
 * comes out even because they all share a width. Set, the body clips at whatever is left of the target
 * once this card's own chrome is taken off - so a card carrying three linetags and a four-line headline
 * gets a shorter body than its neighbour and the two still finish the same height, which is what makes a
 * stacked row exactly one card tall. The chrome is measured rather than assumed, and is invariant under
 * the clip it produces (it is the card's height minus the body's), so the measurement settles in one pass.
 *
 * Dependencies:
 * - body_ref: ref to the body DOM node; safe when null (no-op)
 * - is_top_level: only top-level notes clip; child notes report no overflow
 * - card_target_height: the height every card in this lane is aiming at, when something is aiming them
 */
export function useMarkdownNoteOverflow(
    body_ref: React.RefObject<HTMLDivElement | null>,
    is_top_level: boolean,
    card_target_height?: number,
): MarkdownNoteOverflowState {
    const [overflow_state, setOverflowState] = useState<MarkdownNoteOverflowState>({ overflows: false, max_height: 0 });
    useEffect(() => {
        if (!is_top_level || !body_ref.current) {
            setOverflowState({ overflows: false, max_height: 0 });
            return;
        }
        const el = body_ref.current;
        const check = (): void => {
            if (getComputedStyle(el).position === 'fixed') { return; }
            const width = el.offsetWidth;
            if (width === 0) { return; }
            const max_h = bodyClipHeight(el, card_target_height);
            const naturally_overflows = el.scrollHeight > max_h;
            setOverflowState(prev => {
                if (prev.overflows === naturally_overflows && prev.max_height === max_h) { return prev; }
                return { overflows: naturally_overflows, max_height: max_h };
            });
        };
        const observer = new ResizeObserver(check);
        observer.observe(el);
        check();
        return () => observer.disconnect();
    }, [is_top_level, body_ref, card_target_height]);
    return overflow_state;
}
