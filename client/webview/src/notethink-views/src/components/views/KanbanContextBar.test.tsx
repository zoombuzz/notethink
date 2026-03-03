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

    it('renders breadcrumb trail when provided', () => {
        const breadcrumb = <div data-testid="breadcrumb">Trail</div>;
        const props = makeViewProps({
            nested: { breadcrumb_trail: breadcrumb },
        });
        render(<KanbanContextBar {...props} />);
        expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
    });

    it('renders empty when no breadcrumb trail', () => {
        const { container } = render(<KanbanContextBar {...makeViewProps()} />);
        const bar = container.querySelector('#vtest-kanban-context');
        expect(bar).toBeInTheDocument();
        expect(bar?.children).toHaveLength(0);
    });

    it('renders settings gear button when onSettingsClick provided', () => {
        const handle_settings = jest.fn();
        render(<KanbanContextBar {...makeViewProps()} onSettingsClick={handle_settings} />);
        const button = screen.getByTestId('kanban-settings-button');
        expect(button).toBeInTheDocument();
        fireEvent.click(button);
        expect(handle_settings).toHaveBeenCalledTimes(1);
    });

    it('does not render settings button when onSettingsClick not provided', () => {
        render(<KanbanContextBar {...makeViewProps()} />);
        expect(screen.queryByTestId('kanban-settings-button')).not.toBeInTheDocument();
    });
});
