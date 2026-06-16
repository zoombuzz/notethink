import { findFrontmatterNode, parseFrontmatterLinetags } from './frontmatterops';
import type { MdastNode } from '../types/NoteProps';

/**
 * Build a front-matter MdastNode whose position spans the leading `---…---`
 * (or `+++…+++`) block of `text`, matching the real mdast-util-frontmatter shape:
 * position covers the fences, value is the inner text.
 */
function frontmatterNodeFromText(type: 'yaml' | 'toml', text: string): MdastNode {
    const fence = type === 'toml' ? '+++' : '---';
    const open_end = text.indexOf('\n');
    const close_at = text.indexOf('\n' + fence, open_end);
    const end_offset = close_at + 1 + fence.length;
    return {
        type,
        value: text.slice(open_end + 1, close_at),
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: end_offset, line: 1 },
        },
        children: [],
    };
}

// assert the stored key/value sit at their reported absolute file offsets
function expectOffsetsMatch(text: string, linetags_from: number, tag: { key: string; key_offset: number; value: string; value_offset: number }): void {
    const key_abs = linetags_from + tag.key_offset;
    const value_abs = linetags_from + tag.value_offset;
    expect(text.slice(key_abs, key_abs + tag.key.length)).toBe(tag.key);
    expect(text.slice(value_abs, value_abs + tag.value.length)).toBe(tag.value);
}

describe('findFrontmatterNode', () => {
    it('returns the first yaml node', () => {
        const yaml = frontmatterNodeFromText('yaml', '---\nx: 1\n---\n');
        const heading: MdastNode = {
            type: 'heading',
            position: { start: { offset: 0, line: 1 }, end: { offset: 1, line: 1 } },
            children: [],
        };
        expect(findFrontmatterNode([yaml, heading])).toBe(yaml);
    });

    it('returns the first toml node', () => {
        const toml = frontmatterNodeFromText('toml', '+++\nx = 1\n+++\n');
        expect(findFrontmatterNode([toml])).toBe(toml);
    });

    it('returns undefined when no front-matter node is present', () => {
        const heading: MdastNode = {
            type: 'heading',
            position: { start: { offset: 0, line: 1 }, end: { offset: 1, line: 1 } },
            children: [],
        };
        const paragraph: MdastNode = {
            type: 'paragraph',
            position: { start: { offset: 2, line: 2 }, end: { offset: 3, line: 2 } },
            children: [],
        };
        expect(findFrontmatterNode([heading, paragraph])).toBeUndefined();
    });
});

describe('parseFrontmatterLinetags — yaml', () => {
    it('parses verbatim keys, numeric coercion, and plausible offsets', () => {
        const text = '---\nnt_view: kanban\norder: 3\n---\n# Title\n';
        const node = frontmatterNodeFromText('yaml', text);
        const result = parseFrontmatterLinetags(node, text, 0);

        expect(result.linetags_from).toBe(0);
        const linetags = result.linetags!;
        // keys stored verbatim (no prefix logic)
        expect(linetags['nt_view'].value).toBe('kanban');
        expect(linetags['nt_view'].value_numeric).toBeUndefined();
        expect(linetags['nt_view'].note_seq).toBe(0);
        expect(linetags['nt_view'].linktext_offset).toBe(0);
        // numeric coercion mirrors parseLineTags
        expect(linetags['order'].value).toBe('3');
        expect(linetags['order'].value_numeric).toBe(3);
        // offsets are real file positions
        expectOffsetsMatch(text, result.linetags_from!, linetags['nt_view']);
        expectOffsetsMatch(text, result.linetags_from!, linetags['order']);
    });

    it('splits on the first colon so values may contain colons', () => {
        const text = '---\nnt_link: https://example.com/x\n---\n';
        const node = frontmatterNodeFromText('yaml', text);
        const linetags = parseFrontmatterLinetags(node, text, 0).linetags!;
        expect(linetags['nt_link'].value).toBe('https://example.com/x');
        expectOffsetsMatch(text, 0, linetags['nt_link']);
    });

    it('passes a non-zero note_seq through to each LineTag', () => {
        const text = '---\na: 1\n---\n';
        const node = frontmatterNodeFromText('yaml', text);
        const linetags = parseFrontmatterLinetags(node, text, 7).linetags!;
        expect(linetags['a'].note_seq).toBe(7);
    });
});

describe('parseFrontmatterLinetags — toml', () => {
    it('parses `key = value` form with correct offsets', () => {
        const text = '+++\nnt_view = kanban\norder = 3\n+++\n# Title\n';
        const node = frontmatterNodeFromText('toml', text);
        const result = parseFrontmatterLinetags(node, text, 0);
        const linetags = result.linetags!;
        expect(linetags['nt_view'].value).toBe('kanban');
        expect(linetags['order'].value).toBe('3');
        expect(linetags['order'].value_numeric).toBe(3);
        expectOffsetsMatch(text, result.linetags_from!, linetags['nt_view']);
        expectOffsetsMatch(text, result.linetags_from!, linetags['order']);
    });
});

describe('parseFrontmatterLinetags — value shapes', () => {
    it('strips matching quotes and keeps inline arrays verbatim', () => {
        const text = '---\ntitle: "Hello World"\ntags: [a, b, c]\nname: \'solo\'\n---\n';
        const node = frontmatterNodeFromText('yaml', text);
        const result = parseFrontmatterLinetags(node, text, 0);
        const linetags = result.linetags!;
        // double-quoted → unquoted value, offset points inside the quotes
        expect(linetags['title'].value).toBe('Hello World');
        expectOffsetsMatch(text, result.linetags_from!, linetags['title']);
        // inline array stored verbatim, not expanded
        expect(linetags['tags'].value).toBe('[a, b, c]');
        expectOffsetsMatch(text, result.linetags_from!, linetags['tags']);
        // single-quoted → unquoted value
        expect(linetags['name'].value).toBe('solo');
        expectOffsetsMatch(text, result.linetags_from!, linetags['name']);
    });

    it('skips keys with an empty value', () => {
        const text = '---\nfilled: yes\nempty:\nquoted_empty: ""\n---\n';
        const node = frontmatterNodeFromText('yaml', text);
        const linetags = parseFrontmatterLinetags(node, text, 0).linetags!;
        expect(linetags['filled'].value).toBe('yes');
        expect(linetags['empty']).toBeUndefined();
        expect(linetags['quoted_empty']).toBeUndefined();
    });
});

describe('parseFrontmatterLinetags — skipping', () => {
    it('skips comment and blank lines', () => {
        const text = '---\n# a comment\n\nnt_view: kanban\n---\n';
        const node = frontmatterNodeFromText('yaml', text);
        const linetags = parseFrontmatterLinetags(node, text, 0).linetags!;
        expect(Object.keys(linetags)).toEqual(['nt_view']);
        expectOffsetsMatch(text, 0, linetags['nt_view']);
    });

    it('skips malformed lines without a separator', () => {
        const text = '---\nthisisnotvalid\nnt_view: kanban\n---\n';
        const node = frontmatterNodeFromText('yaml', text);
        const linetags = parseFrontmatterLinetags(node, text, 0).linetags!;
        expect(Object.keys(linetags)).toEqual(['nt_view']);
    });

    it('returns {} when no keys parse (both fields undefined)', () => {
        const text = '---\n# only a comment\n---\n';
        const node = frontmatterNodeFromText('yaml', text);
        const result = parseFrontmatterLinetags(node, text, 0);
        expect(result.linetags).toBeUndefined();
        expect(result.linetags_from).toBeUndefined();
    });
});
