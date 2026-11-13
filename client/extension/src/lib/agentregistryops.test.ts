import {
    REGISTRY_STALE_AFTER_MS,
    isRegistryWorkStale,
    overlayRegistry,
    parseRegistryEntry,
    registryActivityState,
    registryEntrySegments,
    registrySessionId,
    registryVendorSlug,
    type RegistryOverlayContext,
    type ResolvedRegistryAgent,
} from './agentregistryops';
import type { ActivitySessionState } from './agentanalyserops';
import { emptyActivityUsage, type ActivityStoryProgress } from '../types/AgentActivity';
import type { HashMapOf } from '../types/general';

const NOW_MS = Date.parse('2026-11-03T12:00:00Z');
const FRESH = '2026-11-03T11:30:00Z';
const OLD = '2026-11-03T06:00:00Z';
const DOC_PATH = 'docstech/users/dev/todo.md';

function agent(overrides: Partial<ResolvedRegistryAgent> = {}): ResolvedRegistryAgent {
    return {
        agent: 'coord-demo', vendor: 'claude-code', repo: '/ws/demo', state: 'working', story: 'story-a',
        session_ids: ['sess-1'], updated_at: FRESH, root_path: '/ws/demo', repo_relative: 'demo',
        ...overrides,
    };
}

function vendorSession(overrides: Partial<ActivitySessionState['session']> = {}): ActivitySessionState {
    return {
        root_path: '/ws/demo',
        session: {
            session_id: 'sess-1', vendor: 'claude-code', project: 'demo', story_binding: 'none',
            started_at: '2026-11-03T08:00:00Z', updated_at: FRESH, state: 'idle', capabilities: {}, usage: emptyActivityUsage(),
            ...overrides,
        },
    };
}

function context(status: string | undefined, progress: ActivityStoryProgress[] = []): RegistryOverlayContext {
    return {
        now_ms: NOW_MS,
        progress,
        findStory: (repo_relative, story_id) => (status !== undefined && story_id === 'story-a' ? { story: { doc_path: `${repo_relative}/${DOC_PATH}`, id: story_id }, status } : undefined),
    };
}

describe('parseRegistryEntry', () => {
    it('keeps the fields a row or a coordinator row displays and drops the rest', () => {
        const text = JSON.stringify({
            agent: 'coord-demo', agent_kind: 'coordinator', vendor: 'claude', repo: '/ws/demo/', machine: 'host-a', mailbox: '/secret/mailbox',
            state: 'working', story: 'story-a', session_id: 'sess-2', previous_session_ids: ['sess-1'], binary_version: '9.9', open_convoys: ['c1'],
            last_recycle: '2026-11-01T00:00:00Z', updated_at: FRESH, pane: '%3',
        });
        const entry = parseRegistryEntry(text, 'dir-name');
        expect(entry).toEqual({
            agent: 'coord-demo', vendor: 'claude-code', repo: '/ws/demo', state: 'working', story: 'story-a', session_ids: ['sess-2', 'sess-1'], updated_at: FRESH,
            agent_kind: 'coordinator', machine: 'host-a', binary_version: '9.9', open_convoys: ['c1'],
        });
        expect(JSON.stringify(entry)).not.toContain('mailbox');
        expect(JSON.stringify(entry)).not.toContain('%3');
    });

    it('treats every field but the repository as optional and carries an unknown state', () => {
        expect(parseRegistryEntry('{"repo":"/ws/demo","state":"hibernating"}', 'dir-name')).toEqual({
            agent: 'dir-name', vendor: 'unknown', repo: '/ws/demo', state: 'hibernating', story: '', session_ids: [], updated_at: undefined,
            agent_kind: '', machine: '', binary_version: '', open_convoys: [],
        });
    });

    it('reads a field of the wrong type as absent', () => {
        const entry = parseRegistryEntry('{"repo":"/ws/demo","agent":7,"story":false,"previous_session_ids":"x","updated_at":"not a date"}', 'dir-name');
        expect(entry).toMatchObject({ agent: 'dir-name', story: '', session_ids: [], updated_at: undefined });
    });

    it.each(['', 'not json', '[]', 'null', '{}', '{"repo":"relative/path"}', '{"repo":7}'])('gives nothing for %j', text => {
        expect(parseRegistryEntry(text, 'dir-name')).toBeUndefined();
    });
});

