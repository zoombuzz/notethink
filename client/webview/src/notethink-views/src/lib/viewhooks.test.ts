import React from 'react';
import { render, act } from '@testing-library/react';
import { useScrollToCaret } from './viewhooks';
import { scrollVirtualLaneToNoteId } from './virtualScrollRegistry';
import type { NoteDisplayOptions, NoteProps } from '../types/NoteProps';

jest.mock('./virtualScrollRegistry', () => ({
    scrollVirtualLaneToNoteId: jest.fn(),
}));

const mocked_scroll = scrollVirtualLaneToNoteId as jest.Mock;

interface HarnessProps { display_options: NoteDisplayOptions; view_id: string; }

function Harness({ display_options, view_id }: HarnessProps): React.ReactElement {
    useScrollToCaret(display_options, view_id, undefined);
    return React.createElement('div', { id: `v${view_id}-n1` }, 'story');
}

function baseDisplayOptions(): NoteDisplayOptions {
    return {
        settings: { scrollNoteIntoView: true },
        focused_seqs: [1],
        focused_notes: [{ seq: 1, stable_id: 'story-1' } as unknown as NoteProps],
    };
}

describe('useScrollToCaret virtualizer integration', () => {
    let original_raf: typeof globalThis.requestAnimationFrame;
    let original_caf: typeof globalThis.cancelAnimationFrame;
    let scroll_by_spy: jest.Mock;
    // a manual FIFO queue, not jest's fake-timer shim, which would collapse the two rAF frames into one
    let raf_queue: FrameRequestCallback[];

    function flushOneFrame(): void {
        const cb = raf_queue.shift();
        act(() => { cb?.(0); });
    }

    beforeEach(() => {
        mocked_scroll.mockReset();
        raf_queue = [];
        original_raf = globalThis.requestAnimationFrame;
        original_caf = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { raf_queue.push(cb); return raf_queue.length; }) as unknown as typeof globalThis.requestAnimationFrame;
        globalThis.cancelAnimationFrame = (() => {}) as unknown as typeof globalThis.cancelAnimationFrame;
        scroll_by_spy = jest.fn();
        Element.prototype.scrollBy = scroll_by_spy as unknown as typeof Element.prototype.scrollBy;
        Element.prototype.getBoundingClientRect = jest.fn(() => ({
            top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}),
        })) as unknown as typeof Element.prototype.getBoundingClientRect;
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = original_raf;
        globalThis.cancelAnimationFrame = original_caf;
    });

    it('asks the virtual scroll registry with the focused note\'s identity', () => {
        render(React.createElement(Harness, { display_options: baseDisplayOptions(), view_id: 'v1' }));
        expect(mocked_scroll).toHaveBeenCalledWith('v1', 'story-1');
    });

    it('frames after a single frame when no virtualized lane claims the note', () => {
        mocked_scroll.mockReturnValue(false);
        render(React.createElement(Harness, { display_options: baseDisplayOptions(), view_id: 'v1' }));
        flushOneFrame();
        expect(scroll_by_spy).toHaveBeenCalled();
    });

    it('waits an extra frame before framing when a virtualized lane claims the note', () => {
        mocked_scroll.mockReturnValue(true);
        render(React.createElement(Harness, { display_options: baseDisplayOptions(), view_id: 'v1' }));
        // first frame only lets the lane's own scroll-offset-triggered re-render land - no framing yet
        flushOneFrame();
        expect(scroll_by_spy).not.toHaveBeenCalled();
        // second frame: the row is now assumed mounted, so framing runs
        flushOneFrame();
        expect(scroll_by_spy).toHaveBeenCalled();
    });
});

describe('useScrollToCaret vertical framing against the root (document-level) scroller', () => {
    let original_raf: typeof globalThis.requestAnimationFrame;
    let original_caf: typeof globalThis.cancelAnimationFrame;
    let original_inner_height: number;
    let scroll_by_spy: jest.Mock;
    let raf_queue: FrameRequestCallback[];

    function flushOneFrame(): void {
        const cb = raf_queue.shift();
        act(() => { cb?.(0); });
    }

    beforeEach(() => {
        mocked_scroll.mockReset();
        mocked_scroll.mockReturnValue(false);
        raf_queue = [];
        original_raf = globalThis.requestAnimationFrame;
        original_caf = globalThis.cancelAnimationFrame;
        original_inner_height = window.innerHeight;
        globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { raf_queue.push(cb); return raf_queue.length; }) as unknown as typeof globalThis.requestAnimationFrame;
        globalThis.cancelAnimationFrame = (() => {}) as unknown as typeof globalThis.cancelAnimationFrame;
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
        scroll_by_spy = jest.fn();
        Element.prototype.scrollBy = scroll_by_spy as unknown as typeof Element.prototype.scrollBy;
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = original_raf;
        globalThis.cancelAnimationFrame = original_caf;
        Object.defineProperty(window, 'innerHeight', { value: original_inner_height, configurable: true });
    });

    /*
     * Regression guard: the root scrolling element's own getBoundingClientRect() describes the full
     * content box (the fake 5000px-tall one below), not the viewport - a story deep in that box can
     * look "already framed" if bounds are taken from it instead of the real viewport, stranding a
     * focused card off-screen with nothing left to scroll.
     */
    it('scrolls to the viewport bounds, not the root element\'s own (uncapped) content box', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowing to the mocked story element by id, the same technique the rect mock above narrows on
        Element.prototype.getBoundingClientRect = jest.fn(function (this: any) {
            if (this.id === 'vv1-n1') { return { top: 4000, bottom: 4040, left: 0, right: 100, width: 100, height: 40, x: 0, y: 4000, toJSON: () => ({}) }; }
            return { top: 0, bottom: 5000, left: 0, right: 800, width: 800, height: 5000, x: 0, y: 0, toJSON: () => ({}) };
        }) as unknown as typeof Element.prototype.getBoundingClientRect;
        render(React.createElement(Harness, { display_options: baseDisplayOptions(), view_id: 'v1' }));
        flushOneFrame();
        expect(scroll_by_spy).toHaveBeenCalledWith({ top: 3284, behavior: 'smooth' });
    });
});
