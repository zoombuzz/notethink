import {
    ACTIVITY_MESSAGE_TYPE,
    ACTIVITY_UNAVAILABLE_MESSAGE_TYPE,
    ACTIVITY_USAGE_WINDOW_DAYS,
    activityUsageWindow,
    attributedCommits,
    attributedFiles,
    earliestCountedActivity,
    unattributedCommits,
    factStateFor,
    formatActivityUsage,
    formatDurationClock,
    isAgentScanPending,
    normaliseActivityPath,
    parseActivityMessage,
    parseActivityUnavailableMessage,
    sessionForUnboundKey,
    sessionStateOf,
    sessionUsageForStory,
    sessionsForStory,
    shortModelId,
    storyKeyForNote,
    totalActivityUsage,
    treeForDocPath,
    treeForRoot,
    truncateActivityArg,
    unattributedFiles,
    unboundSessionKey,
    unboundSessions,
    vendorMonogram,
    virtualNotesForActivity,
    type ActivitySessionState,
    type ActivitySnapshot,
    type ActivityTreeState,
} from './agentactivityops';
import { isVirtualNote, virtualNoteKeyOf } from './virtualnoteops';
import type { ActivitySession, ActivityTree } from '../types/AgentActivity';
import type { NoteProps } from '../types/NoteProps';

const ROOT_PATH = '/mnt/workspace/in_development/notethink';
const ROOT_RELATIVE = 'notethink';
const TODO_PATH = `${ROOT_RELATIVE}/docstech/users/alex.stanhope/todo.md`;

function makeSession(session_id: string, overrides: Partial<ActivitySession> = {}): ActivitySession {
    return {
        session_id,
        vendor: 'claude-code',
        project: 'notethink',
        story_binding: 'none',
        started_at: '2026-09-22T00:00:00Z',
        updated_at: '2026-09-22T00:00:00Z',
        state: 'working',
        capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
        ...overrides,
    };
}

function makeTree(): ActivityTree {
    return {
        generated_at: '2026-09-22T00:00:00Z',
        branch: 'staging',
        head_commit: 'a'.repeat(40),
        uncommitted: [
            { path: 'client/extension/src/agentAnalyser.ts', change: 'added', session_id: 'claude-bound-busy' },
            { path: 'client/extension/src/lib/agentanalyserops.ts', change: 'modified', session_id: 'claude-bound-busy' },
            { path: 'package.json', change: 'modified' },
        ],
        committed: [
            { sha: 'b'.repeat(40), subject: 'wire the analyser', session_id: 'grok-bound-idle' },
            { sha: 'c'.repeat(40), subject: 'unattributed commit' },
        ],
    };
}

function fixtureSnapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
    const grok_capabilities = { live_tool_call: 'supported' as const, question: 'supported' as const, file_attribution: 'unsupported' as const };
    const sessions: ActivitySessionState[] = [
        { root_path: ROOT_PATH, session: makeSession('claude-bound-busy', { story_binding: 'bound', stories: [{ doc_path: TODO_PATH, id: 'agent-activity-card' }] }) },
        { root_path: ROOT_PATH, session: makeSession('grok-bound-idle', { vendor: 'grok', story_binding: 'bound', stories: [{ doc_path: TODO_PATH, id: 'agent-activity-card' }], state: 'idle', capabilities: grok_capabilities }) },
        { root_path: ROOT_PATH, session: makeSession('grok-question', { vendor: 'grok', story_binding: 'bound', stories: [{ doc_path: TODO_PATH, id: 'agent-activity-card' }], question: { question_id: 'q1', asked_at: '2026-09-22T00:00:00Z', prompt: 'Grant run_terminal_command permission?' }, state: 'waiting', capabilities: grok_capabilities }) },
        { root_path: ROOT_PATH, session: makeSession('claude-no-story', { story_binding: 'none' }) },
        { root_path: ROOT_PATH, session: makeSession('codex-no-question', { vendor: 'codex', story_binding: 'bound', stories: [{ doc_path: TODO_PATH, id: 'agent-activity-card' }], state: 'unknown' }) },
    ];
    return {
        analyser: { state: 'live', refusals: [] },
        sessions,
        trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: makeTree() }],
        ...overrides,
    };
}

