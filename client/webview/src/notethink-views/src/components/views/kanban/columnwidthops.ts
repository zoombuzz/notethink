/*
 * Lane breadth is a setting, and the ratio only shapes the card.
 *
 * `lineBreadth` is the pixel breadth of one lane: its width when the lanes run side by side, its height when
 * they are stacked. It is a minimum rather than an exact size - lanes that all fit still spread to fill the
 * board - and it is the one number the drawer's text box shows and a dragged lane boundary sets. The card
 * ratio then decides how tall a card stands at the width it is drawn at, and a card holding more than that
 * clips its own body to reach it. Stacked, the same rule runs along the other axis: a row is `lineBreadth`
 * tall, and each card's width is solved from its own text so the row is one card high whatever it holds.
 *
 * Nothing here reads the DOM, which is what keeps the drag arithmetic and the fill rule testable.
 */

// the ratios the drawer offers, height over width; the band that reads well is 1.2 to 1.5
export const CARD_RATIOS = [1, 1.2, 1.4, 1.6, 2, 2.5, 3];

export const DEFAULT_CARD_RATIO = 1.4;

// the breadth a lane starts at, measured from the layout it replaced: 3 lanes on a 760px board, 7 on 1590px
export const DEFAULT_LINE_BREADTH = 220;

// the narrowest a lane may be dragged or typed to; below it a card has no room to hold a line of text
export const MIN_LINE_BREADTH = 120;

// the pixels one arrow key nudges a lane boundary, and one with shift held
export const BREADTH_NUDGE = 10;
export const BREADTH_NUDGE_LARGE = 50;

/**
 * One card as measured on screen, its border box in px.
 * - id: what the board calls this card, so a per-card answer can be handed back to the right one
 */
export interface CardBox {
    id?: string;
    width: number;
    height: number;
}

/**
 * What a solved layout tells the board.
 * - width: the width every rendered column takes, in px
 * - fit: how many whole columns of that width the board holds
 * - scrolls: true when the lanes do not all fit, so the board scrolls rather than filling
 */
export interface ColumnLayout {
    width: number;
    fit: number;
    scrolls: boolean;
}

/**
 * One lane's cards, narrowed to what a signature needs.
 */
export interface LaneCards {
    value: string;
    child_notes?: Array<{ stable_id?: string }>;
}

/**
 * A string that changes exactly when the measurement would come out different, and is what invalidates a
 * cached one. Keyed on which cards are on the board rather than on what they say: an edit changes a card's
 * area a little, and re-measuring mid-keystroke would resize every lane as the user types. Adding,
 * removing or moving a card is the change worth paying a measurement for.
 *
 * `layout` is in there because a card is not the same card in every layout - a sticky draws nothing like a
 * full card, and the orientation decides which axis the probe has to neutralise. Without it a board that
 * opened stacked kept serving that measurement after a flip to columns, and the ratio setting moved
 * nothing at all.
 */
export function cardSignature(lanes: LaneCards[], layout: string): string {
    const cards = lanes.map(lane => `${lane.value}:${(lane.child_notes ?? []).map(note => note.stable_id ?? '?').join(',')}`).join('|');
    return `${layout}#${cards}`;
}

