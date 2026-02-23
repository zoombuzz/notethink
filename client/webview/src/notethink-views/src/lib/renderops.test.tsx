import { renderMarkdownNoteHeadline } from './renderops';
import { NoteProps, MdastNode } from '../types/NoteProps';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Helper: build a minimal NoteProps with MDAST children for headline rendering.
 */
function headingNote(
    children: MdastNode[],
    overrides: Partial<NoteProps> = {},
): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'heading',
        depth: 3,
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 100, line: 1 },
        },
        children,
        children_body: [],
        headline_raw: '',
        body_raw: '',
        ...overrides,
    };
}

function mdastText(value: string, startOffset: number, endOffset: number): MdastNode {
    return {
        type: 'text',
        position: {
            start: { offset: startOffset, line: 1 },
            end: { offset: endOffset, line: 1 },
        },
        children: [],
        value,
    } as unknown as MdastNode;
}

function mdastStrong(children: MdastNode[], startOffset: number, endOffset: number): MdastNode {
    return {
        type: 'strong',
        position: {
            start: { offset: startOffset, line: 1 },
            end: { offset: endOffset, line: 1 },
        },
        children,
    };
}

describe('renderMarkdownNoteHeadline', () => {

    describe('strip_linetags', () => {

        it('strips linetag children by position', () => {
            // Simulates: ### My Task [](?status=doing)
            // MDAST children: [text("My Task "), text("[](?status=doing)")]
            const children = [
                mdastText('My Task ', 4, 12),
                mdastText('[](?status=doing)', 12, 29),
            ];
            const note = headingNote(children, { linetags_from: 12 });

            const result = renderMarkdownNoteHeadline(note, {
                render: 'strip_linetags',
                linetags_from: 12,
            });
            const html = renderToStaticMarkup(result);

            expect(html).toContain('My Task');
            expect(html).not.toContain('status=doing');
        });

        it('preserves inline formatting (bold) before the linetag', () => {
            // Simulates: ### some **bold** text [](?status=doing)
            // MDAST children: [text("some "), strong("bold"), text(" text "), text("[](?status=doing)")]
            const children = [
                mdastText('some ', 4, 9),
                mdastStrong(
                    [mdastText('bold', 11, 15)],
                    9, 17,
                ),
                mdastText(' text ', 17, 23),
                mdastText('[](?status=doing)', 23, 40),
            ];
            const note = headingNote(children, { linetags_from: 23 });

            const result = renderMarkdownNoteHeadline(note, {
                render: 'strip_linetags',
                linetags_from: 23,
            });
            const html = renderToStaticMarkup(result);

            expect(html).toContain('some');
            expect(html).toContain('bold');
            expect(html).toContain(' text ');
            expect(html).not.toContain('status=doing');
        });

        it('renders all children when linetags_from is undefined (no linetags)', () => {
            const children = [
                mdastText('Normal heading', 4, 18),
            ];
            const note = headingNote(children);

            const result = renderMarkdownNoteHeadline(note, {
                render: 'strip_linetags',
                // linetags_from not set
            });
            const html = renderToStaticMarkup(result);

            expect(html).toContain('Normal heading');
        });
    });

    describe('all_children', () => {

        it('renders everything including linetag text', () => {
            const children = [
                mdastText('My Task ', 4, 12),
                mdastText('[](?status=doing)', 12, 29),
            ];
            const note = headingNote(children, { linetags_from: 12 });

            const result = renderMarkdownNoteHeadline(note, {
                render: 'all_children',
            });
            const html = renderToStaticMarkup(result);

            expect(html).toContain('My Task');
            expect(html).toContain('[](?status=doing)');
        });
    });
});
