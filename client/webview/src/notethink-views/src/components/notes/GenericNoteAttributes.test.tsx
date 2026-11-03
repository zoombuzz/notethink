import React from 'react';
import { render, screen } from '@testing-library/react';
import GenericNoteAttributes from './GenericNoteAttributes';
import type { LineTag, NoteProps } from '../../types/NoteProps';

function tag(key: string, value: string): LineTag {
    return { key, value, value_numeric: Number.isNaN(Number(value)) ? undefined : Number(value), key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 };
}

function noteWith(linetags: Record<string, LineTag>): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'heading',
        children_body: [],
        children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: '### Story',
        body_raw: '',
        linetags,
    };
}

describe('GenericNoteAttributes progress tag', () => {
    it('draws a share of its max with the unit', () => {
        render(<GenericNoteAttributes {...noteWith({ progress: tag('progress', '35'), progress_max: tag('progress_max', '100'), progress_unit: tag('progress_unit', '%') })} />);
        expect(screen.getByRole('listitem', { name: 'progress' })).toHaveTextContent('Progress:35%');
    });

    it('draws a progress tag that has no max or unit siblings without throwing', () => {
        render(<GenericNoteAttributes {...noteWith({ progress: tag('progress', '60') })} />);
        expect(screen.getByRole('listitem', { name: 'progress' })).toHaveTextContent('Progress:60');
    });
});
