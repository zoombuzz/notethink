import {
    CARD_RATIOS,
    DEFAULT_CARD_RATIO,
    cardSignature,
    cardWidthsForHeight,
    medianCardArea,
    medianOf,
    solveColumnLayout,
    targetCardHeight,
    targetColumnWidth,
} from './columnwidthops';

describe('medianOf', () => {

    it('takes the middle of an odd list and the upper middle of an even one', () => {
        expect(medianOf([3, 1, 2])).toBe(2);
        expect(medianOf([1, 2, 3, 4])).toBe(3);
    });

    it('answers zero for an empty list, which is what makes an unmeasured board fall back', () => {
        expect(medianOf([])).toBe(0);
    });

    it('does not reorder the caller\'s list', () => {
        const values = [3, 1, 2];
        medianOf(values);
        expect(values).toEqual([3, 1, 2]);
    });
});

describe('medianCardArea', () => {

    it('is the middle card\'s area, so one outsized note does not widen every lane beside it', () => {
        const area = medianCardArea([
            { width: 200, height: 100 },
            { width: 200, height: 200 },
            { width: 200, height: 4000 },
        ]);
        expect(area).toBe(200 * 200);
    });

    /*
     * A drop placeholder and a card mid-flight both measure as slivers. Counting them would pull the
     * median down to an area no real card has, and the board would settle at a width nothing wanted.
     */
    it('ignores boxes too small to be a card that has reflowed', () => {
        expect(medianCardArea([
            { width: 4, height: 4 },
            { width: 200, height: 300 },
            { width: 200, height: 1 },
        ])).toBe(200 * 300);
    });

    it('answers zero when nothing measurable is on the board yet', () => {
        expect(medianCardArea([])).toBe(0);
        expect(medianCardArea([{ width: 0, height: 0 }])).toBe(0);
    });
});

describe('targetColumnWidth', () => {

    /*
     * The whole algorithm in one assertion: a card holding 240x480 of text is at ratio 2, and asking for
     * ratio 2 back must return the width it already has. sqrt(115200 / 2) = 240.
     */
    it('returns the width a card at that ratio already has', () => {
        expect(targetColumnWidth(240 * 480, 2, 0)).toBeCloseTo(240, 5);
    });

    it('widens the column as the target ratio drops, since a shorter card is a wider one', () => {
        const tall = targetColumnWidth(100000, 3, 0) as number;
        const square = targetColumnWidth(100000, 1, 0) as number;
        expect(square).toBeGreaterThan(tall);
        // area is fixed, so halving the ratio widens by sqrt(2) rather than doubling
        expect((targetColumnWidth(100000, 1, 0) as number) / (targetColumnWidth(100000, 2, 0) as number)).toBeCloseTo(Math.SQRT2, 5);
    });

    it('adds the lane padding back, because that sits outside the card the ratio is about', () => {
        expect(targetColumnWidth(240 * 480, 2, 26)).toBeCloseTo(266, 5);
    });

    it('answers undefined when there is nothing to solve, which leaves the stylesheet width alone', () => {
        expect(targetColumnWidth(0, 2, 26)).toBeUndefined();
        expect(targetColumnWidth(-1, 2, 26)).toBeUndefined();
        expect(targetColumnWidth(100000, 0, 26)).toBeUndefined();
    });

    it('offers a default that is one of the ratios the drawer lists', () => {
        expect(CARD_RATIOS).toContain(DEFAULT_CARD_RATIO);
    });
});

describe('solveColumnLayout', () => {

    it('spreads the lanes to fill the board when they all fit', () => {
        const layout = solveColumnLayout(200, 1000, 3, 8);
        expect(layout.scrolls).toBe(false);
        expect(layout.fit).toBe(3);
        // (1000 - 2 gaps) / 3
        expect(layout.width).toBeCloseTo(328, 0);
    });

    /*
     * The point of the feature: past the point where the lanes fit, a wider board must reveal more of
     * them rather than fatten the ones already showing, so the width stays pinned at the target.
     */
    it('holds every column at its target and scrolls when the lanes do not all fit', () => {
        const layout = solveColumnLayout(200, 500, 6, 8);
        expect(layout.scrolls).toBe(true);
        expect(layout.width).toBe(200);
        expect(layout.fit).toBe(2);
    });

    it('reveals one more lane per target-width of board, without changing the column width', () => {
        const narrow = solveColumnLayout(200, 500, 9, 8);
        const wider = solveColumnLayout(200, 800, 9, 8);
        expect(wider.fit).toBeGreaterThan(narrow.fit);
        expect(wider.width).toBe(narrow.width);
    });

    it('never reports fewer than one column, however narrow the board gets', () => {
        expect(solveColumnLayout(200, 40, 5, 8).fit).toBe(1);
    });

    it('leaves an unmeasured board alone rather than dividing by a lane count of zero', () => {
        const layout = solveColumnLayout(200, 800, 0, 8);
        expect(layout.scrolls).toBe(true);
        expect(layout.width).toBe(200);
    });
});

