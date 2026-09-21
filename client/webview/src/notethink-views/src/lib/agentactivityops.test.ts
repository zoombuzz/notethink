import fs from 'fs';
import path from 'path';
import {
    ACTIVITY_BAND_COMMITTED,
    ACTIVITY_BAND_UNCOMMITTED,
    ACTIVITY_MESSAGE_TYPE,
    ACTIVITY_UNAVAILABLE_MESSAGE_TYPE,
    attributedFiles,
    diffAvailabilityOf,
    factStateFor,
    normaliseActivityPath,
    parseActivityMessage,
    parseActivityUnavailableMessage,
    producerForDocPath,
    producerForRoot,
    producerStateOf,
    resolveActivityPath,
    sessionForUnboundKey,
    sessionStateOf,
    sessionStoryPath,
    sessionsForStory,
    storyKeyForNote,
    treeForRoot,
    truncateActivityArg,
    unattributedFiles,
    unboundSessionKey,
    unboundSessions,
    vendorMonogram,
    virtualNotesForActivity,
    type ActivityProducerState,
    type ActivitySessionState,
    type ActivitySnapshot,
} from './agentactivityops';
import { isVirtualNote, virtualNoteKeyOf } from './virtualnoteops';
import type { ActivityManifest, ActivitySession, ActivityTree } from '../types/AgentActivity';
import type { NoteProps } from '../types/NoteProps';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const FIXTURE_DIR = path.join(PROJECT_ROOT, 'playwright', 'fixtures', 'activity');
const ROOT_PATH = '/mnt/workspace/in_development/notethink';
const ROOT_RELATIVE = 'notethink';
const TODO_PATH = `${ROOT_RELATIVE}/docstech/users/alex.stanhope/todo.md`;

function readFixture<T>(...segments: string[]): T {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, ...segments), 'utf-8')) as T;
}

/*
 * The whole fixture set as the extension host would post it, so these assertions run against the
 * contract's own files rather than against hand-written objects that could drift away from them. The
 * manifest is authoritative about which sessions are live, which is why the failure fixtures beside
 * them are absent here unless a test asks for one.
 */
function fixtureSnapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
    const manifest = readFixture<ActivityManifest>('manifest.json');
    const sessions: ActivitySessionState[] = manifest.sessions.map(id => {
        const digest_path = path.join(FIXTURE_DIR, 'sessions', `${id}.digest.json`);
        return {
            root_path: ROOT_PATH,
            root_relative: ROOT_RELATIVE,
            session: readFixture<ActivitySession>('sessions', `${id}.session.json`),
            events: [],
            digest: fs.existsSync(digest_path) ? JSON.parse(fs.readFileSync(digest_path, 'utf-8')) : undefined,
        };
    });
    const producer: ActivityProducerState = {
        root_path: ROOT_PATH,
        root_relative: ROOT_RELATIVE,
        project: 'notethink',
        producer: manifest.producer,
        written_at: manifest.written_at,
        heartbeat_seconds: manifest.heartbeat_seconds,
        live: true,
        capabilities: manifest.capabilities,
        declared_session_ids: manifest.sessions,
        unreadable_session_ids: [],
        refusals: [],
    };
    return {
        contract_version: '1.0.0',
        producers: [producer],
        sessions,
        trees: [{ root_path: ROOT_PATH, root_relative: ROOT_RELATIVE, tree: readFixture<ActivityTree>('tree.json') }],
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
            contract_version: '1.0.0',
            producers: [],
            sessions: [],
            trees: [],
        });
    });

    it('reads the contract fixtures as five live sessions in one contract root', () => {
        const snapshot = fixtureSnapshot();
        expect(snapshot.sessions.map(s => s.session.session_id)).toEqual([
            'claude-bound-busy', 'grok-bound-idle', 'grok-question', 'claude-no-story', 'codex-no-question',
        ]);
        expect(snapshot.producers).toHaveLength(1);
        expect(treeForRoot(snapshot, ROOT_PATH)?.branch).toBe('staging');
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

    it('separates nothing writing here, an unreadable manifest, a stopped producer and a live one', () => {
        const snapshot = fixtureSnapshot();
        const live = snapshot.producers[0];
        expect(producerStateOf(undefined)).toBe('absent');
        expect(producerStateOf(live)).toBe('live');
        expect(producerStateOf({ ...live, live: false })).toBe('stopped');
        expect(producerStateOf({ ...live, live: false, producer: undefined })).toBe('unreadable');
    });

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
        const busy = sessions.find(s => s.session.session_id === 'claude-bound-busy')!.session;
        expect(factStateFor(codex, 'question', codex.question !== undefined)).toBe('unsupported');
        expect(factStateFor(busy, 'question', busy.question !== undefined)).toBe('quiet');
        expect(factStateFor(waiting, 'question', waiting.question !== undefined)).toBe('reported');
    });

    it('reads an absent capability key exactly as it reads an unsupported one', () => {
        const session = { capabilities: {} } as unknown as ActivitySession;
        expect(factStateFor(session, 'live_tool_call', true)).toBe('unsupported');
        expect(factStateFor(undefined, 'live_tool_call', true)).toBe('unsupported');
    });
});

