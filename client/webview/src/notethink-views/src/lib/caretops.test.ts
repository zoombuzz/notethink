import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toString } from 'mdast-util-to-string';
import { gfm } from 'micromark-extension-gfm';
import { convertMdastToNoteHierarchy } from './convertMdastToNoteHierarchy';
import { flattenAllNotes } from './noteops';
import {
    buildTitleMap,
    caretFieldsOf,
    editForKey,
    fieldAt,
    linetagField,
    moveCaret,
    renderedToSource,
    sourceToRendered,
    titleField,
    titleStartInHeadline,
} from './caretops';
import type { NoteProps } from '../types/NoteProps';

function parseNotes(markdown: string): NoteProps[] {
    const root = convertMdastToNoteHierarchy(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), markdown);
    return flattenAllNotes(root).filter(note => note.type === 'heading' || note.type === 'paragraph');
}

function renderedOf(source: string): string {
    return buildTitleMap(source).rendered;
}

describe('buildTitleMap', () => {

    it('maps plain text one to one', () => {
        const map = buildTitleMap('Plain title');
        expect(map.rendered).toBe('Plain title');
        expect(map.starts).toEqual([...Array(11).keys()]);
        expect(map.source_length).toBe(11);
    });

    it('drops emphasis marks and keeps the span of each rendered character', () => {
        const map = buildTitleMap('a **bo** c');
        expect(map.rendered).toBe('a bo c');
        // "b" is source offset 4, after the two opening asterisks
        expect(map.starts[2]).toBe(4);
        expect(map.starts[3]).toBe(5);
        expect(map.starts[4]).toBe(8);
    });

    it('renders code spans verbatim without the backticks', () => {
        const map = buildTitleMap('run `pnpm test` now');
        expect(map.rendered).toBe('run pnpm test now');
        expect(map.starts[4]).toBe(5);
    });

    it('renders a link as its text and drops the destination', () => {
        const map = buildTitleMap('see [the docs](https://example.com/x) here');
        expect(map.rendered).toBe('see the docs here');
        expect(map.starts[4]).toBe(5);
        // the character after the link maps past the closing parenthesis
        expect(map.starts[12]).toBe(37);
    });

    it('renders an image as nothing', () => {
        expect(renderedOf('a ![alt](x.png) b')).toBe('a  b');
    });

    it('unescapes a backslash escape and spans both source characters', () => {
        const map = buildTitleMap('a \\*b\\* c');
        expect(map.rendered).toBe('a *b* c');
        expect(map.starts[2]).toBe(2);
        expect(map.ends[2]).toBe(4);
    });

    it('treats intraword underscores as literal', () => {
        expect(renderedOf('snake_case_name')).toBe('snake_case_name');
        expect(renderedOf('_em_ here')).toBe('em here');
    });

    it('treats an unbalanced delimiter as literal', () => {
        expect(renderedOf('2 * 3 = 6')).toBe('2 * 3 = 6');
        expect(renderedOf('**unclosed')).toBe('**unclosed');
    });

    it('handles emphasis around a link around code', () => {
        expect(renderedOf('**[`x`](u)** y')).toBe('x y');
    });
});

describe('buildTitleMap against a real markdown parse', () => {
    // titles a person might write; the map's rendered text is checked against mdast-util-to-string
    const CORPUS = [
        'Plain title', 'A **bold** word', 'An *italic* word', 'An _italic_ word', '__bold__ underscores', '~~struck~~ text',
        'run `pnpm test` now', 'see [the docs](https://example.com) here', '**[link](u)** in bold', 'snake_case_name stays',
        'mixed `code` and **bold** and [a link](x) end', 'escaped \\*star\\* here', '`a`b`c`', 'two ``double `tick` span`` here',
        'a [nested *em* link](url) b', '**bold *and italic* mixed**', '2 * 3 * 4', 'a_b_c and _d_', 'trailing **',
    ];
    const results = CORPUS.map(title => {
        const [note] = parseNotes(`## ${title}\n`);
        const expected = toString({ type: 'root', children: note.children } as never);
        return { title, expected, actual: renderedOf(title) };
    });

    it.each(results)('matches the parser on $title', ({ expected, actual }) => {
        expect(actual).toBe(expected);
    });

    it('agrees on every title of the corpus', () => {
        expect(results.filter(result => result.expected !== result.actual)).toEqual([]);
    });
});

