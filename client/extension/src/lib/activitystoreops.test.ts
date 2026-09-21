import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    parseActivityDigest,
    parseActivityEvents,
    parseActivityManifest,
    parseActivitySession,
    parseActivityTree,
} from './activityops';
import {
    activityBlobPathFor,
    activityChangedFileIn,
    activityContractRootFor,
    activityMaxBytesForKind,
    buildActivitySnapshot,
    emptyActivityContractRoot,
    type ActivityContractRoot,
    type ActivityStore,
} from './activitystoreops';
import {
    ACTIVITY_CONTRACT_VERSION,
    ACTIVITY_DIGEST_MAX_BYTES,
    ACTIVITY_EVENTS_MAX_BYTES,
    ACTIVITY_MANIFEST_MAX_BYTES,
    ACTIVITY_SESSION_MAX_BYTES,
    ACTIVITY_TREE_MAX_BYTES,
} from '../types/AgentActivity';

/*
 * Built from the same `playwright/fixtures/activity` directory the validator tests and the
 * Playwright harness read, so the store is exercised against a producer's real output rather than
 * against a shape restated here.
 */
const FIXTURES_DIR = path.join(__dirname, '..', '..', '..', '..', 'playwright', 'fixtures', 'activity');
const ROOT_PATH = '/ws/notethink';
// the manifest's written_at, so a test picks a `now` either side of the heartbeat window rather than depending on the clock
const MANIFEST_WRITTEN_MS = Date.parse('2026-09-18T09:14:02Z');

function fixture(relative_path: string): string {
    return fs.readFileSync(path.join(FIXTURES_DIR, relative_path), 'utf-8');
}

function parsedOrThrow<T>(result: {ok: true, value: T} | {ok: false, reason: string}): T {
    if (!result.ok) { throw new Error(`fixture refused: ${result.reason}`); }
    return result.value;
}

/** the store the reader would hold after reading every healthy fixture out of one contract directory */
function fixtureRoot(): ActivityContractRoot {
    const root = emptyActivityContractRoot(ROOT_PATH, 'notethink');
    root.manifest = parsedOrThrow(parseActivityManifest(fixture('manifest.json')));
    root.tree = parsedOrThrow(parseActivityTree(fixture('tree.json')));
    for (const session_id of root.manifest.sessions) {
        root.sessions[session_id] = {session: parsedOrThrow(parseActivitySession(fixture(path.join('sessions', `${session_id}.session.json`))))};
    }
    root.sessions['claude-bound-busy'].events = parsedOrThrow(parseActivityEvents(fixture(path.join('sessions', 'claude-bound-busy.events.jsonl'))));
    root.sessions['claude-bound-busy'].digest = parsedOrThrow(parseActivityDigest(fixture(path.join('sessions', 'claude-bound-busy.digest.json'))));
    return root;
}

function fixtureStore(): ActivityStore {
    return {[ROOT_PATH]: fixtureRoot()};
}

describe('locating a contract file', () => {
    it('finds the repository holding a root file and a session file', () => {
        expect(activityContractRootFor('/ws/notethink/.notethink/manifest.json')).toBe('/ws/notethink');
        expect(activityContractRootFor('/ws/notethink/.notethink/sessions/abc.session.json')).toBe('/ws/notethink');
    });

    it('refuses a path that is not one of the contract\'s own files', () => {
        expect(activityContractRootFor('/ws/notethink/.notethink/blobs/deadbeef.ts')).toBeUndefined();
        expect(activityContractRootFor('/ws/notethink/.notethink/sessions/nested/abc.session.json')).toBeUndefined();
        expect(activityContractRootFor('/ws/notethink/docs/.notethink')).toBeUndefined();
        expect(activityContractRootFor('/ws/notethink/package.json')).toBeUndefined();
    });

    it('bounds each kind by the size the contract gives it', () => {
        expect(activityMaxBytesForKind('manifest')).toBe(ACTIVITY_MANIFEST_MAX_BYTES);
        expect(activityMaxBytesForKind('tree')).toBe(ACTIVITY_TREE_MAX_BYTES);
        expect(activityMaxBytesForKind('session')).toBe(ACTIVITY_SESSION_MAX_BYTES);
        expect(activityMaxBytesForKind('events')).toBe(ACTIVITY_EVENTS_MAX_BYTES);
        expect(activityMaxBytesForKind('digest')).toBe(ACTIVITY_DIGEST_MAX_BYTES);
    });
});

