import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    activityFileKindFromFileName,
    activitySessionIdFromFileName,
    hasActivityCapability,
    isActivityBlobPath,
    isActivityProducerLive,
    parseActivityDigest,
    parseActivityEvents,
    parseActivityManifest,
    parseActivitySession,
    parseActivityTree,
} from './activityops';
import {ACTIVITY_EVENTS_MAX_LINES, ACTIVITY_SESSION_MAX_BYTES} from '../types/AgentActivity';

/*
 * The contract fixtures under playwright/fixtures/activity are the single populated `.notethink/`
 * this repo keeps, shared with the Playwright harness. Reading them here rather than restating
 * their contents is what stops a fixture drifting away from the validator unnoticed: a producer
 * author reads the fixtures, so a fixture the parser would refuse is a lie in the documentation.
 */
const FIXTURES_DIR = path.join(__dirname, '..', '..', '..', '..', 'playwright', 'fixtures', 'activity');

function fixture(relative_path: string): string {
    return fs.readFileSync(path.join(FIXTURES_DIR, relative_path), 'utf-8');
}

function sessionFixture(name: string): string {
    return fixture(path.join('sessions', name));
}

describe('the contract fixtures', () => {
    it('accepts the manifest and keeps every declared session', () => {
        const parsed = parseActivityManifest(fixture('manifest.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.sessions).toHaveLength(5);
        expect(parsed.dropped).toBeUndefined();
        expect(hasActivityCapability(parsed.value.capabilities, 'tree_state')).toBe(true);
        expect(hasActivityCapability(parsed.value.capabilities, 'blob_base')).toBe(true);
    });

    it('accepts a bound busy agent and carries its live line', () => {
        const parsed = parseActivitySession(sessionFixture('claude-bound-busy.session.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.state).toBe('working');
        expect(parsed.value.story_binding).toBe('bound');
        expect(parsed.value.story).toEqual({doc_path: 'docstech/users/alex.stanhope/todo.md', id: 'agent-activity-card'});
        expect(parsed.value.current?.tool).toBe('Edit');
    });

    it('accepts a bound idle agent with no question pending', () => {
        const parsed = parseActivitySession(sessionFixture('grok-bound-idle.session.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.state).toBe('idle');
        expect(parsed.value.question).toBeUndefined();
        expect(hasActivityCapability(parsed.value.capabilities, 'question')).toBe(true);
    });

    it('accepts an agent with a pending question', () => {
        const parsed = parseActivitySession(sessionFixture('grok-question.session.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.state).toBe('waiting');
        expect(parsed.value.question?.question_id).toBe('q-4417');
        expect(parsed.value.question?.options).toHaveLength(3);
    });

    it('accepts an agent that declared it is on no story, and gives it no story', () => {
        const parsed = parseActivitySession(sessionFixture('claude-no-story.session.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.story_binding).toBe('none');
        expect(parsed.value.story).toBeUndefined();
    });

    it('tells a Codex session that cannot report a question from one with nothing pending', () => {
        const codex = parseActivitySession(sessionFixture('codex-no-question.session.json'));
        const grok = parseActivitySession(sessionFixture('grok-bound-idle.session.json'));
        expect(codex.ok && grok.ok).toBe(true);
        if (!codex.ok || !grok.ok) { return; }
        expect(codex.value.question).toBeUndefined();
        expect(grok.value.question).toBeUndefined();
        expect(hasActivityCapability(codex.value.capabilities, 'question')).toBe(false);
        expect(hasActivityCapability(grok.value.capabilities, 'question')).toBe(true);
    });

    it('accepts a clean event log in write order', () => {
        const parsed = parseActivityEvents(sessionFixture('claude-bound-busy.events.jsonl'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.map((event) => event.kind)).toEqual(['message', 'tool_call', 'tool_result', 'tool_call']);
        expect(parsed.dropped).toBeUndefined();
    });

    it('accepts a bounded digest that states what it dropped', () => {
        const parsed = parseActivityDigest(sessionFixture('claude-bound-busy.digest.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.messages.kept).toBe(3);
        expect(parsed.value.messages.dropped).toBe(47);
        expect(parsed.value.messages.items).toHaveLength(3);
        expect(parsed.value.facts?.turns).toBe('23');
    });

    it('accepts both working tree bands, leaving an unmatched file unattributed', () => {
        const parsed = parseActivityTree(fixture('tree.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.dropped).toBeUndefined();
        expect(parsed.value.uncommitted).toHaveLength(4);
        expect(parsed.value.committed).toHaveLength(2);
        const unattributed = parsed.value.uncommitted.find((file) => file.path === 'package.json');
        expect(unattributed?.session_id).toBeUndefined();
        expect(fixture(unattributed?.base_blob as string)).toContain('"name": "notethink"');
    });

    it('keeps both sides of a committed diff, and both are readable blobs', () => {
        const parsed = parseActivityTree(fixture('tree.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        const sticky = parsed.value.committed[0];
        expect(sticky.base_blob).toBeDefined();
        expect(sticky.head_blob).toBeDefined();
        expect(fixture(sticky.base_blob as string)).toContain('StickyNote');
        expect(fixture(sticky.head_blob as string)).toContain('StickyNote');
    });

    it('keeps a side that exists but was not stored apart from one that does not exist', () => {
        const parsed = parseActivityTree(fixture('tree.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        const binary = parsed.value.uncommitted.find((file) => file.path === 'media/board-icon.png');
        const added = parsed.value.uncommitted.find((file) => file.change === 'added');
        expect(binary?.base_blob).toBeUndefined();
        expect(binary?.omitted).toBe('binary');
        expect(added?.base_blob).toBeUndefined();
        expect(added?.omitted).toBeUndefined();
    });

    it('refuses a contract major it does not read, and names both versions', () => {
        const parsed = parseActivitySession(sessionFixture('future-version.session.json'));
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('unsupported_version');
        expect(parsed.reason).toContain('2.0.0');
    });

    it('refuses a whole-file read caught mid-write rather than half-reading it', () => {
        const parsed = parseActivitySession(sessionFixture('truncated.session.json'));
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('unreadable');
    });

    it('keeps every complete line of a half-written append and reports the one it dropped', () => {
        const parsed = parseActivityEvents(sessionFixture('partial-append.events.jsonl'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value).toHaveLength(2);
        expect(parsed.dropped).toHaveLength(1);
        expect(parsed.dropped?.[0]).toContain('line 3');
    });
});

describe('path bases in the fixtures', () => {
    const bound_sessions = ['claude-bound-busy', 'grok-bound-idle', 'grok-question', 'codex-no-question']
        .map((name) => parseActivitySession(sessionFixture(`${name}.session.json`)));

    it('is one contract root, so every session names the same project', () => {
        const projects = bound_sessions.map((parsed) => parsed.ok ? parsed.value.project : 'unparsed');
        expect(new Set(projects).size).toBe(1);
    });

    /*
     * The mistake a workspace-relative reading produces is a doc_path carrying the repository name
     * as its first segment. Nothing downstream could tell that apart from a real folder of that
     * name, so it is worth pinning here rather than at render time.
     */
    it('writes doc_path relative to the contract root, not prefixed with the project', () => {
        for (const parsed of bound_sessions) {
            expect(parsed.ok).toBe(true);
            if (!parsed.ok) { continue; }
            expect(parsed.value.story?.doc_path.startsWith(`${parsed.value.project}/`)).toBe(false);
        }
    });

    it('binds each session to a distinct story in the contract root', () => {
        const ids = bound_sessions.map((parsed) => parsed.ok ? parsed.value.story?.id : undefined);
        expect(new Set(ids).size).toBe(bound_sessions.length);
        expect(ids).not.toContain(undefined);
    });

    it('writes changed-file paths relative to the contract root, not prefixed with the project', () => {
        const parsed = parseActivityTree(fixture('tree.json'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        for (const file of [...parsed.value.uncommitted, ...parsed.value.committed]) {
            expect(file.path.startsWith('notethink/')).toBe(false);
            expect(file.path.startsWith('/')).toBe(false);
        }
    });
});

describe('refusing a file rather than half-reading it', () => {
    it('refuses a file over its size bound before parsing it', () => {
        const oversized = `{"contract_version":"1.0.0","pad":"${'x'.repeat(ACTIVITY_SESSION_MAX_BYTES)}"}`;
        const parsed = parseActivitySession(oversized);
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('too_large');
    });

    it('refuses an event log over its line bound', () => {
        const line = '{"contract_version":"1.0.0","session_id":"s","at":"2026-09-18T09:00:00Z","kind":"notice"}';
        const parsed = parseActivityEvents(Array.from({length: ACTIVITY_EVENTS_MAX_LINES + 1}, () => line).join('\n'));
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('too_large');
    });

    it('refuses a file with no contract_version', () => {
        const parsed = parseActivityManifest('{"producer":{"name":"p","version":"1"}}');
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('invalid_shape');
    });

    it('refuses a timestamp written as an epoch number', () => {
        const parsed = parseActivityManifest('{"contract_version":"1.0.0","producer":{"name":"p","version":"1"},"written_at":1789999999,"heartbeat_seconds":10,"sessions":[]}');
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('invalid_shape');
    });
});

describe('the story binding, which is declared and never guessed', () => {
    function session(extra: string): string {
        return `{"contract_version":"1.0.0","session_id":"s","vendor":"codex","project":"notethink","started_at":"2026-09-18T09:00:00Z","updated_at":"2026-09-18T09:00:00Z","state":"idle",${extra}}`;
    }

    it('refuses a bound session with no story to join to', () => {
        const parsed = parseActivitySession(session('"story_binding":"bound"'));
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('invalid_shape');
    });

    it('refuses a story on a session that declared it is on none', () => {
        const parsed = parseActivitySession(session('"story_binding":"none","story":{"doc_path":"todo.md","id":"x"}'));
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('invalid_shape');
    });

    it('refuses a session with no story_binding at all, rather than reading it as none', () => {
        const parsed = parseActivitySession(session('"vendor_note":"nothing declared"'));
        expect(parsed.ok).toBe(false);
        if (parsed.ok) { return; }
        expect(parsed.code).toBe('invalid_shape');
    });

    it('keeps undeclared apart from a declared none', () => {
        const undeclared = parseActivitySession(session('"story_binding":"undeclared"'));
        const none = parseActivitySession(session('"story_binding":"none"'));
        expect(undeclared.ok && none.ok).toBe(true);
        if (!undeclared.ok || !none.ok) { return; }
        expect(undeclared.value.story_binding).toBe('undeclared');
        expect(none.value.story_binding).toBe('none');
    });
});

describe('values a later contract version may add', () => {
    function session(state: string): string {
        return `{"contract_version":"1.4.0","session_id":"s","vendor":"a-new-vendor","project":"notethink","started_at":"2026-09-18T09:00:00Z","updated_at":"2026-09-18T09:00:00Z","state":"${state}","story_binding":"undeclared"}`;
    }

    it('reads a higher minor version of the same major', () => {
        const parsed = parseActivitySession(session('idle'));
        expect(parsed.ok).toBe(true);
    });

    it('coerces a state it does not know to unknown, never to idle', () => {
        const parsed = parseActivitySession(session('compacting'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.state).toBe('unknown');
    });

    it('keeps a vendor it does not know rather than dropping the session', () => {
        const parsed = parseActivitySession(session('working'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.vendor).toBe('a-new-vendor');
    });

    it('treats a capability state it does not know as not supported', () => {
        const parsed = parseActivityManifest('{"contract_version":"1.4.0","producer":{"name":"p","version":"1"},"written_at":"2026-09-18T09:00:00Z","heartbeat_seconds":10,"capabilities":{"tree_state":"partial"},"sessions":[]}');
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(hasActivityCapability(parsed.value.capabilities, 'tree_state')).toBe(false);
    });

    it('treats a capability nobody declared as not supported', () => {
        const parsed = parseActivityManifest('{"contract_version":"1.0.0","producer":{"name":"p","version":"1"},"written_at":"2026-09-18T09:00:00Z","heartbeat_seconds":10,"sessions":[]}');
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(hasActivityCapability(parsed.value.capabilities, 'blob_base')).toBe(false);
    });
});

describe('the working tree bands', () => {
    function tree(files: string): string {
        return `{"contract_version":"1.0.0","generated_at":"2026-09-18T09:00:00Z","branch":"staging","head_commit":"abc","uncommitted":[${files}],"committed":[]}`;
    }

    it('drops the contract own files, so they never show in the band they feed', () => {
        const parsed = parseActivityTree(tree('{"path":".notethink/tree.json","change":"modified"},{"path":"README.md","change":"modified"}'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.uncommitted.map((file) => file.path)).toEqual(['README.md']);
        expect(parsed.dropped).toHaveLength(1);
    });

    it('drops a contract file in a repository nested inside the contract root', () => {
        const parsed = parseActivityTree(tree('{"path":"notegit/.notethink/manifest.json","change":"added"}'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.uncommitted).toHaveLength(0);
    });

    it('drops an entry whose blob path escapes the contract directory', () => {
        const parsed = parseActivityTree(tree('{"path":"a.ts","change":"modified","base_blob":"blobs/../../../etc/passwd"}'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.uncommitted).toHaveLength(0);
        expect(parsed.dropped).toHaveLength(1);
    });

    it('drops a rename with no previous path, which nothing could diff', () => {
        const parsed = parseActivityTree(tree('{"path":"a.ts","change":"renamed"}'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.uncommitted).toHaveLength(0);
    });

    it('leaves a file unattributed rather than crediting an unsafe session id', () => {
        const parsed = parseActivityTree(tree('{"path":"a.ts","change":"modified","session_id":"../elsewhere"}'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(parsed.value.uncommitted[0].session_id).toBeUndefined();
    });
});

describe('blob paths, which become file URIs', () => {
    it('accepts a blob inside the contract directory', () => {
        expect(isActivityBlobPath('blobs/3f2a.ts')).toBe(true);
    });

    it.each([
        ['blobs/../secrets.env'],
        ['/etc/passwd'],
        ['../blobs/a.ts'],
        ['sessions/a.session.json'],
        ['blobs/'],
        ['blobs'],
        ['blobs\\a.ts'],
        ['blobs//a.ts'],
    ])('refuses %s', (candidate) => {
        expect(isActivityBlobPath(candidate)).toBe(false);
    });
});

describe('routing a watcher event by file name', () => {
    it.each([
        ['manifest.json', 'manifest'],
        ['tree.json', 'tree'],
        ['abc.session.json', 'session'],
        ['abc.events.jsonl', 'events'],
        ['abc.digest.json', 'digest'],
    ])('reads %s as a %s file', (file_name, kind) => {
        expect(activityFileKindFromFileName(file_name)).toBe(kind);
    });

    it('ignores a file the contract does not define', () => {
        expect(activityFileKindFromFileName('notes.md')).toBeUndefined();
    });

    it('recovers the session id from each of the three per-session names', () => {
        expect(activitySessionIdFromFileName('claude-bound-busy.session.json')).toBe('claude-bound-busy');
        expect(activitySessionIdFromFileName('claude-bound-busy.events.jsonl')).toBe('claude-bound-busy');
        expect(activitySessionIdFromFileName('claude-bound-busy.digest.json')).toBe('claude-bound-busy');
    });

    it('refuses a session id that is not a safe path segment', () => {
        expect(activitySessionIdFromFileName('../escape.session.json')).toBeUndefined();
        expect(activitySessionIdFromFileName('.hidden.session.json')).toBeUndefined();
    });
});

describe('telling a stopped producer from a quiet one', () => {
    function manifest(written_at: string): string {
        return `{"contract_version":"1.0.0","producer":{"name":"p","version":"1"},"written_at":"${written_at}","heartbeat_seconds":10,"sessions":[]}`;
    }

    const now_ms = Date.parse('2026-09-18T09:00:00Z');

    it('counts a producer that wrote within three heartbeats as live', () => {
        const parsed = parseActivityManifest(manifest('2026-09-18T08:59:35Z'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(isActivityProducerLive(parsed.value, now_ms)).toBe(true);
    });

    it('counts a producer that has gone quiet past three heartbeats as stopped', () => {
        const parsed = parseActivityManifest(manifest('2026-09-18T08:59:00Z'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(isActivityProducerLive(parsed.value, now_ms)).toBe(false);
    });

    it('counts a producer whose clock runs ahead as live', () => {
        const parsed = parseActivityManifest(manifest('2026-09-18T09:00:30Z'));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { return; }
        expect(isActivityProducerLive(parsed.value, now_ms)).toBe(true);
    });
});