function makeStoryNote(id: string, relative_path = TODO_PATH): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'heading',
        children_body: [],
        children: [],
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
        headline_raw: `### Story [](?id=${id})`,
        body_raw: '',
        linetags: { id: { key: 'id', value: id, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } },
        origin: { doc_id: 'x', doc_path: `/workspace/${relative_path}`, relative_path },
    };
}

describe('the activity message', () => {

    it('ignores anything that is not an activity message', () => {
        expect(parseActivityMessage({ type: 'update', partial: {} })).toBeUndefined();
        expect(parseActivityMessage(undefined)).toBeUndefined();
        expect(parseActivityMessage({ type: ACTIVITY_MESSAGE_TYPE })).toBeUndefined();
    });

    it('fills in every array, so a component reads the snapshot without a chain of fallbacks', () => {
        expect(parseActivityMessage({ type: ACTIVITY_MESSAGE_TYPE, activity: {} })).toEqual({
            analyser: { state: 'scanning', refusals: [] },
            sessions: [],
            trees: [],
        });
    });

    it('reads five sessions in one repository from a fixture snapshot', () => {
        const snapshot = fixtureSnapshot();
        expect(snapshot.sessions.map(s => s.session.session_id)).toEqual([
            'claude-bound-busy', 'grok-bound-idle', 'grok-question', 'claude-no-story', 'codex-no-question',
        ]);
        expect(treeForRoot(snapshot, ROOT_PATH)?.tree.branch).toBe('staging');
        expect(treeForRoot(snapshot, '/somewhere/else')).toBeUndefined();
    });

    it('reads the host answer that a row request could not be carried out, and nothing else', () => {
        expect(parseActivityUnavailableMessage({ type: ACTIVITY_UNAVAILABLE_MESSAGE_TYPE, request: 'diff', reason: 'not_listed', path: 'a.ts' }))
            .toEqual({ request: 'diff', reason: 'not_listed', path: 'a.ts', session_id: undefined });
        expect(parseActivityUnavailableMessage({ type: ACTIVITY_UNAVAILABLE_MESSAGE_TYPE, request: 'chat', reason: 'no_chat_panel', session_id: 'x' }))
            .toEqual({ request: 'chat', reason: 'no_chat_panel', path: undefined, session_id: 'x' });
        expect(parseActivityUnavailableMessage({ type: ACTIVITY_UNAVAILABLE_MESSAGE_TYPE, request: 'something', reason: 'x' })).toBeUndefined();
        expect(parseActivityUnavailableMessage({ type: 'update' })).toBeUndefined();
    });
});

describe('what a board may honestly say', () => {

    it('never reports a state it was not told, coercing an unrecognised one to unknown', () => {
        const codex = fixtureSnapshot().sessions.find(s => s.session.session_id === 'codex-no-question')!.session;
        expect(sessionStateOf(codex)).toBe('unknown');
        expect(sessionStateOf({ ...codex, state: 'busy' as ActivitySession['state'] })).toBe('unknown');
        expect(sessionStateOf({ ...codex, state: 'working' })).toBe('working');
    });

    it('separates a vendor that cannot report a question from one reporting that none is pending', () => {
        const sessions = fixtureSnapshot().sessions;
        const codex = sessions.find(s => s.session.session_id === 'codex-no-question')!.session;
        const waiting = sessions.find(s => s.session.session_id === 'grok-question')!.session;
        const idle = sessions.find(s => s.session.session_id === 'grok-bound-idle')!.session;
        expect(factStateFor(codex, 'question', codex.question !== undefined)).toBe('unsupported');
        expect(factStateFor(idle, 'question', idle.question !== undefined)).toBe('quiet');
        expect(factStateFor(waiting, 'question', waiting.question !== undefined)).toBe('reported');
    });

    it('reads an absent capability key exactly as it reads an unsupported one', () => {
        const session = { capabilities: {} } as unknown as ActivitySession;
        expect(factStateFor(session, 'live_tool_call', true)).toBe('unsupported');
        expect(factStateFor(undefined, 'live_tool_call', true)).toBe('unsupported');
    });
});

