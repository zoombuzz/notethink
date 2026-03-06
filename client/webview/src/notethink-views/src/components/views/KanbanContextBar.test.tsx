import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import KanbanContextBar from './KanbanContextBar';
import type { ViewProps } from '../../types/ViewProps';

function makeViewProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'test-kanban',
        type: 'kanban',
        display_options: {},
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
        },
        ...overrides,
    };
}

describe('KanbanContextBar', () => {

    it('renders container with correct id', () => {
        const { container } = render(<KanbanContextBar {...makeViewProps()} />);
        expect(container.querySelector('#vtest-kanban-context')).toBeInTheDocument();
    });

    it('renders data-level attribute', () => {
        const { container } = render(
            <KanbanContextBar {...makeViewProps({ display_options: { level: 2 } })} />
        );
        const bar = container.querySelector('#vtest-kanban-context');
        expect(bar).toHaveAttribute('data-level', '2');
    });

    it('renders data-parent-content-seq attribute', () => {
        const { container } = render(
            <KanbanContextBar {...makeViewProps({ display_options: { parent_context_seq: 5 } })} />
        );
        const bar = container.querySelector('#vtest-kanban-context');
        expect(bar).toHaveAttribute('data-parent-content-seq', '5');
    });

    it('renders without settings button (moved to toolbar)', () => {
        render(<KanbanContextBar {...makeViewProps()} />);
        expect(screen.queryByTestId('kanban-settings-button')).not.toBeInTheDocument();
    });
});
