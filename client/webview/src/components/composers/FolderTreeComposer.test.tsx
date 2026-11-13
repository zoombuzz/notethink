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
});
