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

    it('multiple files: stories interleave round-robin by per-file rank (uneven lengths)', () => {
        const docA = simpleFile('id-a', 'a/todo.md', 'A', ['A1', 'A2']);
        const docB = simpleFile('id-b', 'b/todo.md', 'B', ['B1']);
        // pass in reverse-insertion order — file order is still a/ then b/ (relative_path sort)
        const { root, all_notes } = mergeAggregateRoot({ 'id-b': docB, 'id-a': docA }, '/repo/');

        expect(root.child_notes).toHaveLength(3);
        expect(all_notes).toHaveLength(4);
        expect(all_notes.map(n => n.seq)).toEqual([0, 1, 2, 3]);
        // round 0: A1 (a), B1 (b); round 1: only A2 (b has no rank-1 story)
        const [s1, s2, s3] = root.child_notes!;
        expect(s1.headline_raw).toBe('### A1');
        expect(s1.origin?.doc_id).toBe('id-a');
        expect(s2.headline_raw).toBe('### B1');
        expect(s2.origin?.doc_id).toBe('id-b');
        expect(s3.headline_raw).toBe('### A2');
        expect(s3.origin?.doc_id).toBe('id-a');
    });

    it('equal-length files: clean round-robin across three projects in stable file order', () => {
        const docA = simpleFile('id-a', 'a/todo.md', 'A', ['A1', 'A2']);
        const docB = simpleFile('id-b', 'b/todo.md', 'B', ['B1', 'B2']);
        const docC = simpleFile('id-c', 'c/todo.md', 'C', ['C1', 'C2']);
        const { root } = mergeAggregateRoot({ 'id-c': docC, 'id-a': docA, 'id-b': docB }, '/repo/');
        expect(root.child_notes!.map(n => n.headline_raw)).toEqual(
            ['### A1', '### B1', '### C1', '### A2', '### B2', '### C2'],
        );
    });

    it('newest-at-bottom interleaves each project\'s newest-first across projects', () => {
        // two done.md-style files: newest is the last story; cap 2 keeps the last
        // two reversed (newest first), then interleave so the column shows each
        // project's most-recent completion first
        const docA = orderedFile('id-a', 'a/done.md', 'A', 'newest-at-bottom', ['A1', 'A2', 'A3']);
        const docB = orderedFile('id-b', 'b/done.md', 'B', 'newest-at-bottom', ['B1', 'B2', 'B3']);
        const { root } = mergeAggregateRoot({ 'id-b': docB, 'id-a': docA }, '/repo/', 2);
        // a kept [A3,A2] (newest first), b kept [B3,B2]; round-robin → A3,B3,A2,B2
        expect(root.child_notes!.map(n => n.headline_raw)).toEqual(
            ['### A3', '### B3', '### A2', '### B2'],
        );
    });

    it('stamps origin.file_rank as the 0-based per-file index (relevance ordering key)', () => {
        const docA = simpleFile('id-a', 'a/todo.md', 'A', ['A1', 'A2', 'A3']);
        const docB = simpleFile('id-b', 'b/todo.md', 'B', ['B1', 'B2']);
        const { root } = mergeAggregateRoot({ 'id-b': docB, 'id-a': docA }, '/repo/');
        const by_headline = Object.fromEntries(
            root.child_notes!.map(n => [n.headline_raw, n.origin?.file_rank]),
        );
        // each file's stories are ranked 0..n-1 independently, in that file's order
        expect(by_headline).toEqual({
            '### A1': 0, '### A2': 1, '### A3': 2,
            '### B1': 0, '### B2': 1,
        });
    });

    it('newest-at-bottom: file_rank 0 is the newest (document-bottom) story', () => {
        const doc = orderedFile('id-a', 'a/done.md', 'A', 'newest-at-bottom', ['old', 'mid', 'new']);
        const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/');
        const rank0 = root.child_notes!.find(n => n.origin?.file_rank === 0);
        expect(rank0?.headline_raw).toBe('### new');
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

    /**
     * Build a single-H1 file whose H1 carries an `order=<value>` linetag, with
     * depth-3 stories directly under the H1.
     */
    function orderedFile(
        id: string,
        relative_path: string,
        title: string,
        order_value: string | undefined,
        stories: string[],
    ): AggregatedDocInput {
        const h1_line = order_value === undefined
            ? `# ${title}`
            : `# ${title} [](?order=${order_value})`;
        const lines: string[] = [h1_line];
        for (const s of stories) { lines.push(`### ${s}`); }
        const text = lines.join('\n') + '\n';

        const children: MdastNode[] = [];
        let offset = 0;
        children.push(mdastNode('heading', offset, offset + h1_line.length, { depth: 1 }));
        offset += h1_line.length + 1;
        for (const s of stories) {
            const line = `### ${s}`;
            children.push(mdastNode('heading', offset, offset + line.length, { depth: 3 }));
            offset += line.length + 1;
        }
        return makeDoc(id, relative_path, text, children);
    }

    describe('max_notes_per_file cap', () => {

        it('undefined max: no cap (behaviour unchanged)', () => {
            const doc = simpleFile('id-a', 'a/todo.md', 'T', ['S1', 'S2', 'S3', 'S4', 'S5']);
            const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/');
            expect(root.child_notes).toHaveLength(5);
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(
                ['### S1', '### S2', '### S3', '### S4', '### S5'],
            );
        });

        it('default (no order linetag) keeps the FIRST N stories', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', undefined, ['S1', 'S2', 'S3', 'S4', 'S5']);
            const { root, all_notes } = mergeAggregateRoot({ 'id-a': doc }, '/repo/', 3);
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(['### S1', '### S2', '### S3']);
            // seqs renumber contiguously over the kept set only
            expect(all_notes.map(n => n.seq)).toEqual([0, 1, 2, 3]);
        });

        it('explicit newest-at-top keeps the FIRST N stories', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', 'newest-at-top', ['S1', 'S2', 'S3', 'S4']);
            const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/', 2);
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(['### S1', '### S2']);
        });

        it('newest-at-bottom keeps the LAST N stories, reversed to newest-first', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', 'newest-at-bottom', ['S1', 'S2', 'S3', 'S4', 'S5']);
            const { root, all_notes } = mergeAggregateRoot({ 'id-a': doc }, '/repo/', 2);
            // last 2 in the file are S4,S5; S5 is newest so it sorts first (smallest seq)
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(['### S5', '### S4']);
            expect(all_notes.map(n => n.seq)).toEqual([0, 1, 2]);
        });

        it('newest-at-bottom reverses even when uncapped (implicit ordering weight)', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', 'newest-at-bottom', ['S1', 'S2', 'S3']);
            // no max passed: still reversed so the document-bottom story sorts to the top
            const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/');
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(['### S3', '### S2', '### S1']);
        });

        it('absent order behaves as newest-at-top (first N)', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', undefined, ['S1', 'S2', 'S3']);
            const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/', 1);
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(['### S1']);
        });

        it('unrecognised order value behaves as default (first N)', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', 'sideways', ['S1', 'S2', 'S3', 'S4']);
            const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/', 2);
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(['### S1', '### S2']);
        });

        it('max greater than story count keeps all (newest-at-bottom still reversed)', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', 'newest-at-bottom', ['S1', 'S2']);
            const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/', 10);
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(['### S2', '### S1']);
        });

        it('max = 0 keeps none from that file', () => {
            const doc = orderedFile('id-a', 'a/todo.md', 'T', undefined, ['S1', 'S2', 'S3']);
            const { root, all_notes } = mergeAggregateRoot({ 'id-a': doc }, '/repo/', 0);
            expect(root.child_notes).toHaveLength(0);
            expect(all_notes).toHaveLength(1); // synthetic root only
        });

        it('mix of two files with different order linetags in one merge', () => {
            // a/ keeps first 2 (default), b/ keeps last 2 (newest-at-bottom)
            const docA = orderedFile('id-a', 'a/todo.md', 'A', 'newest-at-top', ['A1', 'A2', 'A3', 'A4']);
            const docB = orderedFile('id-b', 'b/todo.md', 'B', 'newest-at-bottom', ['B1', 'B2', 'B3', 'B4']);
            const { root, all_notes } = mergeAggregateRoot({ 'id-b': docB, 'id-a': docA }, '/repo/', 2);
            // a kept [A1,A2] (first 2), b kept [B4,B3] (last 2 reversed newest-first);
            // round-robin in stable file order a/ then b/ → A1,B4,A2,B3
            expect(root.child_notes!.map(n => n.headline_raw)).toEqual(
                ['### A1', '### B4', '### A2', '### B3'],
            );
            expect(all_notes.map(n => n.seq)).toEqual([0, 1, 2, 3, 4]);
        });

        it('epic-nested stories are counted in the per-file cap', () => {
            // # Todo
            // ### S1            (direct)
            // ## Epic
            // ### S2            (epic-nested)
            // ### S3            (epic-nested)
            // ### S4            (epic-nested)
            const h1 = '# Todo';
            const s1 = '### S1';
            const epic = '## Epic';
            const s2 = '### S2';
            const s3 = '### S3';
            const s4 = '### S4';
            const text = `${h1}\n${s1}\n${epic}\n${s2}\n${s3}\n${s4}\n`;
            let off = 0;
            const h1_n = mdastNode('heading', off, off + h1.length, { depth: 1 }); off += h1.length + 1;
            const s1_n = mdastNode('heading', off, off + s1.length, { depth: 3 }); off += s1.length + 1;
            const epic_n = mdastNode('heading', off, off + epic.length, { depth: 2 }); off += epic.length + 1;
            const s2_n = mdastNode('heading', off, off + s2.length, { depth: 3 }); off += s2.length + 1;
            const s3_n = mdastNode('heading', off, off + s3.length, { depth: 3 }); off += s3.length + 1;
            const s4_n = mdastNode('heading', off, off + s4.length, { depth: 3 }); off += s4.length + 1;
            const doc = makeDoc('id-epic', 'x/todo.md', text, [h1_n, s1_n, epic_n, s2_n, s3_n, s4_n]);

            // cap of 3: keeps S1 (direct) + S2, S3 (epic-nested), drops S4
            const { root } = mergeAggregateRoot({ 'id-epic': doc }, '/repo/', 3);
            const kept = root.child_notes!;
            expect(kept.map(n => n.headline_raw)).toEqual(['### S1', '### S2', '### S3']);
            // epic stamping of the kept epic-nested stories preserved
            expect(kept[0].origin?.epic).toBeUndefined();
            expect(kept[1].origin?.epic?.name).toBe('Epic');
            expect(kept[2].origin?.epic?.name).toBe('Epic');
        });

        it('epic-nested newest-at-bottom keeps the last N across the file, reversed', () => {
            // same shape as above but order=newest-at-bottom, cap 2 → keeps S3,S4 → reversed to S4,S3
            const h1 = '# Todo [](?order=newest-at-bottom)';
            const s1 = '### S1';
            const epic = '## Epic';
            const s2 = '### S2';
            const s3 = '### S3';
            const s4 = '### S4';
            const text = `${h1}\n${s1}\n${epic}\n${s2}\n${s3}\n${s4}\n`;
            let off = 0;
            const h1_n = mdastNode('heading', off, off + h1.length, { depth: 1 }); off += h1.length + 1;
            const s1_n = mdastNode('heading', off, off + s1.length, { depth: 3 }); off += s1.length + 1;
            const epic_n = mdastNode('heading', off, off + epic.length, { depth: 2 }); off += epic.length + 1;
            const s2_n = mdastNode('heading', off, off + s2.length, { depth: 3 }); off += s2.length + 1;
            const s3_n = mdastNode('heading', off, off + s3.length, { depth: 3 }); off += s3.length + 1;
            const s4_n = mdastNode('heading', off, off + s4.length, { depth: 3 }); off += s4.length + 1;
            const doc = makeDoc('id-epic2', 'x/todo.md', text, [h1_n, s1_n, epic_n, s2_n, s3_n, s4_n]);

            const { root } = mergeAggregateRoot({ 'id-epic2': doc }, '/repo/', 2);
            const kept = root.child_notes!;
            expect(kept.map(n => n.headline_raw)).toEqual(['### S4', '### S3']);
            expect(kept[0].origin?.epic?.name).toBe('Epic');
            expect(kept[1].origin?.epic?.name).toBe('Epic');
        });

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
