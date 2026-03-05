import { convertMdastToNoteHierarchy } from './convertMdastToNoteHierarchy';
/**
 * Helper to create a minimal MDAST node with position info.
 */
function mdastNode(type, startOffset, endOffset, extra = {}) {
    return {
        type,
        position: {
            start: { offset: startOffset, line: 0 },
            end: { offset: endOffset, line: 0 },
        },
        children: [],
        ...extra,
    };
}
describe('convertMdastToNoteHierarchy', () => {
    it('empty MDAST produces root note with seq=0', () => {
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: 0, line: 1 } },
            children: [],
        };
        const root = convertMdastToNoteHierarchy(mdast, '');
        expect(root.seq).toBe(0);
        expect(root.type).toBe('root');
        expect(root.level).toBe(0);
        expect(root.children_body).toHaveLength(0);
    });
    it('single heading produces NoteProps with correct headline_raw', () => {
        const text = '# Hello World\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('heading', 0, 13, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        expect(root.children_body).toHaveLength(1);
        const heading = root.children_body[0];
        expect(heading.seq).toBe(1);
        expect(heading.type).toBe('heading');
        expect(heading.headline_raw).toBe('# Hello World');
        expect(heading.depth).toBe(1);
        expect(heading.level).toBe(1);
    });
    it('code block produces NoteProps with lang and body_raw', () => {
        const text = '```js\nconsole.log("hi")\n```\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('code', 0, text.length - 1, {
                    lang: 'js',
                    value: 'console.log("hi")',
                }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        expect(root.children_body).toHaveLength(1);
        const code = root.children_body[0];
        expect(code.seq).toBe(1);
        expect(code.type).toBe('code');
        expect(code.lang).toBe('js');
        expect(code.body_raw).toBe('console.log("hi")');
    });
    it('multiple headings get incrementing seq numbers', () => {
        // "# A\n## B\n## C\n"
        //  0123 45678 9...
        const text = '# A\n## B\n## C\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 8, { depth: 2 }),
                mdastNode('heading', 9, 13, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const seqs = allNotes.map((n) => n.seq);
        expect(seqs).toEqual([1, 2, 3]);
    });
    it('nested headings get correct levels (h1=1, h2 under h1=2)', () => {
        // "# Title\n## Sub\nSome text\n"
        //  01234567 89...14 15...
        const text = '# Title\n## Sub\nSome text\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 7, { depth: 1 }),
                mdastNode('heading', 8, 14, { depth: 2 }),
                mdastNode('paragraph', 15, text.length - 1),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const h1 = allNotes.find((n) => n.depth === 1);
        const h2 = allNotes.find((n) => n.depth === 2);
        expect(h1.level).toBe(1);
        expect(h2.level).toBe(2);
    });
    it('heading end_body covers until next same-level heading', () => {
        const text = '# A\nBody A\n# B\nBody B\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 5 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('paragraph', 4, 10),
                mdastNode('heading', 11, 14, { depth: 1 }),
                mdastNode('paragraph', 15, 21),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        // First heading should have end_body at offset 11 (start of second heading)
        const allNotes = flattenNotes(root);
        const headingA = allNotes[0];
        expect(headingA.headline_raw).toBe('# A');
        expect(headingA.position.end_body?.offset).toBe(11);
    });
    it('non-note MDAST nodes (top-level paragraphs) appear in children_body as MdastNode', () => {
        const text = 'Hello world\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('paragraph', 0, 11),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        expect(root.children_body).toHaveLength(1);
        const para = root.children_body[0];
        // Should be a raw MdastNode, not a NoteProps (no seq)
        expect('seq' in para).toBe(false);
        expect(para.type).toBe('paragraph');
    });
    it('lists produce NoteProps with children_body containing listItems', () => {
        const text = '- item 1\n- item 2\n';
        const listItem1 = mdastNode('listItem', 0, 8, {
            children: [mdastNode('paragraph', 2, 8)],
        });
        const listItem2 = mdastNode('listItem', 9, 17, {
            children: [mdastNode('paragraph', 11, 17)],
        });
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('list', 0, 17, {
                    children: [listItem1, listItem2],
                }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        // Root has a list note
        const listNote = root.children_body[0];
        expect(listNote.type).toBe('list');
        expect(listNote.seq).toBeGreaterThan(0);
        // List has listItem children in children_body
        const listItemNotes = listNote.children_body.filter((c) => c.seq !== undefined);
        expect(listItemNotes.length).toBe(2);
        expect(listItemNotes[0].type).toBe('listItem');
        expect(listItemNotes[1].type).toBe('listItem');
    });
    it('heading with linetags populates note.linetags', () => {
        const text = '## Task [](?status=doing)\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('heading', 0, text.length - 1, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const heading = allNotes[0];
        expect(heading.linetags).toBeDefined();
        expect(heading.linetags['status']).toBeDefined();
        expect(heading.linetags['status'].value).toBe('doing');
        expect(heading.linetags['status'].note_seq).toBe(1);
        expect(heading.linetags_from).toBeDefined();
    });
    it('heading without linetags leaves note.linetags undefined', () => {
        const text = '## Normal heading\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('heading', 0, 17, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const heading = allNotes[0];
        expect(heading.linetags).toBeUndefined();
    });
    it('populates child_notes for parent headings', () => {
        const text = '# Parent\n## Child A\n## Child B\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 8, { depth: 1 }),
                mdastNode('heading', 9, 19, { depth: 2 }),
                mdastNode('heading', 20, 30, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const parent = allNotes[0];
        expect(parent.child_notes).toBeDefined();
        expect(parent.child_notes.length).toBe(2);
        expect(parent.child_notes[0].headline_raw).toBe('## Child A');
        expect(parent.child_notes[1].headline_raw).toBe('## Child B');
    });
    it('heading with body paragraphs includes them in children_body', () => {
        const text = '# Title\nParagraph body\n';
        const mdast = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 7, { depth: 1 }),
                mdastNode('paragraph', 8, 22),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const heading = allNotes[0];
        // The paragraph should appear in the heading's children_body as a raw MdastNode
        expect(heading.children_body.length).toBeGreaterThan(0);
        const bodyPara = heading.children_body.find((c) => !('seq' in c) && c.type === 'paragraph');
        expect(bodyPara).toBeDefined();
    });
});
/**
 * Helper to extract all NoteProps (by seq) from a root note's children_body tree.
 */
function flattenNotes(root) {
    const result = [];
    function walk(items) {
        for (const item of items) {
            if ('seq' in item && item.seq !== undefined && item.seq > 0) {
                result.push(item);
                if (item.children_body?.length) {
                    walk(item.children_body);
                }
            }
        }
    }
    if (root.children_body) {
        walk(root.children_body);
    }
    return result;
}
