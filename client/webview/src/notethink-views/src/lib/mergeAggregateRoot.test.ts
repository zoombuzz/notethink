import { mergeAggregateRoot, anyViewInFolderMode, firstIntegrationPath, stampSingleFileStableIds, FOLDER_VIEW_STATE_ID, type AggregatedDocInput } from './mergeAggregateRoot';
import { convertMdastToNoteHierarchy } from './convertMdastToNoteHierarchy';
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

    it('stamps origin.file_mtime from the doc input on every collected story', () => {
        const docA: AggregatedDocInput = { ...simpleFile('id-a', 'a/todo.md', 'A', ['A1', 'A2']), mtime: 1_000 };
        const docB: AggregatedDocInput = { ...simpleFile('id-b', 'b/todo.md', 'B', ['B1']), mtime: 2_000 };
        const { root } = mergeAggregateRoot({ 'id-a': docA, 'id-b': docB }, '/repo/');
        const by_headline = Object.fromEntries(
            root.child_notes!.map(n => [n.headline_raw, n.origin?.file_mtime]),
        );
        expect(by_headline).toEqual({
            '### A1': 1_000, '### A2': 1_000,
            '### B1': 2_000,
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

    it('stamps origin.project_label using the aggregate divergence rule', () => {
        const docNg = simpleFile('id-ng', 'notegit/todo.md', 'Notegit', ['Ng1']);
        const docNt = simpleFile('id-nt', 'notethink/todo.md', 'Notethink', ['Nt1']);
        const docCs = simpleFile('id-cs', 'countingsheet/todo.md', 'Countingsheet', ['Cs1']);
        const { root } = mergeAggregateRoot(
            { 'id-ng': docNg, 'id-nt': docNt, 'id-cs': docCs },
            '/repo/',
        );
        const by_headline = Object.fromEntries(
            root.child_notes!.map(n => [n.headline_raw, n.origin?.project_label]),
        );
        expect(by_headline['### Ng1']).toBe('NG');
        expect(by_headline['### Nt1']).toBe('NT');
        expect(by_headline['### Cs1']).toBe('CO');
    });

    it('keeps pill labels stable across folder descents when workspace_projects is provided', () => {
        // simulates: at workspace root we see notethink + notegit + countingsheet (label NT, NG, CO). After descending into notethink/ only the notethink doc is visible. Without workspace_projects, the disambiguation collapses and notethink's label flips to "NO" (next char). With workspace_projects, the universe is fixed and the label stays "NT"
        const docNt = simpleFile('id-nt', 'notethink/todo.md', 'Notethink', ['Nt1']);
        const workspace_universe = ['countingsheet', 'notegit', 'notethink'];
        const { root } = mergeAggregateRoot(
            { 'id-nt': docNt },
            '/repo/notethink',
            undefined,
            workspace_universe,
        );
        expect(root.child_notes![0].origin?.project_label).toBe('NT');
    });

    it('keeps pill hues stable across folder descents when workspace_projects is provided', () => {
        // hue is assigned by sorted-index of distinct_project_names. With a fixed universe the index for notethink is the same regardless of which subset is currently visible
        const docNt = simpleFile('id-nt', 'notethink/todo.md', 'Notethink', ['Nt1']);
        const workspace_universe = ['countingsheet', 'notegit', 'notethink'];
        const root_alone = mergeAggregateRoot({ 'id-nt': docNt }, '/repo/notethink', undefined, workspace_universe).root;
        const docNg = simpleFile('id-ng', 'notegit/todo.md', 'Notegit', ['Ng1']);
        const docCs = simpleFile('id-cs', 'countingsheet/todo.md', 'Countingsheet', ['Cs1']);
        const root_full = mergeAggregateRoot({ 'id-nt': docNt, 'id-ng': docNg, 'id-cs': docCs }, '/repo', undefined, workspace_universe).root;
        const nt_hue_alone = root_alone.child_notes![0].origin?.project_hue;
        const nt_hue_full = root_full.child_notes!.find(n => n.headline_raw === '### Nt1')?.origin?.project_hue;
        expect(nt_hue_alone).toBeDefined();
        expect(nt_hue_alone).toBe(nt_hue_full);
    });

    it('falls back to visible-set derivation when workspace_projects is omitted (legacy)', () => {
        // legacy callers (no workspace_projects argument) should see the original behaviour: labels derive from the visible set only
        const docNt = simpleFile('id-nt', 'notethink/todo.md', 'Notethink', ['Nt1']);
        const { root } = mergeAggregateRoot({ 'id-nt': docNt }, '/repo/notethink');
        // with only notethink visible and no universe, divergence collapses and we get the second char of the project name (NO) — preserving the old behaviour
        expect(root.child_notes![0].origin?.project_label).toBe('NO');
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

    describe('maxNotesPerFile cap', () => {

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

    describe('stable_id', () => {

        it('stamps stable_id on every note in the merged tree', () => {
            const docA = simpleFile('id-a', 'a/todo.md', 'A', ['Story Alpha', 'Story Beta']);
            const docB = simpleFile('id-b', 'b/todo.md', 'B', ['Story Gamma']);
            const { root, all_notes } = mergeAggregateRoot({ 'id-a': docA, 'id-b': docB }, '/repo/');
            expect(root.stable_id).toBeDefined();
            for (const note of all_notes) {
                expect(note.stable_id).toBeDefined();
                expect(typeof note.stable_id).toBe('string');
                expect((note.stable_id ?? '').length).toBeGreaterThan(0);
            }
            const ids = all_notes.map(n => n.stable_id);
            const unique = new Set(ids);
            expect(unique.size).toBe(ids.length);
        });

        it('round-trips: parse → merge → re-parse same docs → stable_ids identical', () => {
            const docA = simpleFile('id-a', 'a/todo.md', 'A', ['Story Alpha', 'Story Beta']);
            const docB = simpleFile('id-b', 'b/todo.md', 'B', ['Story Gamma', 'Story Delta']);
            const first = mergeAggregateRoot({ 'id-a': docA, 'id-b': docB }, '/repo/');
            // re-build the same docs from scratch so the second pass shares no object identity with the first
            const docA2 = simpleFile('id-a', 'a/todo.md', 'A', ['Story Alpha', 'Story Beta']);
            const docB2 = simpleFile('id-b', 'b/todo.md', 'B', ['Story Gamma', 'Story Delta']);
            const second = mergeAggregateRoot({ 'id-a': docA2, 'id-b': docB2 }, '/repo/');
            const by_headline_first = new Map(first.root.child_notes!.map(n => [n.headline_raw, n.stable_id]));
            const by_headline_second = new Map(second.root.child_notes!.map(n => [n.headline_raw, n.stable_id]));
            expect(by_headline_first).toEqual(by_headline_second);
        });

        it('adding a new file to the aggregate keeps existing stories\' stable_ids', () => {
            const docA = simpleFile('id-a', 'a/todo.md', 'A', ['Story Alpha']);
            const docB = simpleFile('id-b', 'b/todo.md', 'B', ['Story Beta']);
            const before = mergeAggregateRoot({ 'id-a': docA, 'id-b': docB }, '/repo/');
            const docC = simpleFile('id-c', 'c/todo.md', 'C', ['Story Gamma']);
            const after = mergeAggregateRoot({ 'id-a': docA, 'id-b': docB, 'id-c': docC }, '/repo/');
            // every story from `before` must keep its stable_id in `after`
            const before_by_headline = new Map(before.root.child_notes!.map(n => [n.headline_raw, n.stable_id]));
            for (const note of after.root.child_notes!) {
                const previous = before_by_headline.get(note.headline_raw);
                if (previous !== undefined) {
                    expect(note.stable_id).toBe(previous);
                }
            }
            // the new story is present too
            expect(after.root.child_notes!.find(n => n.headline_raw === '### Story Gamma')).toBeDefined();
        });

        it('removing a file from the aggregate keeps remaining stories\' stable_ids', () => {
            const docA = simpleFile('id-a', 'a/todo.md', 'A', ['Story Alpha']);
            const docB = simpleFile('id-b', 'b/todo.md', 'B', ['Story Beta']);
            const docC = simpleFile('id-c', 'c/todo.md', 'C', ['Story Gamma']);
            const before = mergeAggregateRoot({ 'id-a': docA, 'id-b': docB, 'id-c': docC }, '/repo/');
            const after = mergeAggregateRoot({ 'id-a': docA, 'id-c': docC }, '/repo/');
            const before_by_headline = new Map(before.root.child_notes!.map(n => [n.headline_raw, n.stable_id]));
            for (const note of after.root.child_notes!) {
                expect(note.stable_id).toBe(before_by_headline.get(note.headline_raw));
            }
        });

        it('inserting a new sibling story BEFORE an existing one keeps the existing one\'s stable_id', () => {
            // file before: # A / ### Existing
            const before_doc = simpleFile('id-a', 'a/todo.md', 'A', ['Existing']);
            const before = mergeAggregateRoot({ 'id-a': before_doc }, '/repo/');
            const before_existing = before.root.child_notes!.find(n => n.headline_raw === '### Existing')!;
            // file after: # A / ### Inserted Before / ### Existing — the new sibling sits earlier in the file, so `Existing` has a higher offset than it did before
            const after_doc = simpleFile('id-a', 'a/todo.md', 'A', ['Inserted Before', 'Existing']);
            const after = mergeAggregateRoot({ 'id-a': after_doc }, '/repo/');
            const after_existing = after.root.child_notes!.find(n => n.headline_raw === '### Existing')!;
            // sanity check: the new sibling really did shift the offsets, so the fixture still exercises the case
            expect(after_existing.position.start.offset).toBeGreaterThan(before_existing.position.start.offset);
            // the stable_id must survive the shift — this is the case that rules out offset-based derivation
            expect(after_existing.stable_id).toBe(before_existing.stable_id);
        });

        it('duplicate same-headline stories within a file are disambiguated', () => {
            // two stories share the stripped headline "Dup" — the second must get a `#1` suffix so stable_ids remain unique within the file
            const doc = simpleFile('id-a', 'a/todo.md', 'A', ['Dup', 'Dup']);
            const { root } = mergeAggregateRoot({ 'id-a': doc }, '/repo/');
            const ids = root.child_notes!.map(n => n.stable_id);
            expect(ids[0]).not.toBe(ids[1]);
            expect(ids[1]).toMatch(/#1$/);
        });

        it('explicit `[](?id=...)` linetag on a story is used as the slug', () => {
            // # Todo / ### Wire alerts [](?id=wire-alerts)
            const story_headline = '### Wire alerts [](?id=wire-alerts)';
            const text = `# Todo\n${story_headline}\n`;
            const h1_end = 6;
            const h3_start = h1_end + 1;
            const h3_end = h3_start + story_headline.length;
            const children: MdastNode[] = [
                mdastNode('heading', 0, h1_end, { depth: 1 }),
                mdastNode('heading', h3_start, h3_end, { depth: 3 }),
            ];
            const doc = makeDoc('id-doc', 'x/todo.md', text, children);
            const { root } = mergeAggregateRoot({ 'id-doc': doc }, '/repo/');
            expect(root.child_notes![0].stable_id).toBe('id-doc:wire-alerts');
        });

    });

});

describe('anyViewInFolderMode', () => {
    it('returns false for undefined or empty view states', () => {
        expect(anyViewInFolderMode(undefined)).toBe(false);
        expect(anyViewInFolderMode({})).toBe(false);
    });

    it('returns true when the canonical key is tagged folder', () => {
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(true);
    });

    it('returns true via legacy fallback when a doc-path key is tagged folder', () => {
        const view_states = {
            '/repo/a.md': { display_options: { integration_mode: 'folder' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(true);
    });

    it('returns false when canonical is tagged current_file and no legacy folder entry exists', () => {
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } },
            '/repo/a.md': { display_options: { integration_mode: 'current_file' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(false);
    });

    it('legacy rescue: returns true via stranded folder tag even when canonical is current_file (covers pre-fix persisted state until the next flip cleans up)', () => {
        // the dispatcher's clearing-on-flip is what eventually purges stranded tags; until that happens the helper must keep rescuing legacy state so users who never explicitly flipped still see their folder view
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } },
            '/repo/a.md': { display_options: { integration_mode: 'folder' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(true);
    });

    it('falls back to non-canonical scan when the canonical key has no integration_mode at all', () => {
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { } },
            '/repo/a.md': { display_options: { integration_mode: 'folder' } },
        };
        expect(anyViewInFolderMode(view_states)).toBe(true);
    });
});

describe('firstIntegrationPath', () => {
    it('returns undefined for undefined or empty view states', () => {
        expect(firstIntegrationPath(undefined)).toBeUndefined();
        expect(firstIntegrationPath({})).toBeUndefined();
    });

    it('prefers the canonical key over a legacy entry', () => {
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder', integration_path: '/canonical' } },
            '/repo/a.md': { display_options: { integration_mode: 'folder', integration_path: '/legacy' } },
        };
        expect(firstIntegrationPath(view_states)).toBe('/canonical');
    });

    it('legacy rescue: returns the stranded legacy path even when canonical is current_file (covers pre-fix persisted state until the next flip cleans up)', () => {
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'current_file' } },
            '/repo/a.md': { display_options: { integration_mode: 'folder', integration_path: '/legacy' } },
        };
        expect(firstIntegrationPath(view_states)).toBe('/legacy');
    });

    it('falls back to legacy entry when the canonical key has no integration_mode at all', () => {
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { } },
            '/repo/a.md': { display_options: { integration_mode: 'folder', integration_path: '/legacy' } },
        };
        expect(firstIntegrationPath(view_states)).toBe('/legacy');
    });

    it('returns undefined when no entry has both folder tag and a path', () => {
        const view_states = {
            [FOLDER_VIEW_STATE_ID]: { display_options: { integration_mode: 'folder' } },
        };
        expect(firstIntegrationPath(view_states)).toBeUndefined();
    });
});

describe('stampSingleFileStableIds', () => {
    // the single-file path NoteTreeComposer takes; the aggregate suite's invariants must hold against doc_id-namespaced ids

    function buildSingleFile(stories: string[]): { text: string; root: ReturnType<typeof convertMdastToNoteHierarchy>; } {
        const lines: string[] = ['# Doc'];
        for (const s of stories) { lines.push(`### ${s}`); }
        const text = lines.join('\n') + '\n';
        let offset = 0;
        const h1_line = '# Doc';
        const children: MdastNode[] = [
            { type: 'heading', depth: 1, position: { start: { offset: 0, line: 1 }, end: { offset: h1_line.length, line: 1 } }, children: [] },
        ];
        offset = h1_line.length + 1;
        for (const s of stories) {
            const line = `### ${s}`;
            children.push({ type: 'heading', depth: 3, position: { start: { offset, line: 1 }, end: { offset: offset + line.length, line: 1 } }, children: [] });
            offset += line.length + 1;
        }
        const mdast = { type: 'root', position: { start: { offset: 0, line: 1 }, end: { offset: text.length, line: 1 } }, children } as MdastNode;
        const root = convertMdastToNoteHierarchy(mdast, text);
        return { text, root };
    }

    // single-file mode tree shape: root → H1 → [Story1, Story2, ...]. The H1 sits in root.child_notes and the depth-3 stories are H1's child_notes.
    function findStoryByHeadline(root: ReturnType<typeof convertMdastToNoteHierarchy>, headline: string): ReturnType<typeof convertMdastToNoteHierarchy> | undefined {
        const stack = [...(root.child_notes ?? [])];
        while (stack.length > 0) {
            const top = stack.pop()!;
            if (top.headline_raw === headline) { return top; }
            for (const c of (top.child_notes ?? [])) { stack.push(c); }
        }
        return undefined;
    }

    it('stamps stable_id on every note in the tree', () => {
        const { root } = buildSingleFile(['Alpha', 'Beta']);
        stampSingleFileStableIds(root, 'doc-1');
        expect(root.stable_id).toBe('doc-1:__root__');
        // walk the whole tree and assert every note carries a stable_id
        const stack = [...(root.child_notes ?? [])];
        const seen: string[] = [];
        while (stack.length > 0) {
            const top = stack.pop()!;
            expect(top.stable_id).toBeDefined();
            seen.push(top.stable_id!);
            for (const c of (top.child_notes ?? [])) { stack.push(c); }
        }
        expect(seen.length).toBeGreaterThan(0);
    });

    it('keeps a story\'s stable_id when an earlier sibling is inserted in the same file', () => {
        const { root: before_root } = buildSingleFile(['Existing']);
        stampSingleFileStableIds(before_root, 'doc-1');
        const before_existing = findStoryByHeadline(before_root, '### Existing')!;
        const { root: after_root } = buildSingleFile(['Inserted Before', 'Existing']);
        stampSingleFileStableIds(after_root, 'doc-1');
        const after_existing = findStoryByHeadline(after_root, '### Existing')!;
        expect(after_existing.position.start.offset).toBeGreaterThan(before_existing.position.start.offset);
        expect(after_existing.stable_id).toBe(before_existing.stable_id);
    });

    it('is idempotent — calling twice produces the same stable_ids', () => {
        const { root } = buildSingleFile(['Alpha', 'Beta']);
        stampSingleFileStableIds(root, 'doc-1');
        const first_a = findStoryByHeadline(root, '### Alpha')!.stable_id;
        const first_b = findStoryByHeadline(root, '### Beta')!.stable_id;
        stampSingleFileStableIds(root, 'doc-1');
        const second_a = findStoryByHeadline(root, '### Alpha')!.stable_id;
        const second_b = findStoryByHeadline(root, '### Beta')!.stable_id;
        expect(second_a).toBe(first_a);
        expect(second_b).toBe(first_b);
    });

    it('namespaces ids by doc_id so the same headlines across two files don\'t collide', () => {
        const { root: root_a } = buildSingleFile(['Same']);
        const { root: root_b } = buildSingleFile(['Same']);
        stampSingleFileStableIds(root_a, 'doc-a');
        stampSingleFileStableIds(root_b, 'doc-b');
        const id_a = findStoryByHeadline(root_a, '### Same')!.stable_id;
        const id_b = findStoryByHeadline(root_b, '### Same')!.stable_id;
        expect(id_a).not.toBe(id_b);
        expect(id_a).toBe('doc-a:Same');
        expect(id_b).toBe('doc-b:Same');
    });

});