describe('resolving a declared path', () => {

    it('joins what the producer declared to where the host found the contract directory, and only that', () => {
        expect(resolveActivityPath('notethink', 'docstech/todo.md')).toBe('notethink/docstech/todo.md');
        expect(resolveActivityPath('a/b/c', 'docstech/todo.md')).toBe('a/b/c/docstech/todo.md');
        expect(resolveActivityPath('', 'docstech/todo.md')).toBe('docstech/todo.md');
        expect(resolveActivityPath('notethink', undefined)).toBe('');
    });

    it('spells a path one way, so a leading dot-slash or slash cannot break a join', () => {
        expect(normaliseActivityPath('./a/b.md')).toBe('a/b.md');
        expect(normaliseActivityPath('/a/b.md')).toBe('a/b.md');
        expect(normaliseActivityPath(undefined)).toBe('');
        expect(resolveActivityPath('/notethink/', './docstech/todo.md')).toBe('notethink/docstech/todo.md');
    });

    it('finds the contract root a document sits inside, taking the deepest where roots nest', () => {
        const snapshot = fixtureSnapshot();
        const nested: ActivityProducerState = { ...snapshot.producers[0], root_path: '/w/notethink/vendor', root_relative: 'notethink/vendor' };
        const workspace_root: ActivityProducerState = { ...snapshot.producers[0], root_path: '/w', root_relative: '' };
        const nesting = { ...snapshot, producers: [workspace_root, snapshot.producers[0], nested] };
        expect(producerForDocPath(nesting, 'notethink/vendor/docstech/todo.md')?.root_relative).toBe('notethink/vendor');
        expect(producerForDocPath(nesting, 'notethink/docstech/todo.md')?.root_relative).toBe('notethink');
        expect(producerForDocPath(nesting, 'notegit/docstech/todo.md')?.root_relative).toBe('');
        expect(producerForDocPath(snapshot, 'notegit/docstech/todo.md')).toBeUndefined();
        expect(producerForRoot(snapshot, ROOT_PATH)?.project).toBe('notethink');
    });
});