describe('resolving a note to the repository its document sits inside', () => {

    it('spells a path one way, so a leading dot-slash or slash cannot break a join', () => {
        expect(normaliseActivityPath('./a/b.md')).toBe('a/b.md');
        expect(normaliseActivityPath('/a/b.md')).toBe('a/b.md');
        expect(normaliseActivityPath(undefined)).toBe('');
    });

    it('finds the repository a document sits inside, taking the deepest where repositories nest', () => {
        const snapshot = fixtureSnapshot();
        const nested: ActivityTreeState = { ...snapshot.trees[0], root_path: '/w/notethink/vendor', root_relative: 'notethink/vendor' };
        const workspace_root: ActivityTreeState = { ...snapshot.trees[0], root_path: '/w', root_relative: '' };
        const nesting = { ...snapshot, trees: [workspace_root, snapshot.trees[0], nested] };
        expect(treeForDocPath(nesting, 'notethink/vendor/docstech/todo.md')?.root_relative).toBe('notethink/vendor');
        expect(treeForDocPath(nesting, 'notethink/docstech/todo.md')?.root_relative).toBe('notethink');
        expect(treeForDocPath(nesting, 'notegit/docstech/todo.md')?.root_relative).toBe('');
        expect(treeForDocPath(snapshot, undefined)).toBeUndefined();
        expect(treeForRoot(snapshot, ROOT_PATH)?.root_path).toBe(ROOT_PATH);
    });
});

describe('joining a session to a card', () => {

    it('draws every bound session on the story it declared, and on no other', () => {
        const snapshot = fixtureSnapshot();
        const bound = snapshot.sessions.filter(state => state.session.story_binding === 'bound');
        expect(bound.length).toBeGreaterThan(0);
        for (const state of bound) {
            const first_story = state.session.stories![0];
            const key = storyKeyForNote(makeStoryNote(first_story.id, first_story.doc_path))!;
            expect(sessionsForStory(snapshot, key).map(s => s.session.session_id)).toContain(state.session.session_id);
            const wrong_story = storyKeyForNote(makeStoryNote('a-story-nobody-declared', first_story.doc_path))!;
            expect(sessionsForStory(snapshot, wrong_story)).toEqual([]);
        }
    });

    it('resolves a declared story path directly, since the analyser already knows the workspace', () => {
        const snapshot = fixtureSnapshot();
        const bound = snapshot.sessions.find(state => state.session.session_id === 'claude-bound-busy')!;
        expect(bound.session.stories?.[0]?.doc_path).toBe(TODO_PATH);
        expect(sessionsForStory(snapshot, storyKeyForNote(makeStoryNote('agent-activity-card'))!).map(s => s.session.session_id))
            .toEqual(['claude-bound-busy', 'grok-bound-idle', 'grok-question', 'codex-no-question']);
    });

    it('draws nothing rather than guessing when the resolution does not match, however close it looks', () => {
        const snapshot = fixtureSnapshot();
        for (const near_miss of ['docstech/users/alex.stanhope/todo.md', 'notegit/docstech/users/alex.stanhope/todo.md', `${TODO_PATH}x`]) {
            expect(sessionsForStory(snapshot, { doc_path: near_miss, id: 'agent-activity-card' })).toEqual([]);
        }
    });

    it('draws every agent that declared the same story', () => {
        const snapshot = fixtureSnapshot();
        const key = storyKeyForNote(makeStoryNote('agent-activity-card'))!;
        expect(sessionsForStory(snapshot, key)).toHaveLength(4);
    });

    it('derives a joinable id from the headline when a story carries no authored id linetag', () => {
        const untagged = { ...makeStoryNote('agent-activity-card'), headline_raw: '### Ship the thing', linetags: undefined };
        expect(storyKeyForNote(untagged, undefined)).toEqual({ doc_path: TODO_PATH, id: 'ship-the-thing' });
    });

    it('joins a session bound by the extension host under a derived slug to the same card the webview key resolves to', () => {
        // the extension host mirrors storyStableIdSlug byte-for-byte (agentstorybindingops.ts), so "### Ship the thing" derives 'ship-the-thing' on both sides
        const snapshot = fixtureSnapshot({
            sessions: [{ root_path: ROOT_PATH, session: makeSession('claude-untagged', { story_binding: 'bound', stories: [{ doc_path: TODO_PATH, id: 'ship-the-thing' }] }) }],
        });
        const note = { ...makeStoryNote('agent-activity-card'), headline_raw: '### Ship the thing', linetags: undefined };
        const key = storyKeyForNote(note)!;
        expect(sessionsForStory(snapshot, key).map(s => s.session.session_id)).toEqual(['claude-untagged']);
    });

    it('falls back to the view document path in single-file mode, where a note carries no origin', () => {
        const note = { ...makeStoryNote('agent-activity-card'), origin: undefined };
        expect(storyKeyForNote(note, './notethink/docstech/users/alex.stanhope/todo.md')).toEqual({
            doc_path: TODO_PATH,
            id: 'agent-activity-card',
        });
    });

    it('returns undefined when the note carries no document path to join on at all', () => {
        const note = { ...makeStoryNote('agent-activity-card'), origin: undefined };
        expect(storyKeyForNote(note, undefined)).toBeUndefined();
    });

    it('draws a session on every story it bound to, when its own write calls touched more than one', () => {
        const snapshot = fixtureSnapshot({
            sessions: [{ root_path: ROOT_PATH, session: makeSession('claude-multi', { story_binding: 'bound', stories: [{ doc_path: TODO_PATH, id: 'agent-activity-card' }, { doc_path: TODO_PATH, id: 'kanban-perf-harness' }] }) }],
        });
        expect(sessionsForStory(snapshot, { doc_path: TODO_PATH, id: 'agent-activity-card' }).map(s => s.session.session_id)).toEqual(['claude-multi']);
        expect(sessionsForStory(snapshot, { doc_path: TODO_PATH, id: 'kanban-perf-harness' }).map(s => s.session.session_id)).toEqual(['claude-multi']);
    });
});

