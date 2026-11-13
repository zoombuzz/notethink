import {
    COORDINATOR_SEND_BODY_MAX_CHARS,
    COORDINATOR_VENDOR_NAMES,
    boardDocFor,
    buildCoordinatorEnvelope,
    compactStamp,
    coordMarkerChanges,
    coordinatorsFrom,
    isCoordinatorEntry,
    isCoordinatorVendorName,
    isSafeCoordinatorName,
    mailboxInboxSegments,
    markerAfter,
    parseBoardStories,
    type CoordinatorTextChange,
} from './coordinatorops';
import type { ResolvedRegistryAgent } from './agentregistryops';

const BOARD = [
    '# Todo',
    '',
    '',
    '### Alpha story [](?id=alpha&status=doing&coord=host-a)',
    '',
    '+ [X] done task [](?work=manual)',
    '+ [ ] open task one',
    '+ [ ] reply to the vendor [](?work=manual)',
    '',
    '',
    '### Beta story [](?id=beta)',
    '',
    '+ [ ] build the shared piece [](?delegate=repo-b)',
    '',
    '',
    '### Gamma story with no tags',
    '',
    '+ [ ] nothing special',
    '',
    '',
    '#### a sub heading that is not a story',
    '',
].join('\n');

function applyChanges(text: string, changes: CoordinatorTextChange[]): string {
    return [...changes].sort((a, b) => b.from - a.from).reduce((acc, change) => acc.slice(0, change.from) + change.insert + acc.slice(change.to), text);
}

function agent(overrides: Partial<ResolvedRegistryAgent> = {}): ResolvedRegistryAgent {
    return {
        agent: 'coord-demo', vendor: 'claude-code', repo: '/ws/demo', state: 'working', story: 'alpha', session_ids: [],
        root_path: '/ws/demo', repo_relative: 'demo', agent_kind: 'coordinator', machine: 'host-a', binary_version: '1.2.3', open_convoys: ['c1'],
        ...overrides,
    };
}

describe('parseBoardStories', () => {
    it('reads each ### heading with its id, status, markers, convoys and operator steps', () => {
        const stories = parseBoardStories(BOARD);
        expect(stories.map(story => story.id)).toEqual(['alpha', 'beta', 'gamma-story-with-no-tags']);
        expect(stories[0]).toMatchObject({ title: 'Alpha story', status: 'doing', markers: ['host-a'], convoys: [], operator_steps: ['reply to the vendor'] });
        expect(stories[1]).toMatchObject({ status: '', markers: [], convoys: ['repo-b'], operator_steps: [] });
        expect(stories[2]).toMatchObject({ convoys: [], operator_steps: [] });
    });

    it('ignores a ticked task, and a heading deeper than three hashes', () => {
        const stories = parseBoardStories(BOARD);
        expect(stories).toHaveLength(3);
        expect(stories[0].operator_steps).not.toContain('done task');
    });

    it('records where each heading line starts', () => {
        const [first] = parseBoardStories(BOARD);
        expect(BOARD.slice(first.line_start, first.line_start + first.line.length)).toBe(first.line);
    });

    it('reads a comma list of hosts in one coord tag', () => {
        const [story] = parseBoardStories('### One [](?coord=host-a,host-b)\n');
        expect(story.markers).toEqual(['host-a', 'host-b']);
    });

    it('gives nothing for a text with no story', () => {
        expect(parseBoardStories('# Todo\n\nplain\n')).toEqual([]);
    });
});

describe('markerAfter', () => {
    it('counts the stories down to the lowest one carrying the host, and 0 when none does', () => {
        const stories = parseBoardStories('### A [](?coord=host-a)\n### B\n### C [](?coord=host-a)\n### D\n');
        expect(markerAfter(stories, 'host-a')).toBe(3);
        expect(markerAfter(stories, 'host-b')).toBe(0);
    });
});