describe('titleStartInHeadline', () => {
    it('skips a heading marker and its space', () => {
        expect(titleStartInHeadline({ type: 'heading', headline_raw: '### Story' })).toBe(4);
        expect(titleStartInHeadline({ type: 'heading', headline_raw: '# Story' })).toBe(2);
    });

    it('offers no title for a task line or any other type', () => {
        expect(titleStartInHeadline({ type: 'paragraph', headline_raw: 'text' })).toBeUndefined();
        expect(titleStartInHeadline({ type: 'code', headline_raw: 'ts' })).toBeUndefined();
        expect(titleStartInHeadline({ type: 'listItem', headline_raw: '- x' })).toBeUndefined();
    });
});

describe('titleField and linetagField', () => {
    const TEXT = 'intro\n\n## Task **B** [](?status=doing&id=b) [](?points=3)\n\nbody\n';
    const [note] = parseNotes(TEXT).filter(candidate => candidate.type === 'heading');

    it('puts the title field on the source text between the marker and the linetags', () => {
        const field = titleField(note)!;
        expect(TEXT.slice(field.from, field.to)).toBe('Task **B**');
        expect(field.map.rendered).toBe('Task B');
    });

    it('puts each linetag value field on exactly the value text', () => {
        for (const [key, value] of [['status', 'doing'], ['id', 'b'], ['points', '3']]) {
            const field = linetagField(note, key)!;
            expect(TEXT.slice(field.from, field.to)).toBe(value);
        }
    });

    it('lists the title first, then the linetag values', () => {
        expect(caretFieldsOf(note).map(field => field.key ?? 'title')).toEqual(['title', 'status', 'id', 'points']);
    });

    it('offers no field for an inherited linetag, an unknown key or a value whose offset misses', () => {
        expect(linetagField({ ...note, linetags: { ...note.linetags, status: { ...note.linetags!.status, inherited: true } } }, 'status')).toBeUndefined();
        expect(linetagField(note, 'nope')).toBeUndefined();
        expect(linetagField({ ...note, linetags: { ...note.linetags, status: { ...note.linetags!.status, value_offset: 1 } } }, 'status')).toBeUndefined();
    });

    it('uses the folder origin position as the base, so offsets stay in the file', () => {
        const in_folder: NoteProps = { ...note, origin: { doc_id: 'd', doc_path: '/ws/a.md', relative_path: 'a.md', source_position: { start: { offset: 7, line: 3 }, end: { offset: 60, line: 3 } } } as never };
        // the folder merge moved the note in the tree, but the source start is what the editor knows
        const moved: NoteProps = { ...in_folder, position: { ...note.position, start: { ...note.position.start, offset: note.position.start.offset + 1000 }, end: { ...note.position.end, offset: note.position.end.offset + 1000 } }, linetags_from: note.linetags_from! + 1000 };
        const field = titleField(moved)!;
        expect(field.doc_path).toBe('/ws/a.md');
        expect(TEXT.slice(field.from - 7 + 7, field.to)).toBe('Task **B**');
        expect(field.from).toBe(7 + 3);
    });
});

describe('titleField for a title holding an ordinary link', () => {
    const TEXT = '## Read [the guide](guide.md) first [](?status=doing)\n';
    const [note] = parseNotes(TEXT).filter(candidate => candidate.type === 'heading');

    it('keeps the link and the text after it in the title, ending before the linetags', () => {
        const field = titleField(note)!;
        expect(TEXT.slice(field.from, field.to)).toBe('Read [the guide](guide.md) first');
        expect(field.map.rendered).toBe('Read the guide first');
    });

    it('still finds the linetag value after the link', () => {
        const field = linetagField(note, 'status')!;
        expect(TEXT.slice(field.from, field.to)).toBe('doing');
        expect(note.linetags?.status?.value).toBe('doing');
    });

    it('treats a heading with a link and no linetags as all title', () => {
        const [plain] = parseNotes('## Read [the guide](guide.md) first\n').filter(candidate => candidate.type === 'heading');
        expect(plain.linetags).toBeUndefined();
        const field = titleField(plain)!;
        expect(field.map.rendered).toBe('Read the guide first');
    });
});

