import React from 'react';
import { render } from '@testing-library/react';
import { parse } from '../../lib/parseops';
import type { ViewProps } from '../../notethink-views/src/types/ViewProps';
import type { Doc, HashMapOf } from '../../types/general';
import type { NoteRendererProps } from '../NoteRenderer';

// capture GenericView props for assertion
const captured_props: ViewProps[] = [];

jest.mock('../../notethink-views/src/components', () => ({
    GenericView: (props: ViewProps) => {
        captured_props.push(props);
        return <div data-testid={`folderview-${props.id}`}>GenericView</div>;
    },
}));

// import after the mock
import FolderTreeComposer from './FolderTreeComposer';

const INTEGRATION_PATH = '/workspace';
const TEXT = '# File [](?nt_view=kanban)\n\n### Story 1\n\n+ [ ] task one\n';

function textOnlyDoc(): Doc {
    return { id: 'doc-1', path: `${INTEGRATION_PATH}/todo.md`, relative_path: 'todo.md', text: TEXT, hash_sha256: 'h1' };
}

function withParsedContent(doc: Doc): Doc {
    return { ...doc, content: parse(doc.text!) };
}

function buildProps(overrides: Partial<NoteRendererProps> = {}): NoteRendererProps {
    return { notes: {}, ...overrides };
}

describe('FolderTreeComposer', () => {

    beforeEach(() => {
        captured_props.length = 0;
    });

    it('a text-only doc contributes no stories until its worker/fallback parse fills in content', () => {
        const docs: HashMapOf<Doc> = { 'doc-1': textOnlyDoc() };
        const { rerender } = render(<FolderTreeComposer docs={docs} integration_path={INTEGRATION_PATH} props={buildProps()} />);
        expect(captured_props[captured_props.length - 1].note_count).toBe(0);

        // same doc id and hash, content now attached - the merge memo's key must notice this transition
        const parsed_docs: HashMapOf<Doc> = { 'doc-1': withParsedContent(docs['doc-1']) };
        rerender(<FolderTreeComposer docs={parsed_docs} integration_path={INTEGRATION_PATH} props={buildProps()} />);

        expect(captured_props[captured_props.length - 1].note_count).toBe(1);
    });
    it('renders one pane, then a second over the same merged tree once the second pane has an entry', () => {
        const docs: HashMapOf<Doc> = { 'doc-1': withParsedContent(textOnlyDoc()) };
        const view_states = { '__folder__': { type: 'kanban' }, '__pane2__': { type: 'document', display_options: { split_ratio: 0.3 } } };
        const { rerender, queryByTestId } = render(<FolderTreeComposer docs={docs} integration_path={INTEGRATION_PATH} props={buildProps()} />);
        expect(captured_props.map(p => p.id)).toEqual(['__folder__']);
        expect(queryByTestId('split-handle')).toBeNull();

        captured_props.length = 0;
        rerender(<FolderTreeComposer docs={docs} integration_path={INTEGRATION_PATH} props={buildProps({ viewStates: view_states })} />);
        const first = captured_props.find(p => p.id === '__folder__');
        const second = captured_props.find(p => p.id === '__pane2__');
        expect(first?.type).toBe('kanban');
        expect(second?.type).toBe('document');
        // one merge serves both panes, so they hold the identical note list
        expect(second?.notes).toBe(first?.notes);
        expect(second?.display_options?.integration_mode).toBe('folder');
        expect(second?.handlers?.onNavigationCommand).toBeUndefined();
    });
});
