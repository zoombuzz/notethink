import React from 'react';
import { render } from '@testing-library/react';
import MarkdownNoteHeadline from './MarkdownNoteHeadline';
import type { NoteProps } from '../../../types/NoteProps';

function note(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1, level: 1, type: 'heading', stable_id: 'doc:a', children_body: [], children: [], focused: true,
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: '## Title [](?status=doing)', body_raw: '', headline: <>Title</>,
        linetags: { status: { key: 'status', value: 'doing', key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } },
        display_options: { id: 'v1' },
        ...overrides,
    } as NoteProps;
}

afterEach(() => {
    delete (globalThis as { NOTETHINK_DEV?: boolean }).NOTETHINK_DEV;
});

describe('MarkdownNoteHeadline and the virtual caret marks', () => {
    it('renders no caret marks and no linetag chips outside a dev build', () => {
        const { container } = render(<MarkdownNoteHeadline note={note()} />);
        expect(container.querySelector('[data-vc-title]')).toBeNull();
        expect(container.querySelector('[data-vc-linetag]')).toBeNull();
        expect(container.textContent).toBe('Title');
    });

    it('marks the title and shows a focused note\'s linetag values in a dev build', () => {
        (globalThis as { NOTETHINK_DEV?: boolean }).NOTETHINK_DEV = true;
        const { container } = render(<MarkdownNoteHeadline note={note()} />);
        expect(container.querySelector('[data-vc-title]')?.textContent).toBe('Title');
        expect(container.querySelector('[data-vc-linetag="status"]')?.textContent).toBe('doing');
    });

    it('leaves an unfocused note\'s linetags hidden in a dev build', () => {
        (globalThis as { NOTETHINK_DEV?: boolean }).NOTETHINK_DEV = true;
        const { container } = render(<MarkdownNoteHeadline note={note({ focused: false })} />);
        expect(container.querySelector('[data-vc-linetag]')).toBeNull();
    });
});