describe('cardSignature', () => {

    it('changes when a card moves lane, which is a change worth re-measuring for', () => {
        const before = cardSignature([
            { value: 'doing', child_notes: [{ stable_id: 'a' }, { stable_id: 'b' }] },
            { value: 'done', child_notes: [] },
        ], 'columns/card');
        const after = cardSignature([
            { value: 'doing', child_notes: [{ stable_id: 'a' }] },
            { value: 'done', child_notes: [{ stable_id: 'b' }] },
        ], 'columns/card');
        expect(after).not.toBe(before);
    });

    it('is stable across a re-render that changed nothing', () => {
        const lanes = [{ value: 'doing', child_notes: [{ stable_id: 'a' }] }];
        expect(cardSignature(lanes, 'columns/card')).toBe(cardSignature([{ value: 'doing', child_notes: [{ stable_id: 'a' }] }], 'columns/card'));
    });

    /*
     * A card is not the same card in every layout, and a measurement taken under one must not be served
     * to the other. A board that opened stacked kept its stacked measurement after a flip to columns, and
     * the ratio setting then moved nothing at all.
     */
    it('changes when the orientation or the card type changes, since the same cards measure differently', () => {
        const lanes = [{ value: 'doing', child_notes: [{ stable_id: 'a' }] }];
        expect(cardSignature(lanes, 'rows/card')).not.toBe(cardSignature(lanes, 'columns/card'));
        expect(cardSignature(lanes, 'columns/sticky')).not.toBe(cardSignature(lanes, 'columns/card'));
    });

    it('tolerates a lane with no cards and a card with no stable id', () => {
        expect(cardSignature([{ value: 'todo' }], 'columns/card')).toBe('columns/card#todo:');
        expect(cardSignature([{ value: 'todo', child_notes: [{}] }], 'columns/card')).toBe('columns/card#todo:?');
    });
});

describe('the stacked transpose', () => {

    /*
     * The two layouts are one rule read along different axes, and the median card is where they meet: the
     * height it lands at side by side is the height every card is sized to when the lanes stack, so that
     * card comes out the same shape either way round.
     */
    it('takes the height the side by side layout already produces for the typical card', () => {
        const width = targetColumnWidth(240 * 480, 2, 0) as number;
        expect(targetCardHeight(width, 2)).toBeCloseTo(480, 5);
    });

    it('leaves the median card exactly as wide as it is side by side', () => {
        const area = 240 * 480;
        const width = targetColumnWidth(area, 2, 0) as number;
        const widths = cardWidthsForHeight([{ id: 'median', width: 240, height: 480 }], targetCardHeight(width, 2), width);
        expect(widths.median).toBeCloseTo(width, 5);
    });

    /*
     * The point of solving per card. Side by side a card holding four times the text is four times as
     * TALL, which stacked would make the row four times as tall as it needs to be and leave every other
     * card floating in the gap; stacked, the same card is four times as WIDE and no taller than its
     * neighbours.
     */
    it('makes a card holding four times the text four times as wide, not four times as tall', () => {
        const widths = cardWidthsForHeight([
            { id: 'typical', width: 200, height: 300 },
            { id: 'long', width: 200, height: 1200 },
        ], 300, 1);
        expect(widths.long / widths.typical).toBeCloseTo(4, 5);
    });

    it('floors a short card at the width it would have had side by side, since text has a shortest useful line', () => {
        const widths = cardWidthsForHeight([{ id: 'short', width: 200, height: 20 }], 400, 174);
        expect(widths.short).toBe(174);
    });

    it('skips a card with no id, leaving the board to fall back to its shared width', () => {
        expect(cardWidthsForHeight([{ width: 200, height: 300 }], 300, 1)).toEqual({});
    });

    it('answers with nothing when there is no height to solve against', () => {
        expect(cardWidthsForHeight([{ id: 'a', width: 200, height: 300 }], 0, 1)).toEqual({});
    });
});
