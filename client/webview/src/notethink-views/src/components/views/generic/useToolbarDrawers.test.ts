import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { useToolbarDrawers } from './useToolbarDrawers';

interface HarnessProps { viewId: string; }

function Harness({ viewId }: HarnessProps): React.ReactElement {
    const drawers = useToolbarDrawers(viewId);
    return React.createElement('div', null,
        React.createElement('button', {
            'data-testid': 'trigger',
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => drawers.toggle_cards(e.currentTarget),
        }, 'trigger'),
        React.createElement('div', { 'data-testid': 'state' }, drawers.active_drawer),
        React.createElement('div', { id: `v${viewId}-cards-drawer`, 'data-testid': 'drawer' }, 'drawer content'),
        React.createElement('div', { 'data-testid': 'outside' }, 'outside'),
    );
}

describe('useToolbarDrawers', () => {
    it('opens on trigger toggle and closes on a second toggle', () => {
        const { getByTestId } = render(React.createElement(Harness, { viewId: 'v1' }));
        fireEvent.click(getByTestId('trigger'));
        expect(getByTestId('state').textContent).toBe('cards');
        fireEvent.click(getByTestId('trigger'));
        expect(getByTestId('state').textContent).toBe('none');
    });

    it('closes on Escape and returns focus to the trigger that opened it', () => {
        const { getByTestId } = render(React.createElement(Harness, { viewId: 'v1' }));
        const trigger = getByTestId('trigger');
        fireEvent.click(trigger);
        expect(getByTestId('state').textContent).toBe('cards');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(getByTestId('state').textContent).toBe('none');
    });

    it('closes on a pointerdown outside the drawer and its trigger', () => {
        const { getByTestId } = render(React.createElement(Harness, { viewId: 'v1' }));
        fireEvent.click(getByTestId('trigger'));
        expect(getByTestId('state').textContent).toBe('cards');
        fireEvent.pointerDown(getByTestId('outside'));
        expect(getByTestId('state').textContent).toBe('none');
    });

    it('does not close on a pointerdown inside the open drawer', () => {
        const { getByTestId } = render(React.createElement(Harness, { viewId: 'v1' }));
        fireEvent.click(getByTestId('trigger'));
        expect(getByTestId('state').textContent).toBe('cards');
        fireEvent.pointerDown(getByTestId('drawer'));
        expect(getByTestId('state').textContent).toBe('cards');
    });

    it('does not close on a pointerdown on the trigger itself', () => {
        const { getByTestId } = render(React.createElement(Harness, { viewId: 'v1' }));
        const trigger = getByTestId('trigger');
        fireEvent.click(trigger);
        expect(getByTestId('state').textContent).toBe('cards');
        fireEvent.pointerDown(trigger);
        expect(getByTestId('state').textContent).toBe('cards');
    });
});

interface LabelledHarnessProps { viewId: string; label: string; }

// one hook instance with its own trigger and state readout, so two can share a view id on one page
function LabelledHarness({ viewId, label }: LabelledHarnessProps): React.ReactElement {
    const drawers = useToolbarDrawers(viewId);
    return React.createElement('div', null,
        React.createElement('button', {
            'data-testid': `${label}-trigger`,
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => drawers.toggle_files(e.currentTarget),
        }, 'trigger'),
        React.createElement('div', { 'data-testid': `${label}-state` }, drawers.active_drawer),
    );
}

interface AutoPairProps { innerLabel: string | undefined; }

// an Auto view's two levels: the outer instance always mounted, the inner one swapped or dropped as the type changes
function AutoPair({ innerLabel }: AutoPairProps): React.ReactElement {
    return React.createElement('div', null,
        React.createElement(LabelledHarness, { viewId: 'v9', label: 'outer' }),
        innerLabel ? React.createElement(LabelledHarness, { key: innerLabel, viewId: 'v9', label: innerLabel }) : null,
        React.createElement('div', { id: 'vv9-files-drawer', 'data-testid': 'drawer' }, 'drawer content'),
    );
}

describe('useToolbarDrawers shared by view id', () => {
    it('shows every instance holding a view id the drawer one of them opened', () => {
        const { getByTestId } = render(React.createElement(AutoPair, { innerLabel: 'inner' }));
        fireEvent.click(getByTestId('inner-trigger'));
        expect(getByTestId('inner-state').textContent).toBe('files');
        expect(getByTestId('outer-state').textContent).toBe('files');
    });

    it('keeps the drawer open when the inner level unmounts, as choosing a concrete type under Auto does', () => {
        const { getByTestId, rerender, queryByTestId } = render(React.createElement(AutoPair, { innerLabel: 'inner' }));
        fireEvent.click(getByTestId('inner-trigger'));
        rerender(React.createElement(AutoPair, { innerLabel: undefined }));
        expect(queryByTestId('inner-state')).toBeNull();
        expect(getByTestId('outer-state').textContent).toBe('files');
        rerender(React.createElement(AutoPair, { innerLabel: 'remounted' }));
        expect(getByTestId('remounted-state').textContent).toBe('files');
    });

    it('does not let the instance that did not open the drawer close it on the trigger itself', () => {
        const { getByTestId } = render(React.createElement(AutoPair, { innerLabel: 'inner' }));
        const trigger = getByTestId('inner-trigger');
        fireEvent.click(trigger);
        fireEvent.pointerDown(trigger);
        expect(getByTestId('outer-state').textContent).toBe('files');
        fireEvent.pointerDown(getByTestId('drawer'));
        expect(getByTestId('outer-state').textContent).toBe('files');
    });

    it('keeps the drawer open across a remount of the only instance holding the view id', () => {
        const { getByTestId, rerender } = render(React.createElement(LabelledHarness, { key: 'kanban', viewId: 'v8', label: 'kanban' }));
        fireEvent.click(getByTestId('kanban-trigger'));
        rerender(React.createElement(LabelledHarness, { key: 'line', viewId: 'v8', label: 'line' }));
        expect(getByTestId('line-state').textContent).toBe('files');
    });

    it('starts closed once no instance holds the view id any more', async () => {
        const first = render(React.createElement(AutoPair, { innerLabel: 'inner' }));
        fireEvent.click(first.getByTestId('inner-trigger'));
        first.unmount();
        await Promise.resolve();
        const second = render(React.createElement(AutoPair, { innerLabel: 'inner' }));
        expect(second.getByTestId('outer-state').textContent).toBe('none');
    });
});