describe('coordMarkerChanges', () => {
    it('moves the marker down one story and leaves every other line alone', () => {
        const next = applyChanges(BOARD, coordMarkerChanges(BOARD, 'host-a', 2));
        expect(next).toContain('### Alpha story [](?id=alpha&status=doing)');
        expect(next).toContain('### Beta story [](?id=beta&coord=host-a)');
        expect(next.replace('### Alpha story [](?id=alpha&status=doing)', '').replace('### Beta story [](?id=beta&coord=host-a)', '')).toBe(BOARD.replace('### Alpha story [](?id=alpha&status=doing&coord=host-a)', '').replace('### Beta story [](?id=beta)', ''));
    });

    it('adds a linetag to a heading that has none', () => {
        const next = applyChanges(BOARD, coordMarkerChanges(BOARD, 'host-a', 3));
        expect(next).toContain('### Gamma story with no tags [](?coord=host-a)');
        expect(parseBoardStories(next).filter(story => story.markers.includes('host-a'))).toHaveLength(1);
    });

    it('takes the marker off the board with 0, dropping a linetag the marker alone filled', () => {
        const board = '### One [](?coord=host-a)\n\n### Two [](?id=two&coord=host-a)\n';
        const next = applyChanges(board, coordMarkerChanges(board, 'host-a', 0));
        expect(next).toBe('### One\n\n### Two [](?id=two)\n');
    });

    it('keeps another host\'s marker, on the same tag or another', () => {
        const board = '### One [](?coord=host-a,host-b)\n### Two\n';
        const next = applyChanges(board, coordMarkerChanges(board, 'host-a', 2));
        expect(next).toBe('### One [](?coord=host-b)\n### Two [](?coord=host-a)\n');
    });

    it('collapses two markers of one host into the one asked for', () => {
        const board = '### One [](?coord=host-a)\n### Two [](?coord=host-a)\n### Three\n';
        const next = applyChanges(board, coordMarkerChanges(board, 'host-a', 1));
        expect(parseBoardStories(next).map(story => story.markers)).toEqual([['host-a'], [], []]);
    });

    it('gives no change when the marker already sits there, or the position names no story', () => {
        expect(coordMarkerChanges(BOARD, 'host-a', 1)).toEqual([]);
        expect(coordMarkerChanges(BOARD, 'host-a', 4)).toEqual([]);
        expect(coordMarkerChanges(BOARD, 'host-a', -1)).toEqual([]);
        expect(coordMarkerChanges(BOARD, 'host-a', 1.5)).toEqual([]);
    });

    it('refuses a host that is not safe to write into a linetag', () => {
        expect(coordMarkerChanges(BOARD, 'a&status=done', 2)).toEqual([]);
        expect(coordMarkerChanges(BOARD, '', 2)).toEqual([]);
    });
});

describe('who a view lists', () => {
    it('lists an entry naming no kind or a coordinator, never an overseer or a session', () => {
        expect(isCoordinatorEntry({ agent_kind: '' })).toBe(true);
        expect(isCoordinatorEntry({})).toBe(true);
        expect(isCoordinatorEntry({ agent_kind: 'coordinator' })).toBe(true);
        expect(isCoordinatorEntry({ agent_kind: 'overseer' })).toBe(false);
        expect(isCoordinatorEntry({ agent_kind: 'session' })).toBe(false);
    });

    it('accepts only names that are safe in a path and a target', () => {
        for (const name of ['coord-demo', 'host-a', 'a.b_c-1']) { expect(isSafeCoordinatorName(name)).toBe(true); }
        for (const name of ['', '-x', '../x', 'a/b', 'a b', 'a@b']) { expect(isSafeCoordinatorName(name)).toBe(false); }
    });
});

describe('coordinatorsFrom', () => {
    const docs = [
        { doc_path: 'demo/docstech/users/dev/todo.md', text: BOARD },
        { doc_path: 'demo/docstech/users/dev/done.md', text: '### Old\n' },
        { doc_path: 'other/docstech/users/dev/todo.md', text: '### Elsewhere\n' },
    ];

    it('places each coordinator on its own repository\'s board with the marker position for its machine', () => {
        const [row] = coordinatorsFrom([agent()], docs);
        expect(row).toMatchObject({ agent: 'coord-demo', machine: 'host-a', version: '1.2.3', open_convoys: ['c1'], root_relative: 'demo', board_doc_path: 'demo/docstech/users/dev/todo.md', marker_after: 1 });
        expect(row.board_stories.map(story => story.id)).toEqual(['alpha', 'beta', 'gamma-story-with-no-tags']);
    });

    it('never carries a mailbox, pane, session or absolute path', () => {
        const text = JSON.stringify(coordinatorsFrom([agent({ session_ids: ['sess-1'] })], docs));
        expect(text).not.toContain('sess-1');
        expect(text).not.toContain('/ws/demo');
        expect(text).not.toContain('mailbox');
    });

    it('omits an overseer, an entry with no machine and an unsafe name, and sorts by name', () => {
        const rows = coordinatorsFrom([
            agent({ agent: 'coord-zed', repo_relative: 'other' }),
            agent({ agent: 'overseer', agent_kind: 'overseer' }),
            agent({ agent: 'coord-nomachine', machine: '' }),
            agent({ agent: '../evil' }),
            agent({ agent: 'coord-alpha' }),
        ], docs);
        expect(rows.map(row => row.agent)).toEqual(['coord-alpha', 'coord-zed']);
    });

    it('has an empty board and no marker for a repository with no todo.md', () => {
        const [row] = coordinatorsFrom([agent({ repo_relative: 'bare' })], docs);
        expect(row).toMatchObject({ board_stories: [], marker_after: 0 });
        expect(row.board_doc_path).toBeUndefined();
    });

    it('finds a board at the workspace root when the repository is the workspace folder', () => {
        const root_docs = [{ doc_path: 'docstech/users/dev/todo.md', text: BOARD }];
        expect(boardDocFor(root_docs, '')?.doc_path).toBe('docstech/users/dev/todo.md');
        expect(boardDocFor(root_docs, 'demo')).toBeUndefined();
    });

    it('takes the first user\'s board, in path order, and not a nested path', () => {
        const two = [
            { doc_path: 'demo/docstech/users/zed/todo.md', text: '### Z\n' },
            { doc_path: 'demo/docstech/users/amy/todo.md', text: '### A\n' },
            { doc_path: 'demo/docstech/users/amy/sub/todo.md', text: '### S\n' },
        ];
        expect(boardDocFor(two, 'demo')?.doc_path).toBe('demo/docstech/users/amy/todo.md');
    });
});

