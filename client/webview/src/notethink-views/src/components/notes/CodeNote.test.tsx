import React from 'react';
import { render, screen } from '@testing-library/react';
import CodeNote from './CodeNote';
import type { NoteProps } from '../../types/NoteProps';

// mock GenericNoteAttributes
jest.mock('./GenericNoteAttributes', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid="note-attributes">attributes</div>,
}));

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'code',
        lang: 'javascript',
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 50, line: 5 },
        },
        headline_raw: '```javascript',
        body_raw: 'const x = 42;\nconsole.log(x);',
        ...overrides,
    };
}

describe('CodeNote', () => {
    it('renders code content inside pre > code elements', () => {
        const { container } = render(<CodeNote {...makeNote()} />);
        const code_el = container.querySelector('code')!;
        expect(code_el.textContent).toBe('const x = 42;\nconsole.log(x);');
        expect(code_el.tagName).toBe('CODE');
        expect(code_el.parentElement?.tagName).toBe('PRE');
    });

    it('sets language class on code element', () => {
        const { container } = render(<CodeNote {...makeNote({ lang: 'python' })} />);
        const code_el = container.querySelector('code')!;
        expect(code_el).toHaveClass('language-python');
    });

    it('renders language label when lang is specified', () => {
        render(<CodeNote {...makeNote({ lang: 'typescript' })} />);
        expect(screen.getByText('typescript')).toBeInTheDocument();
    });

    it('does not render language label when lang is empty', () => {
        const { container } = render(<CodeNote {...makeNote({ lang: undefined })} />);
        const lang_spans = container.querySelectorAll('[class*="codeBlockLang"]');
        expect(lang_spans.length).toBe(0);
    });

    it('does not set language class on code when lang is empty', () => {
        const { container } = render(<CodeNote {...makeNote({ lang: undefined })} />);
        const code_el = container.querySelector('code')!;
        expect(code_el.textContent).toBe('const x = 42;\nconsole.log(x);');
        expect(code_el.className).toBe('');
    });

    it('renders with correct data attributes', () => {
        const { container } = render(<CodeNote {...makeNote()} />);
        const note_el = container.firstChild as HTMLElement;
        expect(note_el).toHaveAttribute('data-seq', '1');
        expect(note_el).toHaveAttribute('data-mdast-type', 'code');
    });

    it('renders linetags when present', () => {
        render(<CodeNote {...makeNote({
            linetags: { status: { key: 'status', key_offset: 0, value: 'done', value_offset: 7, linktext_offset: 0, note_seq: 1 } },
        })} />);
        expect(screen.getByTestId('note-attributes')).toBeInTheDocument();
    });

    it('does not render linetags when absent', () => {
        render(<CodeNote {...makeNote()} />);
        expect(screen.queryByTestId('note-attributes')).not.toBeInTheDocument();
    });
});