describe('joining a session to a card', () => {

    /*
     * Derived from the fixture set rather than hard-coded against it: every bound session must be
     * drawn on the story it declared and on no other, whichever stories the fixtures happen to name.
     */
    it('draws every bound session on the story it declared, and on no other', () => {
        const snapshot = fixtureSnapshot();
        const bound = snapshot.sessions.filter(state => state.session.story_binding === 'bound');
        expect(bound.length).toBeGreaterThan(0);
        for (const state of bound) {
            const key = storyKeyForNote(makeStoryNote(state.session.story!.id, sessionStoryPath(state)))!;
            expect(sessionsForStory(snapshot, key).map(s => s.session.session_id)).toContain(state.session.session_id);
            const wrong_story = storyKeyForNote(makeStoryNote('a-story-nobody-declared', sessionStoryPath(state)))!;
            expect(sessionsForStory(snapshot, wrong_story)).toEqual([]);
        }
    });

    it('resolves a declared story path exactly one way, against where the contract root was found', () => {
        const snapshot = fixtureSnapshot();
        const bound = snapshot.sessions.find(state => state.session.session_id === 'claude-bound-busy')!;
        expect(bound.session.story?.doc_path).toBe('docstech/users/alex.stanhope/todo.md');
        expect(sessionStoryPath(bound)).toBe(TODO_PATH);
        expect(sessionsForStory(snapshot, storyKeyForNote(makeStoryNote('agent-activity-card'))!).map(s => s.session.session_id))
            .toEqual(['claude-bound-busy']);
    });

    it('draws nothing rather than guessing when the resolution does not match, however close it looks', () => {
        const snapshot = fixtureSnapshot();
        for (const near_miss of ['docstech/users/alex.stanhope/todo.md', 'notegit/docstech/users/alex.stanhope/todo.md', `${TODO_PATH}x`]) {
            expect(sessionsForStory(snapshot, { doc_path: near_miss, id: 'agent-activity-card' })).toEqual([]);
        }
    });

    it('never rebuilds a location from project, which names a directory rather than a path', () => {
        const snapshot = fixtureSnapshot();
        const deep = { ...snapshot, producers: [{ ...snapshot.producers[0], root_relative: 'vendored/notethink' }],
            sessions: snapshot.sessions.map(state => ({ ...state, root_relative: 'vendored/notethink' })) };
        const by_project = storyKeyForNote(makeStoryNote('agent-activity-card', 'notethink/docstech/users/alex.stanhope/todo.md'))!;
        const by_root = storyKeyForNote(makeStoryNote('agent-activity-card', 'vendored/notethink/docstech/users/alex.stanhope/todo.md'))!;
        expect(sessionsForStory(deep, by_project)).toEqual([]);
        expect(sessionsForStory(deep, by_root)).toHaveLength(1);
    });

    it('draws both agents that declared the same story', () => {
        const snapshot = fixtureSnapshot();
        const shared = snapshot.sessions
            .filter(state => state.session.story_binding === 'bound')
            .slice(0, 2)
            .map(state => ({ ...state, session: { ...state.session, story: { doc_path: 'docstech/users/alex.stanhope/todo.md', id: 'shared-story' } } }));
        const key = storyKeyForNote(makeStoryNote('shared-story'))!;
        expect(sessionsForStory({ ...snapshot, sessions: shared }, key)).toHaveLength(2);
    });

    it('joins a workspace whose folder is the repository itself, where the declared path stands alone', () => {
        const snapshot = fixtureSnapshot();
        const at_root = { ...snapshot, sessions: snapshot.sessions.map(state => ({ ...state, root_relative: '' })) };
        const key = storyKeyForNote(makeStoryNote('agent-activity-card', 'docstech/users/alex.stanhope/todo.md'))!;
        expect(sessionsForStory(at_root, key).map(s => s.session.session_id)).toEqual(['claude-bound-busy']);
    });

    it('refuses to join a story with no authored id, rather than deriving one from its headline', () => {
        expect(storyKeyForNote({ ...makeStoryNote('agent-activity-card'), linetags: undefined }, undefined)).toBeUndefined();
    });

    it('falls back to the view document path in single-file mode, where a note carries no origin', () => {
        const note = { ...makeStoryNote('agent-activity-card'), origin: undefined };
        expect(storyKeyForNote(note, './notethink/docstech/users/alex.stanhope/todo.md')).toEqual({
            doc_path: TODO_PATH,
            id: 'agent-activity-card',
        });
    });
});

