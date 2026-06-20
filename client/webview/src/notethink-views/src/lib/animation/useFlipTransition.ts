import Debug from 'debug';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type React from 'react';
import {
    classifyTransitions,
    computeInverseTransform,
    isSignificantDelta,
    buildMoveKeyframes,
    buildEnterKeyframes,
    moveTiming,
    enterTiming,
    KANBAN_ANIMATION_TRANSITION_MAX_MS,
    KANBAN_ANIMATION_GLOBAL_CAP_MS,
    type RectLike,
} from './flipMath';
import type { PassiveUpdateGate } from './passiveUpdateGate';
import { emitAnimationEvent } from './animationProbe';

const debug = Debug('nodejs:notethink-views:useFlipTransition');

/**
 * FlipClassNames: the three CSS-module class names the hook applies. `flipping` lifts a card while
 * its move animation plays; `columnEntering` / `columnExiting` drive the column slide/collapse.
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
 * - enabled: display_options.settings.kanbanAnimateTransitions
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

interface MeasuredCard {
    el: HTMLElement;
    rect: RectLike;
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

/** finish any running Web-Animation on a card so it settles to its identity (true-layout) box */
function finishCardAnimations(el: HTMLElement): void {
    if (typeof el.getAnimations === 'function') {
        el.getAnimations().forEach((a) => a.finish());
    }
}

/**
 * settle every still-playing move before a fresh measurement. getBoundingClientRect reports a card's
 * LIVE animated position, so measuring while a previous move is mid-flight would bake those in-between
 * rects into the next baseline and the following transition would invert from the wrong `previous` spot
 * (the displaced cards visibly fly in from the top of the column). Finishing snaps each card to its true
 * layout box first. The caller skips this during a drag, where dnd owns the inline transforms.
 */
function settleInFlightAnimations(container: HTMLElement): void {
    forEachFlipCard(container, finishCardAnimations);
}

/**
 * FIRST: measure every `[data-flip-id]` card's rect, keyed by stable_id, in the BOARD's content space
 * (relative to the board-root origin, plus its scroll) rather than the viewport.
 *
 * The board root (`[data-flip-root]`) is the cards' common ancestor, BELOW the scrolling `.content`
 * container and BELOW the document-strip / parent-context header that folder mode renders above the board.
 * Anchoring there makes the measurement immune to the two things that otherwise fold a uniform offset into
 * every card and fling the whole column in from off-screen:
 * - a SCROLL of `.content` (useScrollToCaret reveals the moved story between baseline and move) - board and
 *   cards scroll together, so the offset cancels;
 * - a HEIGHT CHANGE of the header above the board (folder-mode re-aggregation re-renders the strip /
 *   parent-context) - the board shifts down with the cards, so the shift cancels.
 * A card that only scrolled / was only pushed by the header (did not reorder) measures identically across
 * renders, so its FLIP delta is zero. The constant board origin cancels in prev - next, so a static board
 * is unaffected. Falls back to the container when no board root is present (e.g. the unit-test harness).
 */
function measureCards(container: HTMLElement): Map<string, MeasuredCard> {
    const result = new Map<string, MeasuredCard>();
    const root = container.querySelector<HTMLElement>('[data-flip-root]') ?? container;
    const base = root.getBoundingClientRect();
    const scroll_left = root.scrollLeft;
    const scroll_top = root.scrollTop;
    forEachFlipCard(container, (el) => {
        const id = el.getAttribute('data-flip-id');
        if (id === null) { return; }
        const r = el.getBoundingClientRect();
        result.set(id, {
            el,
            rect: {
                left: r.left - base.left + scroll_left,
                top: r.top - base.top + scroll_top,
                width: r.width,
                height: r.height,
            },
        });
    });
    return result;
}

/** measure every `[data-flip-column-id]` column element within the container, keyed by status value */
function measureColumns(container: HTMLElement): Map<string, HTMLElement> {
    const result = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>('[data-flip-column-id]').forEach((el) => {
        const value = el.getAttribute('data-flip-column-id');
        if (value !== null) { result.set(value, el); }
    });
    return result;
}

/** the column values present now but absent in the previous render - the ones to slide in */
function enteringColumns(next: Set<string>, prev: Set<string>): Set<string> {
    const result = new Set<string>();
    next.forEach((value) => { if (!prev.has(value)) { result.add(value); } });
    return result;
}

