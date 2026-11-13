import React from 'react';
import { render } from '@testing-library/react';
import type { Root as MdastRoot } from 'mdast';
import { DEFAULT_SETTINGS_CASCADE } from '../../constants';
import type { Doc } from '../../types/general';
import type { SettingsCascadePayload } from '../../notethink-views/src/types/Messages';
import type { ViewProps } from '../../notethink-views/src/types/ViewProps';
import type { NoteRendererProps } from '../NoteRenderer';

function buildCascade(overrides: Partial<SettingsCascadePayload> = {}): SettingsCascadePayload {
    return { ...DEFAULT_SETTINGS_CASCADE, ...overrides };
}

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
        // the converted root, doc id and doc path let stories route and stamp against the one open file
        expect(flattenSingleFileStories).toHaveBeenCalledWith(expect.objectContaining({ type: 'root' }), 'doc-1', '/repo/sub/file.md');
    });

    it('descends to story cards for a saved type parented on kanban, not just the literal "kanban" id', () => {
        const note = buildDoc();
        render(<NoteTreeComposer
            note_id="doc-1"
            note={note}
            props={buildProps({
                viewStates: { 'doc-1': { type: 'user-kanban-copy' } },
                settingsCascade: buildCascade({ views: { 'user-kanban-copy': { parent: 'kanban', label: 'Kanban copy' } } }),
            })}
        />);
        expect(flattenSingleFileStories).toHaveBeenCalledTimes(1);
        expect(flattenSingleFileStories).toHaveBeenCalledWith(expect.objectContaining({ type: 'root' }), 'doc-1', '/repo/sub/file.md');
    });

    it('does NOT descend a saved type parented on document, since its chain never passes through kanban', () => {
        const note = buildDoc();
        render(<NoteTreeComposer
            note_id="doc-1"
            note={note}
            props={buildProps({
                viewStates: { 'doc-1': { type: 'user-document-copy' } },
                settingsCascade: buildCascade({ views: { 'user-document-copy': { parent: 'document', label: 'Document copy' } } }),
            })}
        />);
        expect(flattenSingleFileStories).not.toHaveBeenCalled();
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
        // the composer surfaces `current_file` regardless of a stranded `folder` value on the per-doc viewState
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

    describe('second pane', () => {
        it('renders a single pane and no handle while the second pane has no view-state entry', () => {
            const { queryByTestId } = render(<NoteTreeComposer note_id="doc-1" note={buildDoc()} props={buildProps()} />);
            expect(captured_props.map(p => p.id)).toEqual(['doc-1']);
            expect(queryByTestId('split-handle')).toBeNull();
        });

        it('mounts a second GenericView that reads its own view-state entry, not the first pane\'s', () => {
            const view_states = { 'doc-1': { type: 'kanban' }, '__pane2__': { type: 'document', display_options: { split_ratio: 0.4 } } };
            const { getByTestId } = render(<NoteTreeComposer note_id="doc-1" note={buildDoc()} props={buildProps({ viewStates: view_states })} />);
            const first = captured_props.find(p => p.id === 'doc-1');
            const second = captured_props.find(p => p.id === '__pane2__');
            expect(first?.type).toBe('kanban');
            expect(second?.type).toBe('document');
            expect(getByTestId('split-handle')).toBeTruthy();
            // the first pane's board flattening does not leak into the second pane's own conversion
            expect(flattenSingleFileStories).toHaveBeenCalledTimes(1);
        });

        it('does not hand the second pane the shared keyboard navigation ref', () => {
            const nav_ref = { current: undefined };
            render(<NoteTreeComposer note_id="doc-1" note={buildDoc()} props={buildProps({ viewStates: { '__pane2__': { type: 'document' } }, onNavigationCommand: nav_ref })} />);
            expect(captured_props.find(p => p.id === 'doc-1')?.handlers?.onNavigationCommand).toBe(nav_ref);
            expect(captured_props.find(p => p.id === '__pane2__')?.handlers?.onNavigationCommand).toBeUndefined();
        });

        it('wires deleteViewFromManagedState so closing the pane removes exactly its entry', () => {
            const remove = jest.fn();
            render(<NoteTreeComposer note_id="doc-1" note={buildDoc()} props={buildProps({ viewStates: { '__pane2__': { type: 'document' } }, deleteViewFromManagedState: remove })} />);
            captured_props.find(p => p.id === '__pane2__')?.handlers?.deleteViewFromManagedState('__pane2__');
            expect(remove).toHaveBeenCalledWith('__pane2__');
        });
    });

});
