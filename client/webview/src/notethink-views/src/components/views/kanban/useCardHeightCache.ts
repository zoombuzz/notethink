import { useCallback, useRef } from "react";
import { rowSizeFor } from "./virtualCardSizingOps";

/**
 * CardHeightCacheApi:
 * - getRowSize: the row size the lane should reserve for `stable_ids[index]`, in px
 * - reportMeasuredHeight: records a card's own measured height (not the row including the gap);
 *   calls `on_changed` only when the cached answer for that id actually moved
 */
export interface CardHeightCacheApi {
    getRowSize: (stable_ids: ReadonlyArray<string>, index: number) => number;
    reportMeasuredHeight: (stable_id: string, height: number, on_changed: () => void) => void;
}

/**
 * Per-lane measured-card-height cache, keyed by stable_id so it survives a reorder without a visible
 * jump. Kept in a ref, not state: `on_changed` tells the caller (VirtualizedKanbanColumn) to bump its
 * own state and recompute row offsets.
 */
export function useCardHeightCache(estimated_card_height: number | undefined): CardHeightCacheApi {
    const measured = useRef<Map<string, number>>(new Map());
    const getRowSize = useCallback((stable_ids: ReadonlyArray<string>, index: number): number => {
        const id = stable_ids[index];
        const known = id !== undefined ? measured.current.get(id) : undefined;
        return rowSizeFor(known, estimated_card_height);
    }, [estimated_card_height]);
    const reportMeasuredHeight = useCallback((stable_id: string, height: number, on_changed: () => void): void => {
        const rounded = Math.ceil(height);
        if (rounded <= 0) { return; }
        if (measured.current.get(stable_id) === rounded) { return; }
        measured.current.set(stable_id, rounded);
        on_changed();
    }, []);
    return { getRowSize, reportMeasuredHeight };
}