/** name the reason the hook is committing a baseline without animating (for the skip probe event + debug) */
function skipReason(is_first_run: boolean, gate_hot: boolean, enabled: boolean, reduced: boolean): string {
    if (is_first_run) { return 'first-run'; }
    if (gate_hot) { return 'gate-hot'; }
    if (!enabled) { return 'disabled'; }
    if (reduced) { return 'reduced-motion'; }
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
 * INVERT + PLAY a single card move: paint the card at its previous position, then animate to identity.
 * CHOREOGRAPHY: a card landing in a just-entered column waits one extra frame so the column lands first.
 * The move probe event is emitted before any deferral so tests always see it scheduled.
 */
function playCardMove(
    id: string,
    prev_rect: RectLike,
    measured: MeasuredCard,
    entering_columns: Set<string>,
    flipping_class: string,
): void {
    const delta = computeInverseTransform(prev_rect, measured.rect);
    if (!isSignificantDelta(delta)) { return; }
    emitAnimationEvent({ kind: 'move', id, dx: delta.dx, dy: delta.dy, duration: KANBAN_ANIMATION_TRANSITION_MAX_MS });

    const el = measured.el;
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

    const column_el = el.closest('[data-flip-column-id]');
    const lands_in_entering_column = column_el !== null &&
        entering_columns.has(column_el.getAttribute('data-flip-column-id') ?? '');
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

/** GLOBAL CAP: after the budget elapses, force-finish any still-running card animations so nothing lingers */
function armGlobalCap(container: HTMLElement, cap_timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): void {
    if (cap_timer.current !== null) { clearTimeout(cap_timer.current); }
    cap_timer.current = setTimeout(() => {
        emitAnimationEvent({ kind: 'cap' });
        forEachFlipCard(container, finishCardAnimations);
        cap_timer.current = null;
    }, KANBAN_ANIMATION_GLOBAL_CAP_MS);
}

/**
 * useFlipTransition: the FLIP (First-Last-Invert-Play) layer for kanban passive transitions.
 *
 * THE SEAM. A PASSIVE update (external file edit / AI edit / mtime re-parse) mutates the notes with
 * no active projection, so the board re-renders straight into the new layout - this hook measures the
 * before/after rects (cards keyed by the invariant stable_id via `data-flip-id`) and animates the
 * difference. A USER drag instead goes through the optimistic projection in useProjectedNotes; its
 * drag-end handler ARMS `gate`, so when the projection-commit re-render lands the hook sees
 * `gate.isHot()` and SKIPS animating (no double-animate on top of @hello-pangea/dnd's own drop tween).
 *
 * EXIT-ANIMATION LIMITATION. Cards present in the previous render but absent in the next are already
 * unmounted from the DOM by the time this layout effect runs - there is no element left to animate.
 * The hook therefore emits an `exit` probe event for classification visibility (so tests can assert
 * the fade-out path is recognised at the schedule level) but performs no DOM exit animation. Real
 * exit choreography would need a mount-deferral / presence layer, which is out of scope here.
 *
 * jsdom GUARDS. `el.animate`, `el.getAnimations`, `requestAnimationFrame` and `window.matchMedia` may
 * all be absent under jest; each is feature-detected. The probe events fire regardless of WAAPI
 * availability, so the schedule is testable without a real animation loop.
 */
export function useFlipTransition(options: UseFlipTransitionOptions): void {
    const prev_rects = useRef<Map<string, RectLike>>(new Map());
    const prev_columns = useRef<Set<string>>(new Set());
    const first_run = useRef(true);
    const cap_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // signature changes whenever the column set or card order/membership changes - i.e. a reorder
    const signature = useMemo(
        () => options.column_ids.join('|') + '#' + options.flip_ids.join(','),
        [options.column_ids, options.flip_ids],
    );

    /*
     * The FLIP samples each card's rect on the commit that introduces a reorder (LAST) and inverts it
     * against the previous baseline (FIRST). For the deltas to mean "the reorder" and nothing else, both
     * must be read against the SETTLED card heights - guaranteed by MarkdownNote's useSyncedBodyClip, which
     * applies the overflow clip in a CHILD layout effect that React runs before this parent effect. So a
     * freshly (re)mounted card (notably one that just changed kanban columns and remounted into the new
     * Droppable) is already clipped when we measure it; without that it is sampled at full height and
     * shoves its new siblings down by its whole unclipped height, which this hook then inverts - the
     * "displaced cards fly up above their slot then settle" bug. Board-anchored measurement (measureCards)
     * additionally makes a scroll or header-height shift cancel in FIRST - LAST, so neither perturbs the
     * deltas.
     */
    useLayoutEffect(() => {
        const container = options.container_ref.current;
        if (!container) { return; }

        // snapshot the measured layout as the next baseline (the FIRST for the following reorder)
        const snapshotBaseline = (rects: Map<string, MeasuredCard>, columns: Set<string>): void => {
            const baseline = new Map<string, RectLike>();
            rects.forEach((measured, id) => { baseline.set(id, measured.rect); });
            prev_rects.current = baseline;
            prev_columns.current = columns;
            first_run.current = false;
        };

        /*
         * settle any still-playing move so getBoundingClientRect reads the true layout box - a mid-flight
         * position would otherwise bake into the baseline; skipped while the gate is hot, where dnd owns
         * the card transforms and FLIP has nothing in flight.
         */
        if (!options.gate.isHot()) {
            settleInFlightAnimations(container);
        }
        const new_rects = measureCards(container);
        const new_column_els = measureColumns(container);
        const new_columns = new Set(new_column_els.keys());
        const reduced = prefersReducedMotion();

        // GATE / FIRST-RUN / DISABLED / REDUCED-MOTION: establish baseline, never animate
        if (first_run.current || options.gate.isHot() || !options.enabled || reduced) {
            const reason = skipReason(first_run.current, options.gate.isHot(), options.enabled, reduced);
            debug('skip animate: %s', reason);
            emitAnimationEvent({ kind: 'skip', reason });
            snapshotBaseline(new_rects, new_columns);
            return;
        }

        // PLAN. emit probe events for the whole schedule, then play via WAAPI where available.
        const prev_rect_map = prev_rects.current;
        const classification = classifyTransitions(prev_rect_map.keys(), new_rects.keys());
        const entering_cols = enteringColumns(new_columns, prev_columns.current);

        entering_cols.forEach((value) => playColumnEnter(value, new_column_els.get(value), options.class_names.columnEntering));
        classification.moving.forEach((id) => {
            const prev_rect = prev_rect_map.get(id);
            const measured = new_rects.get(id);
            if (prev_rect && measured) { playCardMove(id, prev_rect, measured, entering_cols, options.class_names.flipping); }
        });
        classification.entering.forEach((id) => playCardEnter(id, new_rects.get(id)));
        classification.exiting.forEach((id) => { emitAnimationEvent({ kind: 'exit', id }); });

        snapshotBaseline(new_rects, new_columns);
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
