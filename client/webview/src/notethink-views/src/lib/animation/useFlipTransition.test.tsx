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
import { buildMoveKeyframes, KANBAN_ANIMATION_GLOBAL_CAP_MS } from './flipMath';

const CLASS_NAMES: FlipClassNames = { flipping: 'flipping', columnEntering: 'columnEntering', columnExiting: 'columnExiting' };

interface RectLookup { [id: string]: { left: number; top: number; width: number; height: number }; }

// the test controls per-id rects; the mock reads data-flip-id off the element to pick its rect.
let rect_lookup: RectLookup = {};

// per-id card placement: id -> column value (render order follows the array)
interface CardSpec { id: string; column: string; }

interface HarnessProps {
    cards: CardSpec[];
    columns: string[];
    enabled: boolean;
    gate: PassiveUpdateGate;
}

/**
 * minimal harness: a measured container holding one [data-flip-column-id] div per column, each
 * holding its [data-flip-id] cards. drives useFlipTransition with the test-controlled inputs.
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
            {props.columns.map((col) => (
                <div key={col} data-flip-column-id={col}>
                    {props.cards.filter((c) => c.column === col).map((c) => (
                        <div key={c.id} data-flip-id={c.id}>{c.id}</div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function moveEvents(): AnimationProbeEvent[] {
    return getAnimationProbeEvents().filter((e) => e.kind === 'move');
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

        original_grbc = Element.prototype.getBoundingClientRect;
        original_animate = Element.prototype.animate;
        original_get_animations = Element.prototype.getAnimations;
        original_match_media = window.matchMedia;
        original_raf = globalThis.requestAnimationFrame;

        // per-id rect mock: read data-flip-id and return the test's lookup (fallback to a zero rect)
        Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
            const id = this.getAttribute('data-flip-id');
            const r = (id !== null && rect_lookup[id]) || { left: 0, top: 0, width: 0, height: 0 };
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

        // render 2: passive reorder — a and b swap positions (signature changes); a moves from top 0 -> 50
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

        // arm the gate just before the next render — the hook must skip animating
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
});
