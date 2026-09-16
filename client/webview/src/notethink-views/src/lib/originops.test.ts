import { buildProjectLabels, detectVscodeTheme, hueForOrigin, hueForProjectName, originHasProject, pillColourForHue, projectAbbreviation, projectFolderFromOrigin, projectNameFromRelativePath } from './originops';
import type { NoteOrigin } from '../types/NoteProps';

describe('detectVscodeTheme', () => {

    afterEach(() => {
        document.body.className = '';
    });

    it('reads a body with no theme class as dark', () => {
        expect(detectVscodeTheme()).toBe('dark');
    });

    it('reads the light and high-contrast light body classes as light', () => {
        document.body.className = 'vscode-light';
        expect(detectVscodeTheme()).toBe('light');
        document.body.className = 'vscode-high-contrast-light';
        expect(detectVscodeTheme()).toBe('light');
    });

    it('reads the dark and high-contrast body classes as dark', () => {
        document.body.className = 'vscode-dark';
        expect(detectVscodeTheme()).toBe('dark');
        document.body.className = 'vscode-high-contrast';
        expect(detectVscodeTheme()).toBe('dark');
    });

    it('ignores the attribute nothing in notethink sets', () => {
        document.documentElement.setAttribute('data-mantine-color-scheme', 'light');
        expect(detectVscodeTheme()).toBe('dark');
        document.documentElement.removeAttribute('data-mantine-color-scheme');
    });
});

describe('hueForOrigin', () => {

    it('uses the stamped project_hue when present, ahead of any name hash', () => {
        const origin: NoteOrigin = { doc_id: 'a', doc_path: '/ws/orbit/todo.md', relative_path: 'orbit/todo.md', project_hue: 7 };
        expect(hueForOrigin(origin)).toBe(7);
    });

    it('derives the hue from the project name when no project_hue is stamped', () => {
        const origin: NoteOrigin = { doc_id: 'a', doc_path: '/ws/sculptor/todo.md', relative_path: 'sculptor/todo.md' };
        expect(hueForOrigin(origin)).toBe(hueForProjectName('sculptor'));
    });

    it('falls back to hashing the doc path when there is no project name', () => {
        const origin: NoteOrigin = { doc_id: 'a', doc_path: '/ws/todo.md' };
        expect(hueForOrigin(origin)).toBe(hueForProjectName('/ws/todo.md'));
    });

    it('agrees between a stamped folder origin and an unstamped one for the same project', () => {
        const stamped: NoteOrigin = { doc_id: 'a', doc_path: '/ws/lunagate/todo.md', relative_path: 'lunagate/todo.md', project_hue: hueForProjectName('lunagate') };
        const unstamped: NoteOrigin = { doc_id: 'b', doc_path: '/ws/lunagate/done.md', relative_path: 'lunagate/done.md' };
        expect(hueForOrigin(stamped)).toBe(hueForOrigin(unstamped));
    });

    it('spreads distinct projects across the spectrum', () => {
        const names = ['mira', 'lunagate', 'lunatide', 'cygnus', 'carina', 'zenith', 'draco'];
        const hues = new Set(names.map(n => hueForOrigin({ doc_id: n, doc_path: `/ws/${n}/todo.md`, relative_path: `${n}/todo.md` })));
        // allow at most one collision
        expect(hues.size).toBeGreaterThanOrEqual(names.length - 1);
    });
});

describe('originHasProject', () => {

    it('is false with no origin at all', () => {
        expect(originHasProject(undefined)).toBe(false);
    });

    it('is false for a single-file origin carrying only an epic', () => {
        expect(originHasProject({ doc_id: 'a', doc_path: '/ws/todo.md', epic: { name: 'Launch' } })).toBe(false);
    });

    it('is true for any one of relative_path, project_label or project_hue', () => {
        expect(originHasProject({ doc_id: 'a', doc_path: '/ws/orbit/todo.md', relative_path: 'orbit/todo.md' })).toBe(true);
        expect(originHasProject({ doc_id: 'a', doc_path: '/ws/todo.md', project_label: 'OR' })).toBe(true);
        expect(originHasProject({ doc_id: 'a', doc_path: '/ws/todo.md', project_hue: 0 })).toBe(true);
    });
});

describe('hueForProjectName', () => {
    it('returns a value in [0, 359]', () => {
        for (const name of ['mira', 'lunagate', 'carina', 'x', '']) {
            const hue = hueForProjectName(name);
            expect(hue).toBeGreaterThanOrEqual(0);
            expect(hue).toBeLessThan(360);
        }
    });

    it('is deterministic - same name always produces the same hue', () => {
        expect(hueForProjectName('lunagate')).toBe(hueForProjectName('lunagate'));
        expect(hueForProjectName('notethink')).toBe(hueForProjectName('notethink'));
    });

    it('is set-independent - result does not depend on which other projects are present', () => {
        // calling with no context vs calling after building a universe for other projects must give the same hue
        const hue_alone = hueForProjectName('notethink');
        // simulate "other projects have been processed first" by calling hueForProjectName for them
        hueForProjectName('cobalt');
        hueForProjectName('notebook');
        const hue_after = hueForProjectName('notethink');
        expect(hue_alone).toBe(hue_after);
    });

});