describe('an agent that declared no story', () => {

    it('is the only kind of session a virtual note is minted for', () => {
        const snapshot = fixtureSnapshot();
        expect(unboundSessions(snapshot).map(s => s.session.session_id)).toEqual(['claude-no-story']);
        const virtual = virtualNotesForActivity(snapshot);
        expect(virtual).toHaveLength(1);
        expect(isVirtualNote(virtual[0])).toBe(true);
        expect(virtualNoteKeyOf(virtual[0], 'agent')).toBe('notethink/claude-no-story');
    });

    it('is keyed per contract root, so two repositories running the same session id draw two cards', () => {
        const snapshot = fixtureSnapshot();
        const unbound = unboundSessions(snapshot)[0];
        const elsewhere = { ...unbound, root_path: '/w/notegit', root_relative: 'notegit' };
        const both = { ...snapshot, sessions: [...snapshot.sessions, elsewhere] };
        expect(unboundSessionKey(unbound)).not.toBe(unboundSessionKey(elsewhere));
        expect(virtualNotesForActivity(both)).toHaveLength(2);
        expect(sessionForUnboundKey(both, unboundSessionKey(elsewhere))?.root_relative).toBe('notegit');
        expect(sessionForUnboundKey(both, 'nothing/at-all')).toBeUndefined();
    });

    it('is headlined by its vendor and project, never by a story it did not declare', () => {
        const virtual = virtualNotesForActivity(fixtureSnapshot());
        expect(virtual[0].headline_raw).toBe('claude-code in notethink');
        expect(virtual[0].origin?.project_hue).toEqual(expect.any(Number));
    });
});

describe('changed files', () => {

    it('lists only the files a card own sessions account for', () => {
        const tree = treeForRoot(fixtureSnapshot(), ROOT_PATH);
        expect(attributedFiles(tree, ACTIVITY_BAND_UNCOMMITTED, ['claude-bound-busy']).map(f => f.path)).toEqual([
            'client/extension/src/types/AgentActivity.ts',
            'client/extension/src/lib/activityops.ts',
        ]);
        expect(attributedFiles(tree, ACTIVITY_BAND_COMMITTED, ['grok-bound-idle'])).toHaveLength(2);
    });

    it('never credits a file with no matching write call to a guessed agent', () => {
        const tree = treeForRoot(fixtureSnapshot(), ROOT_PATH);
        expect(unattributedFiles(tree, ACTIVITY_BAND_UNCOMMITTED).map(f => f.path)).toEqual(['package.json']);
        const every_session = fixtureSnapshot().sessions.map(s => s.session.session_id);
        expect(attributedFiles(tree, ACTIVITY_BAND_UNCOMMITTED, every_session).map(f => f.path)).not.toContain('package.json');
    });

    it('tells a side that does not exist apart from a side that exists and was not stored', () => {
        const tree = treeForRoot(fixtureSnapshot(), ROOT_PATH)!;
        const added = tree.uncommitted.find(f => f.path === 'client/extension/src/lib/activityops.ts')!;
        const binary = tree.uncommitted.find(f => f.path === 'media/board-icon.png')!;
        const modified = tree.uncommitted.find(f => f.path === 'package.json')!;
        const committed = tree.committed.find(f => f.change === 'modified')!;
        const renamed = tree.committed.find(f => f.change === 'renamed')!;
        expect(diffAvailabilityOf(added, ACTIVITY_BAND_UNCOMMITTED)).toBe('added_no_base');
        expect(diffAvailabilityOf(binary, ACTIVITY_BAND_UNCOMMITTED)).toBe('omitted_binary');
        expect(diffAvailabilityOf(modified, ACTIVITY_BAND_UNCOMMITTED)).toBe('both_sides');
        expect(diffAvailabilityOf(committed, ACTIVITY_BAND_COMMITTED)).toBe('both_sides');
        expect(diffAvailabilityOf(renamed, ACTIVITY_BAND_COMMITTED)).toBe('no_stored_side');
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
});
