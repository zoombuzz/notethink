import { act, renderHook } from '@testing-library/react';
import { useAgentClockNow } from './useAgentClockNow';

describe('useAgentClockNow', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('answers the current time on mount', () => {
        jest.setSystemTime(Date.parse('2026-09-23T10:00:00Z'));
        const { result } = renderHook(() => useAgentClockNow(true));
        expect(result.current).toBe(Date.parse('2026-09-23T10:00:00Z'));
    });

    it('ticks once a minute while active', () => {
        jest.setSystemTime(Date.parse('2026-09-23T10:00:00Z'));
        const { result } = renderHook(() => useAgentClockNow(true));
        act(() => { jest.advanceTimersByTime(60_000); });
        expect(result.current).toBe(Date.parse('2026-09-23T10:01:00Z'));
    });

    it('never ticks while inactive', () => {
        jest.setSystemTime(Date.parse('2026-09-23T10:00:00Z'));
        const { result } = renderHook(() => useAgentClockNow(false));
        act(() => { jest.advanceTimersByTime(5 * 60_000); });
        expect(result.current).toBe(Date.parse('2026-09-23T10:00:00Z'));
    });

    it('stops ticking once active turns false, without throwing on the clear', () => {
        jest.setSystemTime(Date.parse('2026-09-23T10:00:00Z'));
        const { result, rerender } = renderHook(({ active }) => useAgentClockNow(active), { initialProps: { active: true } });
        act(() => { jest.advanceTimersByTime(60_000); });
        expect(result.current).toBe(Date.parse('2026-09-23T10:01:00Z'));
        rerender({ active: false });
        act(() => { jest.advanceTimersByTime(60_000); });
        expect(result.current).toBe(Date.parse('2026-09-23T10:01:00Z'));
    });
});
