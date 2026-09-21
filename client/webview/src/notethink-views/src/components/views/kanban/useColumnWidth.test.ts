import { renderHook } from "@testing-library/react";
import { MIN_LINE_BREADTH } from "./columnwidthops";
import { useBoardColumnStyle, type BoardWidths } from "./useColumnWidth";

/*
 * What the board hands its cards, driven through the hook against a mocked layout.
 *
 * jsdom lays nothing out and reflows no text, so every box here is the one the rect mock reports rather
 * than one a browser measured: the card shape is an input, not a finding. That is enough for the question
 * these tests ask, which is what the hook DOES with the breadth setting - which lane width it solves, and
 * which width the ratio is applied to. Whether a real card then lands on that ratio is a question about
 * reflowed text, and playwright/specs/kanban-card-ratio.spec.ts asks it in a browser.
 */

// the border box every probed card reports, so the model's area is this card's area
const CARD_WIDTH = 200;
const CARD_HEIGHT = 300;

// what a lane spends outside its cards, mirroring the stylesheet's 12px of padding and 1px of border a side
const LANE_PADDING = 26;

// wide enough that every lane in the tests fits and spreads to fill, where the drawn width leaves the breadth behind
const FILLING_BOARD_WIDTH = 1000;

// too narrow for all four lanes at the test breadth, so each holds the breadth and the board scrolls
const SCROLLING_BOARD_WIDTH = 700;

// the breadth the tests set, wide enough that two lanes fit the scrolling board and four do not
const BREADTH = 300;

/** a DOMRect of the given size at the origin, which is all any of this reads off one */
function rectOf(width: number, height: number): DOMRect {
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} } as DOMRect;
}

/** one lane carrying the two attributes the measurement looks for, plus a card per id */
function buildLane(card_ids: string[]): HTMLDivElement {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.setAttribute('data-column-lane', '');
    // the stylesheet's padding and border, which the hook reads back off the lane's computed style
    Object.assign(lane.style, { paddingLeft: '12px', paddingRight: '12px', paddingTop: '12px', paddingBottom: '12px' });
    Object.assign(lane.style, { borderLeftWidth: '1px', borderRightWidth: '1px', borderTopWidth: '1px', borderBottomWidth: '1px' });
    const cards = document.createElement('div');
    cards.setAttribute('data-column-cards', '');
    for (const id of card_ids) {
        const card = document.createElement('div');
        card.setAttribute('data-column-card-id', id);
        cards.appendChild(card);
    }
    lane.appendChild(cards);
    return lane;
}

/** a board of those lanes, with the width a ResizeObserver would have reported defined on it */
function buildBoard(lanes: string[][], board_width: number): HTMLDivElement {
    const board = document.createElement('div');
    for (const card_ids of lanes) {
        board.appendChild(buildLane(card_ids));
    }
    Object.defineProperty(board, 'clientWidth', { value: board_width, configurable: true });
    document.body.appendChild(board);
    return board;
}

/** enough of a ResizeObserver for the hook to read the board's width once; nothing here fires a callback */
class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

/** the solve for one board, as the hook publishes it to the board and its cards */
function solveBoard(board: HTMLDivElement, side_by_side: boolean, ratio: number, lane_count: number, breadth = BREADTH): BoardWidths {
    const board_ref = { current: board };
    const { result } = renderHook(() => useBoardColumnStyle(board_ref, side_by_side, ratio, breadth, lane_count, 'one-board'));
    return result.current;
}

/** the lane width the board published, which is what its cards are drawn at once the lane padding is off */
function publishedColumnWidth(published: BoardWidths): number {
    const custom = published.style as Record<string, string> | undefined;
    return parseFloat(custom?.['--nt-column-width'] ?? '0');
}

/** the target height the board published, as a number a test can do arithmetic on */
function publishedCardHeight(published: BoardWidths): number {
    return published.cardHeight ?? 0;
}

