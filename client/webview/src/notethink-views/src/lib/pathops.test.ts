import { segmentPathBelowWorkspace, splitPathSegments, workspaceRootFromDocAndRelative } from './pathops';

describe('workspaceRootFromDocAndRelative', () => {
    it('strips the relative_path suffix and any trailing slash', () => {
        expect(workspaceRootFromDocAndRelative(
            '/abs/active_development/notethink/docstech/users/alex/todo.md',
            'notethink/docstech/users/alex/todo.md',
        )).toBe('/abs/active_development');
    });

    it('returns empty string when doc_path does not end with relative_path', () => {
        expect(workspaceRootFromDocAndRelative(
            '/abs/active_development/notethink/docs/todo.md',
            'oma/docs/todo.md',
        )).toBe('');
    });

    it('returns empty string when either argument is missing', () => {
        expect(workspaceRootFromDocAndRelative(undefined, 'a/b.md')).toBe('');
        expect(workspaceRootFromDocAndRelative('/abs/a/b.md', undefined)).toBe('');
        expect(workspaceRootFromDocAndRelative(undefined, undefined)).toBe('');
    });

    it('handles a workspace-root file (relative_path == basename)', () => {
        // doc_path ends with relative_path; prefix is the workspace folder itself
        expect(workspaceRootFromDocAndRelative(
            '/abs/active_development/README.md',
            'README.md',
        )).toBe('/abs/active_development');
    });
});

describe('segmentPathBelowWorkspace', () => {
    it('keeps the workspace folder itself as the first clickable segment', () => {
        const segments = segmentPathBelowWorkspace(
            '/abs/active_development/notethink/docs/todo.md',
            '/abs/active_development/notethink',
        );
        expect(segments).toEqual([
            { label: 'notethink', path: '/abs/active_development/notethink' },
            { label: 'docs', path: '/abs/active_development/notethink/docs' },
            { label: 'todo.md', path: '/abs/active_development/notethink/docs/todo.md' },
        ]);
    });

    it('handles a single-level workspace root (path is the workspace folder itself)', () => {
        const segments = segmentPathBelowWorkspace(
            '/abs/active_development/notethink',
            '/abs/active_development/notethink',
        );
        expect(segments).toEqual([
            { label: 'notethink', path: '/abs/active_development/notethink' },
        ]);
    });

    it('handles an integration_path one level below the workspace root', () => {
        const segments = segmentPathBelowWorkspace(
            '/abs/active_development/notethink/docs',
            '/abs/active_development/notethink',
        );
        expect(segments).toEqual([
            { label: 'notethink', path: '/abs/active_development/notethink' },
            { label: 'docs', path: '/abs/active_development/notethink/docs' },
        ]);
    });

    it('falls back to absolute-path segmentation when workspace_root is missing', () => {
        const segments = segmentPathBelowWorkspace('/abs/a/b.md');
        expect(segments).toEqual([
            { label: 'abs', path: '/abs' },
            { label: 'a', path: '/abs/a' },
            { label: 'b.md', path: '/abs/a/b.md' },
        ]);
    });

    it('falls back to absolute-path segmentation when absolute_path does not sit under workspace_root', () => {
        const segments = segmentPathBelowWorkspace('/other/place/x.md', '/abs/active_development/notethink');
        expect(segments).toEqual([
            { label: 'other', path: '/other' },
            { label: 'place', path: '/other/place' },
            { label: 'x.md', path: '/other/place/x.md' },
        ]);
    });
});

describe('splitPathSegments', () => {
    it('prefers doc_relative_path to derive the workspace root', () => {
        const segments = splitPathSegments(
            '/abs/active_development/notethink/docs/todo.md',
            undefined,
            'notethink/docs/todo.md',
        );
        expect(segments).toEqual([
            { label: 'active_development', path: '/abs/active_development' },
            { label: 'notethink', path: '/abs/active_development/notethink' },
            { label: 'docs', path: '/abs/active_development/notethink/docs' },
            { label: 'todo.md', path: '/abs/active_development/notethink/docs/todo.md' },
        ]);
    });

    it('falls back to workspace_root when doc_relative_path is absent', () => {
        const segments = splitPathSegments(
            '/abs/active_development/notethink/docs/todo.md',
            '/abs/active_development/notethink',
        );
        expect(segments).toEqual([
            { label: 'notethink', path: '/abs/active_development/notethink' },
            { label: 'docs', path: '/abs/active_development/notethink/docs' },
            { label: 'todo.md', path: '/abs/active_development/notethink/docs/todo.md' },
        ]);
    });

    it('segments from / when neither workspace_root nor doc_relative_path is supplied', () => {
        const segments = splitPathSegments('/a/b/c.md');
        expect(segments).toEqual([
            { label: 'a', path: '/a' },
            { label: 'b', path: '/a/b' },
            { label: 'c.md', path: '/a/b/c.md' },
        ]);
    });

    it('ignores workspace_root when doc_path does not sit under it', () => {
        const segments = splitPathSegments('/other/x.md', '/abs/active_development/notethink');
        expect(segments).toEqual([
            { label: 'other', path: '/other' },
            { label: 'x.md', path: '/other/x.md' },
        ]);
    });
});
