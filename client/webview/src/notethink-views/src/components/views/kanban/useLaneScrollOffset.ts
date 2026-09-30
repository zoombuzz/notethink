import Debug from "debug";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { findScrollParent } from "../../../lib/viewhooks";
import { clampScrollOffset } from "./virtualCardSizingOps";

const debug = Debug("nodejs:notethink-views:useLaneScrollOffset");

// re-measure at most this often while scrolling, so a fast fling costs one timer, not one per event
const SCROLL_MEASURE_THROTTLE_MS = 100;

/**
 * Lane's own scroll offset, in px, and a setter for pinning it directly.
 * - scroll_offset: how far the page has scrolled the lane's content past its top edge; never a
 *   scrollport's own scrollTop, since the lane owns no scrollable element itself.
 * - setScrollOffset: pins the offset with no DOM measurement, so a row can mount before the page
 *   actually scrolls there.
 */
export interface LaneScrollOffset {
    scroll_offset: number;
    setScrollOffset: (offset: number) => void;
}

/**
 * Windowing equivalent of a scrollport's own `scrollTop`, but sourced from the PAGE's scroll: this
 * webview's real scroller (`.content`, an `overflow: auto` wrapper) never fires on `window`, so
 * `findScrollParent` locates the real ancestor to listen on. Bounds are read via a ref so the
 * scroll listener is set up once per mount, not resubscribed on every measurement.
 */
export function useLaneScrollOffset(
    container_ref: RefObject<HTMLElement | null>,
    content_height: number,
    viewport_size: number,
): LaneScrollOffset {
    const [scroll_offset, setScrollOffsetState] = useState(0);
    const throttle_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bounds_ref = useRef({ content_height, viewport_size });
    useLayoutEffect(() => {
        bounds_ref.current = { content_height, viewport_size };
    });
    const setScrollOffset = useCallback((offset: number) => {
        const { content_height: ch, viewport_size: vs } = bounds_ref.current;
        setScrollOffsetState(clampScrollOffset(offset, ch, vs));
    }, []);
    useEffect(() => {
        const el = container_ref.current;
        if (!el || typeof window === 'undefined') { return; }
        const scroller = findScrollParent(el, 'y');
        // a root scroller dispatches scroll on `document`, not the element itself; other ancestors dispatch on themselves
        const is_root_scroller = scroller === ((document.scrollingElement as HTMLElement | null) ?? document.body);
        const scroll_target: EventTarget = is_root_scroller ? document : scroller;
        const measure = (): void => { setScrollOffset(Math.max(0, -el.getBoundingClientRect().top)); };
        measure();
        const on_resize = (): void => measure();
        const on_scroll = (): void => {
            if (throttle_ref.current !== null) { return; }
            throttle_ref.current = setTimeout(() => {
                throttle_ref.current = null;
                measure();
            }, SCROLL_MEASURE_THROTTLE_MS);
        };
        window.addEventListener('resize', on_resize);
        scroll_target.addEventListener('scroll', on_scroll, { passive: true });
        return () => {
            window.removeEventListener('resize', on_resize);
            scroll_target.removeEventListener('scroll', on_scroll);
            if (throttle_ref.current !== null) { clearTimeout(throttle_ref.current); }
        };
    }, [container_ref, setScrollOffset]);
    debug('lane scroll offset %dpx', scroll_offset);
    return { scroll_offset, setScrollOffset };
}
