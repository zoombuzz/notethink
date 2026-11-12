import {
    attributedFiles,
    buildActivitySnapshot,
    emptyActivitySnapshot,
    emptyAnalyserState,
    rootsWithNothingLeftToRead,
    scopeMayBelongTo,
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
        expect(emptyActivitySnapshot()).toEqual({ analyser: { state: 'scanning', reason: undefined, refusals: [] }, sessions: [], trees: [], progress: [], coordinators: [] });
    });

    it('carries a reason through to unavailable and failed states', () => {
        expect(emptyActivitySnapshot('unavailable', 'no local file access in this host').analyser)
            .toEqual({ state: 'unavailable', reason: 'no local file access in this host', refusals: [] });
    });

    // reason_code is what the webview actually translates from; reason stays only as an English fallback
    it('carries a reason_code through alongside the English fallback reason', () => {
        expect(emptyActivitySnapshot('unavailable', 'no .claude, .codex or .grok directory found', 'remote_home_not_found').analyser)
            .toEqual({ state: 'unavailable', reason: 'no .claude, .codex or .grok directory found', reason_code: 'remote_home_not_found', refusals: [] });
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
        const refusals: ActivityRefusal[] = [{ file: 'a', code: 'unreadable', reason: 'r' }];
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
        expect(snapshot.progress).toEqual([]);
    });

    it('carries the progress entries it is given', () => {
        const entry = { root_relative: '', story_id: 'story-a', pct: 40, at: '2026-11-03T10:00:00Z', by: 'agent' };
        expect(buildActivitySnapshot(emptyAnalyserState('live'), {}, {}, [entry]).progress).toEqual([entry]);
    });
});

describe('scopeMayBelongTo', () => {
    it('matches a Claude Code folder naming the root, a folder inside it, or a symlinked alias of it', () => {
        expect(scopeMayBelongTo({ claude_dir: '-home-dev-work-app' }, '/home/dev/work/app')).toBe(true);
        expect(scopeMayBelongTo({ claude_dir: '-home-dev-work-app-nested' }, '/home/dev/work/app')).toBe(true);
        expect(scopeMayBelongTo({ claude_dir: '-mnt-data-work-app' }, '/home/dev/work/app')).toBe(true);
    });

    it('matches a folder above the root, since a session launched there can write into it, but not a sibling', () => {
        expect(scopeMayBelongTo({ claude_dir: '-home-dev-work' }, '/home/dev/work/app')).toBe(true);
        expect(scopeMayBelongTo({ claude_dir: '-home-dev-other-thing' }, '/home/dev/work/app')).toBe(false);
        expect(scopeMayBelongTo({ claude_dir: '-home-dev-wor' }, '/home/dev/work/app')).toBe(false);
    });

    it('matches a Grok cwd by path, inside, equal or above the root', () => {
        expect(scopeMayBelongTo({ cwd: '/ws/app' }, '/ws/app')).toBe(true);
        expect(scopeMayBelongTo({ cwd: '/ws/app/sub' }, '/ws/app')).toBe(true);
        expect(scopeMayBelongTo({ cwd: '/ws' }, '/ws/app')).toBe(true);
        expect(scopeMayBelongTo({ cwd: '/elsewhere' }, '/ws/app')).toBe(false);
    });

    it('lets a session of unknown scope belong anywhere', () => {
        expect(scopeMayBelongTo(undefined, '/ws/app')).toBe(true);
    });
});

describe('rootsWithNothingLeftToRead', () => {
    it('lists every root when nothing remains', () => {
        expect(rootsWithNothingLeftToRead(['/b', '/a'], [])).toEqual(['/a', '/b']);
    });

    it('holds back a root only while a remaining session could belong to it', () => {
        const remaining = [{ claude_dir: '-other-place' }];
        expect(rootsWithNothingLeftToRead(['/ws/app', '/ws/lib'], remaining)).toEqual(['/ws/app', '/ws/lib']);
        expect(rootsWithNothingLeftToRead(['/ws/app', '/ws/lib'], [{ claude_dir: '-ws-app' }])).toEqual(['/ws/lib']);
        expect(rootsWithNothingLeftToRead(['/ws/app', '/ws/lib'], [undefined])).toEqual([]);
    });
});