describe('caret offset mapping', () => {
    const field = titleField(parseNotes('## a **bo** c\n')[0])!;

    it('maps a rendered offset to the start of the character it sits before', () => {
        // "a bo c": offset 2 sits before "b" (source 4 inside the heading line, plus the field start)
        expect(renderedToSource(field, 0)).toBe(field.from);
        expect(renderedToSource(field, 2)).toBe(field.from + 4);
        expect(renderedToSource(field, 6)).toBe(field.to);
    });

    it('clamps a rendered offset outside the field', () => {
        expect(renderedToSource(field, -5)).toBe(field.from);
        expect(renderedToSource(field, 99)).toBe(field.to);
    });

    it('maps a source offset inside markup to the next rendered character', () => {
        expect(sourceToRendered(field, field.from + 2)).toBe(2);
        expect(sourceToRendered(field, field.from + 3)).toBe(2);
        expect(sourceToRendered(field, field.from + 4)).toBe(2);
        expect(sourceToRendered(field, field.from + 5)).toBe(3);
        expect(sourceToRendered(field, field.from + 6)).toBe(4);
    });

    it('round trips every rendered offset', () => {
        for (let offset = 0; offset <= field.map.rendered.length; offset += 1) {
            expect(sourceToRendered(field, renderedToSource(field, offset))).toBe(offset);
        }
    });

    it('finds the field an offset falls in, per file', () => {
        expect(fieldAt([field], undefined, field.from + 4)?.rendered_offset).toBe(2);
        expect(fieldAt([field], '/ws/other.md', field.from + 4)).toBeUndefined();
        expect(fieldAt([field], undefined, field.to + 1)).toBeUndefined();
    });
});

describe('moveCaret', () => {
    const field = titleField(parseNotes('## abc\n')[0])!;

    it('moves one character and stops at the ends', () => {
        expect(moveCaret(field, 1, 'left')).toBe(0);
        expect(moveCaret(field, 0, 'left')).toBe(0);
        expect(moveCaret(field, 2, 'right')).toBe(3);
        expect(moveCaret(field, 3, 'right')).toBe(3);
    });

    it('jumps to the ends with Home and End', () => {
        expect(moveCaret(field, 2, 'home')).toBe(0);
        expect(moveCaret(field, 1, 'end')).toBe(3);
    });
});

describe('editForKey', () => {
    const TEXT = '## a **bo** \\*c [](?status=doing)\n';
    const [note] = parseNotes(TEXT).filter(candidate => candidate.type === 'heading');
    const title = titleField(note)!;

    function apply(edit: { change: { from: number; to?: number; insert: string } }): string {
        return TEXT.slice(0, edit.change.from) + edit.change.insert + TEXT.slice(edit.change.to ?? edit.change.from);
    }

    it('inserts typed text at the source offset the caret stands for', () => {
        const edit = editForKey(title, 2, { text: 'X' })!;
        expect(apply(edit)).toBe('## a **Xbo** \\*c [](?status=doing)\n');
        expect(edit.next_caret).toBe(3);
    });

    it('Backspace removes the whole source span of the previous rendered character', () => {
        const edit = editForKey(title, 3, 'Backspace')!;
        expect(apply(edit)).toBe('## a **o** \\*c [](?status=doing)\n');
        expect(edit.next_caret).toBe(2);
    });

    it('Backspace and Delete take an escaped character with its backslash', () => {
        // rendered "a bo *c": the star is rendered index 5
        expect(apply(editForKey(title, 6, 'Backspace')!)).toBe('## a **bo** c [](?status=doing)\n');
        expect(apply(editForKey(title, 5, 'Delete')!)).toBe('## a **bo** c [](?status=doing)\n');
    });

    it('relays nothing at the ends of the field', () => {
        expect(editForKey(title, 0, 'Backspace')).toBeUndefined();
        expect(editForKey(title, title.map.rendered.length, 'Delete')).toBeUndefined();
    });

    it('refuses an empty or multi-line insert', () => {
        expect(editForKey(title, 1, { text: '' })).toBeUndefined();
        expect(editForKey(title, 1, { text: 'a\nb' })).toBeUndefined();
    });

    it('edits a linetag value and refuses characters that would break the link', () => {
        const status = linetagField(note, 'status')!;
        expect(apply(editForKey(status, 5, { text: 's' })!)).toBe('## a **bo** \\*c [](?status=doings)\n');
        expect(apply(editForKey(status, 5, 'Backspace')!)).toBe('## a **bo** \\*c [](?status=doin)\n');
        expect(editForKey(status, 2, { text: ')' })).toBeUndefined();
        expect(editForKey(status, 2, { text: ' ' })).toBeUndefined();
        expect(editForKey(status, 2, { text: '&' })).toBeUndefined();
    });
});
