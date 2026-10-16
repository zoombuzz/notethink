import Debug from 'debug';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type React from 'react';
import {
    classifyTransitions,
    computeInverseTransform,
    isSignificantDelta,
    isBulkTransition,
    buildMoveKeyframes,
    buildEnterKeyframes,
    buildColumnMoveKeyframes,
    moveTiming,
    enterTiming,
    KANBAN_ANIMATION_TRANSITION_MAX_MS,
    KANBAN_ANIMATION_GLOBAL_CAP_MS,
    type RectLike,
    type FlipDelta,
    type TransitionClassification,
} from './flipMath';
import type { PassiveUpdateGate } from './passiveUpdateGate';
import { emitAnimationEvent } from './animationProbe';

const debug = Debug('nodejs:notethink-views:useFlipTransition');

/**
 * FlipClassNames: the three CSS-module class names the hook applies. `flipping` lifts a card while
 * its move animation plays; `columnEntering` / `columnExiting` drive the column slide/collapse. A
 * group move carries no class of its own - its transform is plain translate, applied the same way a
 * card's is, with no lift to toggle.
 */
export interface FlipClassNames {
    flipping: string;
    columnEntering: string;
    columnExiting: string;
}

/**
 * UseFlipTransitionOptions: the fixed hook contract.
 * - container_ref: the kanban content `<div>` to measure within (querySelectorAll scope)
 * - flip_ids: every card stable_id in render order (top-to-bottom, column-by-column) - the FLIP registry keys
 * - column_ids: visible column values in render order
 * - enabled: display_options.settings.animateTransitions
 * - gate: the shared PassiveUpdateGate - when hot (a drag just completed), the hook commits baseline without animating
 * - class_names: the CSS-module class strings to toggle
 */
export interface UseFlipTransitionOptions {
    container_ref: React.RefObject<HTMLElement | null>;
    flip_ids: string[];
    column_ids: string[];
    enabled: boolean;
    gate: PassiveUpdateGate;
    class_names: FlipClassNames;
}

/** one measured card: its element, its board-relative rect, and the group value it currently sits inside (null if none) */
interface MeasuredCard {
    el: HTMLElement;
    rect: RectLike;
    column: string | null;
}

/** one measured group: its element and its board-relative rect */
interface MeasuredColumn {
    el: HTMLElement;
    rect: RectLike;
}

/** a card's carried-forward baseline: the board-relative rect and group it sat in at the last snapshot */
interface CardBaseline {
    rect: RectLike;
    column: string | null;
}

/** one planned card move: the delta to play it with (already group-adjusted where it applies) and whether that delta is genuine (significant) or a pure ride-along */
interface CardMovePlan {
    id: string;
    delta: FlipDelta;
    next: MeasuredCard;
    genuine: boolean;
}

/** detect the user's reduced-motion preference, guarding against jsdom (matchMedia may be absent) */
function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

// request-animation-frame with a setTimeout fallback for jsdom (where rAF may be absent)
const scheduleFrame: (cb: () => void) => void =
    typeof requestAnimationFrame === 'function'
        ? (cb) => { requestAnimationFrame(() => cb()); }
        : (cb) => { setTimeout(cb, 0); };

/** run `fn` over every `[data-flip-id]` card within the container (the one FLIP-registry query, shared) */
function forEachFlipCard(container: HTMLElement, fn: (el: HTMLElement) => void): void {
    container.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(fn);
}

/** run `fn` over every `[data-flip-column-id]` group within the container (the one group-registry query, shared) */
function forEachFlipColumn(container: HTMLElement, fn: (el: HTMLElement) => void): void {
    container.querySelectorAll<HTMLElement>('[data-flip-column-id]').forEach(fn);
}

/** finish any running Web Animation on an element so it settles to its identity (true-layout) box */
function finishElementAnimations(el: HTMLElement): void {
    if (typeof el.getAnimations === 'function') {
        el.getAnimations().forEach((a) => a.finish());
    }
}

/**
 * Settles every still-playing card AND group move before a fresh measurement, since getBoundingClientRect
 * reports an element's live animated position and would otherwise bake an in-between rect into the next
 * baseline. The caller skips this during a drag, where dnd owns the inline transforms.
 */
function settleInFlightAnimations(container: HTMLElement): void {
    forEachFlipCard(container, finishElementAnimations);
    forEachFlipColumn(container, finishElementAnimations);
}

