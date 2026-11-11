import {
    ACTIVITY_MESSAGE_TYPE,
    ACTIVITY_UNAVAILABLE_MESSAGE_TYPE,
    childDisplayName,
    childStateOf,
    formatChildClock,
    splitChildrenForDisplay,
    sessionExpandedByDefault,
    attributedCommits,
    attributedFiles,
    unattributedCommits,
    agentClockModeLabel,
    agentClockTooltip,
    factStateFor,
    formatActivityUsage,
    formatStatusTokens,
    formatStatusUsage,
    formatAgentClock,
    formatDurationClock,
    isAgentCardScanDone,
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
    unboundSessionHeadline,
    unboundSessionKey,
    isSessionLive,
    unboundSessions,
    vendorColour,
    vendorLabel,
    vendorMonogram,
    sessionDisplayName,
    viewedActivityScope,
    virtualNotesForActivity,
    type ActivityAnalyserState,
    type ActivitySessionState,
    type ActivitySnapshot,
    type ActivityTreeState,
    type ActivityViewScope,
} from './agentactivityops';
import { isVirtualNote, virtualNoteKeyOf } from './virtualnoteops';
import type { ActivityChildSession, ActivitySession, ActivityState, ActivityTree } from '../types/AgentActivity';
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
            progress: [],
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
        // the extension host mirrors storyStableIdSlug byte-for-byte, so both sides derive 'ship-the-thing' alike
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

/** a scope admitting exactly these root_paths, folder-mode shaped unless told otherwise; `undefined` in the list admits a root-less session */
function scopeAdmitting(root_paths: ReadonlyArray<string | undefined>, notes_carry_relative_path = true): ActivityViewScope {
    return { root_paths: new Set(root_paths), notes_carry_relative_path };
}

describe('an agent whose own write calls bound it to no story', () => {

    it('is the only kind of session a virtual note is minted for', () => {
        const snapshot = fixtureSnapshot();
        expect(unboundSessions(snapshot).map(s => s.session.session_id)).toEqual(['claude-no-story']);
        const virtual = virtualNotesForActivity(snapshot, scopeAdmitting([ROOT_PATH]));
        expect(virtual).toHaveLength(1);
        expect(isVirtualNote(virtual[0])).toBe(true);
        expect(virtualNoteKeyOf(virtual[0], 'agent')).toBe(`${ROOT_PATH.replace(/^\//, '')}/claude-no-story`);
    });

    it('hides an ended session whose transcript was read from its tail, like any other ended session', () => {
        const snapshot = fixtureSnapshot({
            sessions: [{ root_path: ROOT_PATH, session: makeSession('s-tail-ended', { state: 'ended', tail_read: true }) }],
        });
        expect(virtualNotesForActivity(snapshot, scopeAdmitting([ROOT_PATH]))).toHaveLength(0);
    });

    it('draws a card only while live: ended is hidden, and unknown (no liveness reporting) stays visible', () => {
        const states = ['working', 'waiting', 'idle', 'ended', 'unknown'] as const;
        const snapshot = fixtureSnapshot({
            sessions: states.map(state => ({ root_path: ROOT_PATH, session: makeSession(`s-${state}`, { state }) })),
        });
        expect(unboundSessions(snapshot)).toHaveLength(5);
        const keys = virtualNotesForActivity(snapshot, scopeAdmitting([ROOT_PATH])).map(note => virtualNoteKeyOf(note, 'agent'));
        expect(keys).toEqual(['working', 'waiting', 'idle', 'unknown'].map(state => `${ROOT_PATH.replace(/^\//, '')}/s-${state}`));
        expect(isSessionLive({ root_path: ROOT_PATH, session: makeSession('x', { state: 'ended' }) })).toBe(false);
    });

    it('is keyed per repository, so two repositories running the same session id draw two cards', () => {
        const snapshot = fixtureSnapshot();
        const unbound = unboundSessions(snapshot)[0];
        const elsewhere = { ...unbound, root_path: '/w/notegit' };
        const both = { ...snapshot, sessions: [...snapshot.sessions, elsewhere] };
        expect(unboundSessionKey(unbound)).not.toBe(unboundSessionKey(elsewhere));
        expect(virtualNotesForActivity(both, scopeAdmitting([ROOT_PATH, '/w/notegit']))).toHaveLength(2);
        expect(sessionForUnboundKey(both, unboundSessionKey(elsewhere))?.root_path).toBe('/w/notegit');
        expect(sessionForUnboundKey(both, 'nothing/at-all')).toBeUndefined();
    });

    it('is headlined by its vendor monogram and session name, never by a story it did not declare', () => {
        const snapshot = fixtureSnapshot();
        const named = { ...snapshot, sessions: snapshot.sessions.map(state => (state.session.story_binding === 'none' ? { ...state, session: { ...state.session, session_name: 'coord-demo' } } : state)) };
        const virtual = virtualNotesForActivity(named, scopeAdmitting([ROOT_PATH]));
        expect(virtual[0].headline_raw).toBe('CC coord-demo');
        expect(virtual[0].origin?.project_hue).toEqual(expect.any(Number));
    });

    it('mints a card for a live registry-only agent under its name, and none for a stopped one', () => {
        const registry_only = (id: string, state: ActivityState): ActivitySessionState => ({ root_path: ROOT_PATH, session: makeSession(id, { vendor: 'agy', registry_name: id, registry_only: true, state }) });
        const snapshot = fixtureSnapshot({ sessions: [registry_only('agy-idle', 'idle'), registry_only('agy-stopped', 'ended')] });
        const virtual = virtualNotesForActivity(snapshot, scopeAdmitting([ROOT_PATH]));
        expect(virtual.map(note => note.headline_raw)).toEqual(['AG agy-idle']);
    });

    it('names a session by its own name, else the registry name, else a short session id', () => {
        const base = makeSession('abcdef0123456789');
        expect(sessionDisplayName({ ...base, session_name: 'own', registry_name: 'registry' })).toBe('own');
        expect(sessionDisplayName({ ...base, session_name: '  ', registry_name: 'registry' })).toBe('registry');
        expect(sessionDisplayName(base)).toBe('abcdef01');
        expect(unboundSessionHeadline({ ...base, vendor: 'codex' })).toBe('CO abcdef01');
    });

    it('draws a vendor from the one display table, and an unknown vendor from its slug', () => {
        expect(vendorLabel('claude-code')).toBe('Claude Code');
        expect(vendorLabel('antigravity')).toBe('Antigravity');
        expect(vendorColour('antigravity')).toContain('--vscode-charts-green');
        expect(vendorLabel('some_new_vendor')).toBe('some_new_vendor');
        expect(vendorColour('grok')).toContain('--vscode-charts-');
        expect(vendorColour('some_new_vendor')).toBeUndefined();
        expect(vendorLabel('constructor')).toBe('constructor');
    });
});

