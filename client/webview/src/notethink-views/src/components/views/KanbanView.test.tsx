import React from 'react';
import { render, screen, within } from '@testing-library/react';
import KanbanView from './KanbanView';
import type { ViewProps } from '../../types/ViewProps';
import type { NoteProps, NoteOrigin } from '../../types/NoteProps';
import type { OrderingChangeSet } from '../../lib/linetagops';

// captured DragDropContext callbacks so tests can drive drag start/end directly
const captured_dnd: { onDragStart?: (start: unknown, provided: unknown) => void; onDragEnd?: (result: unknown, provided: unknown) => void } = {};

// per-test override for the ordering function — when set, the mocked linetagops module returns this value instead of running the real algorithm
let mock_ordering_override: Array<OrderingChangeSet> | undefined;

// mock linetagops: passthrough every export but allow tests to swap the ordering function's return value via mock_ordering_override
jest.mock('../../lib/linetagops', () => {
    const actual = jest.requireActual('../../lib/linetagops');
    return {
        ...actual,
        calculateTextChangesForOrdering: (...args: Parameters<typeof actual.calculateTextChangesForOrdering>) => {
            if (mock_ordering_override !== undefined) { return mock_ordering_override; }
            return actual.calculateTextChangesForOrdering(...args);
        },
    };
});

// mock drag-and-drop library
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children, onDragStart, onDragEnd }: { children: React.ReactNode; onDragStart?: (s: unknown, p: unknown) => void; onDragEnd?: (r: unknown, p: unknown) => void }) => {
        captured_dnd.onDragStart = onDragStart;
        captured_dnd.onDragEnd = onDragEnd;
        return <div data-testid="drag-drop-context">{children}</div>;
    },
    Droppable: ({ children, droppableId }: { children: (provided: unknown) => React.ReactNode; droppableId: string }) =>
        <div data-testid={`droppable-${droppableId}`}>{
            (children as (provided: { droppableProps: Record<string, unknown>; innerRef: () => void; placeholder: null }) => React.ReactNode)({
                droppableProps: {},
                innerRef: () => {},
                placeholder: null,
            })
        }</div>,
    Draggable: ({ children, draggableId }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode; draggableId: string }) =>
        <div data-testid={`draggable-${draggableId}`}>{
            (children as (provided: { draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown>; innerRef: () => void }, snapshot: { isDragging: boolean }) => React.ReactNode)({
                draggableProps: {},
                dragHandleProps: {},
                innerRef: () => {},
            }, { isDragging: false })
        }</div>,
}));

// mock KanbanColumn to expose children and count
jest.mock('./KanbanColumn', () => ({
    __esModule: true,
    default: (props: { seq: number; value: string; type?: string; count?: number; children?: React.ReactNode }) => (
        <div data-testid={`column-${props.value}`} role="region" aria-label={props.value}>
            <h3>{props.value}</h3>
            {props.count !== undefined && <span data-testid={`column-${props.value}-count`}>{props.count}</span>}
            <div data-testid={`column-${props.value}-notes`}>{props.children}</div>
        </div>
    ),
}));

// mock GenericNote
jest.mock('../notes/GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => (
        <div data-testid={`note-${props.seq}`} role="row" data-seq={props.seq}>
            {props.headline_raw}
        </div>
    ),
}));

function makeNote(overrides: Partial<NoteProps> = {}): NoteProps {
    return {
        seq: 0,
        level: 2,
        children_body: [],
        children: [],
        position: {
            start: { offset: 0, line: 1 },
            end: { offset: 10, line: 1 },
            end_body: { offset: 50, line: 5 },
        },
        headline_raw: '## Note',
        body_raw: '',
        ...overrides,
    };
}

function makeViewProps(overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'test-kanban',
        type: 'kanban',
        display_options: {},
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
            postMessage: jest.fn(),
        },
        ...overrides,
    };
}