describe('useBoardColumnStyle', () => {
    let original_grbc: typeof Element.prototype.getBoundingClientRect;
    let original_resize_observer: typeof globalThis.ResizeObserver;

    beforeEach(() => {
        original_grbc = Element.prototype.getBoundingClientRect;
        original_resize_observer = globalThis.ResizeObserver;
        // a card reports one fixed box and a lane reports that box plus its own padding; nothing else has a size
        Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
            if (this.hasAttribute('data-column-card-id')) { return rectOf(CARD_WIDTH, CARD_HEIGHT); }
            if (this.classList.contains('lane')) { return rectOf(CARD_WIDTH + LANE_PADDING, CARD_HEIGHT); }
            return rectOf(0, 0);
        };
        globalThis.ResizeObserver = StubResizeObserver as unknown as typeof globalThis.ResizeObserver;
    });

    afterEach(() => {
        Element.prototype.getBoundingClientRect = original_grbc;
        globalThis.ResizeObserver = original_resize_observer;
        document.body.innerHTML = '';
    });

    /*
     * The claim the setting makes side by side: the ratio is the shape of the card, at the width the card
     * is actually drawn at.
     */
    it('hands a side by side board a target height of the width its cards are drawn at times the ratio', () => {
        const board = buildBoard([['a'], ['b'], ['c'], ['d']], SCROLLING_BOARD_WIDTH);
        const published = solveBoard(board, true, 1.4, 4);
        expect(published.cardHeight).toBeCloseTo((BREADTH - LANE_PADDING) * 1.4, 5);
    });

    it('takes the breadth setting as the lane width when the lanes do not all fit', () => {
        const board = buildBoard([['a'], ['b'], ['c'], ['d']], SCROLLING_BOARD_WIDTH);
        expect(publishedColumnWidth(solveBoard(board, true, 1.4, 4))).toBe(BREADTH);
    });

    /*
     * A board whose lanes all fit spreads them over the slack, so the card is drawn wider than the breadth.
     * The height has to follow the width the card really has or the spread would flatten every card on a
     * wide board.
     */
    it('spreads the lanes to fill the board when they all fit, and follows the drawn width', () => {
        const board = buildBoard([['a']], FILLING_BOARD_WIDTH);
        const published = solveBoard(board, true, 1.4, 1);
        expect(publishedColumnWidth(published)).toBeCloseTo(FILLING_BOARD_WIDTH, 5);
        expect(published.cardHeight).toBeCloseTo((FILLING_BOARD_WIDTH - LANE_PADDING) * 1.4, 5);
    });

    it('does not let the ratio choose the lane width, only the card height', () => {
        const board = buildBoard([['a'], ['b'], ['c'], ['d']], SCROLLING_BOARD_WIDTH);
        const square = solveBoard(board, true, 1, 4);
        const tall = solveBoard(board, true, 3, 4);
        expect(publishedColumnWidth(tall)).toBe(publishedColumnWidth(square));
        expect(publishedCardHeight(tall) / publishedCardHeight(square)).toBeCloseTo(3, 5);
    });

    it('treats a breadth under the floor as the floor', () => {
        // eight lanes at the floor still overflow the board, so the floor is what they hold rather than a spread
        const board = buildBoard(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => [id]), SCROLLING_BOARD_WIDTH);
        expect(publishedColumnWidth(solveBoard(board, true, 1.4, 8, 10))).toBe(MIN_LINE_BREADTH);
    });

    /*
     * Stacked, the breadth is the row's height: a card stands it less the lane's padding, and no card is
     * narrower than the width that height needs to stand on the ratio.
     */
    it('stands a stacked card the row height less the lane padding', () => {
        const board = buildBoard([['a'], ['b']], SCROLLING_BOARD_WIDTH);
        const published = solveBoard(board, false, 1.4, 2);
        expect(publishedCardHeight(published)).toBe(BREADTH - LANE_PADDING);
        const custom = published.style as Record<string, string>;
        expect(parseFloat(custom['--nt-row-height'])).toBe(BREADTH);
    });

    it('floors every stacked card at height over ratio, so none is narrower than a card standing on the ratio', () => {
        const board = buildBoard([['a'], ['b']], SCROLLING_BOARD_WIDTH);
        const published = solveBoard(board, false, 1.4, 2);
        const floor = (BREADTH - LANE_PADDING) / 1.4;
        expect(Object.keys(published.cardWidths).sort()).toEqual(['a', 'b']);
        for (const width of Object.values(published.cardWidths)) {
            expect(width).toBeGreaterThanOrEqual(floor - 1e-6);
        }
        const custom = published.style as Record<string, string>;
        expect(parseFloat(custom['--nt-card-width'])).toBeCloseTo(floor, 1);
    });

    it('publishes no height while the board has nothing to measure, so the stylesheet keeps its fallback', () => {
        const board = buildBoard([], FILLING_BOARD_WIDTH);
        expect(solveBoard(board, true, 1.4, 0).cardHeight).toBeUndefined();
    });
});
