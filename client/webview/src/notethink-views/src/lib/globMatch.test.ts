import { globToRegExp, globMatches } from './globMatch';

// library-side test fixture: a realistic exclude glob to feed the matcher. intentionally not coupled to the app's DEFAULT_AGGREGATE_EXCLUDE (extension/webview own those) — these tests exercise the glob mechanism, not the app default
const DERIVED_DIR_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage}/**';

describe('globToRegExp', () => {
    it('matches a top-level file against **/*.md (zero leading dirs)', () => {
        expect(globToRegExp('**/*.md').test('todo.md')).toBe(true);
    });

    it('matches a nested file against **/*.md', () => {
        expect(globToRegExp('**/*.md').test('docs/users/alex/todo.md')).toBe(true);
    });

    it('does not match a non-markdown file against **/*.md', () => {
        expect(globToRegExp('**/*.md').test('docs/notes.txt')).toBe(false);
    });

    it('treats a single * as separator-bounded', () => {
        expect(globToRegExp('*.md').test('todo.md')).toBe(true);
        expect(globToRegExp('*.md').test('docs/todo.md')).toBe(false);
    });

    it('expands {a,b,c} brace alternation', () => {
        const re = globToRegExp('**/{a,b}/**');
        expect(re.test('a/x.md')).toBe(true);
        expect(re.test('deep/b/y.md')).toBe(true);
        expect(re.test('c/z.md')).toBe(false);
    });

    it('escapes regex/dot metacharacters in brace members', () => {
        const re = globToRegExp(DERIVED_DIR_EXCLUDE);
        expect(re.test('node_modules/pkg/readme.md')).toBe(true);
        expect(re.test('src/.next/trace.md')).toBe(true);
        expect(re.test('infra/.terraform/modules/x.md')).toBe(true);
        // a directory that merely starts the same must not match (anchored, dot is literal)
        expect(re.test('nodeXmodules/readme.md')).toBe(false);
        expect(re.test('src/notes.md')).toBe(false);
    });

    it('matches the ? wildcard as exactly one non-separator char', () => {
        expect(globToRegExp('a?.md').test('ab.md')).toBe(true);
        expect(globToRegExp('a?.md').test('a/.md')).toBe(false);
    });
});

describe('globMatches', () => {
    it('selects when include matches and exclude does not', () => {
        expect(globMatches('docs/todo.md', '**/*.md', DERIVED_DIR_EXCLUDE)).toBe(true);
    });

    it('rejects when exclude matches even though include matches', () => {
        expect(globMatches('node_modules/pkg/readme.md', '**/*.md', DERIVED_DIR_EXCLUDE)).toBe(false);
    });

    it('excludes .claude/worktrees mirror trees so agent-worktree copies do not duplicate stories', () => {
        expect(globMatches('project/.claude/worktrees/agent-abc/docstech/users/me/todo.md', '**/*.md', DERIVED_DIR_EXCLUDE)).toBe(false);
        expect(globMatches('project/.claude/settings.md', '**/*.md', DERIVED_DIR_EXCLUDE)).toBe(false);
    });

    it('rejects when include does not match', () => {
        expect(globMatches('docs/notes.txt', '**/*.md', '')).toBe(false);
    });

    it('treats empty include as match-all', () => {
        expect(globMatches('anything/here.txt', '', '')).toBe(true);
    });

    it('treats empty exclude as exclude-nothing', () => {
        expect(globMatches('node_modules/pkg/readme.md', '**/*.md', '')).toBe(true);
    });

    it('supports a narrowed include glob', () => {
        expect(globMatches('docs/users/alex/todo.md', '**/users/**', '')).toBe(true);
        expect(globMatches('docs/changelog.md', '**/users/**', '')).toBe(false);
    });
});