describe('KanbanView', () => {

    it('renders only untagged column when no notes have status', () => {
        render(<KanbanView {...makeViewProps()} />);
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
    });

    it('renders untagged column last in default order', () => {
        const doing_note = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const untagged_note = makeNote({
            seq: 2,
            headline_raw: '## Untagged',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
        });
        const props = makeViewProps({
            notes_within_parent_context: [doing_note, untagged_note],
        });
        const { container } = render(<KanbanView {...props} />);
        const columns = container.querySelectorAll('[data-testid^="column-"]');
        const column_names = Array.from(columns).map(el => el.getAttribute('data-testid')?.replace('column-', '').replace('-notes', '').replace('-count', ''));
        // filter to unique top-level column testids
        const top_level = Array.from(columns)
            .filter(el => !el.getAttribute('data-testid')?.includes('-notes') && !el.getAttribute('data-testid')?.includes('-count'))
            .map(el => el.getAttribute('data-testid')?.replace('column-', ''));
        expect(top_level[top_level.length - 1]).toBe('untagged');
    });

    it('derives columns from note status linetags', () => {
        const doing_note = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const review_note = makeNote({
            seq: 2,
            headline_raw: '## Task B',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'review', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [doing_note, review_note],
        });
        render(<KanbanView {...props} />);
        // empty Untagged column is hidden when other columns have notes
        expect(screen.queryByTestId('column-untagged')).not.toBeInTheDocument();
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
        expect(screen.getByTestId('column-review')).toBeInTheDocument();
    });

    it('assigns notes to columns by status linetag', () => {
        const doing_note = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const done_note = makeNote({
            seq: 2,
            headline_raw: '## Task B',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'done', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [doing_note, done_note],
        });
        render(<KanbanView {...props} />);

        const doing_column = screen.getByTestId('column-doing-notes');
        expect(within(doing_column).getByTestId('note-1')).toBeInTheDocument();

        const done_column = screen.getByTestId('column-done-notes');
        expect(within(done_column).getByTestId('note-2')).toBeInTheDocument();
    });

    it('assigns notes without status linetag to untagged column', () => {
        const untagged_note = makeNote({
            seq: 1,
            headline_raw: '## Untagged Task',
        });
        const props = makeViewProps({
            notes_within_parent_context: [untagged_note],
        });
        render(<KanbanView {...props} />);

        const untagged_column = screen.getByTestId('column-untagged-notes');
        expect(within(untagged_column).getByTestId('note-1')).toBeInTheDocument();
    });

    it('renders drag-drop context', () => {
        render(<KanbanView {...makeViewProps()} />);
        expect(screen.getByTestId('drag-drop-context')).toBeInTheDocument();
    });

    it('renders parent context note when provided', () => {
        const parent = makeNote({ seq: 0, headline_raw: '# Board', level: 1 });
        const props = makeViewProps({
            nested: { parent_context: parent },
        });
        render(<KanbanView {...props} />);
        expect(screen.getByText('# Board')).toBeInTheDocument();
    });

    it('places multiple notes in the same column', () => {
        const note1 = makeNote({
            seq: 1,
            headline_raw: '## Task 1',
            linetags: {
                'status': { key: 'status', value: 'backlog', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const note2 = makeNote({
            seq: 2,
            headline_raw: '## Task 2',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'backlog', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [note1, note2],
        });
        render(<KanbanView {...props} />);

        const backlog_column = screen.getByTestId('column-backlog-notes');
        expect(within(backlog_column).getByTestId('note-1')).toBeInTheDocument();
        expect(within(backlog_column).getByTestId('note-2')).toBeInTheDocument();
    });

    it('respects custom column_order from display_options', () => {
        const doing_note = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const review_note = makeNote({
            seq: 2,
            headline_raw: '## Task B',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'review', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [doing_note, review_note],
            display_options: {
                settings: {
                    column_order: ['review', 'untagged', 'doing'],
                },
            },
        });
        render(<KanbanView {...props} />);
        // columns with notes should be present; empty Untagged hidden
        expect(screen.getByTestId('column-review')).toBeInTheDocument();
        expect(screen.queryByTestId('column-untagged')).not.toBeInTheDocument();
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
    });

    it('appends new status values not in column_order', () => {
        const doing_note = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const blocked_note = makeNote({
            seq: 2,
            headline_raw: '## Task B',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'blocked', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [doing_note, blocked_note],
            display_options: {
                settings: {
                    column_order: ['untagged', 'doing'],
                },
            },
        });
        render(<KanbanView {...props} />);
        // 'blocked' is not in column_order but should still appear; empty Untagged hidden
        expect(screen.getByTestId('column-blocked')).toBeInTheDocument();
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
        expect(screen.queryByTestId('column-untagged')).not.toBeInTheDocument();
    });

    it('hides empty Untagged column when other columns have notes', () => {
        const doing_note = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [doing_note],
        });
        render(<KanbanView {...props} />);
        // Untagged column should be hidden since it's empty and other columns exist
        expect(screen.queryByTestId('column-untagged')).not.toBeInTheDocument();
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
    });

    it('shows Untagged column when it is the only column', () => {
        const untagged_note = makeNote({
            seq: 1,
            headline_raw: '## No Status',
        });
        const props = makeViewProps({
            notes_within_parent_context: [untagged_note],
        });
        render(<KanbanView {...props} />);
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
    });

    it('shows Untagged column when it has notes even if other columns exist', () => {
        const untagged_note = makeNote({
            seq: 1,
            headline_raw: '## No Status',
        });
        const doing_note = makeNote({
            seq: 2,
            headline_raw: '## Task B',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [untagged_note, doing_note],
        });
        render(<KanbanView {...props} />);
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
    });

    it('hides an empty named column left over in a stale column_order', () => {
        const doing_note = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [doing_note],
            display_options: {
                settings: {
                    // 'done' and 'review' are remembered in the order but no note uses them now
                    column_order: ['review', 'done', 'doing', 'untagged'],
                },
            },
        });
        render(<KanbanView {...props} />);
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
        expect(screen.queryByTestId('column-done')).not.toBeInTheDocument();
        expect(screen.queryByTestId('column-review')).not.toBeInTheDocument();
        expect(screen.queryByTestId('column-untagged')).not.toBeInTheDocument();
    });

    it('falls back to all columns when no column has stories (empty board not blank)', () => {
        const props = makeViewProps({
            notes_within_parent_context: [],
            display_options: {
                settings: {
                    column_order: ['done', 'doing', 'untagged'],
                },
            },
        });
        render(<KanbanView {...props} />);
        expect(screen.getByTestId('column-done')).toBeInTheDocument();
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
    });

    it('passes correct count to each column', () => {
        const note1 = makeNote({
            seq: 1,
            headline_raw: '## Task 1',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const note2 = makeNote({
            seq: 2,
            headline_raw: '## Task 2',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const note3 = makeNote({
            seq: 3,
            headline_raw: '## Task 3',
            position: { start: { offset: 110, line: 11 }, end: { offset: 120, line: 12 }, end_body: { offset: 150, line: 15 } },
            linetags: {
                'status': { key: 'status', value: 'review', note_seq: 3, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const props = makeViewProps({
            notes_within_parent_context: [note1, note2, note3],
        });
        render(<KanbanView {...props} />);
        expect(screen.getByTestId('column-doing-count')).toHaveTextContent('2');
        expect(screen.getByTestId('column-review-count')).toHaveTextContent('1');
    });
});

// helpers shared by drag handler tests
function makeOrigin(overrides: Partial<NoteOrigin> = {}): NoteOrigin {
    return {
        doc_id: 'doc-a',
        doc_path: '/repo/file-a.md',
        ...overrides,
    };
}

// build a notes array shaped so dragged_note_seq from draggableId maps to the right element
function notesBySeq(notes: Array<NoteProps>): Array<NoteProps> {
    const out: Array<NoteProps> = [];
    for (const n of notes) { out[n.seq] = n; }
    return out;
}

describe('KanbanView dragEndHandler', () => {

    beforeEach(() => {
        captured_dnd.onDragStart = undefined;
        captured_dnd.onDragEnd = undefined;
        mock_ordering_override = undefined;
    });

    it('single-file mode (no origin): posts legacy single-doc shape with docPath undefined', () => {
        // status change drags doing -> done; no origin anywhere, ordering cascade returns a single set with doc_path undefined which we flatten into the legacy payload
        const doing_a = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const done_b = makeNote({
            seq: 2,
            headline_raw: '## Task B',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            linetags: {
                'status': { key: 'status', value: 'done', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const post_message = jest.fn();
        const props = makeViewProps({
            notes: notesBySeq([doing_a, done_b]),
            notes_within_parent_context: [doing_a, done_b],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        render(<KanbanView {...props} />);

        // columns sorted alphabetically: doing (seq=0), done (seq=1), untagged (seq=2) — 'doing' < 'done' lexicographically
        // drag note seq=1 (status=doing) onto done column at index 0
        captured_dnd.onDragEnd!({
            draggableId: '1',
            destination: { droppableId: '1', index: 0 },
        }, {});

        expect(post_message).toHaveBeenCalledTimes(1);
        const msg = post_message.mock.calls[0][0];
        expect(msg.type).toBe('editText');
        // legacy shape: docPath set (to undefined), changes array, no changes_by_doc
        expect(msg).toHaveProperty('changes');
        expect(msg.docPath).toBeUndefined();
        expect(msg.changes_by_doc).toBeUndefined();
        // status-tag rewrite must be present somewhere in the change set
        expect(Array.isArray(msg.changes)).toBe(true);
        expect(msg.changes.length).toBeGreaterThan(0);
        const has_status_done = msg.changes.some((c: { insert: string }) => typeof c.insert === 'string' && c.insert.includes('done'));
        expect(has_status_done).toBe(true);
    });

    it('folder mode: single-file cascade within file-A posts legacy single-doc shape with docPath=file-a', () => {
        // both notes share file-A origin; dragging doing -> done leaves all changes targeting file-A
        const origin_a = makeOrigin({ doc_id: 'doc-a', doc_path: '/repo/file-a.md' });
        const doing_a = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            origin: origin_a,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const done_a = makeNote({
            seq: 2,
            headline_raw: '## Task B',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            origin: origin_a,
            linetags: {
                'status': { key: 'status', value: 'done', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const post_message = jest.fn();
        const props = makeViewProps({
            notes: notesBySeq([doing_a, done_a]),
            notes_within_parent_context: [doing_a, done_a],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        render(<KanbanView {...props} />);

        // columns sorted alphabetically: doing (seq=0), done (seq=1), untagged (seq=2)
        // drag note seq=1 (status=doing) onto done column at index 0
        captured_dnd.onDragEnd!({
            draggableId: '1',
            destination: { droppableId: '1', index: 0 },
        }, {});

        expect(post_message).toHaveBeenCalledTimes(1);
        const msg = post_message.mock.calls[0][0];
        expect(msg.type).toBe('editText');
        // single doc-path → legacy shape; docPath routes to file-A
        expect(msg.docPath).toBe('/repo/file-a.md');
        expect(msg.changes_by_doc).toBeUndefined();
        expect(Array.isArray(msg.changes)).toBe(true);
    });

    it('folder mode: cascade spanning file-A and file-B posts changes_by_doc with both files (dispatch-policy contract)', () => {
        // override the ordering function to return sets for two doc_paths; KanbanView must then post the partitioned shape
        const origin_a = makeOrigin({ doc_id: 'doc-a', doc_path: '/repo/file-a.md' });
        const doing_a = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            origin: origin_a,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        mock_ordering_override = [
            { doc_path: '/repo/file-a.md', changes: [{ from: 100, insert: 'kanban_ordering_weight=1&' }] },
            { doc_path: '/repo/file-b.md', changes: [{ from: 200, insert: 'kanban_ordering_weight=2&' }] },
        ];
        const post_message = jest.fn();
        const props = makeViewProps({
            notes: notesBySeq([doing_a]),
            notes_within_parent_context: [doing_a],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        render(<KanbanView {...props} />);

        // drop doing_a back into the doing column; the merged changes_by_doc combines its file-A status change with the overridden file-A + file-B ordering edits
        captured_dnd.onDragEnd!({
            draggableId: '1',
            destination: { droppableId: '0', index: 0 },
        }, {});

        expect(post_message).toHaveBeenCalledTimes(1);
        const msg = post_message.mock.calls[0][0];
        expect(msg.type).toBe('editText');
        expect(msg.changes_by_doc).toBeDefined();
        expect(msg.changes).toBeUndefined();
        expect(msg.docPath).toBeUndefined();
        const keys = Object.keys(msg.changes_by_doc);
        expect(keys.sort()).toEqual(['/repo/file-a.md', '/repo/file-b.md']);
        expect(msg.changes_by_doc['/repo/file-a.md'].length).toBeGreaterThan(0);
        expect(msg.changes_by_doc['/repo/file-b.md'].length).toBeGreaterThan(0);
        // file-A bucket includes the overridden ordering-cascade change keyed for that file
        expect(msg.changes_by_doc['/repo/file-a.md'].some((c: { from: number }) => c.from === 100)).toBe(true);
        // file-B bucket carries its ordering-cascade change
        expect(msg.changes_by_doc['/repo/file-b.md'].some((c: { from: number }) => c.from === 200)).toBe(true);
    });

    it('folder mode: cascade spans file-A and file-B posts changes_by_doc with both files (real-algorithm scenario)', () => {
        // drop a file-A note into a done column holding a file-B note; tolerate either dispatch shape — the test guards the contract that cross-file edits, if emitted, are partitioned
        const origin_a = makeOrigin({ doc_id: 'doc-a', doc_path: '/repo/file-a.md' });
        const origin_b = makeOrigin({ doc_id: 'doc-b', doc_path: '/repo/file-b.md' });
        // dragged note in doing column on file-A
        const doing_a = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            origin: origin_a,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '5', value_numeric: 5, note_seq: 1, key_offset: 8, value_offset: 30, linktext_offset: 0 },
            },
        });
        // existing notes in done column with weights that force a cascade
        const done_a_existing = makeNote({
            seq: 2,
            headline_raw: '## Done A1',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            origin: origin_a,
            linetags: {
                'status': { key: 'status', value: 'done', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '0', value_numeric: 0, note_seq: 2, key_offset: 8, value_offset: 30, linktext_offset: 0 },
            },
        });
        const done_b_existing = makeNote({
            seq: 3,
            headline_raw: '## Done B1',
            position: { start: { offset: 110, line: 11 }, end: { offset: 120, line: 12 }, end_body: { offset: 150, line: 15 } },
            origin: origin_b,
            linetags: {
                'status': { key: 'status', value: 'done', note_seq: 3, key_offset: 0, value_offset: 0, linktext_offset: 0 },
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '0', value_numeric: 0, note_seq: 3, key_offset: 8, value_offset: 30, linktext_offset: 0 },
            },
        });
        const post_message = jest.fn();
        const props = makeViewProps({
            notes: notesBySeq([doing_a, done_a_existing, done_b_existing]),
            notes_within_parent_context: [doing_a, done_a_existing, done_b_existing],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        render(<KanbanView {...props} />);

        // columns sorted alphabetically: doing (seq=0), done (seq=1), untagged (seq=2) — 'doing' < 'done'
        // drag doing_a onto done at index 0 (above the existing done notes)
        captured_dnd.onDragEnd!({
            draggableId: '1',
            destination: { droppableId: '1', index: 0 },
        }, {});

        expect(post_message).toHaveBeenCalledTimes(1);
        const msg = post_message.mock.calls[0][0];
        expect(msg.type).toBe('editText');
        // when cascade spans both files we expect the multi-doc shape
        if (msg.changes_by_doc) {
            expect(msg.changes).toBeUndefined();
            const keys = Object.keys(msg.changes_by_doc);
            expect(keys).toEqual(expect.arrayContaining(['/repo/file-a.md', '/repo/file-b.md']));
            // file-A bucket contains the status-tag change for the dragged note
            const file_a_changes = msg.changes_by_doc['/repo/file-a.md'];
            expect(Array.isArray(file_a_changes)).toBe(true);
            expect(file_a_changes.length).toBeGreaterThan(0);
            // file-B bucket exists with at least one ordering change
            const file_b_changes = msg.changes_by_doc['/repo/file-b.md'];
            expect(file_b_changes.length).toBeGreaterThan(0);
        } else {
            // if the cascade did not actually touch file-B (no weight rewrite needed), the
            // legacy single-doc shape is acceptable as long as it routes to file-A — status
            // tag MUST land on file-A
            expect(msg.docPath).toBe('/repo/file-a.md');
            expect(Array.isArray(msg.changes)).toBe(true);
        }
    });

    it('folder mode: interleaving within a column with mixed origins partitions cascade by docPath', () => {
        // interleave a file-A note between two file-B notes in one column: status is unchanged, only ordering weights cascade
        const origin_a = makeOrigin({ doc_id: 'doc-a', doc_path: '/repo/file-a.md' });
        const origin_b = makeOrigin({ doc_id: 'doc-b', doc_path: '/repo/file-b.md' });
        const doing_a = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            origin: origin_a,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '0', value_numeric: 0, note_seq: 1, key_offset: 8, value_offset: 30, linktext_offset: 0 },
            },
        });
        const doing_b_high = makeNote({
            seq: 2,
            headline_raw: '## Task B-high',
            position: { start: { offset: 60, line: 6 }, end: { offset: 70, line: 7 }, end_body: { offset: 100, line: 10 } },
            origin: origin_b,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 2, key_offset: 0, value_offset: 0, linktext_offset: 0 },
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '10', value_numeric: 10, note_seq: 2, key_offset: 8, value_offset: 30, linktext_offset: 0 },
            },
        });
        const doing_b_low = makeNote({
            seq: 3,
            headline_raw: '## Task B-low',
            position: { start: { offset: 110, line: 11 }, end: { offset: 120, line: 12 }, end_body: { offset: 150, line: 15 } },
            origin: origin_b,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 3, key_offset: 0, value_offset: 0, linktext_offset: 0 },
                'kanban_ordering_weight': { key: 'kanban_ordering_weight', value: '5', value_numeric: 5, note_seq: 3, key_offset: 8, value_offset: 30, linktext_offset: 0 },
            },
        });
        const post_message = jest.fn();
        const props = makeViewProps({
            notes: notesBySeq([doing_a, doing_b_high, doing_b_low]),
            notes_within_parent_context: [doing_a, doing_b_high, doing_b_low],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        render(<KanbanView {...props} />);

        // doing column is the only populated named column → its seq is 0 from kanbanNoteOrder when alphabetical
        // single status value 'doing' → seq=0 for doing; drag dragged_a (seq=1) to position 1 within doing
        captured_dnd.onDragEnd!({
            draggableId: '1',
            destination: { droppableId: '0', index: 1 },
        }, {});

        expect(post_message).toHaveBeenCalledTimes(1);
        const msg = post_message.mock.calls[0][0];
        expect(msg.type).toBe('editText');
        // status is unchanged so every change comes from the ordering cascade, which may touch file-A only or both files
        if (msg.changes_by_doc) {
            expect(msg.changes).toBeUndefined();
            const keys = Object.keys(msg.changes_by_doc);
            // at minimum file-A is touched (its weight was rewritten); file-B may also be
            expect(keys).toEqual(expect.arrayContaining(['/repo/file-a.md']));
        } else {
            // single-doc shape acceptable when cascade only touches one file
            expect(typeof msg.docPath === 'string').toBe(true);
            expect(['/repo/file-a.md', '/repo/file-b.md']).toContain(msg.docPath);
        }
    });

    it('does not post when dragged note is locked', () => {
        const doing_locked = makeNote({
            seq: 1,
            headline_raw: '## Locked',
            locked: true,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const post_message = jest.fn();
        const props = makeViewProps({
            notes: notesBySeq([doing_locked]),
            notes_within_parent_context: [doing_locked],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        render(<KanbanView {...props} />);

        captured_dnd.onDragEnd!({
            draggableId: '1',
            destination: { droppableId: '1', index: 0 },
        }, {});

        expect(post_message).not.toHaveBeenCalled();
    });
});

describe('KanbanView dragStartHandler', () => {

    beforeEach(() => {
        captured_dnd.onDragStart = undefined;
        captured_dnd.onDragEnd = undefined;
        mock_ordering_override = undefined;
    });

    it('folder mode: posts revealRange with the dragged note origin docPath (not the active file)', () => {
        const origin_a = makeOrigin({ doc_id: 'doc-a', doc_path: '/repo/file-a.md' });
        const dragged = makeNote({
            seq: 1,
            headline_raw: '## Task A',
            position: { start: { offset: 42, line: 4 }, end: { offset: 70, line: 5 }, end_body: { offset: 100, line: 6 } },
            origin: origin_a,
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        const post_message = jest.fn();
        const click_handler = jest.fn();
        // active file is file-B; the click chain would route to file-B but our drag start must override
        const props = makeViewProps({
            doc_path: '/repo/file-b.md',
            notes: notesBySeq([dragged]),
            notes_within_parent_context: [dragged],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
                click: click_handler,
            },
        });
        render(<KanbanView {...props} />);

        captured_dnd.onDragStart!({ draggableId: '1' }, {});

        // option (a): bypass the click chain — click handler must NOT be invoked
        expect(click_handler).not.toHaveBeenCalled();
        expect(post_message).toHaveBeenCalledTimes(1);
        const msg = post_message.mock.calls[0][0];
        expect(msg.type).toBe('revealRange');
        expect(msg.docPath).toBe('/repo/file-a.md');
        expect(msg.docId).toBe('doc-a');
        expect(msg.from).toBe(42);
    });

    it('single-file mode: posts revealRange with docPath undefined (no origin)', () => {
        const dragged = makeNote({
            seq: 1,
            headline_raw: '## Task',
            position: { start: { offset: 12, line: 2 }, end: { offset: 30, line: 3 }, end_body: { offset: 60, line: 4 } },
        });
        const post_message = jest.fn();
        const props = makeViewProps({
            notes: notesBySeq([dragged]),
            notes_within_parent_context: [dragged],
            handlers: {
                setViewManagedState: jest.fn(),
                deleteViewFromManagedState: jest.fn(),
                revertAllViewsToDefaultState: jest.fn(),
                postMessage: post_message,
            },
        });
        render(<KanbanView {...props} />);

        captured_dnd.onDragStart!({ draggableId: '1' }, {});

        expect(post_message).toHaveBeenCalledTimes(1);
        const msg = post_message.mock.calls[0][0];
        expect(msg.type).toBe('revealRange');
        expect(msg.docPath).toBeUndefined();
        expect(msg.docId).toBeUndefined();
        expect(msg.from).toBe(12);
    });
});