describe('resolving a blob', () => {
    it('resolves a reference confined to the blobs directory', () => {
        expect(activityBlobPathFor(ROOT_PATH, 'blobs/8c3a.json')).toBe('/ws/notethink/.notethink/blobs/8c3a.json');
    });

    it('refuses a reference that would walk out of the contract directory', () => {
        expect(activityBlobPathFor(ROOT_PATH, 'blobs/../../../etc/passwd')).toBeUndefined();
        expect(activityBlobPathFor(ROOT_PATH, '/etc/passwd')).toBeUndefined();
        expect(activityBlobPathFor(ROOT_PATH, 'sessions/abc.session.json')).toBeUndefined();
        expect(activityBlobPathFor(ROOT_PATH, undefined)).toBeUndefined();
    });
});

describe('the changed-file admission gate', () => {
    const tree = parsedOrThrow(parseActivityTree(fixture('tree.json')));

    it('admits a non-markdown path the contract lists', () => {
        const entry = activityChangedFileIn(tree, 'uncommitted', 'client/extension/src/types/AgentActivity.ts');
        expect(entry?.change).toBe('added');
        const committed = activityChangedFileIn(tree, 'committed', 'client/webview/src/notethink-views/src/components/notes/StickyNote.tsx');
        expect(committed?.head_blob).toBeDefined();
    });

    it('refuses a path the band does not list, and a band it does not know', () => {
        expect(activityChangedFileIn(tree, 'uncommitted', 'client/extension/src/lib/errorops.ts')).toBeUndefined();
        // the same path in the other band: the two bands measure against different left-hand sides, so one never answers for the other
        expect(activityChangedFileIn(tree, 'committed', 'package.json')).toBeUndefined();
        expect(activityChangedFileIn(tree, 'both', 'package.json')).toBeUndefined();
    });
});

