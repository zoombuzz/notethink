import { globToRegExp, globMatches } from './globMatch';

const DERIVED_DIR_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage}/**';
const VENDORED_EXCLUDE = '**/{node_modules,.git,.svn,.hg,.terraform,.claude,dist,build,out,.next,.cache,coverage,vendored}/**';

describe('globToRegExp', () => {
    it('matches a top-level file against **/*.md (zero leading dirs)', () => {
        expect(globToRegExp('**/*.md').test('todo.md')).toBe(true);
    });

    it('matches a nested file against **/*.md', () => {
        expect(globToRegExp('**/*.md').test('docs/users/alex/todo.md')).toBe(true);
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
        expect(re.test('nodeXmodules/readme.md')).toBe(false);
        expect(re.test('src/notes.md')).toBe(false);
    });
});

describe('globMatches', () => {
    it('selects when include matches and exclude does not', () => {
        expect(globMatches('docs/todo.md', '**/*.md', DERIVED_DIR_EXCLUDE)).toBe(true);
    });

    it('rejects when exclude matches even though include matches', () => {
        expect(globMatches('node_modules/pkg/readme.md', '**/*.md', DERIVED_DIR_EXCLUDE)).toBe(false);
    });

    it('excludes a vendored copy of another project so duplicates do not leak into folder-mode discovery', () => {
        expect(globMatches('notegit/vendored/notethink/docstech/users/alex/todo.md', '**/{todo,done}.md', VENDORED_EXCLUDE)).toBe(false);
        expect(globMatches('notegit/vendored/notethink/docstech/users/alex/done.md', '**/{todo,done}.md', VENDORED_EXCLUDE)).toBe(false);
    });

    it('keeps the non-vendored sibling so a legitimate project copy is not over-filtered', () => {
        expect(globMatches('notethink/docstech/users/alex/todo.md', '**/{todo,done}.md', VENDORED_EXCLUDE)).toBe(true);
    });

    it('treats empty exclude as exclude-nothing', () => {
        expect(globMatches('node_modules/pkg/readme.md', '**/*.md', '')).toBe(true);
    });
});