describe('registry vocabulary', () => {
    it('maps the registry vendor onto the display slug and keeps an unknown vendor as its own', () => {
        expect(registryVendorSlug('claude')).toBe('claude-code');
        expect(registryVendorSlug(' Claude ')).toBe('claude-code');
        expect(registryVendorSlug('agy')).toBe('antigravity');
        expect(registryVendorSlug('codex')).toBe('codex');
        expect(registryVendorSlug(undefined)).toBe('unknown');
    });

    it('reads each registry state as an activity state', () => {
        expect(registryActivityState('working')).toBe('working');
        expect(registryActivityState('idle')).toBe('idle');
        expect(registryActivityState('starting')).toBe('idle');
        expect(registryActivityState('stopped')).toBe('ended');
        expect(registryActivityState('')).toBe('unknown');
        expect(registryActivityState('hibernating')).toBe('unknown');
    });

    it('places an entry below the registry directory', () => {
        expect(registryEntrySegments('coord-demo')).toEqual(['registry', 'coord-demo', 'agent.json']);
    });

    it('files a registry-only agent under its name and its repository', () => {
        expect(registrySessionId(agent({ agent: 'a b/c' }))).toBe('registry:a-b-c:demo');
    });
});

describe('isRegistryWorkStale', () => {
    it('is false for any state but working', () => {
        expect(isRegistryWorkStale(agent({ state: 'idle', updated_at: OLD }), undefined, context(undefined))).toBe(false);
    });

    it('is false while the entry was updated within the threshold, and true past it', () => {
        expect(isRegistryWorkStale(agent({ updated_at: FRESH }), undefined, context('doing'))).toBe(false);
        expect(isRegistryWorkStale(agent({ updated_at: OLD }), undefined, context('doing'))).toBe(true);
        expect(REGISTRY_STALE_AFTER_MS).toBe(2 * 60 * 60 * 1000);
    });

    it('is rescued by a newer progress entry for the story in the same repository, not another story or repository', () => {
        const progress = (overrides: Partial<ActivityStoryProgress>): ActivityStoryProgress => ({ root_relative: 'demo', story_id: 'story-a', pct: 10, at: FRESH, by: 'agent', ...overrides });
        expect(isRegistryWorkStale(agent({ updated_at: OLD }), undefined, context('doing', [progress({})]))).toBe(false);
        expect(isRegistryWorkStale(agent({ updated_at: OLD }), undefined, context('doing', [progress({ story_id: 'story-b' })]))).toBe(true);
        expect(isRegistryWorkStale(agent({ updated_at: OLD }), undefined, context('doing', [progress({ root_relative: 'elsewhere' })]))).toBe(true);
        expect(isRegistryWorkStale(agent({ updated_at: OLD }), undefined, context('doing', [progress({ root_relative: '' })]))).toBe(false);
    });

    it('is rescued by recent transcript activity on the joined session', () => {
        expect(isRegistryWorkStale(agent({ updated_at: OLD }), vendorSession({ updated_at: FRESH }).session, context('doing'))).toBe(false);
        expect(isRegistryWorkStale(agent({ updated_at: OLD }), vendorSession({ updated_at: OLD }).session, context('doing'))).toBe(true);
    });

    it('is stale when nothing carries a parseable time', () => {
        expect(isRegistryWorkStale(agent({ updated_at: undefined }), undefined, context('doing'))).toBe(true);
    });
});

describe('overlayRegistry joins', () => {
    it('returns the sessions untouched when no agent is registered', () => {
        const sessions: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession() };
        expect(overlayRegistry(sessions, [], context('doing'))).toBe(sessions);
    });

    it('names a vendor session by the entry\'s session id and keeps its vendor-derived state', () => {
        const sessions: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession({ state: 'idle' }) };
        const overlaid = overlayRegistry(sessions, [agent({ state: 'stopped' })], context('doing'));
        expect(Object.keys(overlaid)).toEqual(['sess-1']);
        expect(overlaid['sess-1'].session).toMatchObject({ registry_name: 'coord-demo', state: 'idle' });
        expect(overlaid['sess-1'].session.registry_only).toBeUndefined();
        expect(sessions['sess-1'].session.registry_name).toBeUndefined();
    });

    it('joins by a previous session id', () => {
        const sessions: HashMapOf<ActivitySessionState> = { 'sess-0': vendorSession({ session_id: 'sess-0' }) };
        const overlaid = overlayRegistry(sessions, [agent({ session_ids: ['sess-9', 'sess-0'], state: 'idle' })], context('doing'));
        expect(Object.keys(overlaid)).toEqual(['sess-0']);
        expect(overlaid['sess-0'].session.registry_name).toBe('coord-demo');
    });

    it('does not rebind a session already bound to a story by its own writes', () => {
        const own = { doc_path: DOC_PATH, id: 'story-b' };
        const sessions: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession({ story_binding: 'bound', stories: [own] }) };
        const overlaid = overlayRegistry(sessions, [agent()], context('doing'));
        expect(overlaid['sess-1'].session.stories).toEqual([own]);
    });
});