/** the board root this render measures against, plus the scroll it cancels (shared by cards and groups) */
interface BoardOrigin {
    base: RectLike;
    scroll_left: number;
    scroll_top: number;
}

/**
 * The board-root origin for this measurement pass. The root is `[data-flip-root]`, the cards' AND
 * groups' common ancestor, BELOW the scrolling `.content` container and BELOW the document-strip /
 * parent-context header that folder mode renders above the board. Anchoring there makes every rect
 * immune to the two things that otherwise fold a uniform offset into every element and fling the
 * whole board in from off-screen: a SCROLL of `.content`, and a HEIGHT CHANGE of the header above the
 * board. Falls back to the container when no board root is present (e.g. the unit-test harness).
 */
function boardOrigin(container: HTMLElement): BoardOrigin {
    const root = container.querySelector<HTMLElement>('[data-flip-root]') ?? container;
    return { base: root.getBoundingClientRect(), scroll_left: root.scrollLeft, scroll_top: root.scrollTop };
}

/** `el`'s rect in the board's content space - relative to `origin`'s root, plus its scroll */
function boardRelativeRect(el: HTMLElement, origin: BoardOrigin): RectLike {
    const r = el.getBoundingClientRect();
    return {
        left: r.left - origin.base.left + origin.scroll_left,
        top: r.top - origin.base.top + origin.scroll_top,
        width: r.width,
        height: r.height,
    };
}

/**
 * FIRST: measure every `[data-flip-id]` card's rect, keyed by stable_id, in the BOARD's content space,
 * plus the group value it currently sits inside (`null` when it sits under no group, e.g. the unit-test
 * harness). A card that only scrolled / was only pushed by the header (did not reorder) measures
 * identically across renders, so its FLIP delta is zero.
 */
function measureCards(container: HTMLElement, origin: BoardOrigin): Map<string, MeasuredCard> {
    const result = new Map<string, MeasuredCard>();
    forEachFlipCard(container, (el) => {
        const id = el.getAttribute('data-flip-id');
        if (id === null) { return; }
        const column_el = el.closest<HTMLElement>('[data-flip-column-id]');
        result.set(id, {
            el,
            rect: boardRelativeRect(el, origin),
            column: column_el ? column_el.getAttribute('data-flip-column-id') : null,
        });
    });
    return result;
}

/** FIRST for groups: measure every `[data-flip-column-id]` group's rect, keyed by its value, in the same board-content space cards use */
function measureColumnRects(container: HTMLElement, origin: BoardOrigin): Map<string, MeasuredColumn> {
    const result = new Map<string, MeasuredColumn>();
    forEachFlipColumn(container, (el) => {
        const value = el.getAttribute('data-flip-column-id');
        if (value !== null) { result.set(value, { el, rect: boardRelativeRect(el, origin) }); }
    });
    return result;
}

/** name the reason the hook is committing a baseline without animating (for the skip probe event + debug) */
function skipReason(is_first_run: boolean, gate_hot: boolean, enabled: boolean, reduced: boolean, bulk: boolean): string {
    if (is_first_run) { return 'first-run'; }
    if (gate_hot) { return 'gate-hot'; }
    if (!enabled) { return 'disabled'; }
    if (reduced) { return 'reduced-motion'; }
    if (bulk) { return 'bulk'; }
    return 'unknown';
}

/** slide a just-appeared column in, clearing the class once its CSS animation ends */
function playColumnEnter(value: string, el: HTMLElement | undefined, class_name: string): void {
    emitAnimationEvent({ kind: 'column-enter', id: value });
    if (!el) { return; }
    el.classList.add(class_name);
    const onEnd = (): void => {
        el.classList.remove(class_name);
        el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd);
}

/**
 * INVERT + PLAY a single group move: paint the group at its previous position, then animate to identity.
 * A plain inverse translate - no rotate/scale lift, which is a card affordance mimicking the manual
 * drag lift, and a group is never dragged by hand. The caller has already confirmed `delta` is
 * significant.
 */
