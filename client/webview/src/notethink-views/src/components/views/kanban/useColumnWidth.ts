import Debug from "debug";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
    DEFAULT_CARD_RATIO,
    cardWidthsForHeight,
    medianCardArea,
    solveColumnLayout,
    targetCardHeight,
    targetColumnWidth,
    type CardBox,
} from "./columnwidthops";

const debug = Debug("nodejs:notethink-views:useColumnWidth");

// the lane gap, mirroring `.board { gap: 8px }` in ViewRenderer.module.scss; a solve needs the number the browser is already using
const BOARD_GAP = 8;

/*
 * The lane width the area is probed at. Fixed, and deliberately near the answer.
 *
 * Fixed is what matters most: an area read off the live board would be taken at whatever width the board
 * currently has, so applying the result would change the next reading, which is the feedback loop this
 * design exists to avoid. Near the answer matters because the area-only model treats a card as pure
 * reflowing text - a wide card is mostly heading and padding, and counting those as text overstated the
 * area enough to hand back columns half again too wide, measured on the real board before this was fixed.
 */
const PROBE_COLUMN_WIDTH = 200;

// what a lane and its card list publish themselves as, so the measurement finds them without importing a hashed class name
const LANE_SELECTOR = '[data-column-lane]';
const CARDS_SELECTOR = '[data-column-cards]';

// what the board stamps on each card so a per-card measurement can be handed back to the card it came from
const CARD_ID_ATTRIBUTE = 'data-column-card-id';

/**
 * The two widths a solve produces, in px.
 * - column: the lane's width when the lanes run side by side, after the fit-or-fill rule
 * - card: the card's own target width, which is what the ratio actually solves for
 */
export interface SolvedWidths {
    column: number;
    card: number;
    height: number;
    cardWidths: Record<string, number>;
}

/**
 * The measured shape of the typical card, cached against the content that produced it.
 * - area: the card's width times its height at the probe width, in px squared
 * - lane_padding: what the lane spends outside the card, so a solved card width becomes a column width
 */
interface CardModel {
    signature: string;
    area: number;
    lane_padding: number;
    boxes: CardBox[];
}

/**
 * Measure the cards at a fixed width by cloning them into an off-screen lane.
 *
 * The clone goes inside the board because the lane and card rules are descendant selectors under
 * `.viewKanban .board`, so a probe anywhere else would be styled by none of them and would measure a
 * different card. It is appended, measured and removed inside this one call, and the attributes that make
 * a node interesting to anything else - the FLIP ids, and the hooks this measurement itself looks for -
 * are stripped first, so nothing can observe the probe or mistake it for a real lane.
 */
function measureAtProbeWidth(board: HTMLElement): Omit<CardModel, 'signature'> | undefined {
    const lane = board.querySelector(LANE_SELECTOR);
    const cards = board.querySelectorAll(`${CARDS_SELECTOR} > *`);
    if (lane === null || cards.length === 0) { return undefined; }

    const probe_lane = lane.cloneNode(false) as HTMLElement;
    const probe_cards = document.createElement('div');
    probe_cards.className = lane.querySelector(CARDS_SELECTOR)?.className ?? '';
    cards.forEach(card => probe_cards.appendChild(card.cloneNode(true)));
    probe_lane.appendChild(probe_cards);
    probe_lane.removeAttribute('data-column-lane');
    probe_lane.removeAttribute('data-flip-column-id');
    probe_lane.querySelectorAll('[data-flip-id]').forEach(node => node.removeAttribute('data-flip-id'));
    Object.assign(probe_lane.style, {
        position: 'absolute',
        left: '-10000px',
        top: '0',
        width: `${PROBE_COLUMN_WIDTH}px`,
        minWidth: '0',
        maxWidth: 'none',
        flex: '0 0 auto',
        flexDirection: 'column',
        visibility: 'hidden',
        pointerEvents: 'none',
    });
    /*
     * Force the probe into the side by side layout whatever the board is doing, because the clone keeps
     * the lane's class and sits inside the live board, so the stacked rules reach it: they would lay its
     * cards along a row and size each one from `--nt-card-width`, which the cloned cards carry inline from
     * the last solve. The probe would then be measuring the widths it produced - the feedback loop the
     * fixed probe width exists to prevent, arriving through the clone instead of through the board.
     */
    Object.assign(probe_cards.style, { flexDirection: 'column', alignItems: 'stretch' });
    Array.prototype.forEach.call(probe_cards.children, (card: Element) => {
        Object.assign((card as HTMLElement).style, { flex: '0 0 auto', width: '100%', maxHeight: 'none' });
        (card as HTMLElement).style.removeProperty('--nt-card-width');
    });

    // the clone order is the query order, so the live card at index i is the one the probe measured at index i
    const ids = Array.prototype.map.call(cards, (node: Element) => node.getAttribute(CARD_ID_ATTRIBUTE) ?? undefined) as Array<string | undefined>;
    board.appendChild(probe_lane);
    const boxes: CardBox[] = Array.prototype.map.call(probe_cards.children, (node: Element, index: number) => {
        const rect = node.getBoundingClientRect();
        return { id: ids[index], width: rect.width, height: rect.height };
    }) as CardBox[];
    // both boxes are read rather than assumed, so the gap between them is whatever the stylesheet actually spends
    const card_width = boxes.reduce((widest, box) => Math.max(widest, box.width), 0);
    const lane_width = probe_lane.getBoundingClientRect().width;
    board.removeChild(probe_lane);

    const area = medianCardArea(boxes);
    if (area <= 0 || card_width <= 0) { return undefined; }
    return { area, lane_padding: Math.max(lane_width - card_width, 0), boxes };
}

