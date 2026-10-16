import React, { useRef } from 'react';
import { render, act } from '@testing-library/react';
import { useFlipTransition, type FlipClassNames } from './useFlipTransition';
import { createPassiveUpdateGate, type PassiveUpdateGate } from './passiveUpdateGate';
import {
    enableAnimationProbe,
    disableAnimationProbe,
    getAnimationProbeEvents,
    clearAnimationProbeEvents,
    type AnimationProbeEvent,
} from './animationProbe';
import { buildMoveKeyframes, buildColumnMoveKeyframes, KANBAN_ANIMATION_GLOBAL_CAP_MS } from './flipMath';

const CLASS_NAMES: FlipClassNames = { flipping: 'flipping', columnEntering: 'columnEntering', columnExiting: 'columnExiting' };

interface RectLookup { [id: string]: { left: number; top: number; width: number; height: number }; }

// the test controls per-id rects; the mock reads data-flip-id off the element to pick its rect
let rect_lookup: RectLookup = {};
// the test controls per-group rects; the mock reads data-flip-column-id off the element to pick its rect
let column_rect_lookup: RectLookup = {};
// the board-root (`[data-flip-root]`) rect; tests shift it to simulate a scroll / folder-mode header growth
let root_rect = { left: 0, top: 0, width: 0, height: 0 };

// per-id card placement: id -> column value (render order follows the array)
interface CardSpec { id: string; column: string; }

interface HarnessProps {
    cards: CardSpec[];
    columns: string[];
    enabled: boolean;
    gate: PassiveUpdateGate;
}

/**
 * Minimal harness: a measured container holding one [data-flip-column-id] div per column, each
 * holding its [data-flip-id] cards. Drives useFlipTransition with the test-controlled inputs.
 */
