import { AGENT_SCAN_CACHE_VERSION, parseScanCache, scanCacheFileNameFor, scanCacheKeyFor, serialiseScanCache, trimOutputForStore, type AgentFileIdentity } from './agentscancacheops';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 30 * DAY_MS;
const NOW_MS = Date.parse('2026-09-22T12:00:00Z');

interface TestOutput {
    session_id: string;
    calls: Array<{ absolute_path?: string; edits?: unknown; whole_file?: boolean }>;
}

function file(mtime: number, path = '/home/dev/.claude/projects/-ws/s1.jsonl'): AgentFileIdentity {
    return { path, uri_string: `file://${path}`, mtime, size: 100, appendable: true };
}

function entry(session_id: string, mtime: number, calls: TestOutput['calls'] = []): { session_id: string; files: AgentFileIdentity[]; output: TestOutput } {
    return { session_id, files: [file(mtime)], output: { session_id, calls } };
}

describe('trimOutputForStore', () => {
    it('drops the edit bodies of a source file call but keeps a story board call whole', () => {
        const edits = [{ old_text: 'a', new_text: 'b' }];
        const trimmed = trimOutputForStore<TestOutput>({
            session_id: 's1',
            calls: [{ absolute_path: '/ws/src/app.ts', edits }, { absolute_path: '/ws/docstech/users/a/todo.md', edits }, { absolute_path: '/ws/docstech/users/a/done.md', edits, whole_file: true }],
        });
        expect(trimmed.calls[0].edits).toBeUndefined();
        expect(trimmed.calls[1].edits).toEqual(edits);
        expect(trimmed.calls[2]).toEqual({ absolute_path: '/ws/docstech/users/a/done.md', edits, whole_file: true });
    });

    it('leaves a call with no edits, and the other fields of the output, as they were', () => {
        const output = { session_id: 's1', usage: { input_tokens: 4 }, calls: [{ absolute_path: '/ws/a.ts' }] };
        expect(trimOutputForStore(output)).toEqual(output);
    });
});

describe('serialiseScanCache and parseScanCache', () => {
    it('round-trips every session inside the window', () => {
        const entries = [entry('s1', NOW_MS - DAY_MS), entry('s2', NOW_MS - 2 * DAY_MS)];
        const parsed = parseScanCache<TestOutput>(serialiseScanCache(entries, NOW_MS, WINDOW_MS), NOW_MS, WINDOW_MS);
        expect(parsed.map(e => e.session_id)).toEqual(['s1', 's2']);
        expect(parsed[0].files).toEqual(entries[0].files);
    });

    it('leaves a session older than the window out of the stored text', () => {
        const text = serialiseScanCache([entry('fresh', NOW_MS - DAY_MS), entry('stale', NOW_MS - 31 * DAY_MS)], NOW_MS, WINDOW_MS);
        expect(text).toContain('fresh');
        expect(text).not.toContain('stale');
    });

    it('drops, on load, a session that has aged out of the window since it was stored', () => {
        const text = serialiseScanCache([entry('s1', NOW_MS - 29 * DAY_MS)], NOW_MS, WINDOW_MS);
        expect(parseScanCache<TestOutput>(text, NOW_MS + 2 * DAY_MS, WINDOW_MS)).toEqual([]);
    });

    it('keeps a session while any one of its files is inside the window', () => {
        const mixed = { session_id: 's1', files: [file(NOW_MS - 40 * DAY_MS), file(NOW_MS - DAY_MS, '/other/sub.jsonl')], output: { session_id: 's1', calls: [] } };
        expect(parseScanCache<TestOutput>(serialiseScanCache([mixed], NOW_MS, WINDOW_MS), NOW_MS, WINDOW_MS)).toHaveLength(1);
    });

    it('discards the whole store when its version is not the current one', () => {
        const stored = JSON.parse(serialiseScanCache([entry('s1', NOW_MS)], NOW_MS, WINDOW_MS)) as { version: number };
        expect(stored.version).toBe(AGENT_SCAN_CACHE_VERSION);
        expect(parseScanCache<TestOutput>(JSON.stringify({ ...stored, version: AGENT_SCAN_CACHE_VERSION + 1 }), NOW_MS, WINDOW_MS)).toEqual([]);
    });

    it('discards text that is not a store, and skips an entry of the wrong shape without losing the rest', () => {
        expect(parseScanCache<TestOutput>('not json', NOW_MS, WINDOW_MS)).toEqual([]);
        expect(parseScanCache<TestOutput>('null', NOW_MS, WINDOW_MS)).toEqual([]);
        expect(parseScanCache<TestOutput>(JSON.stringify({ version: AGENT_SCAN_CACHE_VERSION }), NOW_MS, WINDOW_MS)).toEqual([]);
        const good = entry('good', NOW_MS);
        const text = JSON.stringify({ version: AGENT_SCAN_CACHE_VERSION, saved_at_ms: NOW_MS, entries: [{ session_id: 'bad', files: 'nope', output: {} }, { session_id: 'mismatch', files: good.files, output: { session_id: 'other', calls: [] } }, good] });
        expect(parseScanCache<TestOutput>(text, NOW_MS, WINDOW_MS).map(e => e.session_id)).toEqual(['good']);
    });
});

describe('scanCacheKeyFor', () => {
    it('names one home the same way every time and two homes differently', () => {
        expect(scanCacheKeyFor('file:///home/dev')).toBe(scanCacheKeyFor('file:///home/dev'));
        expect(scanCacheKeyFor('file:///home/dev')).not.toBe(scanCacheKeyFor('vscode-remote://ssh-remote%2Bbox/home/dev'));
        expect(scanCacheFileNameFor('file:///home/dev')).toMatch(/^agent-scan-[0-9a-f]{14}\.json$/);
    });
});
