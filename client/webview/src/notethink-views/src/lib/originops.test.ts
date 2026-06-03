import { buildProjectLabels, hueForProjectIndex, originPillColour, pillColourForHue, projectAbbreviation, projectFolderFromOrigin, projectNameFromRelativePath } from './originops';
import type { NoteOrigin } from '../types/NoteProps';

describe('originPillColour', () => {

    it('returns hsl string with theme-appropriate lightness', () => {
        const dark = originPillColour('mira', 'dark');
        const light = originPillColour('mira', 'light');
        expect(dark).toMatch(/^hsl\(\d+ 65% 32%\)$/);
        expect(light).toMatch(/^hsl\(\d+ 65% 72%\)$/);
    });

    it('is deterministic for the same project name', () => {
        const a = originPillColour('lunagate', 'dark');
        const b = originPillColour('lunagate', 'dark');
        expect(a).toBe(b);
    });

    it('produces distinct hues for projects sharing a first letter (lunagate vs lunatide)', () => {
        const a = originPillColour('lunagate', 'dark');
        const b = originPillColour('lunatide', 'dark');
        expect(a).not.toBe(b);
        const huesA = a.match(/hsl\((\d+)/)![1];
        const huesB = b.match(/hsl\((\d+)/)![1];
        expect(huesA).not.toBe(huesB);
    });

    it('hashes are spread across the spectrum across many project names', () => {
        const names = ['mira', 'lunagate', 'lunatide', 'cygnus', 'carina', 'zenith', 'draco'];
        const hues = new Set(names.map(n => Number(originPillColour(n, 'dark').match(/hsl\((\d+)/)![1])));
        expect(hues.size).toBeGreaterThanOrEqual(names.length - 1); // allow at most one collision
    });
});

describe('hueForProjectIndex', () => {
    it('returns a value in [0, 360)', () => {
        for (const i of [0, 1, 5, 100]) {
            const hue = hueForProjectIndex(i);
            expect(hue).toBeGreaterThanOrEqual(0);
            expect(hue).toBeLessThan(360);
        }
    });

    it('is deterministic per index', () => {
        expect(hueForProjectIndex(3)).toBe(hueForProjectIndex(3));
    });

    it('produces well-spread hues for the workspace project list (all gaps ≥ 30°)', () => {
        // simulates the real-world case the user hit: alphabetical sort of every project in the workspace
        const sorted_names = ['carina', 'cygnus', 'fornax', 'izar', 'lunagate', 'lunatide', 'mira', 'sculptor'];
        const hues = sorted_names.map((_, i) => hueForProjectIndex(i)).sort((a, b) => a - b);
        for (let i = 0; i < hues.length - 1; i++) {
            const gap = hues[i + 1] - hues[i];
            expect(gap).toBeGreaterThanOrEqual(30);
        }
        // wrap-around gap between last and first too
        const wrap_gap = 360 - hues[hues.length - 1] + hues[0];
        expect(wrap_gap).toBeGreaterThanOrEqual(30);
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
        // lunagate/lunatide share the 'luna' prefix, so they diverge at the first differentiating
        // character (LG/LT); every other name's first two characters are already unique, so its
        // label is just first + second char
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
