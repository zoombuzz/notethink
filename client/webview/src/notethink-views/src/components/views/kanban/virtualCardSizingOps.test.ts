import { rowSizeFor, laneListHeight, totalContentHeight, rowOffsets, visibleRowRange, scrollOffsetForIndex, clampScrollOffset, laneNeedsVirtualization, DEFAULT_ESTIMATED_CARD_HEIGHT, CARD_ROW_GAP, MIN_LANE_LIST_HEIGHT, LANE_LIST_BOTTOM_MARGIN } from "./virtualCardSizingOps";

describe('rowSizeFor', () => {
    it('uses the measured height plus the gap', () => {
        expect(rowSizeFor(200, 180)).toBe(200 + CARD_ROW_GAP);
    });

    it('falls back to the lane target height when nothing has been measured yet', () => {
        expect(rowSizeFor(undefined, 180)).toBe(180 + CARD_ROW_GAP);
    });

    it('falls back to the flat estimate when neither a measurement nor a target height is known', () => {
        expect(rowSizeFor(undefined, undefined)).toBe(DEFAULT_ESTIMATED_CARD_HEIGHT + CARD_ROW_GAP);
    });
});

describe('laneListHeight', () => {
    it('subtracts the bottom margin from the available space', () => {
        expect(laneListHeight(500)).toBe(500 - LANE_LIST_BOTTOM_MARGIN);
    });

    it('never answers below the floor', () => {
        expect(laneListHeight(50)).toBe(MIN_LANE_LIST_HEIGHT);
    });

    it('answers the floor when nothing has been measured yet', () => {
        expect(laneListHeight(undefined)).toBe(MIN_LANE_LIST_HEIGHT);
    });

    it('answers the floor for a non-finite reading', () => {
        expect(laneListHeight(Number.NaN)).toBe(MIN_LANE_LIST_HEIGHT);
    });
});

describe('totalContentHeight', () => {
    it('sums every row', () => {
        expect(totalContentHeight([100, 150, 80])).toBe(330);
    });

    it('answers 0 for no rows (an empty column)', () => {
        expect(totalContentHeight([])).toBe(0);
    });
});

describe('rowOffsets', () => {
    it('gives each row the running sum of every row before it', () => {
        expect(rowOffsets([100, 150, 80])).toEqual([0, 100, 250]);
    });

    it('answers an empty array for no rows', () => {
        expect(rowOffsets([])).toEqual([]);
    });
});

describe('visibleRowRange', () => {
    it('answers an empty range for no rows', () => {
        expect(visibleRowRange([], 0, 300, 8)).toEqual({ start: 0, end: -1 });
    });

    it('mounts only the rows intersecting the viewport, padded by overscan', () => {
        // 10 rows at 100px each; a 250px viewport starting at 0 covers rows 0-2, padded by 1 either side
        const row_sizes = Array.from({ length: 10 }, () => 100);
        expect(visibleRowRange(row_sizes, 0, 250, 1)).toEqual({ start: 0, end: 3 });
    });

    it('slides the mounted window as the scroll offset moves', () => {
        const row_sizes = Array.from({ length: 10 }, () => 100);
        // rows 5-7 intersect [520, 770); padded by 1 either side
        expect(visibleRowRange(row_sizes, 520, 250, 1)).toEqual({ start: 4, end: 8 });
    });

    it('clamps the overscan padding to the list bounds at the start', () => {
        const row_sizes = Array.from({ length: 10 }, () => 100);
        expect(visibleRowRange(row_sizes, 0, 100, 8)).toEqual({ start: 0, end: 8 });
    });

    it('clamps the overscan padding to the list bounds at the end', () => {
        const row_sizes = Array.from({ length: 10 }, () => 100);
        expect(visibleRowRange(row_sizes, 900, 100, 8)).toEqual({ start: 1, end: 9 });
    });

    it('mounts the tail of the list when the offset has scrolled past every row', () => {
        const row_sizes = Array.from({ length: 10 }, () => 100);
        expect(visibleRowRange(row_sizes, 5000, 250, 2)).toEqual({ start: 7, end: 9 });
    });

    it('mounts the head of the list when the offset sits before every row', () => {
        const row_sizes = Array.from({ length: 10 }, () => 100);
        expect(visibleRowRange(row_sizes, -100, 0, 2)).toEqual({ start: 0, end: 2 });
    });
});

describe('scrollOffsetForIndex', () => {
    const row_sizes = Array.from({ length: 10 }, () => 100);

    it('leaves the offset unchanged when the row is already fully visible', () => {
        expect(scrollOffsetForIndex(row_sizes, 1, 0, 300)).toBe(0);
    });

    it('jumps to the row\'s own start when it sits above the current window', () => {
        // row 0 starts at 0, below a window currently at [400, 700)
        expect(scrollOffsetForIndex(row_sizes, 0, 400, 300)).toBe(0);
    });

    it('aligns the row\'s bottom edge with the viewport\'s when it sits below the current window', () => {
        // row 9 spans [900, 1000); a 300px viewport must end at 1000, so it starts at 700
        expect(scrollOffsetForIndex(row_sizes, 9, 0, 300)).toBe(700);
    });

    it('never answers a negative offset for a row near the top', () => {
        expect(scrollOffsetForIndex(row_sizes, 0, 0, 300)).toBe(0);
    });
});

describe('clampScrollOffset', () => {
    it('never answers below zero', () => {
        expect(clampScrollOffset(-50, 1000, 300)).toBe(0);
    });

    it('never answers past what the content has left to give', () => {
        expect(clampScrollOffset(5000, 1000, 300)).toBe(700);
    });

    it('leaves an in-range offset untouched', () => {
        expect(clampScrollOffset(400, 1000, 300)).toBe(400);
    });

    it('floors at zero when the content is shorter than the viewport', () => {
        expect(clampScrollOffset(50, 200, 300)).toBe(0);
    });
});

describe('laneNeedsVirtualization', () => {
    it('is false for an empty lane', () => {
        expect(laneNeedsVirtualization(0, 500)).toBe(false);
    });

    it('is false for a small fixture-sized lane that comfortably fits the ceiling', () => {
        // 2 cards at ~180px/row = 360px, well under a 900px ceiling
        expect(laneNeedsVirtualization(2, 900)).toBe(false);
    });

    /*
     * Regression guard: the estimate must come from the card's own measured height, not the board's
     * solved card-target height - a short two-line card is a fraction of that target, so estimating
     * from the target mis-virtualized it in a real fixture.
     */
    it('is false for a short lane even on a board whose solved card-target height is large', () => {
        expect(laneNeedsVirtualization(2, 675)).toBe(false);
    });

    it('is true once the estimated total exceeds the ceiling', () => {
        // 400 cards at ~180px/row = 72000px, nowhere near a 900px ceiling
        expect(laneNeedsVirtualization(400, 900)).toBe(true);
    });

    it('is exactly on the boundary at equal height (not virtualized - equal is not "exceeds")', () => {
        expect(laneNeedsVirtualization(5, 5 * (DEFAULT_ESTIMATED_CARD_HEIGHT + CARD_ROW_GAP))).toBe(false);
    });

    /*
     * Regression guard: falling back to the floored list_height (instead of treating undefined as "not
     * measured yet") spuriously virtualized a 2-card lane for one render, breaking a keyboard drag racing it.
     */
    it('is false before the board has ever been measured, however many cards the lane holds', () => {
        expect(laneNeedsVirtualization(400, undefined)).toBe(false);
        expect(laneNeedsVirtualization(2, undefined)).toBe(false);
    });
});