function playColumnMove(value: string, el: HTMLElement, delta: FlipDelta): void {
    emitAnimationEvent({ kind: 'column-move', id: value, dx: delta.dx, dy: delta.dy, duration: KANBAN_ANIMATION_TRANSITION_MAX_MS });
    el.style.transform = `translate(${delta.dx}px, ${delta.dy}px)`;
    scheduleFrame(() => {
        el.style.transform = '';
        if (typeof el.animate === 'function') {
            el.animate(buildColumnMoveKeyframes(delta), moveTiming());
        }
    });
}

/**
 * The delta to animate a MOVING card with. When the card stayed in the same group and that group itself
 * survived (present in both snapshots), the group's own move is subtracted out: the group's CSS
 * transform already carries the card along visually, so animating the card with the raw board-relative
 * delta would double-count the group's share and overshoot. What is left is the card's position change
 * WITHIN its group - zero for a card that only rode along, non-zero for one that also reordered inside
 * the group. A card that changed group (or sat under no group at measurement time) keeps the raw
 * board-relative delta, unchanged from before this group layer existed.
 */
function cardPlayDelta(prev: CardBaseline, next: MeasuredCard, group_deltas: ReadonlyMap<string, FlipDelta>): FlipDelta {
    const total = computeInverseTransform(prev.rect, next.rect);
    if (prev.column === null || prev.column !== next.column) { return total; }
    const group_delta = group_deltas.get(prev.column);
    if (!group_delta) { return total; }
    return { dx: total.dx - group_delta.dx, dy: total.dy - group_delta.dy };
}

/** what `planMoves` works out ahead of the skip decision: every surviving group's delta, every moving card's (group-adjusted) delta, and how many of those card moves are genuine */
interface MovePlan {
    group_deltas: Map<string, FlipDelta>;
    card_moves: CardMovePlan[];
    genuine_card_move_count: number;
}

/**
 * Plans every surviving group's delta and every moving card's delta up front, before the caller decides
 * whether to skip. A card's delta already has its own group's share subtracted out where that applies
 * (`cardPlayDelta`), so `genuine_card_move_count` - unlike the raw moving-id count - reflects only
 * cards that actually need their own animation, which is what the bulk guard must count.
 */
function planMoves(
    card_classification: TransitionClassification,
    column_classification: TransitionClassification,
    prev_card_map: ReadonlyMap<string, CardBaseline>,
    prev_column_map: ReadonlyMap<string, RectLike>,
    new_cards: ReadonlyMap<string, MeasuredCard>,
    new_columns: ReadonlyMap<string, MeasuredColumn>,
): MovePlan {
    const group_deltas = new Map<string, FlipDelta>();
    column_classification.moving.forEach((value) => {
        const prev_rect = prev_column_map.get(value);
        const next = new_columns.get(value);
        if (prev_rect && next) { group_deltas.set(value, computeInverseTransform(prev_rect, next.rect)); }
    });
    const card_moves: CardMovePlan[] = [];
    card_classification.moving.forEach((id) => {
        const prev = prev_card_map.get(id);
        const next = new_cards.get(id);
        if (!prev || !next) { return; }
        const delta = cardPlayDelta(prev, next, group_deltas);
        card_moves.push({ id, delta, next, genuine: isSignificantDelta(delta) });
    });
    return { group_deltas, card_moves, genuine_card_move_count: card_moves.filter((move) => move.genuine).length };
}

/**
 * PLAY a single already-significant card move: paint the card at its inverted offset, then animate to
 * identity. CHOREOGRAPHY: a card landing in a just-entered column waits one extra frame so the column
 * lands first.
 */
function playCardMove(id: string, delta: FlipDelta, el: HTMLElement, lands_in_entering_column: boolean, flipping_class: string): void {
    emitAnimationEvent({ kind: 'move', id, dx: delta.dx, dy: delta.dy, duration: KANBAN_ANIMATION_TRANSITION_MAX_MS });
    el.style.transform = `translate(${delta.dx}px, ${delta.dy}px)`;
    el.classList.add(flipping_class);
    const playMove = (): void => {
        el.style.transform = '';
        if (typeof el.animate === 'function') {
            const anim = el.animate(buildMoveKeyframes(delta), moveTiming());
            anim.onfinish = () => { el.classList.remove(flipping_class); };
        } else {
            el.classList.remove(flipping_class);
        }
    };
    if (lands_in_entering_column) {
        scheduleFrame(() => { scheduleFrame(playMove); });
    } else {
        scheduleFrame(playMove);
    }
}