describe('an agent whose own write calls bound it to no story', () => {

    it('is the only kind of session a virtual note is minted for', () => {
        const snapshot = fixtureSnapshot();
        expect(unboundSessions(snapshot).map(s => s.session.session_id)).toEqual(['claude-no-story']);
        const virtual = virtualNotesForActivity(snapshot);
        expect(virtual).toHaveLength(1);
        expect(isVirtualNote(virtual[0])).toBe(true);
        expect(virtualNoteKeyOf(virtual[0], 'agent')).toBe(`${ROOT_PATH.replace(/^\//, '')}/claude-no-story`);
    });

    it('is keyed per repository, so two repositories running the same session id draw two cards', () => {
        const snapshot = fixtureSnapshot();
        const unbound = unboundSessions(snapshot)[0];
        const elsewhere = { ...unbound, root_path: '/w/notegit' };
        const both = { ...snapshot, sessions: [...snapshot.sessions, elsewhere] };
        expect(unboundSessionKey(unbound)).not.toBe(unboundSessionKey(elsewhere));
        expect(virtualNotesForActivity(both)).toHaveLength(2);
        expect(sessionForUnboundKey(both, unboundSessionKey(elsewhere))?.root_path).toBe('/w/notegit');
        expect(sessionForUnboundKey(both, 'nothing/at-all')).toBeUndefined();
    });

    it('is headlined by its vendor and project, never by a story it did not declare', () => {
        const virtual = virtualNotesForActivity(fixtureSnapshot());
        expect(virtual[0].headline_raw).toBe('claude-code in notethink');
        expect(virtual[0].origin?.project_hue).toEqual(expect.any(Number));
    });
});