describe('pillColourForHue', () => {
    it('returns hsl with theme-appropriate lightness', () => {
        expect(pillColourForHue(123, 'dark')).toBe('hsl(123 65% 32%)');
        expect(pillColourForHue(123, 'light')).toBe('hsl(123 65% 72%)');
    });
});

describe('projectAbbreviation', () => {
    it('returns first + second char uppercased for a normal name', () => {
        expect(projectAbbreviation('cygnus')).toBe('CY');
        expect(projectAbbreviation('lunagate')).toBe('LU');
        expect(projectAbbreviation('mira')).toBe('MI');
    });
    it('returns single letter for a 1-char name', () => {
        expect(projectAbbreviation('a')).toBe('A');
    });
    it('returns "?" for undefined or empty', () => {
        expect(projectAbbreviation(undefined)).toBe('?');
        expect(projectAbbreviation('')).toBe('?');
    });
});

describe('buildProjectLabels', () => {
    it('uses the second character when there is no collision', () => {
        const labels = buildProjectLabels(['cygnus']);
        expect(labels.get('cygnus')).toBe('CY');
    });

    it('picks the earliest differentiating character for prefix-colliding names', () => {
        const labels = buildProjectLabels(['lunagate', 'lunatide']);
        expect(labels.get('lunagate')).toBe('LG');
        expect(labels.get('lunatide')).toBe('LT');
    });

    it('handles three-way collisions by walking to the first unique position', () => {
        const labels = buildProjectLabels(['lunagate', 'lunatide', 'lunas']);
        expect(labels.get('lunagate')).toBe('LG');
        expect(labels.get('lunatide')).toBe('LT');
        expect(labels.get('lunas')).toBe('LS');
    });

    it('falls back to the second character when a name is a strict prefix of another', () => {
        const labels = buildProjectLabels(['luna', 'lunas']);
        expect(labels.get('luna')).toBe('LU');
        expect(labels.get('lunas')).toBe('LS');
    });

    it('emits a single uppercase letter for 1-char names', () => {
        const labels = buildProjectLabels(['a', 'ab']);
        expect(labels.get('a')).toBe('A');
        expect(labels.get('ab')).toBe('AB');
    });

    it('skips empties and de-duplicates', () => {
        const labels = buildProjectLabels(['', 'mira', 'mira']);
        expect(labels.has('')).toBe(false);
        expect(labels.get('mira')).toBe('MI');
        expect(labels.size).toBe(1);
    });

    it('produces correct labels for the real workspace project list', () => {
        const names = ['carina', 'cygnus', 'fornax', 'izar', 'lunagate', 'lunatide', 'mira', 'sculptor'];
        const labels = buildProjectLabels(names);
        // lunagate/lunatide share the 'luna' prefix, so they diverge at the first differentiating character (LG/LT); every other name's first two characters are already unique, so its label is just first + second char
        expect(labels.get('carina')).toBe('CA');
        expect(labels.get('cygnus')).toBe('CY');
        expect(labels.get('fornax')).toBe('FO');
        expect(labels.get('izar')).toBe('IZ');
        expect(labels.get('lunagate')).toBe('LG');
        expect(labels.get('lunatide')).toBe('LT');
        expect(labels.get('mira')).toBe('MI');
        expect(labels.get('sculptor')).toBe('SC');
    });
});

describe('projectNameFromRelativePath', () => {
    it('takes the first path segment', () => {
        expect(projectNameFromRelativePath('mira/docstech/users/alex/todo.md')).toBe('mira');
    });
    it('handles single-segment paths', () => {
        expect(projectNameFromRelativePath('todo.md')).toBe('todo.md');
    });
    it('handles undefined', () => {
        expect(projectNameFromRelativePath(undefined)).toBe('');
    });
});

describe('projectFolderFromOrigin', () => {
    const makeOrigin = (overrides: Partial<NoteOrigin> = {}): NoteOrigin => ({
        doc_id: 'd',
        doc_path: '/abs/workspace/lunatide/docstech/users/alex/todo.md',
        relative_path: 'lunatide/docstech/users/alex/todo.md',
        ...overrides,
    } as NoteOrigin);

    it('returns workspace_root + first segment for a multi-segment relative_path', () => {
        expect(projectFolderFromOrigin(makeOrigin())).toBe('/abs/workspace/lunatide');
    });

    it('handles a different project in the same workspace symmetrically', () => {
        expect(projectFolderFromOrigin(makeOrigin({
            doc_path: '/abs/workspace/mira/server/src/index.md',
            relative_path: 'mira/server/src/index.md',
        }))).toBe('/abs/workspace/mira');
    });

    it('returns empty string for a workspace-folder-root file (no sub-segment to descend into)', () => {
        expect(projectFolderFromOrigin(makeOrigin({
            doc_path: '/abs/workspace/README.md',
            relative_path: 'README.md',
        }))).toBe('');
    });

    it('returns empty string when relative_path is missing', () => {
        expect(projectFolderFromOrigin(makeOrigin({ relative_path: undefined }))).toBe('');
    });

    it('returns empty string when doc_path does not actually end with relative_path (defensive)', () => {
        expect(projectFolderFromOrigin(makeOrigin({
            doc_path: '/abs/workspace/lunatide/docstech/users/alex/todo.md',
            relative_path: 'mira/docstech/users/alex/todo.md',
        }))).toBe('');
    });
});
