import {
    COORDINATOR_BOARD_MAX_STORIES,
    COORDINATOR_SEND_BODY_MAX_CHARS,
    COORDINATOR_VENDOR_NAMES,
    boardDocFor,
    boardLinePositions,
    buildCoordinatorEnvelope,
    compactStamp,
    boardLinesFrom,
    coordinatorsFrom,
    isBuildable,
    isCoordinatorEntry,
    isCoordinatorVendorName,
    isMarkerPushed,
    isSafeCoordinatorName,
    isShippable,
    mailboxInboxSegments,
    sameCommit,
    parseBoardStories,
    type BoardLineFacts,
    type BoardStory,
} from './coordinatorops';
import type { ResolvedRegistryAgent } from './agentregistryops';

const BOARD = [
    '# Todo',
    '',
    '',
    '### Alpha story [](?id=alpha&status=doing)',
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

function agent(overrides: Partial<ResolvedRegistryAgent> = {}): ResolvedRegistryAgent {
    return {
        agent: 'coord-demo', vendor: 'claude-code', repo: '/ws/demo', state: 'working', story: 'alpha', session_ids: [],
        root_path: '/ws/demo', repo_relative: 'demo', agent_kind: 'coordinator', machine: 'host-a', open_convoys: ['c1'],
        ...overrides,
    };
}

describe('parseBoardStories', () => {
    it('reads each ### heading with its id, status, convoys and operator steps', () => {
        const stories = parseBoardStories(BOARD);
        expect(stories.map(story => story.id)).toEqual(['alpha', 'beta', 'gamma-story-with-no-tags']);
        expect(stories[0]).toMatchObject({ title: 'Alpha story', status: 'doing', convoys: [], operator_steps: ['reply to the vendor'] });
        expect(stories[1]).toMatchObject({ status: '', convoys: ['repo-b'], operator_steps: [] });
        expect(stories[2]).toMatchObject({ convoys: [], operator_steps: [] });
    });

    it('ignores a ticked task, and a heading deeper than three hashes', () => {
        const stories = parseBoardStories(BOARD);
        expect(stories).toHaveLength(3);
        expect(stories[0].operator_steps).not.toContain('done task');
    });

    it('gives nothing for a text with no story', () => {
        expect(parseBoardStories('# Todo\n\nplain\n')).toEqual([]);
    });
});

describe('who a view lists', () => {
    it('lists an entry naming no kind or a coordinator, never another kind', () => {
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

    it('places each coordinator on its own repository\'s board with the stories of its board', () => {
        const [row] = coordinatorsFrom([agent()], docs);
        expect(row).toMatchObject({ agent: 'coord-demo', machine: 'host-a', open_convoys: ['c1'], root_relative: 'demo', board_doc_path: 'demo/docstech/users/dev/todo.md' });
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

    it('has an empty board for a repository with no todo.md', () => {
        const [row] = coordinatorsFrom([agent({ repo_relative: 'bare' })], docs);
        expect(row).toMatchObject({ board_stories: [] });
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

function story(id: string, fields: Partial<BoardStory> = {}): BoardStory {
    return { id, title: id, status: '', convoys: [], operator_steps: [], sent: false, markers: [], open_question: false, blocked: false, ...fields };
}

describe('parseBoardStories line facts', () => {
    const text = [
        '### Sent one [](?id=sent-one&sent=go-1)',
        '+ [ ] a task',
        '',
        '### Asked [](?id=asked&status=doing)',
        '+ open question (decision): which way',
        '',
        '### Stuck [](?id=stuck&status=doing)',
        '+ blocked on the vendor: waiting',
        '',
        '### Placed [](?id=placed&sent=go-2&coord=host-a, host-b)',
        '',
        '### Plain [](?id=plain)',
        '+ open questions are not a line shape',
        '+ [X] blocked tasks that are ticked do not count',
    ].join('\n');

    it('reads the sent tag, an open question and a blocked note', () => {
        const stories = parseBoardStories(text);
        expect(stories.map(s => [s.id, s.sent, s.open_question, s.blocked])).toEqual([
            ['sent-one', true, false, false],
            ['asked', false, true, false],
            ['stuck', false, false, true],
            ['placed', true, false, false],
            ['plain', false, false, false],
        ]);
    });

    it('reads the machines a coord tag names', () => {
        const stories = parseBoardStories(text);
        expect(stories.map(s => s.markers)).toEqual([[], [], [], ['host-a', 'host-b'], []]);
    });
});

describe('isBuildable', () => {
    it('takes a story that was sent, is delegated or is the one in flight', () => {
        expect(isBuildable(story('a', { sent: true }))).toBe(true);
        expect(isBuildable(story('delegated-b'))).toBe(true);
        expect(isBuildable(story('c', { status: 'doing' }), { in_flight: ['c'] })).toBe(true);
        expect(isBuildable(story('d'))).toBe(false);
    });

    it('does not take a story at doing that is neither sent, delegated nor in flight', () => {
        expect(isBuildable(story('c', { status: 'doing' }))).toBe(false);
        expect(isBuildable(story('c', { status: 'doing' }), { in_flight: ['other'] })).toBe(false);
    });

    it('leaves out a story at code-review or testing even when it was sent or is in flight', () => {
        expect(isBuildable(story('a', { sent: true, status: 'code-review' }))).toBe(false);
        expect(isBuildable(story('a', { status: 'testing' }), { in_flight: ['a'] })).toBe(false);
    });

    it('leaves out a story parked on a question, a blocked note, a manual task or a delegated task', () => {
        const parked: Array<Partial<BoardStory>> = [{ open_question: true }, { blocked: true }, { operator_steps: ['sign it'] }, { convoys: ['repo-b'] }];
        for (const fields of parked) {
            expect(isBuildable(story('a', { sent: true, ...fields }))).toBe(false);
            expect(isBuildable(story('a', fields), { in_flight: ['a'] })).toBe(false);
        }
    });

    it('leaves out a story whose id an open question of the coordinator names whole', () => {
        const facts: BoardLineFacts = { waiting_questions: ['which way for fix-the-thing (a)?', 'and `other`'] };
        expect(isBuildable(story('fix-the-thing', { sent: true }), facts)).toBe(false);
        expect(isBuildable(story('fix', { sent: true }), facts)).toBe(true);
        expect(isBuildable(story('thing', { sent: true }), facts)).toBe(true);
        expect(isBuildable(story('other', { sent: true }), facts)).toBe(false);
        expect(isBuildable(story('fix-the-thing', { sent: true }), { waiting_questions: ['fix-the-thing-two?'] })).toBe(true);
        expect(isBuildable(story('a.b', { sent: true }), { waiting_questions: ['aXb?'] })).toBe(true);
    });

    it('leaves out a sent story whose coord tag excludes the coordinator machine, but not one with no tag or an unknown machine', () => {
        const placed = story('a', { sent: true, markers: ['host-b'] });
        expect(isBuildable(placed, { machine: 'host-a.example.test' })).toBe(false);
        expect(isBuildable(placed, { machine: 'host-b.example.test' })).toBe(true);
        expect(isBuildable(placed, {})).toBe(true);
        expect(isBuildable(story('a', { sent: true }), { machine: 'host-a' })).toBe(true);
    });

    it('does not apply a coord tag to the story in flight', () => {
        expect(isBuildable(story('a', { markers: ['host-b'] }), { machine: 'host-a', in_flight: ['a'] })).toBe(true);
    });
});

describe('isShippable', () => {
    it('takes a story at code-review or testing, or one the ready marker names', () => {
        expect(isShippable(story('a', { status: 'code-review' }), [])).toBe(true);
        expect(isShippable(story('a', { status: 'testing' }), [])).toBe(true);
        expect(isShippable(story('a', { status: 'doing' }), ['a'])).toBe(true);
        expect(isShippable(story('a', { status: 'doing' }), ['b'])).toBe(false);
    });
});

describe('sameCommit', () => {
    it('compares a short and a long sha by prefix, in either order, ignoring case', () => {
        const long = '6c3d7f27bfb747f9c2c42e9539288a6c19242425';
        expect(sameCommit(long, '6c3d7f2')).toBe(true);
        expect(sameCommit('6C3D7F2', long)).toBe(true);
        expect(sameCommit(long, long)).toBe(true);
        expect(sameCommit(long, '6c3d7f3')).toBe(false);
    });

    it('is false for a missing sha or one too short to name a commit', () => {
        expect(sameCommit(undefined, '6c3d7f2')).toBe(false);
        expect(sameCommit('', '')).toBe(false);
        expect(sameCommit('6c3', '6c3d7f2')).toBe(false);
    });
});

describe('isMarkerPushed', () => {
    const marker = '6c3d7f27bfb747f9c2c42e9539288a6c19242425';
    const other = '9e95da3f38e17d425b75e48406a05f6a0e6bd784';

    it('is pushed when the branch has an upstream and nothing ahead of it', () => {
        expect(isMarkerPushed(marker, { has_upstream: true, ahead: 0 })).toBe(true);
        expect(isMarkerPushed(marker, { has_upstream: true })).toBe(true);
    });

    it('is pushed when the marker is the upstream commit, whichever sha is short', () => {
        expect(isMarkerPushed(marker, { has_upstream: true, ahead: 2, upstream_sha: marker.slice(0, 7) })).toBe(true);
        expect(isMarkerPushed(marker.slice(0, 10), { has_upstream: true, ahead: 2, upstream_sha: marker })).toBe(true);
    });

    it('is pushed when a complete list of the unpushed commits leaves the marker out', () => {
        expect(isMarkerPushed(marker, { has_upstream: true, ahead: 1, upstream_sha: other, pending_shas: [other], pending_complete: true })).toBe(true);
    });

    it('is not pushed when the marker is among the unpushed commits', () => {
        expect(isMarkerPushed(marker, { has_upstream: true, ahead: 1, upstream_sha: other, pending_shas: [marker], pending_complete: true })).toBe(false);
        expect(isMarkerPushed(marker.slice(0, 8), { has_upstream: true, ahead: 1, pending_shas: [marker], pending_complete: true })).toBe(false);
    });

    it('counts the marker when git cannot say', () => {
        expect(isMarkerPushed(marker, undefined)).toBe(false);
        expect(isMarkerPushed(marker, { has_upstream: false })).toBe(false);
        expect(isMarkerPushed(marker, { has_upstream: true, ahead: 1, pending_shas: [other], pending_complete: false })).toBe(false);
        expect(isMarkerPushed(marker, { has_upstream: true, ahead: 1 })).toBe(false);
        expect(isMarkerPushed('', { has_upstream: true, ahead: 1, pending_shas: [other], pending_complete: true })).toBe(false);
    });
});

describe('boardLinePositions', () => {
    it('counts the stories at or above the last story each line marks', () => {
        const stories = [
            story('a', { status: 'code-review' }),
            story('b', { status: 'doing' }),
            story('c', { status: 'doing', open_question: true }),
            story('d', { sent: true }),
            story('e'),
        ];
        expect(boardLinePositions(stories)).toEqual({ build_after: 4, ship_after: 1 });
        expect(boardLinePositions(stories, { ready_ids: ['e'] })).toEqual({ build_after: 4, ship_after: 5 });
    });

    it('puts the solid line on the story in flight and not on a later story left at doing', () => {
        const stories = [story('a', { sent: true }), story('b', { status: 'doing' }), story('c', { status: 'doing' })];
        expect(boardLinePositions(stories, {}).build_after).toBe(1);
        expect(boardLinePositions(stories, { in_flight: ['b'] }).build_after).toBe(2);
    });

    it('is zero for both lines on a board with nothing to build or ship', () => {
        expect(boardLinePositions([story('a'), story('b')])).toEqual({ build_after: 0, ship_after: 0 });
        expect(boardLinePositions([], { ready_ids: ['a'] })).toEqual({ build_after: 0, ship_after: 0 });
    });

    it('keeps the lines off a coordinator row, since they are read from the boards alone', () => {
        const docs = [{ doc_path: 'demo/docstech/users/dev/todo.md', text: '### One [](?id=one&status=doing)\n' }];
        const [row] = coordinatorsFrom([agent()], docs);
        expect(row).not.toHaveProperty('build_after');
        expect(row).not.toHaveProperty('ship_after');
    });
});

describe('boardLinesFrom', () => {
    const TEXT = '# Todo\n\n\n### One [](?id=one&sent=go-1)\n\n\n### Two [](?id=two)\n\n\n### Three [](?id=three&status=code-review)\n';
    const docs = [
        { doc_path: 'demo/docstech/users/dev/todo.md', text: TEXT },
        { doc_path: 'demo/docstech/users/dev/done.md', text: '### Old [](?id=old&status=doing)\n' },
        { doc_path: 'notes/todo.md', text: TEXT },
        { doc_path: 'bare/docstech/users/dev/todo.md', text: '# Todo\n' },
    ];

    it('computes each user todo.md board alone, with no coordinator, leaving out done.md, other todo.md files and boards with no story', () => {
        expect(boardLinesFrom(docs)).toEqual([
            { doc_path: 'demo/docstech/users/dev/todo.md', story_ids: ['one', 'two', 'three'], build_after: 1, ship_after: 3 },
        ]);
    });

    it('takes the facts of the board a document path names, leaving other boards to the statuses', () => {
        const text = '### One [](?id=one)\n\n\n### Two [](?id=two)\n';
        const boards = [{ doc_path: 'demo/docstech/users/dev/todo.md', text }, { doc_path: 'other/docstech/users/dev/todo.md', text }];
        const lines = boardLinesFrom(boards, new Map([['demo/docstech/users/dev/todo.md', { ready_ids: ['two'], in_flight: ['one'] }]]));
        expect(lines.map(entry => [entry.doc_path, entry.build_after, entry.ship_after])).toEqual([['demo/docstech/users/dev/todo.md', 1, 2], ['other/docstech/users/dev/todo.md', 0, 0]]);
    });

    it('keeps both lines on a board where two stories share an id', () => {
        const text = '### Same [](?id=same&sent=go-1)\n\n\n### Same [](?id=same&status=code-review)\n';
        const [entry] = boardLinesFrom([{ doc_path: 'demo/docstech/users/dev/todo.md', text }]);
        expect(entry).toMatchObject({ story_ids: ['same', 'same'], build_after: 1, ship_after: 2 });
    });

    it('puts boards in path order and bounds the story ids a board lists', () => {
        const long = Array.from({ length: COORDINATOR_BOARD_MAX_STORIES + 20 }, (_, i) => `### S${i} [](?id=s${i}&sent=go-${i})\n`).join('\n\n');
        const [entry] = boardLinesFrom([{ doc_path: 'z/docstech/users/dev/todo.md', text: long }]);
        expect(entry.story_ids).toHaveLength(COORDINATOR_BOARD_MAX_STORIES);
        expect(entry.build_after).toBe(COORDINATOR_BOARD_MAX_STORIES);
        const sorted = boardLinesFrom([{ doc_path: 'b/docstech/users/dev/todo.md', text: TEXT }, { doc_path: 'a/docstech/users/dev/todo.md', text: TEXT }]);
        expect(sorted.map(item => item.doc_path)).toEqual(['a/docstech/users/dev/todo.md', 'b/docstech/users/dev/todo.md']);
    });
});
