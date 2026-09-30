import { renderHook, act } from '@testing-library/react';
import { useLaneListHeight } from './useLaneListHeight';
import { MIN_LANE_LIST_HEIGHT, LANE_LIST_BOTTOM_MARGIN } from './virtualCardSizingOps';

function boardRefAt(top: number): React.RefObject<HTMLDivElement | null> {
    const el = document.createElement('div');
    el.getBoundingClientRect = jest.fn(() => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
    document.body.appendChild(el);
    return { current: el };
}

describe('useLaneListHeight', () => {
    const original_inner_height = window.innerHeight;
    afterEach(() => {
        Object.defineProperty(window, 'innerHeight', { value: original_inner_height, configurable: true });
    });

    it('answers the floor, and an undefined available, before the board has ever measured', () => {
        const ref: React.RefObject<HTMLDivElement | null> = { current: null };
        const { result } = renderHook(() => useLaneListHeight(ref));
        expect(result.current.list_height).toBe(MIN_LANE_LIST_HEIGHT);
        expect(result.current.available).toBeUndefined();
    });

    it('measures the window height minus the board top and the bottom margin, and publishes the unfloored reading too', () => {
        Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
        const ref = boardRefAt(200);
        const { result } = renderHook(() => useLaneListHeight(ref));
        expect(result.current.list_height).toBe(900 - 200 - LANE_LIST_BOTTOM_MARGIN);
        expect(result.current.available).toBe(900 - 200);
    });

    it('clamps a negative board top (scrolled past the viewport top) to zero rather than treating it as extra ceiling', () => {
        Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
        const ref = boardRefAt(-8000);
        const { result } = renderHook(() => useLaneListHeight(ref));
        expect(result.current.available).toBe(900);
    });

    it('re-measures on window resize', () => {
        Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
        const ref = boardRefAt(200);
        const { result } = renderHook(() => useLaneListHeight(ref));
        const before = result.current.list_height;
        Object.defineProperty(window, 'innerHeight', { value: 1200, configurable: true });
        act(() => { window.dispatchEvent(new Event('resize')); });
        expect(result.current.list_height).toBe(before + 300);
    });

    describe('scroll filtering (page-level only)', () => {
        beforeEach(() => { jest.useFakeTimers(); });
        afterEach(() => { jest.useRealTimers(); });

        it('re-measures on a page-level scroll (target is document)', () => {
            Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
            const ref = boardRefAt(200);
            const { result } = renderHook(() => useLaneListHeight(ref));
            const before = result.current.list_height;
            (ref.current as HTMLDivElement).getBoundingClientRect = jest.fn(() => ({ top: 100, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
            act(() => {
                document.dispatchEvent(new Event('scroll'));
                jest.advanceTimersByTime(200);
            });
            expect(result.current.list_height).not.toBe(before);
        });

        /*
         * The board's own horizontal scroller dispatches 'scroll' on itself, which a capture-phase window
         * listener still sees; recomputing on it was observed to corrupt an in-progress keyboard drag.
         */
        it('does NOT re-measure on a nested scroll (a lane list or the board horizontal scroller)', () => {
            Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
            const ref = boardRefAt(200);
            const { result } = renderHook(() => useLaneListHeight(ref));
            const before = result.current.list_height;
            (ref.current as HTMLDivElement).getBoundingClientRect = jest.fn(() => ({ top: 100, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
            const nested_scroller = document.createElement('div');
            document.body.appendChild(nested_scroller);
            act(() => {
                nested_scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
                jest.advanceTimersByTime(200);
            });
            expect(result.current.list_height).toBe(before);
        });
    });
});
