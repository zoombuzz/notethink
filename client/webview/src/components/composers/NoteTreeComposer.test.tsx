import React from 'react';
import { render } from '@testing-library/react';
import type { Root as MdastRoot } from 'mdast';
import type { Doc } from '../../types/general';
import type { ViewProps } from '../../notethink-views/src/types/ViewProps';
import type { NoteRendererProps } from '../NoteRenderer';

// capture GenericView props for assertion
const captured_props: ViewProps[] = [];

jest.mock('../../notethink-views/src/components', () => ({
    GenericView: (props: ViewProps) => {
        captured_props.push(props);
        return <div data-testid={`docview-${props.id}`}>GenericView</div>;
    },
}));

// mock the conversion + stable_id stamping so we can run without a real MDAST tree
jest.mock('../../notethink-views/src/lib/convertMdastToNoteHierarchy', () => ({
    convertMdastToNoteHierarchy: jest.fn(() => ({
        seq: 0,
        level: 0,
        type: 'root',
        position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 2 } },
        children: [],
        children_body: [],
        headline_raw: '',
        body_raw: '',
    })),
}));

jest.mock('../../notethink-views/src/lib/mergeAggregateRoot', () => ({
    ...jest.requireActual('../../notethink-views/src/lib/mergeAggregateRoot'),
    stampSingleFileStableIds: jest.fn(),
    flattenSingleFileStories: jest.fn(),
}));

// import after mocks
import NoteTreeComposer from './NoteTreeComposer';
import { flattenSingleFileStories } from '../../notethink-views/src/lib/mergeAggregateRoot';

function buildDoc(): Doc {
    return {
        id: 'doc-1',
        path: '/repo/sub/file.md',
        relative_path: 'sub/file.md',
        text: '# Hello',
        hash_sha256: 'abc123',
        content: { type: 'root', children: [] } as MdastRoot,
    };
}

function buildProps(overrides: Partial<NoteRendererProps> = {}): NoteRendererProps {
    return {
        notes: {},
        ...overrides,
    };
}

describe('NoteTreeComposer', () => {

    beforeEach(() => {
        captured_props.length = 0;
        (flattenSingleFileStories as jest.Mock).mockClear();
    });

    it('descends to story cards when the file renders as a kanban board (kanban viewType), keyed to the doc id + path', () => {
        const note = buildDoc();
        render(<NoteTreeComposer note_id="doc-1" note={note} props={buildProps({ viewStates: { 'doc-1': { type: 'kanban' } } })} />);
        expect(flattenSingleFileStories).toHaveBeenCalledTimes(1);
        // the descent receives the composer's converted root, the doc id, and the doc path so stories route + stamp against the one open file
        expect(flattenSingleFileStories).toHaveBeenCalledWith(expect.objectContaining({ type: 'root' }), 'doc-1', '/repo/sub/file.md');
    });

    it('does NOT descend a plain document (no kanban view) so its ## structure + prose are preserved', () => {
        const note = buildDoc();
        // no viewState type and the mocked root declares no nt_view -> resolves to document, must stay structured
        render(<NoteTreeComposer note_id="doc-1" note={note} props={buildProps()} />);
        expect(flattenSingleFileStories).not.toHaveBeenCalled();
    });

    it('stamps integration_mode=current_file on the rendered view display_options', () => {
        const note = buildDoc();
        render(<NoteTreeComposer note_id="doc-1" note={note} props={buildProps()} />);
        expect(captured_props).toHaveLength(1);
        expect(captured_props[0].display_options?.integration_mode).toBe('current_file');
        expect(captured_props[0].display_options?.integration_path).toBeUndefined();
    });

    it('overrides a stranded `folder` integration_mode on the per-doc viewState', () => {
        // legacy: the per-doc viewState was once stamped with `folder` by the pre-fix dispatch bug; the composer must surface `current_file` on its render regardless
        const note = buildDoc();
        const view_states = {
            'doc-1': { display_options: { integration_mode: 'folder', integration_path: '/repo/sub' } },
        };
        render(<NoteTreeComposer note_id="doc-1" note={note} props={buildProps({ viewStates: view_states })} />);
        expect(captured_props[0].display_options?.integration_mode).toBe('current_file');
        expect(captured_props[0].display_options?.integration_path).toBeUndefined();
    });

    it('threads view_state_ids through to the rendered ViewProps so the toolbar can clear stranded tags', () => {
        const note = buildDoc();
        const view_states = {
            '__folder__': { display_options: { integration_mode: 'current_file' } },
            'doc-1': { display_options: { } },
            '__default': { display_options: { } },
        };
        render(<NoteTreeComposer note_id="doc-1" note={note} props={buildProps({ viewStates: view_states })} />);
        expect(captured_props[0].view_state_ids).toEqual(expect.arrayContaining(['__folder__', 'doc-1', '__default']));
    });

});
