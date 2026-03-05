import React from 'react';
import { render, screen } from '@testing-library/react';
import KanbanColumn from './KanbanColumn';

describe('KanbanColumn', () => {

    it('renders column with heading', () => {
        render(<KanbanColumn seq={0} value="backlog" />);
        expect(screen.getByRole('columnheader')).toBeInTheDocument();
        expect(screen.getByText('backlog')).toBeInTheDocument();
    });

    it('renders column with region role and aria-label', () => {
        render(<KanbanColumn seq={1} value="doing" />);
        expect(screen.getByRole('region', { name: 'doing' })).toBeInTheDocument();
    });

    it('renders children within notes container', () => {
        render(
            <KanbanColumn seq={0} value="test">
                <div data-testid="child-note">Note 1</div>
            </KanbanColumn>
        );
        expect(screen.getByTestId('child-note')).toBeInTheDocument();
    });

    it('applies pseudo class when type is set', () => {
        const { container } = render(<KanbanColumn seq={0} value="untagged" type="pseudo" />);
        const column = container.firstChild as HTMLElement;
        expect(column.className).toContain('pseudo');
    });

    it('does not apply pseudo class when type is undefined', () => {
        const { container } = render(<KanbanColumn seq={0} value="doing" />);
        const column = container.firstChild as HTMLElement;
        expect(column.className).not.toContain('pseudo');
    });

    it('calculates width based on total_columns', () => {
        const { container } = render(
            <KanbanColumn seq={0} value="backlog" display_options={{ total_columns: 4 }} />
        );
        const column = container.firstChild as HTMLElement;
        expect(column.style.width).toBe('calc(25% - 0.5em)');
    });

    it('defaults to 100% width when no total_columns', () => {
        const { container } = render(
            <KanbanColumn seq={0} value="backlog" />
        );
        const column = container.firstChild as HTMLElement;
        expect(column.style.width).toBe('calc(100% - 0.5em)');
    });

    it('applies draglight class when draglight display option is set', () => {
        const { container } = render(
            <KanbanColumn seq={0} value="doing" display_options={{ draglight: true }} />
        );
        const column = container.firstChild as HTMLElement;
        expect(column.className).toContain('draglight');
    });

    it('passes droppable props to container', () => {
        const inner_ref = jest.fn();
        const { container } = render(
            <KanbanColumn
                seq={0}
                value="doing"
                display_options={{
                    provided: {
                        droppableProps: { 'data-rfd-droppable-id': '1' },
                        innerRef: inner_ref,
                    },
                }}
            />
        );
        const column = container.firstChild as HTMLElement;
        expect(column).toHaveAttribute('data-rfd-droppable-id', '1');
        expect(inner_ref).toHaveBeenCalled();
    });
});
