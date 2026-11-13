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

describe('MarkdownNoteHeadline and the editor caret marks', () => {
    it('marks the title and leaves a focused note\'s linetag values hidden in a production build', () => {
        const { container } = render(<MarkdownNoteHeadline note={note()} />);
        expect(container.querySelector('[data-vc-title]')?.textContent).toBe('Title');
        expect(container.querySelector('[data-vc-linetag]')).toBeNull();
        expect(container.textContent).toBe('Title');
    });

    it('marks each linetag value where showLinetagsInHeadlines renders it', () => {
        const { container } = render(<MarkdownNoteHeadline note={note({ focused: false, display_options: { id: 'v1', settings: { showLinetagsInHeadlines: true } } })} />);
        expect(container.querySelector('[data-vc-linetag="status"]')?.textContent).toBe('doing');
        expect(container.textContent).toBe('Titlestatus=doing');
    });

    it('leaves an unfocused note\'s linetags hidden', () => {
        const { container } = render(<MarkdownNoteHeadline note={note({ focused: false })} />);
        expect(container.querySelector('[data-vc-linetag]')).toBeNull();
        expect(container.textContent).toBe('Title');
    });

    it('marks no title on a note that is not a heading', () => {
        const { container } = render(<MarkdownNoteHeadline note={note({ type: 'paragraph' as NoteProps['type'], focused: false })} />);
        expect(container.querySelector('[data-vc-title]')).toBeNull();
    });
});
