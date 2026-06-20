import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OriginPill from './OriginPill';
import { hueForProjectName, pillColourForHue } from '../../lib/originops';
import type { NoteOrigin } from '../../types/NoteProps';

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

    it('click handler fires when the pill is clicked', () => {
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

    it('uses origin.project_hue directly when present, overriding the hueForProjectName fallback', () => {
        // pick a hue that hueForProjectName('oma') would not produce so we can prove which path ran
        const explicit_hue = 200;
        render(<OriginPill origin={makeOrigin({ project_hue: explicit_hue })} />);
        const pill = screen.getByTestId('origin-project-pill');
        expect(pill).toHaveStyle({ backgroundColor: `hsl(${explicit_hue} 65% 32%)` });
    });

    it('with project_hue undefined, backgroundColor equals pillColourForHue(hueForProjectName(project_name), theme)', () => {
        // single-file and folder mode must agree: when project_hue is absent, the colour derives from hueForProjectName
        const origin = makeOrigin({ project_hue: undefined });
        render(<OriginPill origin={origin} />);
        const pill = screen.getByTestId('origin-project-pill');
        const project_name = 'oma';
        const expected_colour = pillColourForHue(hueForProjectName(project_name), 'dark');
        expect(pill).toHaveStyle({ backgroundColor: expected_colour });
    });

    describe('epicOnly (single-file story cards: epic chip, no project pill)', () => {
        // a minimal single-file story origin: doc_id + doc_path + epic, no project metadata
        const minimalOrigin = (epic?: NoteOrigin['epic']): NoteOrigin => ({ doc_id: 'doc-1', doc_path: '/repo/project.md', epic });

        it('suppresses the project pill and renders only the epic chip', () => {
            render(<OriginPill origin={minimalOrigin({ name: 'Storefront', id: 'sf' })} epicOnly />);
            expect(screen.queryByTestId('origin-project-pill')).toBeNull();
            expect(screen.getByTestId('origin-epic-pill')).toHaveTextContent('Storefront');
        });

        it('still carries the epic id on the chip when epicOnly', () => {
            render(<OriginPill origin={minimalOrigin({ name: 'Storefront', id: 'sf' })} epicOnly />);
            expect(screen.getByTestId('origin-epic-pill')).toHaveAttribute('data-epic-id', 'sf');
        });

        it('default (epicOnly absent) keeps rendering the project pill', () => {
            render(<OriginPill origin={makeOrigin({ epic: { name: 'Phase 3' } })} />);
            expect(screen.getByTestId('origin-project-pill')).toBeInTheDocument();
            expect(screen.getByTestId('origin-epic-pill')).toHaveTextContent('Phase 3');
        });
    });
});
