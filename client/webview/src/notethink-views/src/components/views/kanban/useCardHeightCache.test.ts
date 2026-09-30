import { renderHook } from '@testing-library/react';
import { useCardHeightCache } from './useCardHeightCache';
import { CARD_ROW_GAP, DEFAULT_ESTIMATED_CARD_HEIGHT } from './virtualCardSizingOps';

describe('useCardHeightCache', () => {
    it('falls back to the estimate before anything has been measured', () => {
        const { result } = renderHook(() => useCardHeightCache(undefined));
        expect(result.current.getRowSize(['a'], 0)).toBe(DEFAULT_ESTIMATED_CARD_HEIGHT + CARD_ROW_GAP);
    });

    it('reports a changed measurement and reflects it in the next row size', () => {
        const { result } = renderHook(() => useCardHeightCache(undefined));
        const on_changed = jest.fn();
        result.current.reportMeasuredHeight('a', 250, on_changed);
        expect(on_changed).toHaveBeenCalledTimes(1);
        expect(result.current.getRowSize(['a'], 0)).toBe(250 + CARD_ROW_GAP);
    });

    it('does not call on_changed for a re-measurement that rounds to the same height', () => {
        const { result } = renderHook(() => useCardHeightCache(undefined));
        const on_changed = jest.fn();
        result.current.reportMeasuredHeight('a', 250, on_changed);
        result.current.reportMeasuredHeight('a', 250, on_changed);
        expect(on_changed).toHaveBeenCalledTimes(1);
    });

    it('keeps a measured height keyed by stable_id independent of position', () => {
        const { result } = renderHook(() => useCardHeightCache(undefined));
        result.current.reportMeasuredHeight('a', 300, jest.fn());
        expect(result.current.getRowSize(['x', 'a'], 1)).toBe(300 + CARD_ROW_GAP);
    });

    it('ignores a non-positive measurement', () => {
        const { result } = renderHook(() => useCardHeightCache(undefined));
        const on_changed = jest.fn();
        result.current.reportMeasuredHeight('a', 0, on_changed);
        expect(on_changed).not.toHaveBeenCalled();
    });
});
