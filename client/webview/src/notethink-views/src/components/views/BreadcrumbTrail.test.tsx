import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BreadcrumbTrail from './BreadcrumbTrail';
import type { NoteProps } from '../../types/NoteProps';

// mock renderops to avoid ESM dependencies in test
jest.mock('../../lib/renderops', () => ({
    renderMarkdownNoteHeadline: (note: NoteProps, options?: { output_type?: string }) => {
        return <span>{note.headline_raw}</span>;
    },
}));

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 0,
        level: 1,
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
        },
        headline_raw: '# Root',
        body_raw: '',
        ...overrides,
    };
}

describe('BreadcrumbTrail', () => {

    it('renders without parent notes', () => {
        const { container } = render(<BreadcrumbTrail {...makeNote()} />);
        const trail = container.querySelector('[class*="breadcrumbTrail"]');
        expect(trail).toBeInTheDocument();
    });

    it('renders breadcrumb items for each parent note', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            headline_raw: '### Item',
            parent_notes: [parent1, parent2],
        });
        render(<BreadcrumbTrail {...current} />);
        expect(screen.getByText('# Doc')).toBeInTheDocument();
        expect(screen.getByText('## Section')).toBeInTheDocument();
    });

    it('renders separator between breadcrumb items', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            parent_notes: [parent1, parent2],
        });
        const { container } = render(<BreadcrumbTrail {...current} />);
        const separators = container.querySelectorAll('[class*="breadcrumbSeparator"]');
        expect(separators).toHaveLength(1);
    });

    it('calls setParentContextSeq when a breadcrumb is clicked', () => {
        const set_parent_context_seq = jest.fn();
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 5, headline_raw: '## Section' });
        const current = makeNote({
            seq: 10,
            parent_notes: [parent1, parent2],
            handlers: {
                setParentContextSeq: set_parent_context_seq,
            },
        });
        render(<BreadcrumbTrail {...current} />);
        fireEvent.click(screen.getByText('# Doc'));
        expect(set_parent_context_seq).toHaveBeenCalledWith(0);
    });

    it('calls setParentContextSeq with correct seq for non-first breadcrumb', () => {
        const set_parent_context_seq = jest.fn();
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 5, headline_raw: '## Section' });
        const current = makeNote({
            seq: 10,
            parent_notes: [parent1, parent2],
            handlers: {
                setParentContextSeq: set_parent_context_seq,
            },
        });
        render(<BreadcrumbTrail {...current} />);
        fireEvent.click(screen.getByText('## Section'));
        expect(set_parent_context_seq).toHaveBeenCalledWith(5);
    });

    it('does not render separator before first item', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Only' });
        const current = makeNote({
            seq: 1,
            parent_notes: [parent1],
        });
        const { container } = render(<BreadcrumbTrail {...current} />);
        const separators = container.querySelectorAll('[class*="breadcrumbSeparator"]');
        expect(separators).toHaveLength(0);
    });

    it('renders breadcrumb items as button elements', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            parent_notes: [parent1, parent2],
        });
        const { container } = render(<BreadcrumbTrail {...current} />);
        const buttons = container.querySelectorAll('button');
        expect(buttons).toHaveLength(2);
    });

    it('renders breadcrumb buttons with aria-label attributes stripped of markdown', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const parent2 = makeNote({ seq: 1, headline_raw: '## Section' });
        const current = makeNote({
            seq: 2,
            parent_notes: [parent1, parent2],
        });
        render(<BreadcrumbTrail {...current} />);
        expect(screen.getByRole('button', { name: 'Doc' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Section' })).toBeInTheDocument();
    });

    it('renders breadcrumb container with role="navigation"', () => {
        const parent1 = makeNote({ seq: 0, headline_raw: '# Doc' });
        const current = makeNote({
            seq: 1,
            parent_notes: [parent1],
        });
        render(<BreadcrumbTrail {...current} />);
        const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
        expect(nav).toBeInTheDocument();
    });
});
