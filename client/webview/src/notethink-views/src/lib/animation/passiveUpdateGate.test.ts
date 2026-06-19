import { createPassiveUpdateGate } from './passiveUpdateGate';
import { KANBAN_ANIMATION_DRAG_GATE_MS } from './flipMath';

describe('createPassiveUpdateGate', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('is not hot when freshly created', () => {
        const gate = createPassiveUpdateGate();
        expect(gate.isHot()).toBe(false);
    });

    it('is hot immediately after arm()', () => {
        const gate = createPassiveUpdateGate();
        gate.arm();
        expect(gate.isHot()).toBe(true);
    });

    it('cools after the default window elapses', () => {
        const gate = createPassiveUpdateGate();
        gate.arm();
        jest.advanceTimersByTime(KANBAN_ANIMATION_DRAG_GATE_MS + 1);
        expect(gate.isHot()).toBe(false);
    });

    it('stays hot until the window elapses, then cools', () => {
        const gate = createPassiveUpdateGate(100);
        gate.arm();
        jest.advanceTimersByTime(99);
        expect(gate.isHot()).toBe(true);
        jest.advanceTimersByTime(2);
        expect(gate.isHot()).toBe(false);
    });

    it('re-arm resets the window', () => {
        const gate = createPassiveUpdateGate(100);
        gate.arm();
        jest.advanceTimersByTime(80);
        gate.arm();
        jest.advanceTimersByTime(80);
        // 160ms since first arm but only 80ms since re-arm — still within the window
        expect(gate.isHot()).toBe(true);
        jest.advanceTimersByTime(21);
        expect(gate.isHot()).toBe(false);
    });

    it('cancel() stops a pending cool-down and cools immediately', () => {
        const gate = createPassiveUpdateGate(100);
        gate.arm();
        gate.cancel();
        expect(gate.isHot()).toBe(false);
        // the cleared timer must not re-fire and flip any state later
        jest.advanceTimersByTime(200);
        expect(gate.isHot()).toBe(false);
    });

    it('hold() stays hot indefinitely, ignoring the timer window', () => {
        const gate = createPassiveUpdateGate(100);
        gate.hold();
        expect(gate.isHot()).toBe(true);
        // far past any timer window — a hold has no expiry
        jest.advanceTimersByTime(10_000);
        expect(gate.isHot()).toBe(true);
    });

    it('release() clears the hold and starts the tail, which then cools', () => {
        const gate = createPassiveUpdateGate(100);
        gate.hold();
        gate.release();
        // still hot during the tail
        expect(gate.isHot()).toBe(true);
        jest.advanceTimersByTime(99);
        expect(gate.isHot()).toBe(true);
        jest.advanceTimersByTime(2);
        expect(gate.isHot()).toBe(false);
    });

    it('a re-hold after release pins it hot again (projection re-takes the gate)', () => {
        const gate = createPassiveUpdateGate(100);
        gate.hold();
        gate.release();
        jest.advanceTimersByTime(50);
        gate.hold();
        // the tail timer must not cool it while held
        jest.advanceTimersByTime(10_000);
        expect(gate.isHot()).toBe(true);
    });

    it('cancel() clears a hold too', () => {
        const gate = createPassiveUpdateGate(100);
        gate.hold();
        gate.cancel();
        expect(gate.isHot()).toBe(false);
        jest.advanceTimersByTime(10_000);
        expect(gate.isHot()).toBe(false);
    });
});