describe('the snapshot the webview is given', () => {
    it('carries every declared session, its events and its digest', () => {
        const snapshot = buildActivitySnapshot(fixtureStore(), MANIFEST_WRITTEN_MS);
        expect(snapshot.contract_version).toBe(ACTIVITY_CONTRACT_VERSION);
        expect(snapshot.sessions.map((state) => state.session.session_id)).toEqual([
            'claude-bound-busy', 'claude-no-story', 'codex-no-question', 'grok-bound-idle', 'grok-question',
        ]);
        const busy = snapshot.sessions.find((state) => state.session.session_id === 'claude-bound-busy');
        expect(busy?.events.length).toBeGreaterThan(0);
        expect(busy?.digest?.messages.dropped).toBeGreaterThan(0);
        expect(busy?.root_relative).toBe('notethink');
        expect(snapshot.trees[0].tree.branch).toBe('staging');
    });

    it('keeps a session that cannot report a question apart from one with nothing pending', () => {
        const snapshot = buildActivitySnapshot(fixtureStore(), MANIFEST_WRITTEN_MS);
        const codex = snapshot.sessions.find((state) => state.session.session_id === 'codex-no-question');
        const grok = snapshot.sessions.find((state) => state.session.session_id === 'grok-bound-idle');
        expect(codex?.session.capabilities.question).toBe('unsupported');
        expect(grok?.session.capabilities.question).toBe('supported');
        expect(grok?.session.question).toBeUndefined();
    });

    it('carries every story binding through to the webview, declared and undeclared alike', () => {
        const store = fixtureStore();
        const declared_none = store[ROOT_PATH].sessions['claude-no-story'].session!;
        // no fixture declares `undeclared`, and the three values must reach the webview distinctly: nobody having declared a binding is a gap in the tooling, not a declaration that the session is on no story
        store[ROOT_PATH].sessions['codex-no-question'].session = {...store[ROOT_PATH].sessions['codex-no-question'].session!, story_binding: 'undeclared', story: undefined};
        const snapshot = buildActivitySnapshot(store, MANIFEST_WRITTEN_MS);
        const bindings = snapshot.sessions.map((state) => state.session.story_binding);
        expect(declared_none.story_binding).toBe('none');
        expect(bindings).toContain('bound');
        expect(bindings).toContain('none');
        expect(bindings).toContain('undeclared');
        expect(snapshot.sessions.find((state) => state.session.session_id === 'claude-bound-busy')?.session.story?.id).toBe('agent-activity-card');
    });

    it('reports the producer live inside its heartbeat window and stopped beyond it', () => {
        const live = buildActivitySnapshot(fixtureStore(), MANIFEST_WRITTEN_MS + 29000);
        expect(live.producers[0].live).toBe(true);
        expect(live.producers[0].producer?.name).toBe('example-activity-producer');
        const stopped = buildActivitySnapshot(fixtureStore(), MANIFEST_WRITTEN_MS + 31000);
        expect(stopped.producers[0].live).toBe(false);
        // a stopped producer's sessions are still drawn, as the last thing known about them, and the producer is what is reported stopped
        expect(stopped.sessions).toHaveLength(5);
    });

    it('names a declared session it could not read rather than dropping it silently', () => {
        const store = fixtureStore();
        delete store[ROOT_PATH].sessions['grok-question'];
        store[ROOT_PATH].refusals['/ws/notethink/.notethink/sessions/grok-question.session.json'] = {file: 'sessions/grok-question.session.json', code: 'unreadable', reason: 'not valid JSON'};
        const snapshot = buildActivitySnapshot(store, MANIFEST_WRITTEN_MS);
        expect(snapshot.sessions).toHaveLength(4);
        expect(snapshot.producers[0].declared_session_ids).toHaveLength(5);
        expect(snapshot.producers[0].unreadable_session_ids).toEqual(['grok-question']);
        expect(snapshot.producers[0].refusals[0].code).toBe('unreadable');
        expect(snapshot.producers[0].refusals[0].file).toBe('sessions/grok-question.session.json');
    });

    it('draws no session a manifest does not declare', () => {
        const store = fixtureStore();
        store[ROOT_PATH].sessions['leftover-from-a-crash'] = {session: parsedOrThrow(parseActivitySession(fixture(path.join('sessions', 'claude-bound-busy.session.json'))))};
        expect(buildActivitySnapshot(store, MANIFEST_WRITTEN_MS).sessions).toHaveLength(5);
        store[ROOT_PATH].manifest = undefined;
        const without_manifest = buildActivitySnapshot(store, MANIFEST_WRITTEN_MS);
        expect(without_manifest.sessions).toHaveLength(0);
        expect(without_manifest.producers[0].live).toBe(false);
    });

    it('serialises identically for an unchanged store, so a heartbeat posts nothing', () => {
        const first = JSON.stringify(buildActivitySnapshot(fixtureStore(), MANIFEST_WRITTEN_MS));
        const second = JSON.stringify(buildActivitySnapshot(fixtureStore(), MANIFEST_WRITTEN_MS + 1000));
        expect(second).toBe(first);
    });

    it('says nothing is writing when nothing is', () => {
        const snapshot = buildActivitySnapshot({}, MANIFEST_WRITTEN_MS);
        expect(snapshot.producers).toHaveLength(0);
        expect(snapshot.sessions).toHaveLength(0);
        expect(snapshot.trees).toHaveLength(0);
    });
});
