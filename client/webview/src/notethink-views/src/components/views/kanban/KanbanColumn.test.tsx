import React from 'react';
import { render, screen, within } from '@testing-library/react';
import KanbanColumn from './KanbanColumn';

describe('KanbanColumn', () => {

    it('renders column with heading (formatted from the raw status slug)', () => {
        render(<KanbanColumn seq={0} value="backlog" />);
        const heading = screen.getByRole('columnheader');
        // title-cased by formatColumnLabel; scoped to the heading since the footer repeats the same text
        expect(within(heading).getByText('Backlog')).toBeInTheDocument();
    });

    it('renders column with region role and aria-label using the raw slug', () => {
        render(<KanbanColumn seq={1} value="doing" />);
        expect(screen.getByRole('region', { name: 'doing' })).toBeInTheDocument();
    });

    it('formats dashed slugs in the heading with spaces and title-case', () => {
        render(<KanbanColumn seq={0} value="code-review" />);
        // header shows the user-facing label; scoped to the heading since the repeated footer carries the same text
        expect(within(screen.getByRole('columnheader')).getByText('Code Review')).toBeInTheDocument();
        // aria-label keeps the canonical slug for assistive tech / scripting
        expect(screen.getByRole('region', { name: 'code-review' })).toBeInTheDocument();
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

    it('sets no inline width, so the stylesheet owns the group on whichever axis it is laid out along', () => {
        const { container } = render(<KanbanColumn seq={0} value="backlog" />);
        const column = container.firstChild as HTMLElement;
        expect(column.style.width).toBe('');
    });

    it('publishes the group and its card list, which is how the width measurement finds them', () => {
        const { container } = render(<KanbanColumn seq={0} value="backlog" />);
        const column = container.firstChild as HTMLElement;
        expect(column.hasAttribute('data-column-group')).toBe(true);
        expect(column.querySelector('[data-column-cards]')).not.toBeNull();
    });

    it('applies draglight class when draglight display option is set', () => {
        const { container } = render(
            <KanbanColumn seq={0} value="doing" display_options={{ draglight: true }} />
        );
        const column = container.firstChild as HTMLElement;
        expect(column.className).toContain('draglight');
    });

    it('repeats the heading at the group\'s far end with the same name and count', () => {
        render(<KanbanColumn seq={0} value="code-review" count={3} />);
        const footer = screen.getByTestId('group-footer-code-review');
        expect(footer).toHaveAttribute('aria-hidden', 'true');
        expect(within(footer).getByText('Code Review')).toBeInTheDocument();
        expect(within(footer).getByTestId('footer-count-badge')).toHaveTextContent('3');
    });

    it('omits the footer\'s count badge when count is undefined, matching the heading', () => {
        render(<KanbanColumn seq={0} value="doing" />);
        const footer = screen.getByTestId('group-footer-doing');
        expect(within(footer).queryByTestId('footer-count-badge')).toBeNull();
    });

    it('keeps the repeated footer out of the card list, so it is never measured or dragged as a card', () => {
        const { container } = render(
            <KanbanColumn seq={0} value="doing" count={1}>
                <div data-testid="child-note">Note 1</div>
            </KanbanColumn>
        );
        const cards = container.querySelector('[data-column-cards]');
        expect(cards?.querySelector('[data-testid="group-footer-doing"]')).toBeNull();
    });

    it('renders the footer after the card list, so it sits at the group\'s far end in DOM order', () => {
        const { container } = render(<KanbanColumn seq={0} value="doing" count={0} />);
        const column = container.firstChild as HTMLElement;
        const children = Array.from(column.children);
        const notes_index = children.findIndex(el => el.hasAttribute('data-column-cards'));
        const footer_index = children.findIndex(el => el.getAttribute('data-testid') === 'group-footer-doing');
        expect(notes_index).toBeGreaterThanOrEqual(0);
        expect(footer_index).toBeGreaterThan(notes_index);
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
