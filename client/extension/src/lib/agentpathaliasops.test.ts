import { bestAliasMapping, remapUnderRoot, trailingSegmentMatchCount } from './agentpathaliasops';

describe('trailingSegmentMatchCount', () => {
    it('counts every shared trailing segment', () => {
        expect(trailingSegmentMatchCount('/mnt/secure/home/dev/git/github.com/in_development/notethink', '/home/dev/github.com/in_development/notethink')).toBe(3);
    });

    it('is zero when the final segment itself differs', () => {
        expect(trailingSegmentMatchCount('/mnt/secure/home/dev/git/github.com/in_development/notethink', '/home/dev/github.com/in_development/river')).toBe(0);
    });

    it('stops at the first mismatch walking from the end, even if an earlier segment would have matched', () => {
        expect(trailingSegmentMatchCount('/a/x/c', '/b/y/c')).toBe(1);
    });
});

describe('bestAliasMapping', () => {
    const PARENT_REAL = '/mnt/secure/home/dev/git/github.com/in_development';
    const PARENT_ALIAS = '/home/dev/github.com/in_development';

    it('maps a real path that is itself the aliased root, with no ancestor walking needed', () => {
        const real_path = `${PARENT_REAL}/notethink`;
        expect(bestAliasMapping(real_path, [`${PARENT_ALIAS}/notethink`])).toEqual({ real_root: real_path, alias_root: `${PARENT_ALIAS}/notethink` });
    });

    it('maps a real path one level inside the aliased root, the ordinary multi-project case', () => {
        const real_path = `${PARENT_REAL}/notethink`;
        expect(bestAliasMapping(real_path, [PARENT_ALIAS])).toEqual({ real_root: PARENT_REAL, alias_root: PARENT_ALIAS });
    });

    it('maps a real path two levels inside the aliased root', () => {
        const real_path = `${PARENT_REAL}/notethink/client/extension`;
        expect(bestAliasMapping(real_path, [PARENT_ALIAS])).toEqual({ real_root: PARENT_REAL, alias_root: PARENT_ALIAS });
    });

    it('excludes a candidate the real path already matches by ordinary prefix, since nothing needs aliasing there', () => {
        const real_path = `${PARENT_REAL}/notethink`;
        expect(bestAliasMapping(real_path, [PARENT_REAL, `${PARENT_ALIAS}/notethink`])).toEqual({ real_root: real_path, alias_root: `${PARENT_ALIAS}/notethink` });
    });

    it('returns undefined when no candidate shares even the final segment', () => {
        expect(bestAliasMapping(`${PARENT_REAL}/notethink`, ['/home/dev/github.com/in_development/river'])).toBeUndefined();
    });

    it('prefers the candidate with the longer trailing match over one that only shares the last segment', () => {
        const real_path = `${PARENT_REAL}/notethink`;
        const shallow = '/other/notethink';
        expect(bestAliasMapping(real_path, [shallow, `${PARENT_ALIAS}/notethink`])).toEqual({ real_root: real_path, alias_root: `${PARENT_ALIAS}/notethink` });
    });

    it('breaks a tie between equally-matching candidates alphabetically, so the choice is deterministic', () => {
        const real_path = `${PARENT_REAL}/notethink`;
        const a = '/aaa/in_development/notethink';
        const b = '/bbb/in_development/notethink';
        expect(bestAliasMapping(real_path, [b, a])).toEqual({ real_root: real_path, alias_root: a });
    });

    it('picks the best pairing across several candidate roots at once', () => {
        const real_path = `${PARENT_REAL}/notethink/client`;
        const unrelated = '/var/backups/client';
        const sibling_project = `${PARENT_ALIAS}/river`;
        expect(bestAliasMapping(real_path, [unrelated, sibling_project, PARENT_ALIAS])).toEqual({ real_root: PARENT_REAL, alias_root: PARENT_ALIAS });
    });

    it('prefers the deepest ancestor when the same candidate matches more than one at an equal count', () => {
        const real_path = '/a/b/b/b';
        const root = '/x/y/b';
        expect(bestAliasMapping(real_path, [root])).toEqual({ real_root: real_path, alias_root: root });
    });
});

describe('remapUnderRoot', () => {
    it('rewrites a path under the real root onto the alias root', () => {
        expect(remapUnderRoot('/mnt/secure/home/dev/notethink/docstech/todo.md', '/mnt/secure/home/dev/notethink', '/home/dev/notethink'))
            .toBe('/home/dev/notethink/docstech/todo.md');
    });

    it('rewrites the root path itself', () => {
        expect(remapUnderRoot('/mnt/secure/home/dev/notethink', '/mnt/secure/home/dev/notethink', '/home/dev/notethink')).toBe('/home/dev/notethink');
    });

    it('leaves a path untouched when it is not under the real root at all', () => {
        expect(remapUnderRoot('/elsewhere/file.md', '/mnt/secure/home/dev/notethink', '/home/dev/notethink')).toBe('/elsewhere/file.md');
    });

    it('does not treat a sibling directory sharing a name prefix as under the root', () => {
        expect(remapUnderRoot('/mnt/secure/home/dev/notethink-other/file.md', '/mnt/secure/home/dev/notethink', '/home/dev/notethink'))
            .toBe('/mnt/secure/home/dev/notethink-other/file.md');
    });
});
