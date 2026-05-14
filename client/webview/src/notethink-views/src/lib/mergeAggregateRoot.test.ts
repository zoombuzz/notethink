import { mergeAggregateRoot, type AggregatedDocInput } from './mergeAggregateRoot';
import type { MdastNode } from '../types/NoteProps';

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

/**
 * Build a doc input with manually-constructed MDAST.
 */
function makeDoc(
    id: string,
    relative_path: string,
    text: string,
    children: MdastNode[],
): AggregatedDocInput {
    return {
        id,
        path: `/repo/${relative_path}`,
        relative_path,
        text,
        content: {
            type: 'root',
            position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 1 } },
            children,
        } as MdastNode,
    };
}

/**
 * Build a single-H1, depth-3-stories file: "# Title\n### Story A\n### Story B\n"
 */
function simpleFile(id: string, relative_path: string, title: string, stories: string[]): AggregatedDocInput {
    const lines: string[] = [`# ${title}`];
    for (const s of stories) { lines.push(`### ${s}`); }
    const text = lines.join('\n') + '\n';

    const children: MdastNode[] = [];
    let offset = 0;
    // h1
    const h1_line = `# ${title}`;
    children.push(mdastNode('heading', offset, offset + h1_line.length, { depth: 1 }));
    offset += h1_line.length + 1; // +1 for \n
    for (const s of stories) {
        const line = `### ${s}`;
        children.push(mdastNode('heading', offset, offset + line.length, { depth: 3 }));
        offset += line.length + 1;
    }
    return makeDoc(id, relative_path, text, children);
}

