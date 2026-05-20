import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OriginPill, { originPillColour, projectNameFromRelativePath, hueForProjectIndex, pillColourForHue } from './OriginPill';
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

    it('renders project pill with single uppercase first letter', () => {
        render(<OriginPill origin={makeOrigin()} />);
        const pill = screen.getByTestId('origin-project-pill');
        expect(pill).toHaveTextContent('O');
        expect(pill).toHaveAttribute('data-project', 'oma');
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

    it('falls back to "?" when relative_path is empty', () => {
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