/**
 * The board's column width, measured from its own cards.
 *
 * Two measurements with quite different lifetimes, which is the whole reason this is a hook rather than a
 * calculation. The typical card's AREA is a property of the notes, so it is probed at a fixed width once
 * per content change and cached. The board's available WIDTH changes constantly and is watched, but only
 * arithmetic hangs off it, so a resize costs no measurement and cannot disturb the model.
 *
 * Returns undefined until a measurement lands, and whenever the ratio is off, which is the board's signal
 * to leave the stylesheet's own fallback widths in place rather than render a guess.
 * - signature: changes exactly when the rendered cards change, and is what invalidates the cached model
 */
function useColumnWidth(
    board_ref: RefObject<HTMLDivElement | null>,
    ratio: number | undefined,
    lane_count: number,
    signature: string,
): SolvedWidths | undefined {
    const [model, setModel] = useState<CardModel | undefined>(undefined);
    const [available, setAvailable] = useState<number>(0);
    const model_ref = useRef(model);
    model_ref.current = model;

    /*
     * `available` is a dependency so a failed probe gets another go. A board measured before its first
     * real layout has nothing to read, and storing nothing meant the effect never ran again for that
     * signature - the board sat on the stylesheet fallback until the notes themselves changed. The failure
     * is recorded as a zero area instead, which is a state the next resize is allowed to replace.
     */
    useEffect(() => {
        const board = board_ref.current;
        if (board === null) { return; }
        const cached = model_ref.current;
        if (cached?.signature === signature && cached.area > 0) { return; }
        const measured = measureAtProbeWidth(board);
        if (measured === undefined) {
            if (cached?.signature !== signature) { setModel({ signature, area: 0, lane_padding: 0, boxes: [] }); }
            return;
        }
        debug('probed at %dpx: area %d, lane padding %d', PROBE_COLUMN_WIDTH, Math.round(measured.area), Math.round(measured.lane_padding));
        setModel({ ...measured, signature });
    }, [board_ref, signature, available]);

    // the board's own width, which every resize of the panel or the editor group changes
    useEffect(() => {
        const board = board_ref.current;
        if (board === null || typeof ResizeObserver === 'undefined') { return; }
        const observer = new ResizeObserver(() => setAvailable(board.clientWidth));
        observer.observe(board);
        setAvailable(board.clientWidth);
        return () => observer.disconnect();
    }, [board_ref]);

    if (ratio === undefined || model === undefined || model.area <= 0 || available <= 0) { return undefined; }
    const target = targetColumnWidth(model.area, ratio, model.lane_padding);
    if (target === undefined) { return undefined; }
    const card = Math.max(target - model.lane_padding, 1);
    const height = targetCardHeight(card, ratio);
    return {
        column: solveColumnLayout(target, available, lane_count, BOARD_GAP).width,
        card,
        height,
        cardWidths: cardWidthsForHeight(model.boxes, height, card),
    };
}

/**
 * What the board publishes: a style for the board itself, and a width for each card the stacked layout
 * sizes individually.
 *
 * Both orientations size a card by the ratio - what differs is which of its two dimensions the ratio
 * pins. Side by side, every card is the same WIDTH and the lane carries it, so one number serves the
 * whole board and a wordy card is simply taller. Stacked, every card is the same HEIGHT, which is the
 * same rule read along the other axis and cannot be one number: a card's width has to be solved from its
 * own text, or the row ends up as tall as its longest card with every other card floating in the gap.
 *
 * The per-card widths are custom properties on the cards themselves, so the board's own value stays as
 * the fallback for a card added since the last measurement. The height is one number for the whole board,
 * because it is the dimension every stacked card shares - and it is handed to the card rather than set on
 * it, because a card already owns a clip of its own and an outer cap only fights it.
 */
export interface BoardWidths {
    style: CSSProperties | undefined;
    cardWidths: Record<string, number>;
    cardHeight: number | undefined;
}

export function useBoardColumnStyle(
    board_ref: RefObject<HTMLDivElement | null>,
    lanes_side_by_side: boolean,
    ratio: number | undefined,
    lane_count: number,
    signature: string,
): BoardWidths {
    const solved = useColumnWidth(board_ref, ratio ?? DEFAULT_CARD_RATIO, lane_count, signature);
    if (solved === undefined) { return { style: undefined, cardWidths: {}, cardHeight: undefined }; }
    // a custom property is not in React's CSSProperties, so the record is built untyped and asserted once
    const custom: Record<string, string> = lanes_side_by_side
        ? { '--nt-column-width': `${solved.column.toFixed(1)}px` }
        : { '--nt-card-width': `${solved.card.toFixed(1)}px` };
    return {
        style: custom as CSSProperties,
        cardWidths: lanes_side_by_side ? {} : solved.cardWidths,
        cardHeight: lanes_side_by_side ? undefined : solved.height,
    };
}
