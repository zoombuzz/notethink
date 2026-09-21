import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import LaneSeparator from "./LaneSeparator";
import { setBreadthDraft, useBreadthDraft } from "./useBreadthDraft";

/*
 * The gap between lanes, driven with the pointer and the keyboard. The board is a stub with a fixed origin,
 * so a pointer's clientX maps straight to an offset and the breadth it implies is plain arithmetic; the
 * gesture against real lanes is covered in the browser by playwright/specs/kanban-lane-breadth.spec.ts.
 */

// jsdom ships no PointerEvent, so a pointer event would arrive without its coordinates; a mouse event carries them
if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 0;
        }
    }
    Object.defineProperty(globalThis, 'PointerEvent', { value: PointerEventPolyfill, configurable: true });
}

function Probe(props: { viewId: string }): React.ReactElement {
    const draft = useBreadthDraft(props.viewId);
    return <output data-testid="draft">{draft === undefined ? 'none' : String(draft)}</output>;
}

function renderSeparator(overrides: Partial<React.ComponentProps<typeof LaneSeparator>> = {}): { on_commit: jest.Mock; separator: HTMLElement; rerender: (next: Partial<React.ComponentProps<typeof LaneSeparator>>) => void } {
    const board = document.createElement('div');
    board.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 400, right: 900, bottom: 450, x: 100, y: 50, toJSON() {} }) as DOMRect;
    const on_commit = jest.fn();
    const tree = (props: Partial<React.ComponentProps<typeof LaneSeparator>>): React.ReactElement => (
        <>
            <LaneSeparator viewId="v1" boardRef={{ current: board }} orientation="columns" lanesBefore={2} breadth={220} onCommit={on_commit} {...overrides} {...props} />
            <Probe viewId="v1" />
        </>
    );
    const view = render(tree({}));
    return { on_commit, separator: screen.getByTestId('lane-separator'), rerender: (next) => view.rerender(tree(next)) };
}

describe('LaneSeparator', () => {

    beforeEach(() => {
        act(() => { setBreadthDraft('v1', undefined); });
    });

    it('is a focusable separator carrying its value, its floor and a translated label', () => {
        const { separator } = renderSeparator();
        expect(separator).toHaveAttribute('role', 'separator');
        expect(separator).toHaveAttribute('aria-orientation', 'vertical');
        expect(separator).toHaveAttribute('aria-valuenow', '220');
        expect(separator).toHaveAttribute('aria-valuemin', '120');
        expect(separator).toHaveAttribute('aria-label', 'Resize column width');
        expect(separator).toHaveAttribute('tabindex', '0');
    });

    it('is horizontal and labelled for rows once the lanes are stacked', () => {
        const { separator } = renderSeparator({ orientation: 'rows' });
        expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
        expect(separator).toHaveAttribute('aria-label', 'Resize row height');
    });

    /*
     * Two lanes before the gap, an 8px gap: a pointer 100 + 2 * 250 + 8 + 4 in is over two 250px lanes, the
     * gap between them and half the gap the pointer stands in.
     */
    it('publishes the breadth live while dragging and writes it once on release', () => {
        const { on_commit, separator } = renderSeparator();
        fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 + 2 * 220 + 12 });
        fireEvent.pointerMove(separator, { pointerId: 1, clientX: 100 + 2 * 250 + 12 });
        expect(screen.getByTestId('draft')).toHaveTextContent('250');
        fireEvent.pointerMove(separator, { pointerId: 1, clientX: 100 + 2 * 260 + 12 });
        expect(on_commit).not.toHaveBeenCalled();
        fireEvent.pointerUp(separator, { pointerId: 1, clientX: 100 + 2 * 260 + 12 });
        expect(on_commit).toHaveBeenCalledTimes(1);
        expect(on_commit).toHaveBeenCalledWith(260);
    });

    // the board hands the live draft back in as `breadth`, so a release must compare against where the drag began
    it('still writes on release when the board has fed the dragged breadth back in', () => {
        const { on_commit, separator, rerender } = renderSeparator();
        fireEvent.pointerDown(separator, { pointerId: 1 });
        fireEvent.pointerMove(separator, { pointerId: 1, clientX: 100 + 2 * 280 + 12 });
        rerender({ breadth: 280 });
        fireEvent.pointerUp(separator, { pointerId: 1, clientX: 100 + 2 * 280 + 12 });
        expect(on_commit).toHaveBeenCalledWith(280);
    });

    it('measures down the board for a stacked layout', () => {
        const { on_commit, separator } = renderSeparator({ orientation: 'rows', lanesBefore: 1 });
        fireEvent.pointerDown(separator, { pointerId: 1, clientY: 50 + 220 + 4 });
        fireEvent.pointerMove(separator, { pointerId: 1, clientY: 50 + 300 + 4 });
        fireEvent.pointerUp(separator, { pointerId: 1, clientY: 50 + 300 + 4 });
        expect(on_commit).toHaveBeenCalledWith(300);
    });

    it('holds a dragged breadth at the floor', () => {
        const { on_commit, separator } = renderSeparator();
        fireEvent.pointerDown(separator, { pointerId: 1 });
        fireEvent.pointerMove(separator, { pointerId: 1, clientX: 100 });
        fireEvent.pointerUp(separator, { pointerId: 1, clientX: 100 });
        expect(on_commit).toHaveBeenCalledWith(120);
    });

    it('writes nothing and drops the draft when the pointer is cancelled', () => {
        const { on_commit, separator } = renderSeparator();
        fireEvent.pointerDown(separator, { pointerId: 1 });
        fireEvent.pointerMove(separator, { pointerId: 1, clientX: 100 + 2 * 300 });
        fireEvent.pointerCancel(separator, { pointerId: 1 });
        expect(on_commit).not.toHaveBeenCalled();
        expect(screen.getByTestId('draft')).toHaveTextContent('none');
    });

    it('nudges by ten with the arrow keys along its axis, and fifty with shift', () => {
        const { on_commit, separator } = renderSeparator();
        fireEvent.keyDown(separator, { key: 'ArrowRight' });
        expect(on_commit).toHaveBeenLastCalledWith(230);
        fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
        expect(on_commit).toHaveBeenLastCalledWith(170);
        fireEvent.keyDown(separator, { key: 'ArrowDown' });
        expect(on_commit).toHaveBeenCalledTimes(2);
    });

    it('answers the vertical arrows when the lanes are rows', () => {
        const { on_commit, separator } = renderSeparator({ orientation: 'rows' });
        fireEvent.keyDown(separator, { key: 'ArrowDown' });
        expect(on_commit).toHaveBeenLastCalledWith(230);
        fireEvent.keyDown(separator, { key: 'ArrowRight' });
        expect(on_commit).toHaveBeenCalledTimes(1);
    });
});