describe('overlayRegistry story binding', () => {
    it.each(['doing', 'code-review', 'testing'])('binds a working entry to its story at %s before the session has written anything', status => {
        const sessions: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession({ state: 'working' }) };
        const session = overlayRegistry(sessions, [agent()], context(status))['sess-1'].session;
        expect(session.story_binding).toBe('bound');
        expect(session.stories).toEqual([{ doc_path: `demo/${DOC_PATH}`, id: 'story-a' }]);
        expect(session.story_usage).toHaveLength(1);
    });

    it.each([undefined, '', 'done', 'blocked'])('binds nothing when the story is %j on the board', status => {
        const sessions: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession() };
        expect(overlayRegistry(sessions, [agent()], context(status))['sess-1'].session.story_binding).toBe('none');
    });

    it('binds nothing for an entry that is not working, is stale, or whose session has ended', () => {
        const sessions: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession() };
        expect(overlayRegistry(sessions, [agent({ state: 'idle' })], context('doing'))['sess-1'].session.story_binding).toBe('none');
        const quiet: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession({ updated_at: OLD }) };
        expect(overlayRegistry(quiet, [agent({ updated_at: OLD })], context('doing'))['sess-1'].session.story_binding).toBe('none');
        const ended: HashMapOf<ActivitySessionState> = { 'sess-1': vendorSession({ state: 'ended' }) };
        expect(overlayRegistry(ended, [agent()], context('doing'))['sess-1'].session.story_binding).toBe('none');
    });
});

describe('overlayRegistry registry-only rows', () => {
    it('builds a row with the name, vendor, state and story for an agent with no vendor session', () => {
        const overlaid = overlayRegistry({}, [agent({ vendor: 'agy', agent: 'agy-helper', state: 'idle', story: '', session_ids: ['gone'] })], context('doing'));
        const state = overlaid['registry:agy-helper:demo'];
        expect(state.root_path).toBe('/ws/demo');
        expect(state.session).toMatchObject({
            session_id: 'registry:agy-helper:demo', vendor: 'agy', project: 'demo', registry_name: 'agy-helper', registry_only: true,
            state: 'idle', story_binding: 'none', started_at: FRESH, updated_at: FRESH,
        });
        expect(state.session.registry_stale).toBeUndefined();
        expect(state.session.registry_story).toBeUndefined();
    });

    it('places a working coordinator on its story\'s card with no vendor session at all', () => {
        const overlaid = overlayRegistry({}, [agent({ session_ids: [] })], context('doing'));
        const session = overlaid['registry:coord-demo:demo'].session;
        expect(session).toMatchObject({ registry_only: true, state: 'working', story_binding: 'bound', registry_story: 'story-a' });
        expect(session.stories).toEqual([{ doc_path: `demo/${DOC_PATH}`, id: 'story-a' }]);
    });

    it('keeps a working entry unbound when its story is not in flight, still showing the story it names', () => {
        const session = overlayRegistry({}, [agent()], context('done'))['registry:coord-demo:demo'].session;
        expect(session).toMatchObject({ state: 'working', story_binding: 'none', registry_story: 'story-a' });
    });

    it('reads a stale working entry as idle, marked stale and unbound', () => {
        const session = overlayRegistry({}, [agent({ updated_at: OLD })], context('doing'))['registry:coord-demo:demo'].session;
        expect(session).toMatchObject({ state: 'idle', registry_stale: true, story_binding: 'none' });
    });

    it('takes liveness from the state: stopped ends the row, an unknown state stays live', () => {
        expect(overlayRegistry({}, [agent({ state: 'stopped' })], context('doing'))['registry:coord-demo:demo'].session.state).toBe('ended');
        expect(overlayRegistry({}, [agent({ state: 'hibernating' })], context('doing'))['registry:coord-demo:demo'].session.state).toBe('unknown');
    });

    it('keeps two repositories\' agents of one name apart', () => {
        const overlaid = overlayRegistry({}, [agent(), agent({ root_path: '/ws/other', repo_relative: 'other' })], context('doing'));
        expect(Object.keys(overlaid).sort()).toEqual(['registry:coord-demo:demo', 'registry:coord-demo:other']);
    });
});
