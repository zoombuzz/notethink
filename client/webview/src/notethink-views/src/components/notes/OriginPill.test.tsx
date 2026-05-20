import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OriginPill, { buildProjectLabels, hueForProjectIndex, originPillColour, pillColourForHue, projectAbbreviation, projectNameFromRelativePath } from './OriginPill';
import type { NoteOrigin } from '../../types/NoteProps';

describe('originPillColour', () => {

    it('returns hsl string with theme-appropriate lightness', () => {
        const dark = originPillColour('oma', 'dark');
        const light = originPillColour('oma', 'light');
        expect(dark).toMatch(/^hsl\(\d+ 65% 32%\)$/);
        expect(light).toMatch(/^hsl\(\d+ 65% 72%\)$/);
    });

    it('is deterministic for the same project name', () => {
        const a = originPillColour('notegit', 'dark');
        const b = originPillColour('notegit', 'dark');
        expect(a).toBe(b);
    });

    it('produces distinct hues for projects sharing a first letter (notegit vs notethink)', () => {
        const a = originPillColour('notegit', 'dark');
        const b = originPillColour('notethink', 'dark');
        expect(a).not.toBe(b);
        const huesA = a.match(/hsl\((\d+)/)![1];
        const huesB = b.match(/hsl\((\d+)/)![1];
        expect(huesA).not.toBe(huesB);
    });

    it('hashes are spread across the spectrum across many project names', () => {
        const names = ['oma', 'notegit', 'notethink', 'countingsheet', 'calfam', 'zoombuzz', 'dulcet'];
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
        // simulates the real-world case the user hit: alphabetical sort of every project in active_development
        const sorted_names = ['calfam', 'countingsheet', 'flynn', 'lightenna-iac', 'notegit', 'notethink', 'oma', 'shopify-uncomplicated'];
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
        expect(projectAbbreviation('countingsheet')).toBe('CO');
        expect(projectAbbreviation('notegit')).toBe('NO');
        expect(projectAbbreviation('oma')).toBe('OM');
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
        const labels = buildProjectLabels(['countingsheet']);
        expect(labels.get('countingsheet')).toBe('CO');
    });

    it('picks the earliest differentiating character for prefix-colliding names', () => {
        const labels = buildProjectLabels(['notegit', 'notethink']);
        expect(labels.get('notegit')).toBe('NG');
        expect(labels.get('notethink')).toBe('NT');
    });

    it('handles three-way collisions by walking to the first unique position', () => {
        const labels = buildProjectLabels(['notegit', 'notethink', 'notes']);
        expect(labels.get('notegit')).toBe('NG');
        expect(labels.get('notethink')).toBe('NT');
        expect(labels.get('notes')).toBe('NS');
    });

    it('falls back to the second character when a name is a strict prefix of another', () => {
        const labels = buildProjectLabels(['note', 'notes']);
        expect(labels.get('note')).toBe('NO');
        expect(labels.get('notes')).toBe('NS');
    });

    it('emits a single uppercase letter for 1-char names', () => {
        const labels = buildProjectLabels(['a', 'ab']);
        expect(labels.get('a')).toBe('A');
        expect(labels.get('ab')).toBe('AB');
    });

    it('skips empties and de-duplicates', () => {
        const labels = buildProjectLabels(['', 'oma', 'oma']);
        expect(labels.has('')).toBe(false);
        expect(labels.get('oma')).toBe('OM');
        expect(labels.size).toBe(1);
    });

    it('produces correct labels for the real workspace project list', () => {
        const names = ['calfam', 'countingsheet', 'flynn', 'lightenna-iac', 'notegit', 'notethink', 'oma', 'shopify-uncomplicated'];
        const labels = buildProjectLabels(names);
        // every initial in this set is distinct (no prefix collisions), so each label is just first + second char
        expect(labels.get('calfam')).toBe('CA');
        expect(labels.get('countingsheet')).toBe('CO');
        expect(labels.get('flynn')).toBe('FL');
        expect(labels.get('lightenna-iac')).toBe('LI');
        expect(labels.get('notegit')).toBe('NG');
        expect(labels.get('notethink')).toBe('NT');
        expect(labels.get('oma')).toBe('OM');
        expect(labels.get('shopify-uncomplicated')).toBe('SH');
    });
});

describe('projectNameFromRelativePath', () => {
    it('takes the first path segment', () => {
        expect(projectNameFromRelativePath('oma/docstech/users/alex/todo.md')).toBe('oma');
    });
    it('handles single-segment paths', () => {
        expect(projectNameFromRelativePath('todo.md')).toBe('todo.md');
    });
    it('handles undefined', () => {
        expect(projectNameFromRelativePath(undefined)).toBe('');
    });
});

describe('OriginPill rendering', () => {

    const makeOrigin = (overrides: Partial<NoteOrigin> = {}): NoteOrigin => ({
        doc_id: 'id-oma',
        doc_path: '/repo/oma/docstech/users/alex/todo.md',
        relative_path: 'oma/docstech/users/alex/todo.md',
        ...overrides,
    });

    it('renders project pill with two uppercase letters from the project name', () => {
        render(<OriginPill origin={makeOrigin()} />);
        const pill = screen.getByTestId('origin-project-pill');
        expect(pill).toHaveTextContent('OM');
        expect(pill).toHaveAttribute('data-project', 'oma');
    });

    it('prefers origin.project_label over the single-project fallback', () => {
        render(<OriginPill origin={makeOrigin({ project_label: 'NG' })} />);
        expect(screen.getByTestId('origin-project-pill')).toHaveTextContent('NG');
    });

    it('full relative_path is exposed as tooltip', () => {
        render(<OriginPill origin={makeOrigin()} />);
        const pill = screen.getByTestId('origin-project-pill');
        expect(pill).toHaveAttribute('title', 'oma/docstech/users/alex/todo.md');
    });

    it('click handler fires with stopPropagation', () => {
        const handler = jest.fn();
        render(<OriginPill origin={makeOrigin()} onClick={handler} />);
        const pill = screen.getByTestId('origin-project-pill');
        fireEvent.click(pill);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('renders epic pill when origin.epic is set', () => {
        render(<OriginPill origin={makeOrigin({ epic: { name: 'Phase 3', id: 'p3' } })} />);
        expect(screen.getByTestId('origin-epic-pill')).toHaveTextContent('Phase 3');
        expect(screen.getByTestId('origin-epic-pill')).toHaveAttribute('data-epic-id', 'p3');
    });

    it('no epic pill when origin.epic is undefined', () => {
        render(<OriginPill origin={makeOrigin()} />);
        expect(screen.queryByTestId('origin-epic-pill')).toBeNull();
    });

    it('falls back to "?" when relative_path is empty and no label stamped', () => {
        render(<OriginPill origin={makeOrigin({ relative_path: undefined })} />);
        expect(screen.getByTestId('origin-project-pill')).toHaveTextContent('?');
    });

    it('uses origin.project_hue when present, ignoring the djb2 hash', () => {
        // pick a hue that djb2 of "oma" would not produce so we can prove which path ran
        const explicit_hue = 200;
        render(<OriginPill origin={makeOrigin({ project_hue: explicit_hue })} />);
        const pill = screen.getByTestId('origin-project-pill');
        expect(pill).toHaveStyle({ backgroundColor: `hsl(${explicit_hue} 65% 32%)` });
    });
});
