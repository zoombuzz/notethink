import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import CollisionsDrawer from './CollisionsDrawer';
import type { StableIdCollision } from '../../../lib/noteops';
import type { NoteProps } from '../../../types/NoteProps';

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 3,
        type: 'heading',
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
        },
        headline_raw: '### Story',
        body_raw: '',
        ...overrides,
    };
}

function makeCollision(slug: string, notes: NoteProps[]): StableIdCollision {
    return { slug, notes };
}

describe('CollisionsDrawer', () => {
    it('renders one entry per collision group with the slug visible', () => {
        const collisions = [
            makeCollision('alpha', [
                makeNote({ seq: 1, headline_raw: '### Alpha one' }),
                makeNote({ seq: 2, headline_raw: '### Alpha two' }),
            ]),
            makeCollision('beta', [
                makeNote({ seq: 3, headline_raw: '### Beta one' }),
                makeNote({ seq: 4, headline_raw: '### Beta two' }),
            ]),
        ];
        render(<CollisionsDrawer collisions={collisions} />);
        const list = screen.getByTestId('collisions-drawer-list');
        const groups = within(list).getAllByRole('listitem').filter(li => within(li).queryByText('alpha') || within(li).queryByText('beta'));
        expect(groups).toHaveLength(2);
        expect(within(list).getByText('alpha')).toBeInTheDocument();
        expect(within(list).getByText('beta')).toBeInTheDocument();
        expect(screen.queryByTestId('collisions-drawer-empty')).not.toBeInTheDocument();
    });

    it("renders each note's headline and source file (no line number)", () => {
        const collisions = [
            makeCollision('alpha', [
                makeNote({
                    seq: 1,
                    headline_raw: '### Alpha one',
                    position: { start: { offset: 0, line: 5 }, end: { offset: 10, line: 5 } },
                    origin: { doc_id: 'd1', doc_path: 'docs/a.md', relative_path: 'docs/a.md' },
                }),
                makeNote({
                    seq: 2,
                    headline_raw: '### Alpha two',
                    position: { start: { offset: 0, line: 9 }, end: { offset: 10, line: 9 } },
                    origin: { doc_id: 'd1', doc_path: 'docs/a.md', relative_path: 'docs/a.md' },
                }),
            ]),
        ];
        render(<CollisionsDrawer collisions={collisions} />);
        const list = screen.getByTestId('collisions-drawer-list');
        expect(within(list).getByText('Alpha one')).toBeInTheDocument();
        expect(within(list).getByText('Alpha two')).toBeInTheDocument();
        // the source file is shown, the line number is not
        expect(within(list).getAllByText('docs/a.md')).toHaveLength(2);
        expect(within(list).queryByText('docs/a.md:5')).not.toBeInTheDocument();
    });

    it('shows neither path nor line number for a single-file collision', () => {
        const collisions = [
            makeCollision('alpha', [
                makeNote({
                    seq: 1,
                    headline_raw: '### Alpha one',
                    position: { start: { offset: 0, line: 3 }, end: { offset: 10, line: 3 } },
                }),
                makeNote({
                    seq: 2,
                    headline_raw: '### Alpha two',
                    position: { start: { offset: 0, line: 7 }, end: { offset: 10, line: 7 } },
                }),
            ]),
        ];
        render(<CollisionsDrawer collisions={collisions} />);
        const list = screen.getByTestId('collisions-drawer-list');
        expect(within(list).getByText('Alpha one')).toBeInTheDocument();
        expect(within(list).getByText('Alpha two')).toBeInTheDocument();
        // single-file collisions show neither a path nor a line number
        expect(within(list).queryByText('3')).not.toBeInTheDocument();
        expect(within(list).queryByText('7')).not.toBeInTheDocument();
    });

    it('renders the empty-state row and no group rows when collisions is empty', () => {
        render(<CollisionsDrawer collisions={[]} />);
        expect(screen.getByTestId('collisions-drawer-empty')).toBeInTheDocument();
        const list = screen.getByTestId('collisions-drawer-list');
        // only the empty-state li, no collision groups
        expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    });

    it('shows both origins for a group whose notes come from two different files', () => {
        const collisions = [
            makeCollision('shared', [
                makeNote({
                    seq: 1,
                    headline_raw: '### From A',
                    position: { start: { offset: 0, line: 2 }, end: { offset: 10, line: 2 } },
                    origin: { doc_id: 'a', doc_path: 'docs/a.md', relative_path: 'docs/a.md' },
                }),
                makeNote({
                    seq: 2,
                    headline_raw: '### From B',
                    position: { start: { offset: 0, line: 4 }, end: { offset: 10, line: 4 } },
                    origin: { doc_id: 'b', doc_path: 'docs/b.md', relative_path: 'docs/b.md' },
                }),
            ]),
        ];
        render(<CollisionsDrawer collisions={collisions} />);
        const list = screen.getByTestId('collisions-drawer-list');
        expect(within(list).getByText('docs/a.md')).toBeInTheDocument();
        expect(within(list).getByText('docs/b.md')).toBeInTheDocument();
    });

    it('calls onRevealNote with the clicked note so the editor jumps to that story', () => {
        const note_a = makeNote({ seq: 1, headline_raw: '### Alpha one' });
        const note_b = makeNote({ seq: 2, headline_raw: '### Alpha two' });
        const onRevealNote = jest.fn();
        render(<CollisionsDrawer collisions={[makeCollision('alpha', [note_a, note_b])]} onRevealNote={onRevealNote} />);
        const headlines = screen.getAllByTestId('collisions-drawer-note');
        fireEvent.click(headlines[1]);
        expect(onRevealNote).toHaveBeenCalledTimes(1);
        expect(onRevealNote).toHaveBeenCalledWith(note_b);
    });
});