describe('changed files and commits', () => {

    it('lists only the uncommitted files a card own sessions account for', () => {
        const tree = treeForRoot(fixtureSnapshot(), ROOT_PATH)?.tree;
        expect(attributedFiles(tree, ['claude-bound-busy']).map(f => f.path)).toEqual([
            'client/extension/src/agentAnalyser.ts',
            'client/extension/src/lib/agentanalyserops.ts',
        ]);
    });

    it('never credits an uncommitted file with no matching write call to a guessed agent', () => {
        const tree = treeForRoot(fixtureSnapshot(), ROOT_PATH)?.tree;
        expect(unattributedFiles(tree).map(f => f.path)).toEqual(['package.json']);
        const every_session = fixtureSnapshot().sessions.map(s => s.session.session_id);
        expect(attributedFiles(tree, every_session).map(f => f.path)).not.toContain('package.json');
    });

    it('lists only the commits a card own sessions accounted for, and never credits an unmatched one', () => {
        const tree = treeForRoot(fixtureSnapshot(), ROOT_PATH)?.tree;
        expect(attributedCommits(tree, ['grok-bound-idle']).map(c => c.subject)).toEqual(['wire the analyser']);
        expect(attributedCommits(tree, ['claude-bound-busy'])).toEqual([]);
    });

    it('lists an unattributed commit separately, the same way an unattributed file is never credited to a guessed agent', () => {
        const tree = treeForRoot(fixtureSnapshot(), ROOT_PATH)?.tree;
        expect(unattributedCommits(tree).map(c => c.subject)).toEqual(['unattributed commit']);
    });
});

describe('drawing a vendor and its arguments', () => {

    it('draws a monogram for any vendor, including one nobody has heard of', () => {
        expect(vendorMonogram('claude-code')).toBe('CC');
        expect(vendorMonogram('codex')).toBe('CO');
        expect(vendorMonogram('grok')).toBe('GR');
        expect(vendorMonogram('some_new_vendor')).toBe('SN');
        expect(vendorMonogram('')).toBe('??');
    });

    it('truncates a long argument for display rather than dropping it', () => {
        expect(truncateActivityArg('short', 200)).toBe('short');
        expect(truncateActivityArg(undefined, 200)).toBe('');
        expect(truncateActivityArg('abcdef', 4)).toBe('abc…');
    });

    it('drops only the claude- prefix the CC monogram already says, leaving every other model id whole', () => {
        expect(shortModelId('claude-opus-5-5')).toBe('opus-5-5');
        expect(shortModelId('gpt-5-codex')).toBe('gpt-5-codex');
        expect(shortModelId('grok-4')).toBe('grok-4');
        expect(shortModelId('claude-')).toBe('claude-');
        expect(shortModelId(undefined)).toBe('');
    });
});

describe('waiting on the first scan', () => {

    it('is waiting from the demand until the host reports anything but scanning', () => {
        expect(isAgentScanPending(true, undefined)).toBe(true);
        expect(isAgentScanPending(true, fixtureSnapshot({ analyser: { state: 'scanning', refusals: [] } }))).toBe(true);
        expect(isAgentScanPending(true, fixtureSnapshot())).toBe(false);
        expect(isAgentScanPending(true, fixtureSnapshot({ analyser: { state: 'failed', refusals: [] } }))).toBe(false);
        expect(isAgentScanPending(true, fixtureSnapshot({ analyser: { state: 'unavailable', refusals: [] } }))).toBe(false);
    });

    it('is never waiting in a panel that has not asked, whatever snapshot it was left holding', () => {
        expect(isAgentScanPending(false, undefined)).toBe(false);
        expect(isAgentScanPending(false, fixtureSnapshot({ analyser: { state: 'scanning', refusals: [] } }))).toBe(false);
    });
});

