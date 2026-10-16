import Debug from "debug";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
    DEFAULT_CARD_RATIO,
    clampBreadth,
    cardWidthsForHeight,
    medianCardArea,
    solveColumnLayout,
    targetCardHeight,
    type CardBox,
} from "./columnwidthops";

const debug = Debug("nodejs:notethink-views:useColumnWidth");

// the group gap, which the stylesheet spends on a separator element between groups: a solve needs the same number
export const BOARD_GAP = 8;

/*
 * The group width the stacked layout probes each card's text at. Fixed: a reading taken off the live board
 * would be taken at whatever width the board currently has, so applying the result would change the next
 * reading, which is a feedback loop.
 */
const PROBE_COLUMN_WIDTH = 200;

// what a group and its card list publish, so the measurement needs no hashed class name
const GROUP_SELECTOR = '[data-column-group]';
const CARDS_SELECTOR = '[data-column-cards]';

// what the board stamps on each card, so a measurement goes back to the card it came from
const CARD_ID_ATTRIBUTE = 'data-column-card-id';

/**
 * What one solve produces, in px.
 * - column: the group's width when the groups run side by side, after the fit-or-fill rule
 * - card: the card's own width when the groups are stacked, which is the row's height over the ratio
 * - height: the height every card aims at: the drawn group width times the ratio side by side, the row
 *   height less the group's padding stacked
 * - cardWidths: the width each card needs to stand `height` tall, keyed by card id, for a stacked group
 */
export interface SolvedWidths {
    column: number;
    card: number;
    height: number;
    cardWidths: Record<string, number>;
}

/**
 * The measured text of the board's cards, cached against the content that produced it, for the stacked
 * layout's per-card widths.
 * - area: the median card's width times its height at the probe width, in px squared
 * - boxes: every card's border box at the probe width, whole note and no clip
 */
interface CardModel {
    signature: string;
    area: number;
    boxes: CardBox[];
}

/**
 * Strip a cloned card back to what the note holds, rather than what the board last decided to show of it.
 *
 * Two inline values come off. The card's own width is what the stacked layout wrote from the last solve,
 * so leaving it would have the probe measure its own output. The body's max-height is the clip cut from
 * the target height this very measurement produces, and it arrives through the clone as the same feedback
 * loop by another route - what the solve needs to know is how much text the note holds, which is one
 * number whatever is on screen.
 */
function unclipProbeCard(card: HTMLElement): void {
    Object.assign(card.style, { flex: '0 0 auto', width: '100%', maxHeight: 'none' });
    card.style.removeProperty('--nt-card-width');
    card.querySelectorAll<HTMLElement>('[style]').forEach(node => {
        if (node.style.maxHeight === '') { return; }
        node.style.removeProperty('max-height');
        node.style.removeProperty('overflow');
    });
}

/**
 * Measure the cards at a fixed width by cloning them into an off-screen group.
 *
 * The clone goes inside the board because the group and card rules are descendant selectors under
 * `.viewKanban .board`, so a probe anywhere else would be styled by none of them and would measure a
 * different card. It is appended, measured and removed inside this one call, and the attributes that make
 * a node interesting to anything else - the FLIP ids, and the hooks this measurement itself looks for -
 * are stripped first, so nothing can observe the probe or mistake it for a real group.
 *
 * What it reads is the whole note, not the part the board is currently showing: every clone is stripped
 * back to its content first, because the clip a card wears is cut from the very height this measurement
 * produces.
 */
