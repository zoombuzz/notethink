import { renderHook, act } from '@testing-library/react';
import { usePendingWork } from './usePendingWork';

describe('usePendingWork', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('starts with pending false', () => {
        const { result } = renderHook(() => usePendingWork());
        expect(result.current.pending).toBe(false);
    });

    it('does not flip pending true before the show-delay elapses', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        // before show-delay (150 ms by default)
        act(() => { jest.advanceTimersByTime(100); });
        expect(result.current.pending).toBe(false);
    });

    it('flips pending true once the show-delay elapses with a key still outstanding', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(150); });
        expect(result.current.pending).toBe(true);
    });

    it('a fast operation (<150 ms) never flashes the spinner', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(100); });
        act(() => { result.current.clearPending('a'); });
        // run all remaining timers
        act(() => { jest.runAllTimers(); });
        expect(result.current.pending).toBe(false);
    });

    it('a slow operation (>150 ms) shows the spinner for at least the min-visibility window', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(150); });
        expect(result.current.pending).toBe(true);
        // clear immediately - min-visibility (250 ms) keeps it shown
        act(() => { result.current.clearPending('a'); });
        expect(result.current.pending).toBe(true);
        act(() => { jest.advanceTimersByTime(249); });
        expect(result.current.pending).toBe(true);
        act(() => { jest.advanceTimersByTime(1); });
        expect(result.current.pending).toBe(false);
    });

    it('pending stays true through additional marks; clears only after all keys clear', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        act(() => { result.current.markPending('b'); });
        act(() => { jest.advanceTimersByTime(150); });
        expect(result.current.pending).toBe(true);
        act(() => { result.current.clearPending('a'); });
        // 'b' still outstanding - stays pending=true even past min-visibility
        act(() => { jest.advanceTimersByTime(500); });
        expect(result.current.pending).toBe(true);
        act(() => { result.current.clearPending('b'); });
        act(() => { jest.advanceTimersByTime(500); });
        expect(result.current.pending).toBe(false);
    });

    it('per-key safety net auto-clears a stuck mark', () => {
        const { result } = renderHook(() => usePendingWork({ safetyNetMs: 1000 }));
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(150); });
        expect(result.current.pending).toBe(true);
        // safety net fires at 1000 ms
        act(() => { jest.advanceTimersByTime(900); });
        // pending dropped after min-visibility runs out post-safety-clear
        act(() => { jest.advanceTimersByTime(500); });
        expect(result.current.pending).toBe(false);
    });

    it('clearAll releases every key synchronously', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        act(() => { result.current.markPending('b'); });
        act(() => { jest.advanceTimersByTime(150); });
        expect(result.current.pending).toBe(true);
        act(() => { result.current.clearAll(); });
        expect(result.current.pending).toBe(false);
    });

    it('clearAll cancels the pre-show delay timer (no flash after clearAll)', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(100); });
        act(() => { result.current.clearAll(); });
        act(() => { jest.advanceTimersByTime(500); });
        expect(result.current.pending).toBe(false);
    });

    it('a late mark during the hide-delay window keeps pending true', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(150); });
        expect(result.current.pending).toBe(true);
        act(() => { result.current.clearPending('a'); });
        // half-way through min-visibility, fresh work arrives
        act(() => { jest.advanceTimersByTime(100); });
        act(() => { result.current.markPending('b'); });
        // run all timers to let the hide-delay fire AND it should be cancelled because 'b' is now outstanding
        act(() => { jest.advanceTimersByTime(500); });
        expect(result.current.pending).toBe(true);
    });

    it('clearPending on an unknown key is a no-op', () => {
        const { result } = renderHook(() => usePendingWork());
        act(() => { result.current.clearPending('unknown'); });
        expect(result.current.pending).toBe(false);
    });

    it('re-marking the same key refreshes its safety-net timer', () => {
        const { result } = renderHook(() => usePendingWork({ safetyNetMs: 1000 }));
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(800); });
        // re-mark before safety-net fires
        act(() => { result.current.markPending('a'); });
        act(() => { jest.advanceTimersByTime(800); });
        // original safety-net would have fired by now; the refresh pushed it out
        expect(result.current.pending).toBe(true);
    });
});