/** fade/scale a just-mounted card in (new note) */
function playCardEnter(id: string, measured: MeasuredCard | undefined): void {
    emitAnimationEvent({ kind: 'enter', id });
    if (measured && typeof measured.el.animate === 'function') {
        measured.el.animate(buildEnterKeyframes(), enterTiming());
    }
}

/** GLOBAL CAP: after the budget elapses, force-finish any still-running card/group animations so nothing lingers */
function armGlobalCap(container: HTMLElement, cap_timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
    if (cap_timer.current !== null) { clearTimeout(cap_timer.current); }
    cap_timer.current = setTimeout(() => {
        emitAnimationEvent({ kind: 'cap' });
        forEachFlipCard(container, finishElementAnimations);
        forEachFlipColumn(container, finishElementAnimations);
        cap_timer.current = null;
    }, KANBAN_ANIMATION_GLOBAL_CAP_MS);
}

/**
 * useFlipTransition: the FLIP (First-Last-Invert-Play) layer for kanban passive transitions, covering
 * both the cards AND the groups they sit in.
 *
 * THE SEAM. A PASSIVE update (external file edit / AI edit / mtime re-parse, a recomputed automatic
 * group order, or a hand-dragged custom order) mutates the notes or the group order with no active
 * projection, so the board re-renders straight into the new layout - this hook measures the
 * before/after rects (cards keyed by the invariant stable_id via `data-flip-id`, groups keyed by their
 * value via `data-flip-column-id`) and animates the difference. A USER drag instead goes through the
 * optimistic projection in useProjectedNotes; its drag-end handler ARMS `gate`, so when the
 * projection-commit re-render lands the hook sees `gate.isHot()` and SKIPS animating (no double-animate
 * on top of @hello-pangea/dnd's own drop tween).
 *
 * CARDS RIDE WITH THEIR GROUP. A card whose group survived the layout change (same value, present
 * before and after) is measured relative to that group's own move (`cardPlayDelta`): if its position
 * within the group did not change, it gets no card-level animation at all and simply rides along inside
 * the group's own CSS transform; if it also reordered within the group, it animates with the REMAINDER
 * after the group's share is subtracted out, so the two transforms compose to the right total rather
 * than double-counting the group's move. A card that changed group (or landed under no group) keeps the
 * plain board-relative delta, exactly as before this group layer existed.
 *
 * THE CARD BULK GUARD COUNTS ONLY GENUINE MOVES. A pure group reorder leaves every card id present in
 * both the previous and the next render, so the id-presence count alone would read as "every card
 * moved" and trip `isBulkTransition` on a busy board even though nothing but the group chrome actually
 * needs to move. The hook plans every card's delta (group-adjusted) up front and counts only the ones
 * that pass `isSignificantDelta` - a riding card costs nothing towards the guard. Groups get no guard of
 * their own: a board rarely carries enough groups for their count to matter.
 *
 * EXIT-ANIMATION LIMITATION. An id (card or group) present in the previous render but absent in the next
 * is already unmounted from the DOM by the time this layout effect runs - there is no element left to
 * animate. The hook therefore emits an `exit` / `column-exit` probe event for classification visibility
 * (so tests can assert the fade-out / collapse path is recognised at the schedule level) but performs no
 * DOM exit animation for either. A surviving group still slides to close the gap a departed one leaves.
 *
 * jsdom GUARDS. `el.animate`, `el.getAnimations`, `requestAnimationFrame` and `window.matchMedia` may
 * all be absent under jest; each is feature-detected. The probe events fire regardless of WAAPI
 * availability, so the schedule is testable without a real animation loop.
 *
 * BULK / VIRTUALIZED GROUPS. A windowed group's scroll can make two snapshots disagree for a reason
 * that isn't a real reorder. `isBulkTransition` catches this (and a genuine bulk load) by count alone
 * and takes the same silent-baseline path as the other skip reasons.
 *
 * ORIENTATION-AGNOSTIC. Group rects come from the same `getBoundingClientRect` cards use; `dx` carries
 * a 'columns' reorder and `dy` a 'rows' one, with no branch on `data-orientation` anywhere in this file.
 */