describe('the duration clock', () => {

    const end = '2026-09-23T12:00:00Z';

    it('reads in minutes under an hour, and in hours and padded minutes up to two days', () => {
        expect(formatDurationClock('2026-09-23T11:48:00Z', end)).toBe('12m');
        expect(formatDurationClock('2026-09-23T08:55:00Z', end)).toBe('3h 05m');
        expect(formatDurationClock('2026-09-21T12:01:00Z', end)).toBe('47h 59m');
    });

    it('reads in whole days from two days on, never as a count of hundreds of hours', () => {
        expect(formatDurationClock('2026-09-21T12:00:00Z', end)).toBe('2d');
        expect(formatDurationClock('2026-09-05T11:04:00Z', end)).toBe('18d');
    });

    it('measures between its two timestamps, not from either one to now', () => {
        expect(formatDurationClock('2026-09-01T10:00:00Z', '2026-09-01T10:42:00Z')).toBe('42m');
    });

    it('draws nothing when either timestamp is unparseable, and never a negative clock for an end before its start', () => {
        expect(formatDurationClock('not a date', end)).toBe('');
        expect(formatDurationClock(end, 'not a date')).toBe('');
        expect(formatDurationClock('2026-09-23T12:05:00Z', end)).toBe('0m');
    });
});

describe('the span a usage counter states', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');

    it('rounds up to whole days from the earliest counted activity, so the span always contains it', () => {
        expect(activityUsageWindow('2026-09-21T13:00:00Z', now)).toEqual({ unit: 'd', count: 2 });
        expect(activityUsageWindow('2026-09-21T11:00:00Z', now)).toEqual({ unit: 'd', count: 3 });
    });

    it('states hours under a day, and at least one', () => {
        expect(activityUsageWindow('2026-09-23T06:30:00Z', now)).toEqual({ unit: 'h', count: 6 });
        expect(activityUsageWindow('2026-09-23T11:59:00Z', now)).toEqual({ unit: 'h', count: 1 });
    });

    it('never states more than the analyser window, and falls back to it for an unknown start', () => {
        expect(activityUsageWindow('2026-06-01T00:00:00Z', now)).toEqual({ unit: 'd', count: ACTIVITY_USAGE_WINDOW_DAYS });
        expect(activityUsageWindow(undefined, now)).toEqual({ unit: 'd', count: ACTIVITY_USAGE_WINDOW_DAYS });
        expect(activityUsageWindow('not a date', now)).toEqual({ unit: 'd', count: ACTIVITY_USAGE_WINDOW_DAYS });
    });

    it('takes a story card from its sessions earliest first_at for that story, ignoring their other stories', () => {
        const story_a = { doc_path: 'todo.md', id: 'story-a' };
        const story_b = { doc_path: 'todo.md', id: 'story-b' };
        const usage = { input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
        const sessions: ActivitySessionState[] = [
            { root_path: '/a', session: makeSession('s1', { story_usage: [{ story: story_a, usage, first_at: '2026-09-22T10:00:00Z' }, { story: story_b, usage, first_at: '2026-09-01T00:00:00Z' }] }) },
            { root_path: '/a', session: makeSession('s2', { story_usage: [{ story: story_a, usage, first_at: '2026-09-21T10:00:00Z' }] }) },
        ];
        expect(earliestCountedActivity(sessions, story_a)).toBe('2026-09-21T10:00:00Z');
    });

    it('takes a virtual note from its session start, and says nothing when no session carries a start', () => {
        const sessions: ActivitySessionState[] = [{ root_path: '/a', session: makeSession('s1', { started_at: '2026-09-20T00:00:00Z' }) }];
        expect(earliestCountedActivity(sessions)).toBe('2026-09-20T00:00:00Z');
        expect(earliestCountedActivity([], { doc_path: 'todo.md', id: 'story-a' })).toBeUndefined();
    });
});