function measureAtProbeWidth(board: HTMLElement): Omit<CardModel, 'signature'> | undefined {
    const group = board.querySelector(GROUP_SELECTOR);
    const cards = board.querySelectorAll(`${CARDS_SELECTOR} > *`);
    if (group === null || cards.length === 0) { return undefined; }
    // the probe itself: one empty group holding a clone of every card on the board
    const probe_group = group.cloneNode(false) as HTMLElement;
    const probe_cards = document.createElement('div');
    probe_cards.className = group.querySelector(CARDS_SELECTOR)?.className ?? '';
    cards.forEach(card => probe_cards.appendChild(card.cloneNode(true)));
    probe_group.appendChild(probe_cards);
    probe_group.removeAttribute('data-column-group');
    probe_group.removeAttribute('data-flip-column-id');
    probe_group.querySelectorAll('[data-flip-id]').forEach(node => node.removeAttribute('data-flip-id'));
    Object.assign(probe_group.style, {
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
    // forces the probe side by side: stacked rules would size cards from the last solve's width, a feedback loop
    Object.assign(probe_cards.style, { flexDirection: 'column', alignItems: 'stretch' });
    Array.prototype.forEach.call(probe_cards.children, (card: Element) => unclipProbeCard(card as HTMLElement));
    // clone order is query order, so the live card at index i is the one probed at index i
    const ids = Array.prototype.map.call(cards, (node: Element) => node.getAttribute(CARD_ID_ATTRIBUTE) ?? undefined) as Array<string | undefined>;
    board.appendChild(probe_group);
    const boxes: CardBox[] = Array.prototype.map.call(probe_cards.children, (node: Element, index: number) => {
        const rect = node.getBoundingClientRect();
        return { id: ids[index], width: rect.width, height: rect.height };
    }) as CardBox[];
    board.removeChild(probe_group);
    // nothing measurable answers undefined, which is the board's signal to keep its stylesheet fallback
    const area = medianCardArea(boxes);
    if (area <= 0) { return undefined; }
    return { area, boxes };
}

/**
 * What a group spends on its own padding and border along the axis its breadth runs, read from the group's
 * computed style so the stylesheet stays the one place the number lives. The breadth is a group's outer
 * size, and the card sits inside it.
 */
function readGroupPadding(board: HTMLElement, groups_side_by_side: boolean): number | undefined {
    const group = board.querySelector(GROUP_SELECTOR);
    if (group === null) { return undefined; }
    const style = getComputedStyle(group);
    const sides = groups_side_by_side
        ? [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
        : [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth];
    return sides.reduce((total, side) => total + (parseFloat(side) || 0), 0);
}

/**
 * The board's group and card sizes, solved from the group breadth setting.
 *
 * Side by side this reads nothing but the board's own width and the group's padding: the groups take the
 * breadth, spread to fill the board when they all fit, and a card is drawn at the group less its padding.
 * Stacked, the card's width has to come from its own text, so the cards' area is probed at a fixed width
 * once per content change and cached; the board's width changes constantly and costs no measurement.
 *
 * Returns undefined until the board has been measured, which is the board's signal to leave the
 * stylesheet's own fallback sizes in place rather than render a guess. `available` is a dependency
 * of the probe effect so a failed probe (nothing to read before first layout) gets another go rather
 * than sitting on the fallback until the notes change; the failure is recorded as a zero area, a
 * state the next resize is allowed to replace.
 * - signature: changes exactly when the rendered cards change, and is what invalidates the cached probe
 */
function useColumnWidth(
    board_ref: RefObject<HTMLDivElement | null>,
    groups_side_by_side: boolean,
    ratio: number,
    breadth: number,
    group_count: number,
    signature: string,
): SolvedWidths | undefined {
    const [model, setModel] = useState<CardModel | undefined>(undefined);
    const [available, setAvailable] = useState<number>(0);
    const [group_padding, setGroupPadding] = useState<number | undefined>(undefined);
    const model_ref = useRef(model);
    model_ref.current = model;
    // the padding is stylesheet-owned, so it is re-read whenever the layout or the group set changes
    useEffect(() => {
        const board = board_ref.current;
        if (board === null) { return; }
        setGroupPadding(readGroupPadding(board, groups_side_by_side));
    }, [board_ref, groups_side_by_side, signature, available]);
    // retries the probe whenever `available` changes, so a failed probe gets another go
    useEffect(() => {
        const board = board_ref.current;
        if (board === null || groups_side_by_side) { return; }
        const cached = model_ref.current;
        if (cached?.signature === signature && cached.area > 0) { return; }
        const measured = measureAtProbeWidth(board);
        if (measured === undefined) {
            if (cached?.signature !== signature) { setModel({ signature, area: 0, boxes: [] }); }
            return;
        }
        debug('probed at %dpx: area %d', PROBE_COLUMN_WIDTH, Math.round(measured.area));
        setModel({ ...measured, signature });
    }, [board_ref, groups_side_by_side, signature, available]);
    // the board's own width, which every resize of the panel or the editor group changes
    useEffect(() => {
        const board = board_ref.current;
        if (board === null || typeof ResizeObserver === 'undefined') { return; }
        const observer = new ResizeObserver(() => setAvailable(board.clientWidth));
        observer.observe(board);
        setAvailable(board.clientWidth);
        return () => observer.disconnect();
    }, [board_ref]);
    if (available <= 0 || group_padding === undefined) { return undefined; }
    if (groups_side_by_side) {
        const column = solveColumnLayout(breadth, available, group_count, BOARD_GAP).width;
        const card = Math.max(column - group_padding, 1);
        return { column, card, height: targetCardHeight(card, ratio), cardWidths: {} };
    }
    if (model === undefined || model.signature !== signature || model.area <= 0) { return undefined; }
    const height = Math.max(breadth - group_padding, 1);
    const card = height / ratio;
    return { column: breadth, card, height, cardWidths: cardWidthsForHeight(model.boxes, height, card) };
}

/**
 * What the board publishes: a style for the board itself, a width for each card the stacked layout sizes
 * individually, and the height every card on the board is aiming at.
 *
 * Both orientations size a card by the ratio - what differs is which of its two dimensions the breadth
 * pins. Side by side, the breadth is the group's width, so one number serves the whole board and the ratio
 * decides how tall a card stands in it: a card with more to say than that height allows clips its own body
 * to reach it, and one with less simply stays short. Stacked, the breadth is the row's height, which is the
 * same rule read along the other axis and cannot be one width: a card's width has to be solved from its own
 * text, or the row ends up as tall as its longest card with every other card floating in the gap.
 *
 * The per-card widths are custom properties on the cards themselves, so the board's own value stays as
 * the fallback for a card added since the last measurement. The height is one number for the whole board,
 * and it is handed to the card rather than set on it, because a card already owns a clip of its own and
 * an outer cap only fights it.
 */
export interface BoardWidths {
    style: CSSProperties | undefined;
    cardWidths: Record<string, number>;
    cardHeight: number | undefined;
}

export function useBoardColumnStyle(
    board_ref: RefObject<HTMLDivElement | null>,
    groups_side_by_side: boolean,
    ratio: number | undefined,
    breadth: number | undefined,
    group_count: number,
    signature: string,
): BoardWidths {
    const solved = useColumnWidth(board_ref, groups_side_by_side, ratio ?? DEFAULT_CARD_RATIO, clampBreadth(breadth), group_count, signature);
    if (solved === undefined) { return { style: undefined, cardWidths: {}, cardHeight: undefined }; }
    // a custom property is not in React's CSSProperties, so the record is asserted once
    const custom: Record<string, string> = groups_side_by_side
        ? { '--nt-column-width': `${solved.column.toFixed(1)}px` }
        : { '--nt-card-width': `${solved.card.toFixed(1)}px`, '--nt-row-height': `${solved.column.toFixed(1)}px` };
    return {
        style: custom as CSSProperties,
        cardWidths: solved.cardWidths,
        cardHeight: solved.height,
    };
}
