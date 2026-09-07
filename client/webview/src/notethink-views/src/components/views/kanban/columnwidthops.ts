import Debug from "debug";

const debug = Debug("nodejs:notethink-views:columnwidthops");

/*
 * Column width derived from the shape you want the cards to be.
 *
 * A card's height is not independent of its width: the text reflows, so a narrower column runs the same
 * words taller. Model a card as pure reflowing text and its area is invariant - `h(w) = A / w` - which
 * makes the height-to-width ratio `rho = h / w = A / w^2`. Asking for a target ratio is therefore asking
 * for one width, and it falls out as a square root rather than a search:
 *
 *   w = sqrt(A / rho)
 *
 * That is the whole algorithm. `A` is measured once per content change from an off-screen clone of the
 * cards at a FIXED probe width, never from the live board - a reading taken at the width the answer just
 * set would feed straight back into the next answer - and everything after it is arithmetic: how many
 * columns of that width fit, and whether the leftover space is shared out or scrolled past.
 *
 * The model is deliberately the simple one, chosen over its refinement after both were tried. A card also
 * carries chrome that does not reflow - the heading, the padding, the border - so the true curve is
 * `h(w) = c + A / w`, and reading that chrome as text is why the probe width matters: probe wide and the
 * area is overstated, probe near the answer and the error is small. Fitting `c` out properly is available
 * and costs one more probe: measure at two widths, solve `A = (h1 - h2) / (1/w1 - 1/w2)` and
 * `c = h1 - A/w1`, then take the positive root of `rho*w^2 - c*w - A = 0`. Measured on a real board it
 * moves the answer by a few pixels, which is under what the eye reads, so it stays written down here
 * rather than built.
 */

// the ratios the drawer offers, height as a multiple of width; the band that reads well is roughly 1.2 to 1.5
export const CARD_RATIOS = [1, 1.2, 1.4, 1.6, 2, 2.5, 3];

export const DEFAULT_CARD_RATIO = 1.4;

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
 * The invariant area of the typical card, in px squared. Cards too small to have reflowed at all are
 * dropped: an empty lane's drop placeholder or a card mid-flight measures as a sliver and would drag the
 * median down to a width no real card wants.
 */
export function medianCardArea(cards: CardBox[]): number {
    const areas = cards.filter(box => box.width > 40 && box.height > 20).map(box => box.width * box.height);
    return medianOf(areas);
}

/**
 * The column width that lands the typical card near `ratio`. `lane_padding` is what the lane spends on
 * its own padding and border, which sits outside the card, so it is added back after the card's width is
 * solved rather than being folded into the reflow model. Returns undefined when nothing usable was
 * measured, which is the board's signal to keep its stylesheet fallback.
 */
export function targetColumnWidth(area: number, ratio: number, lane_padding: number): number | undefined {
    if (!(area > 0) || !(ratio > 0)) { return undefined; }
    const card_width = Math.sqrt(area / ratio);
    debug('area=%d ratio=%s -> card %dpx', Math.round(area), ratio, Math.round(card_width));
    return card_width + Math.max(lane_padding, 0);
}

/**
 * The height a card of `card_width` lands at when it hits the target ratio, which is the height the side
 * by side layout already produces for the typical card. Stacked, it becomes the height every card is sized
 * to instead - the same rule read along the other axis.
 */
export function targetCardHeight(card_width: number, ratio: number): number {
    return card_width * ratio;
}

/**
 * The width each card needs to stand `height` tall, keyed by card id.
 *
 * This is the transpose of the side by side layout, and the reason a stacked board needs one width per
 * card rather than one for all of them. Side by side, every card is the same WIDTH and a card holding
 * four times the text is four times as tall. Stacked, that would make the row as tall as its longest card
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