export function useFlipTransition(options: UseFlipTransitionOptions): void {
    const prev_cards = useRef<Map<string, CardBaseline>>(new Map());
    const prev_column_rects = useRef<Map<string, RectLike>>(new Map());
    const first_run = useRef(true);
    const cap_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // signature changes whenever the column set/order or card order/membership changes - i.e. a reorder
    const signature = useMemo(
        () => options.column_ids.join('|') + '#' + options.flip_ids.join(','),
        [options.column_ids, options.flip_ids],
    );
    // FIRST/LAST must read settled, clipped heights (child clip effect runs first), or a remounted card shoves siblings
    useLayoutEffect(() => {
        const container = options.container_ref.current;
        if (!container) { return; }
        // snapshot the measured layout as the next baseline (the FIRST for the following reorder)
        const snapshotBaseline = (cards: Map<string, MeasuredCard>, columns: Map<string, MeasuredColumn>): void => {
            const card_baseline = new Map<string, CardBaseline>();
            cards.forEach((measured, id) => { card_baseline.set(id, { rect: measured.rect, column: measured.column }); });
            prev_cards.current = card_baseline;
            const column_baseline = new Map<string, RectLike>();
            columns.forEach((measured, value) => { column_baseline.set(value, measured.rect); });
            prev_column_rects.current = column_baseline;
            first_run.current = false;
        };
        // settles any still-playing card/group move so the baseline reads the true layout box, skipped while the gate is hot
        if (!options.gate.isHot()) {
            settleInFlightAnimations(container);
        }
        const origin = boardOrigin(container);
        const new_cards = measureCards(container, origin);
        const new_columns = measureColumnRects(container, origin);
        const reduced = prefersReducedMotion();
        const prev_card_map = prev_cards.current;
        const prev_column_map = prev_column_rects.current;
        // classify cards and groups separately: a group's own partition drives its slide/move, a card's drives its move/enter/exit
        const card_classification: TransitionClassification = classifyTransitions(prev_card_map.keys(), new_cards.keys());
        const column_classification: TransitionClassification = classifyTransitions(prev_column_map.keys(), new_columns.keys());
        // plan every group/card delta before deciding whether to skip, so the bulk guard below counts only GENUINE card moves
        const { group_deltas, card_moves, genuine_card_move_count } = planMoves(card_classification, column_classification, prev_card_map, prev_column_map, new_cards, new_columns);
        // classify before the gate: a virtualized group's scroll churn reads as a bulk transition, which is a gate reason
        const bulk = isBulkTransition(card_classification.entering.length, genuine_card_move_count, card_classification.exiting.length);
        // gate / first-run / disabled / reduced-motion / bulk: establish baseline, never animate
        if (first_run.current || options.gate.isHot() || !options.enabled || reduced || bulk) {
            const reason = skipReason(first_run.current, options.gate.isHot(), options.enabled, reduced, bulk);
            debug('skip animate: %s', reason);
            emitAnimationEvent({ kind: 'skip', reason });
            snapshotBaseline(new_cards, new_columns);
            return;
        }
        const entering_cols = new Set(column_classification.entering);
        column_classification.entering.forEach((value) => playColumnEnter(value, new_columns.get(value)?.el, options.class_names.columnEntering));
        column_classification.moving.forEach((value) => {
            const delta = group_deltas.get(value);
            const measured = new_columns.get(value);
            if (delta && measured && isSignificantDelta(delta)) { playColumnMove(value, measured.el, delta); }
        });
        column_classification.exiting.forEach((value) => { emitAnimationEvent({ kind: 'column-exit', id: value }); });
        card_moves.forEach(({ id, delta, next, genuine }) => {
            if (!genuine) { return; }
            const lands_in_entering_column = next.column !== null && entering_cols.has(next.column);
            playCardMove(id, delta, next.el, lands_in_entering_column, options.class_names.flipping);
        });
        card_classification.entering.forEach((id) => playCardEnter(id, new_cards.get(id)));
        card_classification.exiting.forEach((id) => { emitAnimationEvent({ kind: 'exit', id }); });
        snapshotBaseline(new_cards, new_columns);
        armGlobalCap(container, cap_timer);
    }, [signature, options.container_ref, options.enabled, options.gate, options.class_names]);
    // clear the global-cap timer on unmount (the gate's own cancel is owned by KanbanView)
    useEffect(() => {
        return () => {
            if (cap_timer.current !== null) {
                clearTimeout(cap_timer.current);
                cap_timer.current = null;
            }
        };
    }, []);
}