/** the middle value of a list, which is the card the width is chosen for; one outsized note must not widen every lane beside it */
export function medianOf(values: number[]): number {
    if (values.length === 0) { return 0; }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The typical card's area at the probe width, in px squared, which stacked lanes read to size each card's
 * width and which doubles as the test that a probe measured anything. Cards too small to have reflowed at all are
 * dropped: an empty lane's drop placeholder or a card mid-flight measures as a sliver and would drag the
 * median down to a width no real card wants.
 */
export function medianCardArea(cards: CardBox[]): number {
    const areas = cards.filter(box => box.width > 40 && box.height > 20).map(box => box.width * box.height);
    return medianOf(areas);
}

/**
 * The height a card of `card_width` lands at when it hits the target ratio, which is what both
 * orientations aim every card at. Side by side it is the shape of the card itself: a card holding more
 * than fits clips its own body to reach it, and one holding less is left short. Stacked it is the single
 * height a whole row shares - the same rule read along the other axis - and each card's width is solved
 * back out of it.
 */
export function targetCardHeight(card_width: number, ratio: number): number {
    return card_width * ratio;
}

/**
 * The width each card needs to stand `height` tall, keyed by card id.
 *
 * This is the transpose of the side by side layout, and the reason a stacked board needs one width per
 * card rather than one for all of them. Side by side, every card is the same WIDTH and a card holding
 * four times the text stands at the target height with the rest of its body clipped away, so the one
 * width is the whole answer. Stacked, a single width would make the row as tall as its longest card
 * and leave every other card in a band of empty space, which is what a uniform width actually produced.
 * Fixing the height instead and solving `w = A / h` per card makes the long card four times as WIDE and
 * exactly as tall as its neighbours, so the row is one card high whatever is in it.
 *
 * The transpose is not quite symmetric, and `min_width` is where it stops being so. Text has a shortest
 * useful line and no shortest useful height, so a card holding one sentence is happily 95px tall side by
 * side and unreadable at the 67px the same arithmetic hands it stacked. The floor is the width the side
 * by side layout would have given that card anyway, so it needs no number of its own: below-median cards
 * come out exactly as wide as they would have been, above-median cards get wider, and the row stays one
 * card high because a card under its share of the height is stretched to the row rather than left short.
 *
 * A card with no id is skipped rather than guessed at: the board falls back to the shared width for it,
 * which is the same answer a card that has not been measured yet gets.
 */
export function cardWidthsForHeight(cards: CardBox[], height: number, min_width: number): Record<string, number> {
    const widths: Record<string, number> = {};
    if (!(height > 0)) { return widths; }
    for (const card of cards) {
        if (card.id === undefined || card.width <= 0 || card.height <= 0) { continue; }
        widths[card.id] = Math.max((card.width * card.height) / height, min_width);
    }
    return widths;
}

/**
 * What the board does with the width it has, given the width one column wants.
 *
 * Two outcomes, and the second is the point of the whole feature. When the lanes all fit they share the
 * slack and fill the board, so three lanes on a wide panel are three wide lanes rather than three narrow
 * ones beside an empty strip. When they do not, every column sits at its target and the board scrolls,
 * so widening the panel reveals more lanes instead of fattening the ones already showing.
 */
export function solveColumnLayout(target: number, available: number, lane_count: number, gap: number): ColumnLayout {
    const width = Math.max(target, 1);
    const fit = Math.max(1, Math.floor((available + gap) / (width + gap)));
    if (lane_count > 0 && fit >= lane_count) {
        const spread = (available - gap * (lane_count - 1)) / lane_count;
        return { width: Math.max(width, spread), fit: lane_count, scrolls: false };
    }
    return { width, fit, scrolls: true };
}


/**
 * A lane breadth held to the floor. Anything that is not a finite number answers the default, so a
 * corrupt saved value can never collapse the board.
 */
export function clampBreadth(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) { return DEFAULT_LINE_BREADTH; }
    return Math.max(Math.round(value), MIN_LINE_BREADTH);
}

/**
 * What the drawer's text box makes of what was typed: a whole number of pixels held to the floor, or
 * undefined when it is not a number at all, which is the caller's signal to leave the setting alone.
 */
export function parseBreadthInput(text: string): number | undefined {
    const trimmed = text.trim();
    if (trimmed === '' || !/^-?\d+(\.\d+)?(px)?$/i.test(trimmed)) { return undefined; }
    return clampBreadth(parseFloat(trimmed));
}

/**
 * The breadth a dragged boundary implies. The boundary sits in the middle of the gap after `lanes_before`
 * lanes, so the pointer, measured from the board's start with its scroll added back, is over that many lane
 * breadths and one gap fewer between them plus half the gap it is standing in. Solving for the breadth
 * keeps the boundary under the pointer for as long as the lanes are not being filled out.
 */
export function breadthFromPointer(offset: number, lanes_before: number, gap: number): number {
    const count = Math.max(lanes_before, 1);
    return clampBreadth((offset - gap / 2 - gap * (count - 1)) / count);
}

/**
 * The breadth after an arrow key. `direction` is +1 to grow and -1 to shrink, and the result is held to
 * the floor, so a keyboard user cannot reach a value the pointer could not.
 */
export function nudgeBreadth(breadth: number, direction: 1 | -1, large: boolean): number {
    return clampBreadth(breadth + direction * (large ? BREADTH_NUDGE_LARGE : BREADTH_NUDGE));
}