describe('drawing unbound agents only beside their own repository', () => {

    const OTHER_ROOT_PATH = '/mnt/workspace/in_development/notegit';
    const OTHER_ROOT_RELATIVE = 'notegit';
    const OTHER_TODO_PATH = `${OTHER_ROOT_RELATIVE}/docstech/users/alex.stanhope/todo.md`;

    /** the fixture snapshot's one repository plus a second, each with its own unbound session */
    function twoRepoSnapshot(): ActivitySnapshot {
        const base = fixtureSnapshot();
        const other_unbound = { root_path: OTHER_ROOT_PATH, session: { ...base.sessions.find(s => s.session.session_id === 'claude-no-story')!.session, session_id: 'codex-no-story-other', vendor: 'codex' } };
        return {
            ...base,
            sessions: [...base.sessions, other_unbound],
            trees: [...base.trees, { root_path: OTHER_ROOT_PATH, root_relative: OTHER_ROOT_RELATIVE, tree: makeTree() }],
        };
    }

    it('admits only its own repository in a single-file view, and stamps no relative_path', () => {
        const snapshot = twoRepoSnapshot();
        const scope = viewedActivityScope(snapshot, undefined, TODO_PATH);
        expect(scope.notes_carry_relative_path).toBe(false);
        const virtual = virtualNotesForActivity(snapshot, scope);
        expect(virtual.map(note => virtualNoteKeyOf(note, 'agent'))).toEqual([`${ROOT_PATH.replace(/^\//, '')}/claude-no-story`]);
        expect(virtual[0].origin?.relative_path).toBeUndefined();
    });

    it('admits both repositories in a folder view spanning both, each stamped with its own repository', () => {
        const snapshot = twoRepoSnapshot();
        const notes = [makeStoryNote('agent-activity-card', TODO_PATH), makeStoryNote('some-other-story', OTHER_TODO_PATH)];
        const scope = viewedActivityScope(snapshot, notes, undefined);
        expect(scope.notes_carry_relative_path).toBe(true);
        const virtual = virtualNotesForActivity(snapshot, scope);
        const by_key = new Map(virtual.map(note => [virtualNoteKeyOf(note, 'agent'), note]));
        expect(by_key.get(`${ROOT_PATH.replace(/^\//, '')}/claude-no-story`)?.origin?.relative_path).toBe(ROOT_RELATIVE);
        expect(by_key.get(`${OTHER_ROOT_PATH.replace(/^\//, '')}/codex-no-story-other`)?.origin?.relative_path).toBe(OTHER_ROOT_RELATIVE);
    });

    it('admits only root-less sessions beside a document outside every repository', () => {
        const snapshot = twoRepoSnapshot();
        const outside = { root_path: undefined, session: { ...snapshot.sessions.find(s => s.session.session_id === 'claude-no-story')!.session, session_id: 'claude-no-story-outside' } };
        const with_outside = { ...snapshot, sessions: [...snapshot.sessions, outside] };
        const scope = viewedActivityScope(with_outside, [makeStoryNote('a-story', 'elsewhere/todo.md')], undefined);
        expect(scope.root_paths.has(undefined)).toBe(true);
        expect(scope.root_paths.has(ROOT_PATH)).toBe(false);
        const virtual = virtualNotesForActivity(with_outside, scope);
        expect(virtual.map(note => virtualNoteKeyOf(note, 'agent'))).toEqual(['/claude-no-story-outside']);
    });

    it('admits a workspace-folder repository (root_relative \'\') for every document inside it', () => {
        const workspace_root_path = '/w';
        const snapshot: ActivitySnapshot = {
            analyser: { state: 'live', refusals: [] },
            sessions: [{ root_path: workspace_root_path, session: { ...fixtureSnapshot().sessions.find(s => s.session.session_id === 'claude-no-story')!.session, session_id: 'claude-no-story-ws' } }],
            trees: [{ root_path: workspace_root_path, root_relative: '', tree: makeTree() }],
        };
        const scope = viewedActivityScope(snapshot, [makeStoryNote('a-story', 'docstech/users/alex.stanhope/todo.md')], undefined);
        expect(scope.root_paths.has(workspace_root_path)).toBe(true);
        const virtual = virtualNotesForActivity(snapshot, scope);
        expect(virtual).toHaveLength(1);
        // root_relative '' is the repository IS the workspace folder case, which has no sub-path to stamp
        expect(virtual[0].origin?.relative_path).toBeUndefined();
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
        expect(vendorMonogram('antigravity')).toBe('AG');
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

describe('a card\'s own scan being done', () => {
    const scanning = (extra: Partial<ActivityAnalyserState> = {}): ActivityAnalyserState => ({ state: 'scanning', refusals: [], ...extra });

    it('is done once the analyser is live or a completed scan has ever landed', () => {
        expect(isAgentCardScanDone({ state: 'live', refusals: [] }, '/ws', false)).toBe(true);
        expect(isAgentCardScanDone(scanning(), '/ws', true)).toBe(true);
    });

    it('is done while scanning only when the card\'s own repository is among the finished ones', () => {
        expect(isAgentCardScanDone(scanning({ done_roots: ['/ws', '/lib'] }), '/ws', false)).toBe(true);
        expect(isAgentCardScanDone(scanning({ done_roots: ['/lib'] }), '/ws', false)).toBe(false);
        expect(isAgentCardScanDone(scanning({ done_roots: ['/ws'] }), undefined, false)).toBe(false);
        expect(isAgentCardScanDone(scanning(), '/ws', false)).toBe(false);
        expect(isAgentCardScanDone(undefined, '/ws', false)).toBe(false);
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

describe('the agent card clock, by mode', () => {

    const now_ms = Date.parse('2026-09-23T12:00:00Z');
    const now_iso = new Date(now_ms).toISOString();
    const session = makeSession('claude-bound-busy', { started_at: '2026-09-23T10:00:00Z', updated_at: '2026-09-23T10:42:00Z', active_ms: 7 * 60_000 });

    it('span draws the same figure formatDurationClock would, ignoring active_ms and now', () => {
        expect(formatAgentClock(session, 'span', now_ms)).toBe('42m');
    });

    it('active draws active_ms rather than the span between started_at and updated_at', () => {
        expect(formatAgentClock(session, 'active', now_ms)).toBe('7m');
    });

    it('active reads a missing active_ms as zero rather than throwing', () => {
        expect(formatAgentClock({ ...session, active_ms: undefined }, 'active', now_ms)).toBe('0m');
    });

    it('sinceStart measures from started_at to the caller\'s now, not to updated_at', () => {
        expect(formatAgentClock(session, 'sinceStart', now_ms)).toBe('2h 00m');
    });

    it('sinceStart draws nothing for an unparseable started_at', () => {
        expect(formatAgentClock({ ...session, started_at: 'not a date' }, 'sinceStart', now_ms)).toBe('');
    });

    it('names each mode distinctly for the settings drawer', () => {
        expect(agentClockModeLabel('span')).toBe('Span');
        expect(agentClockModeLabel('active')).toBe('Active time');
        expect(agentClockModeLabel('sinceStart')).toBe('Since start');
    });

    it('the tooltip names the mode and keeps the start and end times, "now" standing in for sinceStart\'s open end', () => {
        expect(agentClockTooltip(session, 'span', now_iso)).toBe(`Span: ran from ${session.started_at} to ${session.updated_at}`);
        expect(agentClockTooltip(session, 'active', now_iso)).toBe(`Active time, excluding gaps over five minutes: ran from ${session.started_at} to ${session.updated_at}`);
        expect(agentClockTooltip(session, 'sinceStart', now_iso)).toBe(`Since start: running since ${session.started_at}, now at ${now_iso}`);
    });
});

describe('the status line token formatter', () => {

    it('reads a count under a thousand as bare tokens', () => {
        expect(formatStatusTokens(0)).toBe('0t');
        expect(formatStatusTokens(999)).toBe('999t');
    });

    it('reads K with one decimal below 10 and none from 10 up, dropping a trailing .0', () => {
        expect(formatStatusTokens(1000)).toBe('1Kt');
        expect(formatStatusTokens(1500)).toBe('1.5Kt');
        expect(formatStatusTokens(9949)).toBe('9.9Kt');
        expect(formatStatusTokens(32_000)).toBe('32Kt');
        expect(formatStatusTokens(32_700)).toBe('33Kt');
    });

    it('reads M and G the same way, and rolls a count that rounds to 1000 of a unit into the next', () => {
        expect(formatStatusTokens(8_203_112)).toBe('8.2Mt');
        expect(formatStatusTokens(10_000_000)).toBe('10Mt');
        expect(formatStatusTokens(999_999)).toBe('1Mt');
        expect(formatStatusTokens(1_100_000_000)).toBe('1.1Gt');
        expect(formatStatusTokens(2_500_000_000_000)).toBe('2500Gt');
    });

    it('joins the tokens to an approximate cost, and shows tokens alone when unpriced', () => {
        const priced = { input_tokens: 8_000_000, output_tokens: 203_112, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 12.4, is_estimate: false };
        expect(formatStatusUsage(priced)).toBe('8.2Mt, ~$12.40');
        expect(formatStatusUsage({ ...priced, cost_usd: undefined })).toBe('8.2Mt');
    });
});

describe('the token and cost counter', () => {

    it('adds input, output and both cache fields into one token total with the estimated cost', () => {
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

describe('subagent children', () => {
    const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true };
    function child(id: string, state: 'working' | 'ended', started_at = '2026-09-22T10:00:00Z', updated_at = '2026-09-22T10:07:00Z'): ActivityChildSession {
        return { child_id: id, state, started_at, updated_at, usage: USAGE };
    }

    it('splits the running children from every finished one, each keeping the host order', () => {
        const children = [child('f1', 'ended'), child('f2', 'ended'), child('r1', 'working'), child('w1', 'waiting'), child('f3', 'ended')];
        const { running, finished } = splitChildrenForDisplay(children);
        expect(running.map(entry => entry.child_id)).toEqual(['r1', 'w1']);
        expect(finished.map(entry => entry.child_id)).toEqual(['f1', 'f2', 'f3']);
    });

    it('splits nothing for no children', () => {
        expect(splitChildrenForDisplay(undefined)).toEqual({ running: [], finished: [] });
    });

    it('expands a session by default only while it is working or waiting', () => {
        const session = (state: string): ActivitySession => ({ state } as ActivitySession);
        expect(sessionExpandedByDefault(session('working'))).toBe(true);
        expect(sessionExpandedByDefault(session('waiting'))).toBe(true);
        expect(sessionExpandedByDefault(session('idle'))).toBe(false);
        expect(sessionExpandedByDefault(session('ended'))).toBe(false);
        expect(sessionExpandedByDefault(session('bogus'))).toBe(false);
    });

    it('clocks a running child against now and a finished one by its own span', () => {
        const now_ms = Date.parse('2026-09-22T10:30:00Z');
        expect(formatChildClock(child('r', 'working'), now_ms)).toBe('30m');
        expect(formatChildClock(child('f', 'ended'), now_ms)).toBe('7m');
        expect(formatChildClock(child('x', 'working', 'not a date'), now_ms)).toBe('');
    });

    it('names a child by title, then kind, then short id, and coerces an unrecognised state', () => {
        expect(childDisplayName({ ...child('abcdefghijkl', 'working'), title: ' Map view code ', agent_type: 'Explore' })).toBe('Map view code');
        expect(childDisplayName({ ...child('abcdefghijkl', 'working'), agent_type: 'Explore' })).toBe('Explore');
        expect(childDisplayName(child('abcdefghijkl', 'working'))).toBe('abcdefgh');
        expect(childStateOf({ ...child('a', 'working'), state: 'bogus' as never })).toBe('unknown');
    });
});
