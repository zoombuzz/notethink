import React from 'react';
import { render, screen } from '@testing-library/react';
import StickyNote, { STICKY_FALLBACK_HUE } from './StickyNote';
import { hueForOrigin } from '../../lib/originops';
import type { NoteOrigin, NoteProps } from '../../types/NoteProps';

// mock GenericNoteAttributes so a rendered attribute row would be unmistakable if one ever appeared
jest.mock('./GenericNoteAttributes', () => ({
    __esModule: true,
    default: (props: NoteProps) => props.linetags ? <div data-testid="linetags">attributes</div> : null,
}));

const PARENT_SEQ = 10;

/** a note shaped the way the renderer reads one: the headline comes from the mdast children, not from headline_raw */
function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'heading',
        children_body: [],
        children: [{
            type: 'text',
            value: 'Story title',
            children: [],
            position: { start: { offset: 4, line: 1 }, end: { offset: 15, line: 1 } },
        }],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 15, line: 1 },
            end_body: { offset: 200, line: 20 },
        },
        headline_raw: '### Story title',
        body_raw: '+ [X] done\n+ [ ] todo',
        parent_notes: [{ seq: PARENT_SEQ } as NoteProps],
        display_options: { parent_context_seq: PARENT_SEQ },
        ...overrides,
    };
}

describe('StickyNote', () => {

    it('renders the headline text', () => {
        render(<StickyNote {...makeNote()} />);
        expect(screen.getByText('Story title')).toBeInTheDocument();
    });

    it('marks itself as the sticky card so views and specs can tell the two cards apart', () => {
        const { container } = render(<StickyNote {...makeNote()} />);
        expect(container.querySelector('[data-card-type="sticky"]')).toBeInTheDocument();
    });

    it('renders the headline row and nothing beneath it', () => {
        const { container } = render(<StickyNote {...makeNote()} />);
        expect(container.querySelectorAll('[role="rowheader"]')).toHaveLength(1);
        // the body is the full card's second row; a sticky has no second row at all
        expect(screen.queryByText('done')).not.toBeInTheDocument();
        expect(screen.queryByText('todo')).not.toBeInTheDocument();
    });

    it('renders no attribute row even when the note carries linetags', () => {
        const note = makeNote({
            linetags: {
                status: { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        render(<StickyNote {...note} />);
        expect(screen.queryByTestId('linetags')).not.toBeInTheDocument();
    });

    it('renders the origin pill for a level-1 note carrying project metadata', () => {
        const note = makeNote({
            origin: { doc_id: 'a', doc_path: '/repo/alpha/todo.md', relative_path: 'alpha/todo.md', project_label: 'AL' },
        });
        const { container } = render(<StickyNote {...note} />);
        expect(container.querySelector('[role="rowheader"]')?.textContent).toContain('AL');
    });

    it('carries the standard note data props and row role', () => {
        const { container } = render(<StickyNote {...makeNote({ seq: 7 })} />);
        const card = container.querySelector('[data-card-type="sticky"]');
        expect(card).toHaveAttribute('data-seq', '7');
        expect(card).toHaveAttribute('data-mdast-type', 'heading');
        expect(card).toHaveAttribute('role', 'row');
    });

    it('reflects focused and selected state on the card element', () => {
        const { container } = render(<StickyNote {...makeNote({ focused: true, selected: true })} />);
        const card = container.querySelector('[data-card-type="sticky"]');
        expect(card).toHaveAttribute('aria-current', 'true');
        expect(card).toHaveAttribute('aria-selected', 'true');
    });

    it('draws its paper in the hue the project pill takes from the same origin', () => {
        const origin: NoteOrigin = { doc_id: 'a', doc_path: '/repo/alpha/todo.md', relative_path: 'alpha/todo.md', project_label: 'AL', project_hue: 212 };
        const { container } = render(<StickyNote {...makeNote({ origin })} />);
        const card = container.querySelector('[data-card-type="sticky"]') as HTMLElement;
        expect(card).toHaveAttribute('data-sticky-hue', String(hueForOrigin(origin)));
        expect(card.style.getPropertyValue('--nt-sticky-hue')).toBe('212');
    });

    it('derives the project hue from the project name when folder mode stamped none', () => {
        const origin: NoteOrigin = { doc_id: 'a', doc_path: '/repo/sculptor/todo.md', relative_path: 'sculptor/todo.md' };
        const { container } = render(<StickyNote {...makeNote({ origin })} />);
        expect(container.querySelector('[data-card-type="sticky"]')).toHaveAttribute('data-sticky-hue', String(hueForOrigin(origin)));
    });

    it('is yellow when the note has no origin at all', () => {
        const { container } = render(<StickyNote {...makeNote()} />);
        expect(container.querySelector('[data-card-type="sticky"]')).toHaveAttribute('data-sticky-hue', String(STICKY_FALLBACK_HUE));
    });

    it('is yellow when the origin carries only an epic, which draws no project pill', () => {
        const origin: NoteOrigin = { doc_id: 'a', doc_path: '/repo/todo.md', epic: { name: 'Launch' } };
        const { container } = render(<StickyNote {...makeNote({ origin })} />);
        expect(container.querySelector('[data-card-type="sticky"]')).toHaveAttribute('data-sticky-hue', String(STICKY_FALLBACK_HUE));
    });

    it('keeps the width the board hands down alongside its own hue', () => {
        const note = makeNote({
            display_options: {
                parent_context_seq: PARENT_SEQ,
                provided: { draggableProps: { style: { '--nt-card-width': '180.0px' } } },
            },
        });
        const { container } = render(<StickyNote {...note} />);
        const card = container.querySelector('[data-card-type="sticky"]') as HTMLElement;
        expect(card.style.getPropertyValue('--nt-card-width')).toBe('180.0px');
        expect(card.style.getPropertyValue('--nt-sticky-hue')).toBe(String(STICKY_FALLBACK_HUE));
    });

    it('clears the lane card surface through its own class rather than any lane rule', () => {
        const { container } = render(<StickyNote {...makeNote()} />);
        expect(container.querySelector('[data-card-type="sticky"]')).toHaveClass('stickyNote');
    });
});
