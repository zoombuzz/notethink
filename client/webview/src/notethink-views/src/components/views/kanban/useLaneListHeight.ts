import Debug from "debug";
import { useEffect, useRef, useState, type RefObject } from "react";
import { laneListHeight } from "./virtualCardSizingOps";

const debug = Debug("nodejs:notethink-views:useLaneListHeight");

// re-measure at most this often while scrolling, so a fast trackpad fling costs one rAF, not one measurement per event
const SCROLL_MEASURE_THROTTLE_MS = 100;

/**
 * - list_height: the room a virtualized lane's card list is given, in px - floored so an
 *   already-virtualizing lane never renders a zero-height list before the first measurement lands
 * - available: the same reading, unfloored, `undefined` before the board has ever been measured.
 *   `KanbanBoard.tsx` reads this, not `list_height`, to decide whether a lane needs virtualizing at
 *   all - reusing the floored value there made every lane look too tall to fit during the bootstrap
 *   window, so a lane could wrongly virtualize once and never need to. `undefined` reads as "not
 *   enough information yet, so don't virtualize" (`laneNeedsVirtualization`)
 */
export interface LaneListHeight {
    list_height: number;
    available: number | undefined;
}

/**
 * Re-measured on mount, on window resize, and (throttled) on a page-level scroll, since the board's
 * top edge moves whenever the page scrolls past the chrome above it. `top` is clamped to 0: treating
 * a negative top (scrolled past the board) as extra ceiling flips `laneNeedsVirtualization`'s
 * decision on every tick, a self-reinforcing remount loop confirmed live.
 *
 * The scroll listener is capture-phase on `window` (there's no single page-scroll element to attach
 * to) but must ignore any event whose target isn't the page itself: a capture-phase window listener
 * also sees every nested scroll - the board's own horizontal scroll, notably - which doesn't move
 * the board's top edge. Recomputing on one anyway wastes work at best; at worst, one arriving
 * mid-gesture re-renders the board while @hello-pangea/dnd has an in-flight drag open, which was
 * observed to corrupt a keyboard cross-column move. Filtering to page-level scrolls removes both.
 */
export function useLaneListHeight(board_ref: RefObject<HTMLDivElement | null>): LaneListHeight {
    const [available, setAvailable] = useState<number | undefined>(undefined);
    const throttle_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const measure = (): void => {
            const board = board_ref.current;
            if (!board || typeof window === 'undefined') { return; }
            const top = board.getBoundingClientRect().top;
            // clamp: a negative top would grow the ceiling with scroll position, causing the remount loop
            setAvailable(window.innerHeight - Math.max(0, top));
        };
        measure();
        const on_resize = (): void => measure();
        const on_scroll = (event: Event): void => {
            // ignore a nested scroll (a lane's own list, the board's horizontal scroller) - only the page moves the board's top edge
            const target = event.target;
            if (target !== document && target !== window) { return; }
            if (throttle_ref.current !== null) { return; }
            throttle_ref.current = setTimeout(() => {
                throttle_ref.current = null;
                measure();
            }, SCROLL_MEASURE_THROTTLE_MS);
        };
        window.addEventListener('resize', on_resize);
        window.addEventListener('scroll', on_scroll, { capture: true, passive: true });
        return () => {
            window.removeEventListener('resize', on_resize);
            window.removeEventListener('scroll', on_scroll, { capture: true });
            if (throttle_ref.current !== null) { clearTimeout(throttle_ref.current); }
        };
    }, [board_ref]);
    const height = laneListHeight(available);
    debug('lane list height %dpx (available=%s)', height, available === undefined ? 'unmeasured' : available.toFixed(0));
    return { list_height: height, available };
}