describe('mergeAggregateRoot', () => {

    it('empty docs map produces synthetic root with no children', () => {
        const { root, all_notes } = mergeAggregateRoot({}, '/repo/');
        expect(root.seq).toBe(0);
        expect(root.level).toBe(0);
        expect(root.type).toBe('root');
        expect(root.child_notes).toEqual([]);
        expect(all_notes).toHaveLength(1);
        expect(all_notes[0]).toBe(root);
    });

    it('single file with two stories: stamps origin, renumbers seqs from 0', () => {
        const doc = simpleFile('id-a', 'a/todo.md', 'Todo', ['Story A', 'Story B']);
        const { root, all_notes } = mergeAggregateRoot({ 'id-a': doc }, '/repo/');

        expect(root.child_notes).toHaveLength(2);
        expect(all_notes).toHaveLength(3); // root + 2 stories
        expect(all_notes.map(n => n.seq)).toEqual([0, 1, 2]);

        const [storyA, storyB] = root.child_notes!;
        expect(storyA.headline_raw).toBe('### Story A');
        expect(storyA.seq).toBe(1);
        expect(storyA.level).toBe(1);
        expect(storyA.origin?.doc_id).toBe('id-a');
        expect(storyA.origin?.doc_path).toBe('/repo/a/todo.md');
        expect(storyA.origin?.relative_path).toBe('a/todo.md');
        expect(storyA.origin?.epic).toBeUndefined();

        expect(storyB.headline_raw).toBe('### Story B');
        expect(storyB.seq).toBe(2);
        expect(storyB.origin?.doc_id).toBe('id-a');
    });

    it('multiple files: stories from each file appear under one synthetic root in stable relative_path order', () => {
        const docA = simpleFile('id-a', 'a/todo.md', 'A', ['A1', 'A2']);
        const docB = simpleFile('id-b', 'b/todo.md', 'B', ['B1']);
        // pass in reverse-insertion order — result should still be A-first due to relative_path sort
        const { root, all_notes } = mergeAggregateRoot({ 'id-b': docB, 'id-a': docA }, '/repo/');

        expect(root.child_notes).toHaveLength(3);
        expect(all_notes).toHaveLength(4);
        expect(all_notes.map(n => n.seq)).toEqual([0, 1, 2, 3]);
        const [s1, s2, s3] = root.child_notes!;
        expect(s1.headline_raw).toBe('### A1');
        expect(s1.origin?.doc_id).toBe('id-a');
        expect(s2.headline_raw).toBe('### A2');
        expect(s3.headline_raw).toBe('### B1');
        expect(s3.origin?.doc_id).toBe('id-b');
    });

    it('empty file (H1 but no stories) contributes zero entries', () => {
        const empty = simpleFile('id-empty', 'oma/todo.md', 'Todo', []);
        const nonempty = simpleFile('id-other', 'a/todo.md', 'Todo', ['Real']);
        const { root, all_notes } = mergeAggregateRoot({ 'id-empty': empty, 'id-other': nonempty }, '/repo/');
        expect(root.child_notes).toHaveLength(1);
        expect(root.child_notes![0].headline_raw).toBe('### Real');
        expect(all_notes).toHaveLength(2);
    });

    it('file with no H1: depth-3 children at doc root are treated as stories', () => {
        // simulate zoombuzz/done.md case: stories directly under doc root, no H1
        const text = '### Loose Story 1\n### Loose Story 2\n';
        const children: MdastNode[] = [
            mdastNode('heading', 0, 17, { depth: 3 }),
            mdastNode('heading', 18, 35, { depth: 3 }),
        ];
        const doc = makeDoc('id-noh1', 'zoombuzz/done.md', text, children);

        const { root, all_notes } = mergeAggregateRoot({ 'id-noh1': doc }, '/repo/');
        expect(root.child_notes).toHaveLength(2);
        expect(root.child_notes![0].headline_raw).toBe('### Loose Story 1');
        expect(root.child_notes![1].origin?.doc_id).toBe('id-noh1');
        expect(all_notes).toHaveLength(3);
    });

    it('## epic wrapping ### stories: epic name carried as structural origin.epic on each story', () => {
        // # Todo
        // ## Phase 3
        // ### Build feature
        // ### Test feature
        const text = '# Todo\n## Phase 3\n### Build feature\n### Test feature\n';
        const children: MdastNode[] = [
            mdastNode('heading', 0, 6, { depth: 1 }),
            mdastNode('heading', 7, 17, { depth: 2 }),
            mdastNode('heading', 18, 36, { depth: 3 }),
            mdastNode('heading', 37, 52, { depth: 3 }),
        ];
        const doc = makeDoc('id-epic', 'x/todo.md', text, children);
        const { root } = mergeAggregateRoot({ 'id-epic': doc }, '/repo/');

        expect(root.child_notes).toHaveLength(2);
        for (const story of root.child_notes!) {
            expect(story.origin?.epic?.name).toBe('Phase 3');
            expect(story.origin?.epic?.id).toBeUndefined();
        }
    });

    it('## epic with id linetag: origin.epic carries id', () => {
        // # Todo
        // ## New Relic [](?id=nr)
        // ### Wire alerts
        const headline2 = '## New Relic [](?id=nr)';
        const text = `# Todo\n${headline2}\n### Wire alerts\n`;
        const h1_end = 6;
        const h2_start = h1_end + 1;
        const h2_end = h2_start + headline2.length;
        const h3_start = h2_end + 1;
        const h3_end = h3_start + '### Wire alerts'.length;
        const children: MdastNode[] = [
            mdastNode('heading', 0, h1_end, { depth: 1 }),
            mdastNode('heading', h2_start, h2_end, { depth: 2 }),
            mdastNode('heading', h3_start, h3_end, { depth: 3 }),
        ];
        const doc = makeDoc('id-x', 'x/todo.md', text, children);
        const { root } = mergeAggregateRoot({ 'id-x': doc }, '/repo/');

        expect(root.child_notes).toHaveLength(1);
        expect(root.child_notes![0].origin?.epic?.name).toBe('New Relic');
        expect(root.child_notes![0].origin?.epic?.id).toBe('nr');
    });

    it('direct epic= linetag overrides structural ## parent', () => {
        // # Todo
        // ## Structural Epic
        // ### Story [](?epic=Other)
        const story_headline = '### Story [](?epic=Other)';
        const text = `# Todo\n## Structural Epic\n${story_headline}\n`;
        const h1_end = 6;
        const h2_start = h1_end + 1;
        const h2_text = '## Structural Epic';
        const h2_end = h2_start + h2_text.length;
        const h3_start = h2_end + 1;
        const h3_end = h3_start + story_headline.length;
        const children: MdastNode[] = [
            mdastNode('heading', 0, h1_end, { depth: 1 }),
            mdastNode('heading', h2_start, h2_end, { depth: 2 }),
            mdastNode('heading', h3_start, h3_end, { depth: 3 }),
        ];
        const doc = makeDoc('id-override', 'x/todo.md', text, children);
        const { root } = mergeAggregateRoot({ 'id-override': doc }, '/repo/');
        expect(root.child_notes).toHaveLength(1);
        // direct linetag value "Other" is unresolved against this file's epics → literal
        expect(root.child_notes![0].origin?.epic?.name).toBe('Other');
        expect(root.child_notes![0].origin?.epic?.id).toBeUndefined();
    });

    it('epic= linetag resolves by exact-name match within the same file', () => {
        // # Todo
        // ## Foo Bar
        // ### Story [](?epic=Foo+Bar)
        const story_headline = '### Story [](?epic=Foo+Bar)';
        const text = `# Todo\n## Foo Bar\n${story_headline}\n`;
        const h1_end = 6;
        const h2_start = h1_end + 1;
        const h2_text = '## Foo Bar';
        const h2_end = h2_start + h2_text.length;
        const h3_start = h2_end + 1;
        const h3_end = h3_start + story_headline.length;
        const children: MdastNode[] = [
            mdastNode('heading', 0, h1_end, { depth: 1 }),
            mdastNode('heading', h2_start, h2_end, { depth: 2 }),
            mdastNode('heading', h3_start, h3_end, { depth: 3 }),
        ];
        const doc = makeDoc('id-name', 'x/todo.md', text, children);
        const { root } = mergeAggregateRoot({ 'id-name': doc }, '/repo/');
        // the story sits structurally under "Foo Bar" too; resolution still works
        expect(root.child_notes![0].origin?.epic?.name).toBe('Foo Bar');
    });

    it('epic= linetag resolves by id when present', () => {
        const story_headline = '### Story [](?epic=nr)';
        const epic_headline = '## New Relic [](?id=nr)';
        const text = `# Todo\n${epic_headline}\n${story_headline}\n`;
        const h1_end = 6;
        const h2_start = h1_end + 1;
        const h2_end = h2_start + epic_headline.length;
        const h3_start = h2_end + 1;
        const h3_end = h3_start + story_headline.length;
        const children: MdastNode[] = [
            mdastNode('heading', 0, h1_end, { depth: 1 }),
            mdastNode('heading', h2_start, h2_end, { depth: 2 }),
            mdastNode('heading', h3_start, h3_end, { depth: 3 }),
        ];
        const doc = makeDoc('id-id', 'x/todo.md', text, children);
        const { root } = mergeAggregateRoot({ 'id-id': doc }, '/repo/');
        expect(root.child_notes![0].origin?.epic?.id).toBe('nr');
        expect(root.child_notes![0].origin?.epic?.name).toBe('New Relic');
    });

    it('unresolved epic= linetag renders as literal label', () => {
        const story_headline = '### Story [](?epic=GhostEpic)';
        const text = `# Todo\n${story_headline}\n`;
        const h1_end = 6;
        const h3_start = h1_end + 1;
        const h3_end = h3_start + story_headline.length;
        const children: MdastNode[] = [
            mdastNode('heading', 0, h1_end, { depth: 1 }),
            mdastNode('heading', h3_start, h3_end, { depth: 3 }),
        ];
        const doc = makeDoc('id-ghost', 'x/todo.md', text, children);
        const { root } = mergeAggregateRoot({ 'id-ghost': doc }, '/repo/');
        expect(root.child_notes![0].origin?.epic?.name).toBe('GhostEpic');
        expect(root.child_notes![0].origin?.epic?.id).toBeUndefined();
    });

    it('ambiguous epic name across files: each resolves within its own file only', () => {
        // both files define a "Shared" epic but each story's linetag resolves against its own file
        function buildFile(id: string, rel: string, with_id: string): AggregatedDocInput {
            const story_headline = '### Story [](?epic=Shared)';
            const epic_headline = `## Shared [](?id=${with_id})`;
            const text = `# Todo\n${epic_headline}\n${story_headline}\n`;
            const h1_end = 6;
            const h2_start = h1_end + 1;
            const h2_end = h2_start + epic_headline.length;
            const h3_start = h2_end + 1;
            const h3_end = h3_start + story_headline.length;
            const children: MdastNode[] = [
                mdastNode('heading', 0, h1_end, { depth: 1 }),
                mdastNode('heading', h2_start, h2_end, { depth: 2 }),
                mdastNode('heading', h3_start, h3_end, { depth: 3 }),
            ];
            return makeDoc(id, rel, text, children);
        }
        const docA = buildFile('id-a', 'a/todo.md', 'shared-a');
        const docB = buildFile('id-b', 'b/todo.md', 'shared-b');
        const { root } = mergeAggregateRoot({ 'id-a': docA, 'id-b': docB }, '/repo/');
        expect(root.child_notes).toHaveLength(2);
        // both stories resolve to "Shared" by name, but each picks the right id from its file
        expect(root.child_notes![0].origin?.epic?.id).toBe('shared-a');
        expect(root.child_notes![1].origin?.epic?.id).toBe('shared-b');
    });

    it('global seq uniqueness across many files', () => {
        const docs: Record<string, AggregatedDocInput> = {};
        for (let i = 0; i < 5; i++) {
            docs[`id-${i}`] = simpleFile(`id-${i}`, `proj${i}/todo.md`, `T${i}`, ['One', 'Two', 'Three']);
        }
        const { all_notes } = mergeAggregateRoot(docs, '/repo/');
        const seqs = all_notes.map(n => n.seq);
        const seq_set = new Set(seqs);
        expect(seq_set.size).toBe(seqs.length);
        // contiguous from 0
        expect(seqs).toEqual([...Array(seqs.length).keys()]);
    });

    it('all_notes[seq] indexing matches each note (contiguous seqs)', () => {
        const docs: Record<string, AggregatedDocInput> = {
            'id-1': simpleFile('id-1', 'a/todo.md', 'A', ['One']),
            'id-2': simpleFile('id-2', 'b/todo.md', 'B', ['Two']),
        };
        const { all_notes } = mergeAggregateRoot(docs, '/repo/');
        for (let i = 0; i < all_notes.length; i++) {
            expect(all_notes[i].seq).toBe(i);
        }
    });

    it('origin stamped on descendants of a story (not just the story itself)', () => {
        // story with a sub-bullet child
        // # Todo
        // ### Story A
        // + sub bullet
        const text = '# Todo\n### Story A\n+ sub bullet\n';
        const h1_end = 6;
        const h3_start = h1_end + 1;
        const h3_text = '### Story A';
        const h3_end = h3_start + h3_text.length;
        const list_start = h3_end + 1;
        const list_end = list_start + '+ sub bullet'.length;
        const children: MdastNode[] = [
            mdastNode('heading', 0, h1_end, { depth: 1 }),
            mdastNode('heading', h3_start, h3_end, { depth: 3 }),
            mdastNode('list', list_start, list_end, {
                children: [mdastNode('listItem', list_start, list_end)],
            }),
        ];
        const doc = makeDoc('id-desc', 'x/todo.md', text, children);
        const { root, all_notes } = mergeAggregateRoot({ 'id-desc': doc }, '/repo/');

        // story plus its descendants should all carry origin
        expect(all_notes.length).toBeGreaterThan(2);
        for (let i = 1; i < all_notes.length; i++) {
            expect(all_notes[i].origin?.doc_id).toBe('id-desc');
        }
        // descendants have parent_notes chain rooted at synthetic root
        const story = root.child_notes![0];
        expect(story.parent_notes).toEqual([root]);
        for (const child of story.child_notes || []) {
            expect(child.parent_notes?.[0]).toBe(root);
            expect(child.parent_notes?.[1]).toBe(story);
        }
    });

    it('integration_path is exposed on the synthetic root', () => {
        const doc = simpleFile('id-a', 'a/todo.md', 'Todo', ['One']);
        const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/active_development');
        expect((root as { integration_path?: string }).integration_path).toBe('/repo/active_development');
    });

    it('file_view_type from H1 ng_view linetag is captured on every story of that file', () => {
        // # Todo [](?ng_view=kanban)
        // ### Story
        const h1_text = '# Todo [](?ng_view=kanban)';
        const text = `${h1_text}\n### Story\n`;
        const h1_end = h1_text.length;
        const h3_start = h1_end + 1;
        const h3_end = h3_start + '### Story'.length;
        const children: MdastNode[] = [
            mdastNode('heading', 0, h1_end, { depth: 1 }),
            mdastNode('heading', h3_start, h3_end, { depth: 3 }),
        ];
        const doc = makeDoc('id-kan', 'a/todo.md', text, children);
        const { root } = mergeAggregateRoot({ 'id-kan': doc }, '/repo');
        expect(root.child_notes![0].origin?.file_view_type).toBe('kanban');
    });

});
