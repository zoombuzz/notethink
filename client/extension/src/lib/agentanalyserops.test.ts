import {
    attributedFiles,
    buildActivitySnapshot,
    emptyActivitySnapshot,
    emptyAnalyserState,
    treeForWorkspacePath,
    unattributedFiles,
    unreadableSessionIds,
    type ActivityRefusal,
    type ActivitySessionState,
    type ActivityTreeState,
} from './agentanalyserops';
import type { ActivitySession, ActivityTree } from '../types/AgentActivity';

function makeSession(session_id: string): ActivitySession {
    return {
        session_id,
        vendor: 'claude-code',
        project: 'notethink',
        story_binding: 'none',
        started_at: '2026-09-22T00:00:00Z',
        updated_at: '2026-09-22T00:00:00Z',
        state: 'working',
        capabilities: {},
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
    };
}

function makeTree(): ActivityTree {
    return { generated_at: '2026-09-22T00:00:00Z', branch: 'staging', head_commit: 'abc123', uncommitted: [], committed: [] };
}

describe('emptyActivitySnapshot', () => {
    it('defaults to scanning with no sessions or trees', () => {
        expect(emptyActivitySnapshot()).toEqual({ analyser: { state: 'scanning', reason: undefined, refusals: [] }, sessions: [], trees: [] });
    });

    it('carries a reason through to unavailable and failed states', () => {
        expect(emptyActivitySnapshot('unavailable', 'no local file access in this host').analyser)
            .toEqual({ state: 'unavailable', reason: 'no local file access in this host', refusals: [] });
    });
});

describe('unreadableSessionIds', () => {
    it('dedupes and sorts session ids from refusals that name one', () => {
        const refusals: ActivityRefusal[] = [
            { file: 'a', code: 'unreadable', reason: 'r', session_id: 'zzz' },
            { file: 'b', code: 'invalid_shape', reason: 'r', session_id: 'aaa' },
            { file: 'c', code: 'unreadable', reason: 'r', session_id: 'zzz' },
        ];
        expect(unreadableSessionIds(refusals)).toEqual(['aaa', 'zzz']);
    });

    it('ignores a refusal naming no session', () => {
        const refusals: ActivityRefusal[] = [{ file: 'a', code: 'too_large', reason: 'r' }];
        expect(unreadableSessionIds(refusals)).toEqual([]);
    });
});

describe('attributedFiles / unattributedFiles', () => {
    const tree: ActivityTree = {
        ...makeTree(),
        uncommitted: [
            { path: 'a.ts', change: 'modified', session_id: 's1' },
            { path: 'b.ts', change: 'added', session_id: 's2' },
            { path: 'c.ts', change: 'deleted' },
        ],
    };

    it('attributedFiles keeps only files credited to a wanted session, in tree order', () => {
        expect(attributedFiles(tree, ['s1']).map(f => f.path)).toEqual(['a.ts']);
        expect(attributedFiles(tree, ['s1', 's2']).map(f => f.path)).toEqual(['a.ts', 'b.ts']);
    });

    it('unattributedFiles keeps only files no session accounts for', () => {
        expect(unattributedFiles(tree).map(f => f.path)).toEqual(['c.ts']);
    });

    it('both read as empty on an undefined tree', () => {
        expect(attributedFiles(undefined, ['s1'])).toEqual([]);
        expect(unattributedFiles(undefined)).toEqual([]);
    });
});

describe('treeForWorkspacePath', () => {
    const outer: ActivityTreeState = { root_path: '/repo', root_relative: '', tree: makeTree() };
    const nested: ActivityTreeState = { root_path: '/repo/vendor/nested-repo', root_relative: 'vendor/nested-repo', tree: makeTree() };

    it('matches the deepest repository a path sits inside', () => {
        expect(treeForWorkspacePath([outer, nested], 'vendor/nested-repo/docstech/todo.md')).toBe(nested);
        expect(treeForWorkspacePath([outer, nested], 'docstech/todo.md')).toBe(outer);
    });

    it('an empty root_relative matches every path, which is what a repository that IS the workspace folder looks like', () => {
        expect(treeForWorkspacePath([outer], 'anything/at/all.md')).toBe(outer);
    });

    it('returns undefined when nothing matches', () => {
        expect(treeForWorkspacePath([nested], 'docstech/todo.md')).toBeUndefined();
    });
});

describe('buildActivitySnapshot', () => {
    it('sorts sessions by id and trees by root_path so an unchanged read serialises identically', () => {
        const sessions: Record<string, ActivitySessionState> = {
            b: { root_path: '/repo', session: makeSession('b') },
            a: { root_path: '/repo', session: makeSession('a') },
        };
        const trees: Record<string, ActivityTreeState> = {
            '/repo-z': { root_path: '/repo-z', root_relative: '', tree: makeTree() },
            '/repo-a': { root_path: '/repo-a', root_relative: '', tree: makeTree() },
        };
        const snapshot = buildActivitySnapshot(emptyAnalyserState('live'), sessions, trees);
        expect(snapshot.sessions.map(s => s.session.session_id)).toEqual(['a', 'b']);
        expect(snapshot.trees.map(t => t.root_path)).toEqual(['/repo-a', '/repo-z']);
        expect(snapshot.analyser.state).toBe('live');
    });
});
