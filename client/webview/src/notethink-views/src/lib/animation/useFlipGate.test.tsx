import { renderHook } from '@testing-library/react';
import { useFlipGate } from './useFlipGate';
import { KANBAN_ANIMATION_DRAG_GATE_MS } from './flipMath';

describe('useFlipGate', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('is cold while not projecting', () => {
        const { result } = renderHook(({ p }) => useFlipGate(p), { initialProps: { p: false } });
        expect(result.current.isHot()).toBe(false);
    });

    it('does not arm a tail on mount, so a first passive update is not suppressed', () => {
        const { result } = renderHook(({ p }) => useFlipGate(p), { initialProps: { p: false } });
        jest.advanceTimersByTime(KANBAN_ANIMATION_DRAG_GATE_MS + 1);
        expect(result.current.isHot()).toBe(false);
    });

    it('holds the gate for the whole projection, ignoring the timer window', () => {
        const { result, rerender } = renderHook(({ p }) => useFlipGate(p), { initialProps: { p: false } });
        rerender({ p: true });
        expect(result.current.isHot()).toBe(true);
        // held has no expiry — far past any timer window it is still hot
        jest.advanceTimersByTime(KANBAN_ANIMATION_DRAG_GATE_MS * 10);
        expect(result.current.isHot()).toBe(true);
    });

    it('releases into a tail when the projection clears, then cools', () => {
        const { result, rerender } = renderHook(({ p }) => useFlipGate(p), { initialProps: { p: true } });
        expect(result.current.isHot()).toBe(true);
        rerender({ p: false });
        // still hot during the reconcile tail
        expect(result.current.isHot()).toBe(true);
        jest.advanceTimersByTime(KANBAN_ANIMATION_DRAG_GATE_MS + 1);
        expect(result.current.isHot()).toBe(false);
    });

    it('cancels the gate on unmount', () => {
        const { result, unmount } = renderHook(({ p }) => useFlipGate(p), { initialProps: { p: true } });
        const gate = result.current;
        expect(gate.isHot()).toBe(true);
        unmount();
        expect(gate.isHot()).toBe(false);
    });
});