describe('the token and cost counter', () => {

    it('states the window it is given on the token total, adding input, output and both cache fields', () => {
        const usage = { input_tokens: 100, output_tokens: 20, cache_read_tokens: 5, cache_write_tokens: 3, is_estimate: true };
        expect(formatActivityUsage(usage, { unit: 'd', count: 30 })).toBe('128 tokens (30d)');
        expect(formatActivityUsage(usage, { unit: 'h', count: 5 })).toBe('128 tokens (5h)');
    });

    it('leaves the window off when given none, for a row sitting under a total that already states it', () => {
        const usage = { input_tokens: 100, output_tokens: 20, cache_read_tokens: 5, cache_write_tokens: 3, cost_usd: 0.5, is_estimate: true };
        expect(formatActivityUsage(usage)).toBe('128 tokens ~$0.50');
    });

    it('prefixes an estimated cost with a tilde, and a vendor-supplied one without', () => {
        const estimated = { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.5, is_estimate: true };
        const authoritative = { ...estimated, is_estimate: false };
        expect(formatActivityUsage(estimated)).toContain('~$0.50');
        expect(formatActivityUsage(authoritative)).not.toContain('~');
        expect(formatActivityUsage(authoritative)).toContain('$0.50');
    });

    it('omits the dollar figure entirely, keeping the tokens, when the usage is unpriced', () => {
        const unpriced = { input_tokens: 42, output_tokens: 8, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
        const result = formatActivityUsage(unpriced);
        expect(result).toContain('50 tokens');
        expect(result).not.toContain('$');
    });

    it('sums two sessions token by token and dollar by dollar', () => {
        const sessions: ActivitySessionState[] = [
            { root_path: '/a', session: makeSession('s1', { usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.1, is_estimate: true } }) },
            { root_path: '/a', session: makeSession('s2', { usage: { input_tokens: 5, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.2, is_estimate: false } }) },
        ];
        const total = totalActivityUsage(sessions);
        expect(total.input_tokens).toBe(15);
        expect(total.output_tokens).toBe(3);
        expect(total.cost_usd).toBeCloseTo(0.3);
    });

    it('one estimated session among the sessions makes the whole total an estimate', () => {
        const sessions: ActivitySessionState[] = [
            { root_path: '/a', session: makeSession('s1', { usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.1, is_estimate: false } }) },
            { root_path: '/a', session: makeSession('s2', { usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.1, is_estimate: true } }) },
        ];
        expect(totalActivityUsage(sessions).is_estimate).toBe(true);
    });

    it('leaves the total unpriced when one session among priced ones is unpriced, so the dollar never understates the tokens beside it', () => {
        const sessions: ActivitySessionState[] = [
            { root_path: '/a', session: makeSession('s1', { usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.1, is_estimate: true } }) },
            { root_path: '/a', session: makeSession('s2', { usage: { input_tokens: 5, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true } }) },
        ];
        const total = totalActivityUsage(sessions);
        expect(total.cost_usd).toBeUndefined();
        expect(formatActivityUsage(total)).not.toContain('$');
    });

    it('leaves the total unpriced when every session is unpriced', () => {
        const sessions: ActivitySessionState[] = [
            { root_path: '/a', session: makeSession('s3', { usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true } }) },
            { root_path: '/a', session: makeSession('s3', { usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true } }) },
        ];
        expect(totalActivityUsage(sessions).cost_usd).toBeUndefined();
    });

    it('with a story key, credits a session only its own split share for that story, never its whole-session total', () => {
        const story_a = { doc_path: TODO_PATH, id: 'story-a' };
        const story_b = { doc_path: TODO_PATH, id: 'story-b' };
        const sessions: ActivitySessionState[] = [{
            root_path: '/a',
            session: makeSession('s1', {
                story_binding: 'bound',
                stories: [story_a, story_b],
                usage: { input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 1, is_estimate: true },
                story_usage: [
                    { story: story_a, usage: { input_tokens: 40, output_tokens: 8, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.4, is_estimate: true } },
                    { story: story_b, usage: { input_tokens: 60, output_tokens: 12, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.6, is_estimate: true } },
                ],
            }),
        }];
        expect(totalActivityUsage(sessions, story_a)).toEqual(expect.objectContaining({ input_tokens: 40, output_tokens: 8, cost_usd: 0.4 }));
        expect(totalActivityUsage(sessions, story_b)).toEqual(expect.objectContaining({ input_tokens: 60, output_tokens: 12, cost_usd: 0.6 }));
        expect(totalActivityUsage(sessions).input_tokens).toBe(100);
        expect(sessionUsageForStory(sessions[0], story_a).input_tokens).toBe(40);
        expect(sessionUsageForStory(sessions[0], undefined).input_tokens).toBe(100);
        expect(sessionUsageForStory(sessions[0], { doc_path: TODO_PATH, id: 'story-c' }).input_tokens).toBe(100);
    });
});
