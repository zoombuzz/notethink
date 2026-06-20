import Debug from "debug";
import { useLayoutEffect } from "react";

const debug = Debug("nodejs:notethink-views:useSyncedBodyClip");

// mirror useMarkdownNoteOverflow: clip when rendered height exceeds this multiple of width
const HEIGHT_RATIO = 1;

export interface SyncedBodyClipPolicy {
    is_top_level: boolean;
    is_dragging: boolean;
    auto_expand: boolean | undefined;
    focused: boolean | undefined;
    manually_expanded: boolean;
}

/**
 * Settle a top-level note body's overflow clip SYNCHRONOUSLY, in a layout effect that React runs before
 * any ancestor's layout effect - so the kanban FLIP host samples the already-clipped height.
 *
 * useMarkdownNoteOverflow owns the React state that drives the Show-more bars, but that state lands from a
 * PASSIVE effect a paint late. A card that just (re)mounted - notably one that changed kanban columns and
 * was remounted into the new Droppable - would otherwise be measured at FULL height for the exact frame the
 * FLIP samples, shoving its new siblings down by its whole unclipped height; the FLIP inverts that bogus
 * shift and the displaced cards visibly fly up above their slot then settle. Applying maxHeight here, in a
 * child layout effect, lands the clipped geometry before the FLIP reads getBoundingClientRect. We re-derive
 * overflow synchronously rather than wait for the passive state, and write only on change so a steady
 * re-render adds no extra layout flush.
 */
export function useSyncedBodyClip(body_ref: React.RefObject<HTMLDivElement | null>, policy: SyncedBodyClipPolicy): void {
    useLayoutEffect(() => {
        const el = body_ref.current;
        if (!el || !policy.is_top_level || policy.is_dragging) { return; }
        const width = el.offsetWidth;
        if (width === 0) { return; }
        const max_h = width * HEIGHT_RATIO;
        const clip = el.scrollHeight > max_h && (policy.auto_expand ? !policy.focused : !policy.manually_expanded);
        const max_height = clip ? `${max_h}px` : '';
        const overflow = clip ? 'hidden' : '';
        if (el.style.maxHeight !== max_height) { el.style.maxHeight = max_height; }
        if (el.style.overflow !== overflow) { el.style.overflow = overflow; }
    });
}