describe('buildCoordinatorEnvelope', () => {
    const NOW = new Date('2026-11-11T09:30:00.123Z');

    it('builds a version 0 request addressed to <agent>@<machine>', () => {
        expect(buildCoordinatorEnvelope({ agent: 'coord-demo', machine: 'host-a', body: '  please look at beta \n', now: NOW, rand_hex: 'abc123' })).toEqual({
            v: 0, id: '20261111T093000Z-abc123', sender: 'notethink', sender_kind: 'operator', origin_machine: 'host-a', target: 'coord-demo@host-a',
            task_id: '20261111T093000Z-abc123', reply_to: '', kind: 'request', state: 'submitted', body: 'please look at beta', created_at: '2026-11-11T09:30:00Z',
        });
    });

    it('refuses an empty or oversize message, an unsafe name and a malformed suffix', () => {
        const base = { agent: 'coord-demo', machine: 'host-a', body: 'hi', now: NOW, rand_hex: 'abc123' };
        expect(buildCoordinatorEnvelope({ ...base, body: '   ' })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, body: 'x'.repeat(COORDINATOR_SEND_BODY_MAX_CHARS + 1) })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, agent: '../x' })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, machine: 'a b' })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, rand_hex: 'ZZZZZZ' })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, body: 'x'.repeat(COORDINATOR_SEND_BODY_MAX_CHARS) })).toBeDefined();
    });

    it('builds a vendor-change envelope of kind vendor whose body names the registry vendor', () => {
        expect(buildCoordinatorEnvelope({ agent: 'coord-demo', machine: 'host-a', kind: 'vendor', vendor: 'agy', now: NOW, rand_hex: 'abc123' })).toEqual({
            v: 0, id: '20261111T093000Z-abc123', sender: 'notethink', sender_kind: 'operator', origin_machine: 'host-a', target: 'coord-demo@host-a',
            task_id: '20261111T093000Z-abc123', reply_to: '', kind: 'vendor', state: 'submitted', body: { vendor: 'agy' }, created_at: '2026-11-11T09:30:00Z',
        });
        for (const vendor of COORDINATOR_VENDOR_NAMES) {
            expect(buildCoordinatorEnvelope({ agent: 'coord-demo', machine: 'host-a', kind: 'vendor', vendor, now: NOW, rand_hex: 'abc123' })?.body).toEqual({ vendor });
        }
    });

    it('refuses a vendor change naming an unknown vendor, an unsafe name or a malformed suffix', () => {
        const base = { agent: 'coord-demo', machine: 'host-a', kind: 'vendor' as const, vendor: 'claude', now: NOW, rand_hex: 'abc123' };
        expect(buildCoordinatorEnvelope({ ...base, vendor: 'claude-code' })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, vendor: '' })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, agent: '../x' })).toBeUndefined();
        expect(buildCoordinatorEnvelope({ ...base, rand_hex: 'zz' })).toBeUndefined();
        expect(isCoordinatorVendorName('codex')).toBe(true);
        expect(isCoordinatorVendorName('antigravity')).toBe(false);
    });

    it('names the compact stamp and the inbox path it files under', () => {
        expect(compactStamp(NOW)).toBe('20261111T093000Z');
        expect(mailboxInboxSegments('coord-demo')).toEqual(['mailboxes', 'coord-demo', 'inbox']);
    });
});
