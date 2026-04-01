import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import GenericNote from './GenericNote';
import type { NoteProps, MdastNode } from '../../types/NoteProps';

// capture enriched props from the mock
let last_markdown_props: NoteProps | undefined;

// mock lazy-loaded components
jest.mock('./MarkdownNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => { last_markdown_props = props; return <div data-testid={`markdown-${props.seq}`} data-level={props.level}>MarkdownNote</div>; },
}));

jest.mock('./CodeNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid={`code-${props.seq}`}>CodeNote</div>,
}));

jest.mock('./GenericNoteWrapper', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid={`wrapper-${props.type}-${props.seq}`}>Wrapper</div>,
}));

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 1,
        level: 1,
        type: 'heading',
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
        },
        headline_raw: '# Test',
        body_raw: '',
        ...overrides,
    };
}

describe('GenericNote', () => {
    it('renders MarkdownNote for heading type', async () => {
        render(<Suspense fallback={<div>loading</div>}><GenericNote {...makeNote({ type: 'heading' })} /></Suspense>);
        await waitFor(() => expect(screen.getByTestId('markdown-1')).toBeInTheDocument());
    });

    it('renders MarkdownNote for paragraph type', async () => {
        render(<Suspense fallback={<div>loading</div>}><GenericNote {...makeNote({ type: 'paragraph' })} /></Suspense>);
        await waitFor(() => expect(screen.getByTestId('markdown-1')).toBeInTheDocument());
    });

    it('renders CodeNote for code type', async () => {
        render(<Suspense fallback={<div>loading</div>}><GenericNote {...makeNote({ type: 'code', lang: 'js' })} /></Suspense>);
        await waitFor(() => expect(screen.getByTestId('code-1')).toBeInTheDocument());
    });

    it('renders GenericNoteWrapper for list type', () => {
        render(<GenericNote {...makeNote({ type: 'list' })} />);
        expect(screen.getByTestId('wrapper-list-1')).toBeInTheDocument();
    });

    it('renders GenericNoteWrapper for listItem type', () => {
        render(<GenericNote {...makeNote({ type: 'listItem' })} />);
        expect(screen.getByTestId('wrapper-listItem-1')).toBeInTheDocument();
    });

    it('passes enriched display_options with deepest defaults', async () => {
        render(<Suspense fallback={<div>loading</div>}><GenericNote {...makeNote({
            display_options: { deepest: { selectable_level: 2 } },
        })} /></Suspense>);
        await waitFor(() => expect(screen.getByTestId('markdown-1')).toBeInTheDocument());
    });

    it('handles note with parent_notes for level cropping', async () => {
        const parent_note = makeNote({ seq: 0, level: 1 });
        const child_note = makeNote({
            seq: 2,
            level: 3,
            parent_notes: [parent_note],
            display_options: { deepest: { selectable_level: 1 } },
        });
        render(<Suspense fallback={<div>loading</div>}><GenericNote {...child_note} /></Suspense>);
        await waitFor(() => expect(screen.getByTestId('markdown-2')).toBeInTheDocument());
    });

    it('enriches selectable_note with selected flag from cropped_selected_seqs', async () => {
        last_markdown_props = undefined;
        const note = makeNote({
            seq: 5,
            level: 2,
            display_options: {
                selected_seqs: [5],
                selected_notes: [makeNote({ seq: 5, level: 2 })],
                focused_seqs: [5],
                deepest: { selectable_level: 2 },
            },
        });
        render(<Suspense fallback={<div>loading</div>}><GenericNote {...note} /></Suspense>);
        await waitFor(() => expect(screen.getByTestId('markdown-5')).toBeInTheDocument());
        expect(last_markdown_props?.display_options?.deepest?.selectable_note?.selected).toBe(true);
        expect(last_markdown_props?.display_options?.deepest?.selectable_note?.focused).toBe(true);
    });

    it('enriches selectable_note with selected=false when not in selected_seqs', async () => {
        last_markdown_props = undefined;
        const note = makeNote({
            seq: 3,
            level: 2,
            display_options: {
                selected_seqs: [],
                selected_notes: [],
                focused_seqs: [],
                deepest: { selectable_level: 2 },
            },
        });
        render(<Suspense fallback={<div>loading</div>}><GenericNote {...note} /></Suspense>);
        await waitFor(() => expect(screen.getByTestId('markdown-3')).toBeInTheDocument());
        expect(last_markdown_props?.display_options?.deepest?.selectable_note?.selected).toBe(false);
        expect(last_markdown_props?.display_options?.deepest?.selectable_note?.focused).toBe(false);
    });
});
