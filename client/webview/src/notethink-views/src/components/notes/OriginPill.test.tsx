import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OriginPill, { originPillColour, projectNameFromRelativePath } from './OriginPill';
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
});