function Harness(props: HarnessProps): React.ReactElement {
    const container_ref = useRef<HTMLDivElement>(null);
    const flip_ids = props.cards.map((c) => c.id);
    useFlipTransition({
        container_ref,
        flip_ids,
        column_ids: props.columns,
        enabled: props.enabled,
        gate: props.gate,
        class_names: CLASS_NAMES,
    });
    return (
        <div ref={container_ref} data-testid="container">
            <div data-flip-root>
                {props.columns.map((col) => (
                    <div key={col} data-flip-column-id={col}>
                        {props.cards.filter((c) => c.column === col).map((c) => (
                            <div key={c.id} data-flip-id={c.id}>{c.id}</div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function moveEvents(): AnimationProbeEvent[] {
    return getAnimationProbeEvents().filter((e) => e.kind === 'move');
}
function columnMoveEvents(): AnimationProbeEvent[] {
    return getAnimationProbeEvents().filter((e) => e.kind === 'column-move');
}
function eventsOfKind(kind: AnimationProbeEvent['kind']): AnimationProbeEvent[] {
    return getAnimationProbeEvents().filter((e) => e.kind === kind);
}

describe('useFlipTransition', () => {
    let original_grbc: typeof Element.prototype.getBoundingClientRect;
    let original_animate: typeof Element.prototype.animate;
    let original_get_animations: typeof Element.prototype.getAnimations;
    let original_match_media: typeof window.matchMedia;
    let original_raf: typeof globalThis.requestAnimationFrame;
    let animate_spy: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        enableAnimationProbe();
        clearAnimationProbeEvents();
        rect_lookup = {};
        column_rect_lookup = {};
        root_rect = { left: 0, top: 0, width: 0, height: 0 };

        original_grbc = Element.prototype.getBoundingClientRect;
        original_animate = Element.prototype.animate;
        original_get_animations = Element.prototype.getAnimations;
        original_match_media = window.matchMedia;
        original_raf = globalThis.requestAnimationFrame;

        // a card/group returns its own lookup; anything else falls back to root_rect, reading as board-stationary
        Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
            const id = this.getAttribute('data-flip-id');
            const column = this.getAttribute('data-flip-column-id');
            const r = (id !== null && rect_lookup[id]) ||
                (column !== null && column_rect_lookup[column]) ||
                root_rect;
            return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON() {} } as DOMRect;
        };

        animate_spy = jest.fn(() => ({ onfinish: null, cancel: jest.fn(), finish: jest.fn() }));
        Element.prototype.animate = animate_spy as unknown as typeof Element.prototype.animate;
        // default: no live animations; specific tests override to seed a fake animation for the cap path
        Element.prototype.getAnimations = jest.fn(() => []) as unknown as typeof Element.prototype.getAnimations;

        // default: reduced-motion OFF
        window.matchMedia = jest.fn().mockReturnValue({ matches: false, media: '', addEventListener() {}, removeEventListener() {} }) as unknown as typeof window.matchMedia;

        // deterministic rAF: run the callback on the next fake-timer macrotask
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as unknown as typeof globalThis.requestAnimationFrame;
    });

    afterEach(() => {
        disableAnimationProbe();
        Element.prototype.getBoundingClientRect = original_grbc;
        Element.prototype.animate = original_animate;
        Element.prototype.getAnimations = original_get_animations;
        window.matchMedia = original_match_media;
        globalThis.requestAnimationFrame = original_raf;
        jest.useRealTimers();
    });

    function flushFrames(): void {
        // run queued rAF/setTimeout(0) callbacks (the PLAY step) without firing the global cap timer
        act(() => { jest.advanceTimersByTime(0); });
    }

    it('emits a move event with the correct dx/dy when a card rect changes between renders', () => {
        const gate = createPassiveUpdateGate();
        // render 1: baseline (first_run skips animation)
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 }, b: { left: 0, top: 50, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'b', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // render 2: passive reorder - a and b swap positions (signature changes); a moves from top 0 -> 50
        rect_lookup = { a: { left: 0, top: 50, width: 100, height: 40 }, b: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });

        const moves = moveEvents();
        const move_a = moves.find((m) => m.id === 'a');
        const move_b = moves.find((m) => m.id === 'b');
        // a: prev top 0, new top 50 => inverse dy = 0 - 50 = -50
        expect(move_a).toMatchObject({ id: 'a', dx: 0, dy: -50 });
        // b: prev top 50, new top 0 => inverse dy = 50 - 0 = 50
        expect(move_b).toMatchObject({ id: 'b', dx: 0, dy: 50 });

        // PLAY step fires .animate with the move keyframes after the next frame
        flushFrames();
        expect(animate_spy).toHaveBeenCalled();
        const animated_with_move = animate_spy.mock.calls.some((call) => JSON.stringify(call[0]) === JSON.stringify(buildMoveKeyframes({ dx: 0, dy: -50 })));
        expect(animated_with_move).toBe(true);
    });

    it('emits enter for an id new in the second render and exit for an id gone in the second render', () => {
        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // a disappears, c appears
        rect_lookup = { c: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'c', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });

        expect(eventsOfKind('enter').map((e) => e.id)).toContain('c');
        expect(eventsOfKind('exit').map((e) => e.id)).toContain('a');
    });

    it('suppresses move/enter events when the gate is hot', () => {
        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // arm the gate just before the next render - the hook must skip animating
        gate.arm();
        rect_lookup = { a: { left: 0, top: 80, width: 100, height: 40 }, b: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });

        expect(moveEvents()).toHaveLength(0);
        expect(eventsOfKind('enter')).toHaveLength(0);
        expect(eventsOfKind('skip').some((e) => e.reason === 'gate-hot')).toBe(true);
        expect(animate_spy).not.toHaveBeenCalled();
    });

    it('no-ops under prefers-reduced-motion (no move/enter events, no animate calls)', () => {
        window.matchMedia = jest.fn().mockReturnValue({ matches: true, media: '', addEventListener() {}, removeEventListener() {} }) as unknown as typeof window.matchMedia;
        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        rect_lookup = { a: { left: 0, top: 80, width: 100, height: 40 }, b: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });
        flushFrames();

        expect(moveEvents()).toHaveLength(0);
        expect(eventsOfKind('enter')).toHaveLength(0);
        expect(eventsOfKind('skip').some((e) => e.reason === 'reduced-motion')).toBe(true);
        expect(animate_spy).not.toHaveBeenCalled();
    });

    it('no-ops when disabled (enabled=false)', () => {
        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo']} enabled={false} gate={gate} />);
        clearAnimationProbeEvents();

        rect_lookup = { a: { left: 0, top: 80, width: 100, height: 40 }, b: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={false} gate={gate} />);
        });

        expect(moveEvents()).toHaveLength(0);
        expect(eventsOfKind('skip').some((e) => e.reason === 'disabled')).toBe(true);
    });

    it('emits a column-enter event for a column new in the second render', () => {
        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // a new 'done' column appears alongside todo
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 }, b: { left: 200, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'b', column: 'done' }]} columns={['todo', 'done']} enabled={true} gate={gate} />);
        });

        expect(eventsOfKind('column-enter').map((e) => e.id)).toContain('done');
    });

    it('fires a cap event after KANBAN_ANIMATION_GLOBAL_CAP_MS and force-finishes live animations', () => {
        const cap_finish = jest.fn();
        // seed getAnimations so the cap path has something to finish
        Element.prototype.getAnimations = jest.fn(() => [{ finish: cap_finish } as unknown as Animation]) as unknown as typeof Element.prototype.getAnimations;

        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 }, b: { left: 0, top: 50, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'b', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        rect_lookup = { a: { left: 0, top: 50, width: 100, height: 40 }, b: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });

        // advance past the global cap budget
        act(() => { jest.advanceTimersByTime(KANBAN_ANIMATION_GLOBAL_CAP_MS); });

        expect(eventsOfKind('cap')).toHaveLength(1);
        expect(cap_finish).toHaveBeenCalled();
    });

    it('settles an in-flight move before measuring so a mid-flight position never corrupts the baseline', () => {
        // a previous move is still playing, so the hook must finish() it before measuring the true layout
        const settle_finish = jest.fn();
        Element.prototype.getAnimations = jest.fn(() => [{ finish: settle_finish } as unknown as Animation]) as unknown as typeof Element.prototype.getAnimations;

        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 }, b: { left: 0, top: 50, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'b', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        settle_finish.mockClear();

        rect_lookup = { a: { left: 0, top: 50, width: 100, height: 40 }, b: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });

        expect(settle_finish).toHaveBeenCalled();
    });

    it('does not settle in-flight animations while the gate is hot (a drag owns the transforms)', () => {
        const settle_finish = jest.fn();
        Element.prototype.getAnimations = jest.fn(() => [{ finish: settle_finish } as unknown as Animation]) as unknown as typeof Element.prototype.getAnimations;

        const gate = createPassiveUpdateGate();
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        settle_finish.mockClear();

        // gate hot: the hook must not touch animations, dnd owns the live drag/drop transforms
        gate.arm();
        rect_lookup = { a: { left: 0, top: 80, width: 100, height: 40 }, b: { left: 0, top: 0, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });

        expect(settle_finish).not.toHaveBeenCalled();
    });

    it('is board-anchored: a uniform shift above the cards (scroll / folder-mode header growth) does not corrupt the deltas', () => {
        const gate = createPassiveUpdateGate();
        // baseline: board at top 0; a at top 0, b at top 50
        root_rect = { left: 0, top: 0, width: 300, height: 200 };
        rect_lookup = { a: { left: 0, top: 0, width: 100, height: 40 }, b: { left: 0, top: 50, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'b', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // the board and every card shift down 200 together; anchoring to the board cancels it, matching the no-shift deltas
        root_rect = { left: 0, top: 200, width: 300, height: 200 };
        rect_lookup = { a: { left: 0, top: 250, width: 100, height: 40 }, b: { left: 0, top: 200, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'b', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['todo']} enabled={true} gate={gate} />);
        });

        const moves = moveEvents();
        expect(moves.find((m) => m.id === 'a')).toMatchObject({ dx: 0, dy: -50 });
        expect(moves.find((m) => m.id === 'b')).toMatchObject({ dx: 0, dy: 50 });
    });

    it('skips animating a bulk membership change (a virtualized group scrolling to a non-overlapping window) instead of animating every card', () => {
        const gate = createPassiveUpdateGate();
        const baseline_cards = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, column: 'todo' }));
        rect_lookup = Object.fromEntries(baseline_cards.map((c, i) => [c.id, { left: 0, top: i * 40, width: 100, height: 40 }]));
        const { rerender } = render(<Harness cards={baseline_cards} columns={['todo']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // simulate scrolling a virtualized group to a disjoint window: every mounted id changes, well past the bulk threshold
        const scrolled_cards = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, column: 'todo' }));
        rect_lookup = Object.fromEntries(scrolled_cards.map((c, i) => [c.id, { left: 0, top: i * 40, width: 100, height: 40 }]));
        act(() => {
            rerender(<Harness cards={scrolled_cards} columns={['todo']} enabled={true} gate={gate} />);
        });

        expect(moveEvents()).toHaveLength(0);
        expect(eventsOfKind('enter')).toHaveLength(0);
        expect(eventsOfKind('skip').some((e) => e.reason === 'bulk')).toBe(true);
        expect(animate_spy).not.toHaveBeenCalled();
    });

    // --- group (column) move ---

    // two groups side by side, each 200px wide; 'todo' leads at left 0, 'done' follows at left 200
    const GROUPS_BASELINE = {
        todo: { left: 0, top: 0, width: 200, height: 400 },
        done: { left: 200, top: 0, width: 200, height: 400 },
    };
    // the same two groups with their order swapped: 'done' now leads
    const GROUPS_SWAPPED = {
        todo: { left: 200, top: 0, width: 200, height: 400 },
        done: { left: 0, top: 0, width: 200, height: 400 },
    };

    it('emits a column-move event with the correct dx when two groups swap order', () => {
        const gate = createPassiveUpdateGate();
        column_rect_lookup = GROUPS_BASELINE;
        rect_lookup = { a: { left: 10, top: 10, width: 100, height: 40 }, b: { left: 210, top: 10, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'b', column: 'done' }]} columns={['todo', 'done']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // passive reorder: the groups swap, each card riding along at the same offset inside its own group
        column_rect_lookup = GROUPS_SWAPPED;
        rect_lookup = { a: { left: 210, top: 10, width: 100, height: 40 }, b: { left: 10, top: 10, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'b', column: 'done' }]} columns={['done', 'todo']} enabled={true} gate={gate} />);
        });

        const column_moves = columnMoveEvents();
        // todo moved right (prev left 0, next left 200): inverse dx = 0 - 200 = -200
        expect(column_moves.find((e) => e.id === 'todo')).toMatchObject({ dx: -200, dy: 0 });
        // done moved left (prev left 200, next left 0): inverse dx = 200 - 0 = 200
        expect(column_moves.find((e) => e.id === 'done')).toMatchObject({ dx: 200, dy: 0 });

        // both cards rode along at an unchanged offset inside their own (moved) group - no card move for either
        expect(moveEvents()).toHaveLength(0);

        // PLAY step fires .animate with the group's own keyframes (no rotate/scale lift)
        flushFrames();
        const animated_with_group_move = animate_spy.mock.calls.some((call) => JSON.stringify(call[0]) === JSON.stringify(buildColumnMoveKeyframes({ dx: -200, dy: 0 })));
        expect(animated_with_group_move).toBe(true);
    });

    it('still animates a card that reorders within its group while the group itself also moves', () => {
        const gate = createPassiveUpdateGate();
        column_rect_lookup = GROUPS_BASELINE;
        // 'a' above 'c' inside todo, baseline
        rect_lookup = { a: { left: 10, top: 10, width: 100, height: 40 }, c: { left: 10, top: 60, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }, { id: 'c', column: 'todo' }]} columns={['todo', 'done']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // the groups swap (todo now at left 200) AND a/c swap their vertical order within todo
        column_rect_lookup = GROUPS_SWAPPED;
        rect_lookup = { a: { left: 210, top: 60, width: 100, height: 40 }, c: { left: 210, top: 10, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'c', column: 'todo' }, { id: 'a', column: 'todo' }]} columns={['done', 'todo']} enabled={true} gate={gate} />);
        });

        // the group's own -200 dx is absorbed by the group move; what's left is each card's within-group vertical swap
        const moves = moveEvents();
        expect(moves.find((m) => m.id === 'a')).toMatchObject({ dx: 0, dy: -50 });
        expect(moves.find((m) => m.id === 'c')).toMatchObject({ dx: 0, dy: 50 });
    });

    it('does not trip the card bulk guard when every id-present card is only riding along with its group', () => {
        const gate = createPassiveUpdateGate();
        const todo_cards = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, column: 'todo' }));
        const done_cards = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, column: 'done' }));
        column_rect_lookup = GROUPS_BASELINE;
        rect_lookup = {
            ...Object.fromEntries(todo_cards.map((c, i) => [c.id, { left: 10, top: i * 20, width: 100, height: 18 }])),
            ...Object.fromEntries(done_cards.map((c, i) => [c.id, { left: 210, top: i * 20, width: 100, height: 18 }])),
        };
        const { rerender } = render(<Harness cards={[...todo_cards, ...done_cards]} columns={['todo', 'done']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // 24 cards are present in both renders, past the bulk threshold, but each rides its own swapped group - zero GENUINE moves
        column_rect_lookup = GROUPS_SWAPPED;
        rect_lookup = {
            ...Object.fromEntries(todo_cards.map((c, i) => [c.id, { left: 210, top: i * 20, width: 100, height: 18 }])),
            ...Object.fromEntries(done_cards.map((c, i) => [c.id, { left: 10, top: i * 20, width: 100, height: 18 }])),
        };
        act(() => {
            rerender(<Harness cards={[...todo_cards, ...done_cards]} columns={['done', 'todo']} enabled={true} gate={gate} />);
        });

        // not skipped as bulk: the groups animate and no 'bulk' skip was recorded
        expect(eventsOfKind('skip').some((e) => e.reason === 'bulk')).toBe(false);
        expect(columnMoveEvents().length).toBe(2);
        expect(moveEvents()).toHaveLength(0);
    });

    it('carries the group delta in dy, not dx, for a rows-oriented board', () => {
        const gate = createPassiveUpdateGate();
        // stacked groups: 'todo' above 'done', both full board width
        column_rect_lookup = { todo: { left: 0, top: 0, width: 400, height: 100 }, done: { left: 0, top: 100, width: 400, height: 100 } };
        rect_lookup = { a: { left: 10, top: 10, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo', 'done']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        // the groups swap vertically: 'todo' drops below 'done'; the card rides along at the same in-group offset
        column_rect_lookup = { todo: { left: 0, top: 100, width: 400, height: 100 }, done: { left: 0, top: 0, width: 400, height: 100 } };
        rect_lookup = { a: { left: 10, top: 110, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['done', 'todo']} enabled={true} gate={gate} />);
        });

        const column_moves = columnMoveEvents();
        expect(column_moves.find((e) => e.id === 'todo')).toMatchObject({ dx: 0, dy: -100 });
        expect(column_moves.find((e) => e.id === 'done')).toMatchObject({ dx: 0, dy: 100 });
        // the card rode along: no card-level move
        expect(moveEvents()).toHaveLength(0);
    });

    it('suppresses column-move events when the gate is hot', () => {
        const gate = createPassiveUpdateGate();
        column_rect_lookup = GROUPS_BASELINE;
        rect_lookup = { a: { left: 10, top: 10, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo', 'done']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        gate.arm();
        column_rect_lookup = GROUPS_SWAPPED;
        rect_lookup = { a: { left: 210, top: 10, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['done', 'todo']} enabled={true} gate={gate} />);
        });

        expect(columnMoveEvents()).toHaveLength(0);
        expect(eventsOfKind('skip').some((e) => e.reason === 'gate-hot')).toBe(true);
    });

    it('no-ops group moves under prefers-reduced-motion', () => {
        window.matchMedia = jest.fn().mockReturnValue({ matches: true, media: '', addEventListener() {}, removeEventListener() {} }) as unknown as typeof window.matchMedia;
        const gate = createPassiveUpdateGate();
        column_rect_lookup = GROUPS_BASELINE;
        rect_lookup = { a: { left: 10, top: 10, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo', 'done']} enabled={true} gate={gate} />);
        clearAnimationProbeEvents();

        column_rect_lookup = GROUPS_SWAPPED;
        rect_lookup = { a: { left: 210, top: 10, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['done', 'todo']} enabled={true} gate={gate} />);
        });

        expect(columnMoveEvents()).toHaveLength(0);
        expect(eventsOfKind('skip').some((e) => e.reason === 'reduced-motion')).toBe(true);
    });

    it('no-ops group moves when disabled (enabled=false)', () => {
        const gate = createPassiveUpdateGate();
        column_rect_lookup = GROUPS_BASELINE;
        rect_lookup = { a: { left: 10, top: 10, width: 100, height: 40 } };
        const { rerender } = render(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['todo', 'done']} enabled={false} gate={gate} />);
        clearAnimationProbeEvents();

        column_rect_lookup = GROUPS_SWAPPED;
        rect_lookup = { a: { left: 210, top: 10, width: 100, height: 40 } };
        act(() => {
            rerender(<Harness cards={[{ id: 'a', column: 'todo' }]} columns={['done', 'todo']} enabled={false} gate={gate} />);
        });

        expect(columnMoveEvents()).toHaveLength(0);
        expect(eventsOfKind('skip').some((e) => e.reason === 'disabled')).toBe(true);
    });
});
