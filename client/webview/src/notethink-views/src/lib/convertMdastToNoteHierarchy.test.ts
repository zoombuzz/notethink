import { convertMdastToNoteHierarchy, applyChildAttributeInheritance } from './convertMdastToNoteHierarchy';
import { MdastNode } from '../types/NoteProps';
import { calculateTextChangesForNewLinetagValue } from './linetagops';

/**
 * Helper to create a minimal MDAST node with position info.
 */
function mdastNode(
    type: string,
    startOffset: number,
    endOffset: number,
    extra: Partial<MdastNode> = {},
): MdastNode {
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
        const mdast: MdastNode = {
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
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('heading', 0, 13, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        expect(root.children_body).toHaveLength(1);

        const heading = root.children_body[0] as any;
        expect(heading.seq).toBe(1);
        expect(heading.type).toBe('heading');
        expect(heading.headline_raw).toBe('# Hello World');
        expect(heading.depth).toBe(1);
        expect(heading.level).toBe(1);
    });

    it('code block produces NoteProps with lang and body_raw', () => {
        const text = '```js\nconsole.log("hi")\n```\n';
        const mdast: MdastNode = {
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

        const code = root.children_body[0] as any;
        expect(code.seq).toBe(1);
        expect(code.type).toBe('code');
        expect(code.lang).toBe('js');
        expect(code.body_raw).toBe('console.log("hi")');
    });

    it('multiple headings get incrementing seq numbers', () => {
        // "# A\n## B\n## C\n"
        //  0123 45678 9...
        const text = '# A\n## B\n## C\n';
        const mdast: MdastNode = {
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
        const seqs = allNotes.map((n: any) => n.seq);
        expect(seqs).toEqual([1, 2, 3]);
    });

    it('nested headings get correct levels (h1=1, h2 under h1=2)', () => {
        // "# Title\n## Sub\nSome text\n"
        //  01234567 89...14 15...
        const text = '# Title\n## Sub\nSome text\n';
        const mdast: MdastNode = {
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
        const h1 = allNotes.find((n: any) => n.depth === 1);
        const h2 = allNotes.find((n: any) => n.depth === 2);
        expect(h1.level).toBe(1);
        expect(h2.level).toBe(2);
    });

    it('heading end_body covers until next same-level heading', () => {
        const text = '# A\nBody A\n# B\nBody B\n';
        const mdast: MdastNode = {
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
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('paragraph', 0, 11),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        expect(root.children_body).toHaveLength(1);

        const para = root.children_body[0] as MdastNode;
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
        const mdast: MdastNode = {
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
        const listNote = root.children_body[0] as any;
        expect(listNote.type).toBe('list');
        expect(listNote.seq).toBeGreaterThan(0);

        // List has listItem children in children_body
        const listItemNotes = listNote.children_body.filter((c: any) => c.seq !== undefined);
        expect(listItemNotes.length).toBe(2);
        expect(listItemNotes[0].type).toBe('listItem');
        expect(listItemNotes[1].type).toBe('listItem');
    });

    it('heading with linetags populates note.linetags', () => {
        const text = '## Task [](?status=doing)\n';
        const mdast: MdastNode = {
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
        expect(heading.linetags!['status']).toBeDefined();
        expect(heading.linetags!['status'].value).toBe('doing');
        expect(heading.linetags!['status'].note_seq).toBe(1);
        expect(heading.linetags_from).toBeDefined();
    });

    it('heading without linetags leaves note.linetags undefined', () => {
        const text = '## Normal heading\n';
        const mdast: MdastNode = {
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
        const mdast: MdastNode = {
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
        expect(parent.child_notes!.length).toBe(2);
        expect(parent.child_notes![0].headline_raw).toBe('## Child A');
        expect(parent.child_notes![1].headline_raw).toBe('## Child B');
    });

    it('heading with body paragraphs includes them in children_body', () => {
        const text = '# Title\nParagraph body\n';
        const mdast: MdastNode = {
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
        const bodyPara = heading.children_body.find((c: any) => !('seq' in c) && c.type === 'paragraph');
        expect(bodyPara).toBeDefined();
    });
});

describe('child attribute inheritance', () => {

    it('ng_child_ attributes are inherited by direct children', () => {
        // # Parent [](?ng_child_status=backlog)\n## Child\n
        const text = '# Parent [](?ng_child_status=backlog)\n## Child\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 37, { depth: 1 }),
                mdastNode('heading', 38, 46, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const child = allNotes.find((n: any) => n.depth === 2);

        expect(child.linetags).toBeDefined();
        expect(child.linetags!['status']).toBeDefined();
        expect(child.linetags!['status'].value).toBe('backlog');
        expect(child.linetags!['status'].inherited).toBe(true);
    });

    it('ng_child_ attributes are NOT inherited by grandchildren', () => {
        // # GrandParent [](?ng_child_status=backlog)\n## Parent\n### GrandChild\n
        const text = '# GrandParent [](?ng_child_status=backlog)\n## Parent\n### GrandChild\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 42, { depth: 1 }),
                mdastNode('heading', 43, 52, { depth: 2 }),
                mdastNode('heading', 53, 68, { depth: 3 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const grandchild = allNotes.find((n: any) => n.depth === 3);

        // Grandchild should NOT have inherited status from ng_child_
        expect(grandchild.linetags?.['status']).toBeUndefined();
    });

    it('ng_child2y_ attributes are inherited only by grandchildren', () => {
        const text = '# GrandParent [](?ng_child2y_priority=high)\n## Parent\n### GrandChild\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 43, { depth: 1 }),
                mdastNode('heading', 44, 53, { depth: 2 }),
                mdastNode('heading', 54, 69, { depth: 3 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const parent = allNotes.find((n: any) => n.depth === 2);
        const grandchild = allNotes.find((n: any) => n.depth === 3);

        // Direct child should NOT have it
        expect(parent.linetags?.['priority']).toBeUndefined();
        // Grandchild should have it
        expect(grandchild.linetags!['priority']).toBeDefined();
        expect(grandchild.linetags!['priority'].value).toBe('high');
        expect(grandchild.linetags!['priority'].inherited).toBe(true);
    });

    it('ng_childall_ attributes are inherited by all descendants', () => {
        const text = '# Root [](?ng_childall_team=alpha)\n## Child\n### GrandChild\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 34, { depth: 1 }),
                mdastNode('heading', 35, 43, { depth: 2 }),
                mdastNode('heading', 44, 58, { depth: 3 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const child = allNotes.find((n: any) => n.depth === 2);
        const grandchild = allNotes.find((n: any) => n.depth === 3);

        expect(child.linetags!['team'].value).toBe('alpha');
        expect(child.linetags!['team'].inherited).toBe(true);
        expect(grandchild.linetags!['team'].value).toBe('alpha');
        expect(grandchild.linetags!['team'].inherited).toBe(true);
    });

    it('child own linetag overrides inherited value', () => {
        const text = '# Parent [](?ng_child_status=backlog)\n## Child [](?status=doing)\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 37, { depth: 1 }),
                mdastNode('heading', 38, 64, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const child = allNotes.find((n: any) => n.depth === 2);

        expect(child.linetags!['status'].value).toBe('doing');
        expect(child.linetags!['status'].inherited).toBeUndefined();
    });

    it('inherited linetags have inherited: true flag', () => {
        const text = '# Parent [](?ng_child_status=backlog)\n## Child\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 37, { depth: 1 }),
                mdastNode('heading', 38, 46, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const child = allNotes.find((n: any) => n.depth === 2);

        expect(child.linetags!['status'].inherited).toBe(true);
        // Parent should NOT have inherited flag on ng_child_status
        const parent = allNotes.find((n: any) => n.depth === 1);
        expect(parent.linetags!['ng_child_status'].inherited).toBeUndefined();
    });
});

describe('drag-drop on inherited-status notes', () => {

    it('dragging a note with inherited status writes a new linetag', () => {
        const text = '# Parent [](?ng_child_status=backlog)\n## Child\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 37, { depth: 1 }),
                mdastNode('heading', 38, 46, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const child = allNotes.find((n: any) => n.depth === 2);

        // Simulate dragging to "doing" column
        const changes = calculateTextChangesForNewLinetagValue(child, 'status', 'doing', 'untagged');
        expect(changes.length).toBeGreaterThan(0);
        // Should insert a new linetag block since the child has no real linetags
        expect(changes[0].insert).toContain('status=doing');
    });

    it('setting inherited status back to default produces no changes', () => {
        const text = '# Parent [](?ng_child_status=backlog)\n## Child\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 37, { depth: 1 }),
                mdastNode('heading', 38, 46, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const child = allNotes.find((n: any) => n.depth === 2);

        // Setting back to "default" value should produce no edits
        const changes = calculateTextChangesForNewLinetagValue(child, 'status', 'untagged', 'untagged');
        expect(changes).toHaveLength(0);
    });
});

describe('makePosition line computation (binary search)', () => {

    it('computes correct line numbers for single-line text', () => {
        const text = '# Hello\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('heading', 0, 7, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        expect(root.position.start.line).toBe(1);
        const heading = flattenNotes(root)[0];
        expect(heading.position.start.line).toBe(1);
        expect(heading.position.end.line).toBe(1);
    });

    it('computes correct line numbers for multi-line text', () => {
        // line 1: "# A\n"  offsets 0-3, newline at 3
        // line 2: "body\n"  offsets 4-8, newline at 8
        // line 3: "# B\n"  offsets 9-12, newline at 12
        const text = '# A\nbody\n# B\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('paragraph', 4, 8),
                mdastNode('heading', 9, 12, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);

        // First heading at offset 0 → line 1
        expect(allNotes[0].position.start.line).toBe(1);
        // Second heading at offset 9 → line 3 (after newlines at 3, 8)
        expect(allNotes[1].position.start.line).toBe(3);
    });

    it('computes line numbers correctly at newline boundaries', () => {
        // offset 0: "a", offset 1: "\n", offset 2: "b", offset 3: "\n"
        const text = 'a\nb\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 1, { depth: 1 }),
                mdastNode('heading', 2, 3, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        // offset 0 is before any newline → line 1
        expect(allNotes[0].position.start.line).toBe(1);
        // offset 2 is after newline at 1 → line 2
        expect(allNotes[1].position.start.line).toBe(2);
    });
});

describe('nestChildNotes stack-based nesting', () => {

    it('assigns correct levels for 3+ nesting depth', () => {
        // # A → level 1, ## B → level 2, ### C → level 3
        const text = '# A\n## B\n### C\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 8, { depth: 2 }),
                mdastNode('heading', 9, 14, { depth: 3 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        expect(allNotes.map((n: any) => n.level)).toEqual([1, 2, 3]);
    });

    it('pops stack correctly when sibling follows nested child (h1 → h2 → h1)', () => {
        // # A → level 1, ## B (under A) → level 2, # C (sibling of A) → level 1
        const text = '# A\n## B\n# C\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 8, { depth: 2 }),
                mdastNode('heading', 9, 12, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        expect(allNotes.map((n: any) => n.level)).toEqual([1, 2, 1]);
    });

    it('parent_notes chain is built correctly for deep nesting', () => {
        const text = '# A\n## B\n### C\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 8, { depth: 2 }),
                mdastNode('heading', 9, 14, { depth: 3 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);

        // A has no parent_notes
        expect(allNotes[0].parent_notes).toBeUndefined();
        // B's parent is A
        expect(allNotes[1].parent_notes).toHaveLength(1);
        expect(allNotes[1].parent_notes[0].seq).toBe(allNotes[0].seq);
        // C's parent chain is [A, B]
        expect(allNotes[2].parent_notes).toHaveLength(2);
        expect(allNotes[2].parent_notes[0].seq).toBe(allNotes[0].seq);
        expect(allNotes[2].parent_notes[1].seq).toBe(allNotes[1].seq);
    });

    it('stack resets for non-overlapping sections', () => {
        // # A (0-3, end_body 4)\n# B (4-7)\n  → both level 1, no parent relationship
        const text = '# A\n# B\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 3 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 7, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        expect(allNotes[0].level).toBe(1);
        expect(allNotes[1].level).toBe(1);
        expect(allNotes[0].parent_notes).toBeUndefined();
        expect(allNotes[1].parent_notes).toBeUndefined();
    });
});

describe('descendant_note_count computation', () => {

    it('leaf note has descendant_note_count of 0', () => {
        const text = '# Leaf\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 2 } },
            children: [
                mdastNode('heading', 0, 6, { depth: 1 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        expect(allNotes[0].descendant_note_count).toBe(0);
    });

    it('parent with 2 leaf children has descendant_note_count of 2', () => {
        const text = '# Parent\n## A\n## B\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 4 } },
            children: [
                mdastNode('heading', 0, 8, { depth: 1 }),
                mdastNode('heading', 9, 13, { depth: 2 }),
                mdastNode('heading', 14, 18, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const parent = allNotes.find((n: any) => n.depth === 1);
        expect(parent.descendant_note_count).toBe(2);
    });

    it('counts accumulate through multiple generations', () => {
        // # A → ## B → ### C, ### D
        // A has 3 descendants (B, C, D), B has 2 descendants (C, D)
        const text = '# A\n## B\n### C\n### D\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 5 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 8, { depth: 2 }),
                mdastNode('heading', 9, 14, { depth: 3 }),
                mdastNode('heading', 15, 20, { depth: 3 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const a = allNotes.find((n: any) => n.headline_raw === '# A');
        const b = allNotes.find((n: any) => n.headline_raw === '## B');
        const c = allNotes.find((n: any) => n.headline_raw === '### C');
        const d = allNotes.find((n: any) => n.headline_raw === '### D');
        expect(c.descendant_note_count).toBe(0);
        expect(d.descendant_note_count).toBe(0);
        expect(b.descendant_note_count).toBe(2);
        expect(a.descendant_note_count).toBe(3);
    });

    it('deep chain: each level accumulates its subtree', () => {
        // # A → ## B → ### C → #### D
        // A=3, B=2, C=1, D=0
        const text = '# A\n## B\n### C\n#### D\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 5 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 8, { depth: 2 }),
                mdastNode('heading', 9, 14, { depth: 3 }),
                mdastNode('heading', 15, 21, { depth: 4 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        expect(allNotes.map((n: any) => n.descendant_note_count)).toEqual([3, 2, 1, 0]);
    });

    it('sibling trees counted independently', () => {
        // # A (has ## B, ## C), # D (has ## E)
        // A=2, B=0, C=0, D=1, E=0
        const text = '# A\n## B\n## C\n# D\n## E\n';
        const mdast: MdastNode = {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 6 } },
            children: [
                mdastNode('heading', 0, 3, { depth: 1 }),
                mdastNode('heading', 4, 8, { depth: 2 }),
                mdastNode('heading', 9, 13, { depth: 2 }),
                mdastNode('heading', 14, 17, { depth: 1 }),
                mdastNode('heading', 18, 22, { depth: 2 }),
            ],
        };
        const root = convertMdastToNoteHierarchy(mdast, text);
        const allNotes = flattenNotes(root);
        const a = allNotes.find((n: any) => n.headline_raw === '# A');
        const d = allNotes.find((n: any) => n.headline_raw === '# D');
        expect(a.descendant_note_count).toBe(2);
        expect(d.descendant_note_count).toBe(1);
    });
});

/**
 * Helper to extract all NoteProps (by seq) from a root note's children_body tree.
 */
function flattenNotes(root: any): any[] {
    const result: any[] = [];
    function walk(items: any[]) {
        for (const item of items) {
            if ('seq' in item && item.seq !== undefined && item.seq > 0) {
                result.push(item);
                if (item.children_body?.length) {
                    walk(item.children_body);
                }
            }
        }
    }
    if (root.children_body) { walk(root.children_body); }
    return result;
}
