import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import SplitPanes from './SplitPanes';

// jsdom has no PointerEvent, and without one the pointer events fireEvent builds carry no coordinates
if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 0;
        }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

function mockHostWidth(host: HTMLElement, width: number): void {
    host.getBoundingClientRect = () => ({ left: 0, right: width, width, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) });
}

describe('SplitPanes', () => {
    it('adds only a transparent host around a lone pane: no handle, no second pane, not flagged open', () => {
        const { queryByTestId, getByTestId } = render(<SplitPanes primary={<p>first</p>} ratio={0.5} onRatioChange={jest.fn()} />);
        expect(getByTestId('split-host').getAttribute('data-split-open')).toBe('false');
        expect(queryByTestId('split-handle')).toBeNull();
        expect(queryByTestId('split-pane-secondary')).toBeNull();
    });

    it('keeps the first pane mounted when the second opens', () => {
        let mounts = 0;
        function Probe(): React.ReactElement {
            React.useEffect(() => { mounts += 1; }, []);
            return <p>first</p>;
        }
        const { rerender, getByTestId } = render(<SplitPanes primary={<Probe />} ratio={0.5} onRatioChange={jest.fn()} />);
        rerender(<SplitPanes primary={<Probe />} secondary={<p>second</p>} ratio={0.5} onRatioChange={jest.fn()} />);
        expect(getByTestId('split-handle')).toBeTruthy();
        expect(mounts).toBe(1);
    });

    it('sizes the first pane from the committed ratio, clamped', () => {
        const { getByTestId } = render(<SplitPanes primary={<p>a</p>} secondary={<p>b</p>} ratio={0.4} onRatioChange={jest.fn()} />);
        expect(getByTestId('split-pane-primary').style.flexBasis).toBe('calc(40% - 3px)');
        expect(getByTestId('split-handle').getAttribute('aria-valuenow')).toBe('40');
    });

    it('commits the ratio once, on release, not on every drag frame', () => {
        const onRatioChange = jest.fn();
        const { getByTestId } = render(<SplitPanes primary={<p>a</p>} secondary={<p>b</p>} ratio={0.5} onRatioChange={onRatioChange} />);
        mockHostWidth(getByTestId('split-host'), 1000);
        const handle = getByTestId('split-handle');
        fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
        fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
        expect(onRatioChange).not.toHaveBeenCalled();
        expect(getByTestId('split-handle').getAttribute('aria-valuenow')).toBe('30');
        fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });
        expect(onRatioChange).toHaveBeenCalledTimes(1);
        expect(onRatioChange).toHaveBeenCalledWith(0.3);
    });

    it('clamps a drag past either edge', () => {
        const onRatioChange = jest.fn();
        const { getByTestId } = render(<SplitPanes primary={<p>a</p>} secondary={<p>b</p>} ratio={0.5} onRatioChange={onRatioChange} />);
        mockHostWidth(getByTestId('split-host'), 1000);
        const handle = getByTestId('split-handle');
        fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
        fireEvent.pointerUp(handle, { clientX: 5, pointerId: 1 });
        expect(onRatioChange).toHaveBeenLastCalledWith(0.2);
    });

    it('steps the ratio from the keyboard and jumps to the bounds with Home and End', () => {
        const onRatioChange = jest.fn();
        const { getByTestId } = render(<SplitPanes primary={<p>a</p>} secondary={<p>b</p>} ratio={0.5} onRatioChange={onRatioChange} />);
        const handle = getByTestId('split-handle');
        act(() => { fireEvent.keyDown(handle, { key: 'ArrowLeft' }); });
        expect(onRatioChange).toHaveBeenLastCalledWith(0.45);
        act(() => { fireEvent.keyDown(handle, { key: 'End' }); });
        expect(onRatioChange).toHaveBeenLastCalledWith(0.8);
        act(() => { fireEvent.keyDown(handle, { key: 'Home' }); });
        expect(onRatioChange).toHaveBeenLastCalledWith(0.2);
        onRatioChange.mockClear();
        act(() => { fireEvent.keyDown(handle, { key: 'a' }); });
        expect(onRatioChange).not.toHaveBeenCalled();
    });
});
