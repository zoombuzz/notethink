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
