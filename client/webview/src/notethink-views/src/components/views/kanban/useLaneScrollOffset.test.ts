import { renderHook, act } from '@testing-library/react';
import type { RefObject } from 'react';
import { useLaneScrollOffset } from './useLaneScrollOffset';

/**
 * A lane nested under an ancestor `findScrollParent` resolves as the real scroller (`overflow-y: auto`
 * and overflowing); `getComputedStyle` is stubbed only for it, so every other node uses jsdom's real one.
 */
function laneUnderScrollParent(top: number): { container: RefObject<HTMLElement | null>; scroller: HTMLElement } {
    const scroller = document.createElement('div');
    const container = document.createElement('div');
    scroller.appendChild(container);
    document.body.appendChild(scroller);
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true });
    container.getBoundingClientRect = jest.fn(() => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
    const original_get_computed_style = window.getComputedStyle.bind(window);
    jest.spyOn(window, 'getComputedStyle').mockImplementation((node: Element) => (
        node === scroller ? ({ overflowY: 'auto' } as CSSStyleDeclaration) : original_get_computed_style(node)
    ));
    return { container: { current: container }, scroller };
}

describe('useLaneScrollOffset', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('answers zero before the container has ever been measured', () => {
        const ref: RefObject<HTMLElement | null> = { current: null };
        const { result } = renderHook(() => useLaneScrollOffset(ref, 1000, 300));
        expect(result.current.scroll_offset).toBe(0);
    });

    it('measures how far the container has scrolled past its own top edge on mount', () => {
        const { container } = laneUnderScrollParent(-250);
        const { result } = renderHook(() => useLaneScrollOffset(container, 1000, 300));
        expect(result.current.scroll_offset).toBe(250);
    });

    it('never answers a negative offset for a container still fully below the viewport top', () => {
        const { container } = laneUnderScrollParent(400);
        const { result } = renderHook(() => useLaneScrollOffset(container, 1000, 300));
        expect(result.current.scroll_offset).toBe(0);
    });

    it('lets a caller pin the offset directly, with no DOM measurement involved', () => {
        const ref: RefObject<HTMLElement | null> = { current: null };
        const { result } = renderHook(() => useLaneScrollOffset(ref, 1000, 300));
        act(() => { result.current.setScrollOffset(500); });
        expect(result.current.scroll_offset).toBe(500);
    });

    it('clamps a pinned offset to what the content has left to give', () => {
        const ref: RefObject<HTMLElement | null> = { current: null };
        const { result } = renderHook(() => useLaneScrollOffset(ref, 1000, 300));
        act(() => { result.current.setScrollOffset(5000); });
        expect(result.current.scroll_offset).toBe(700);
    });

    describe('scroll filtering (the real scroll ancestor only)', () => {
        beforeEach(() => { jest.useFakeTimers(); });
        afterEach(() => { jest.useRealTimers(); });

        it('re-measures when the lane\'s own scroll ancestor scrolls', () => {
            const { container, scroller } = laneUnderScrollParent(0);
            const { result } = renderHook(() => useLaneScrollOffset(container, 1000, 300));
            (container.current as HTMLElement).getBoundingClientRect = jest.fn(() => ({ top: -400, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
            act(() => {
                scroller.dispatchEvent(new Event('scroll'));
                jest.advanceTimersByTime(200);
            });
            expect(result.current.scroll_offset).toBe(400);
        });

        // regression guard: a document-root scroll dispatches on `document`, not on scrollingElement/body directly
        it('re-measures on a scroll of the document root, when the container has no other scrollable ancestor', () => {
            const container = document.createElement('div');
            document.body.appendChild(container);
            container.getBoundingClientRect = jest.fn(() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
            const { result } = renderHook(() => useLaneScrollOffset({ current: container }, 1000, 300));
            container.getBoundingClientRect = jest.fn(() => ({ top: -600, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
            act(() => {
                document.dispatchEvent(new Event('scroll'));
                jest.advanceTimersByTime(200);
            });
            expect(result.current.scroll_offset).toBe(600);
        });

        it('does NOT re-measure on a scroll of an unrelated element', () => {
            const { container } = laneUnderScrollParent(0);
            const { result } = renderHook(() => useLaneScrollOffset(container, 1000, 300));
            (container.current as HTMLElement).getBoundingClientRect = jest.fn(() => ({ top: -400, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
            const unrelated = document.createElement('div');
            document.body.appendChild(unrelated);
            act(() => {
                unrelated.dispatchEvent(new Event('scroll'));
                jest.advanceTimersByTime(200);
            });
            expect(result.current.scroll_offset).toBe(0);
        });

        it('re-measures on a window resize', () => {
            const { container } = laneUnderScrollParent(0);
            const { result } = renderHook(() => useLaneScrollOffset(container, 1000, 300));
            (container.current as HTMLElement).getBoundingClientRect = jest.fn(() => ({ top: -150, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }));
            act(() => { window.dispatchEvent(new Event('resize')); });
            expect(result.current.scroll_offset).toBe(150);
        });
    });
});
