import Debug from "debug";
import { useEffect, useState } from "react";

const debug = Debug("nodejs:notethink-views:useMarkdownNoteOverflow");

// abridge when rendered height exceeds this multiple of width (top-level notes only)
const HEIGHT_RATIO = 1;

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
 * Dependencies:
 * - body_ref: ref to the body DOM node; safe when null (no-op)
 * - is_top_level: only top-level notes clip; child notes report no overflow
 */
export function useMarkdownNoteOverflow(
    body_ref: React.RefObject<HTMLDivElement | null>,
    is_top_level: boolean,
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
            const max_h = width * HEIGHT_RATIO;
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
    }, [is_top_level, body_ref]);
    return overflow_state;
}
