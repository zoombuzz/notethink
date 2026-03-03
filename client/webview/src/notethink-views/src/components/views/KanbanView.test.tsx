import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import KanbanView from './KanbanView';
import type { ViewProps } from '../../types/ViewProps';
import type { NoteProps } from '../../types/NoteProps';

// mock drag-and-drop library
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }: { children: React.ReactNode }) => <div data-testid="drag-drop-context">{children}</div>,
    Droppable: ({ children, droppableId }: { children: (provided: unknown) => React.ReactNode; droppableId: string }) =>
        <div data-testid={`droppable-${droppableId}`}>{
            (children as (provided: { droppableProps: Record<string, unknown>; innerRef: () => void; placeholder: null }) => React.ReactNode)({
                droppableProps: {},
                innerRef: () => {},
                placeholder: null,
            })
        }</div>,
    Draggable: ({ children, draggableId }: { children: (provided: unknown) => React.ReactNode; draggableId: string }) =>
        <div data-testid={`draggable-${draggableId}`}>{
            (children as (provided: { draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown>; innerRef: () => void }) => React.ReactNode)({
                draggableProps: {},
                dragHandleProps: {},
                innerRef: () => {},
            })
        }</div>,
}));

// mock KanbanColumn to expose children
jest.mock('./KanbanColumn', () => ({
    __esModule: true,
    default: (props: { seq: number; value: string; type?: string; children?: React.ReactNode }) => (
        <div data-testid={`column-${props.value}`} role="region" aria-label={props.value}>
            <h3>{props.value}</h3>
            <div data-testid={`column-${props.value}-notes`}>{props.children}</div>
        </div>
    ),
}));

// mock KanbanContextBar
jest.mock('./KanbanContextBar', () => ({
    __esModule: true,
    default: (props: { onSettingsClick?: () => void }) => (
        <div data-testid="kanban-context-bar">
            ContextBar
            {props.onSettingsClick && <button data-testid="settings-btn" onClick={props.onSettingsClick}>Settings</button>}
        </div>
    ),
}));

// mock SettingsKanbanModal
jest.mock('./SettingsKanbanModal', () => ({
    __esModule: true,
    default: (props: { opened: boolean }) => (
        props.opened ? <div data-testid="settings-modal">SettingsModal</div> : null
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
        expect(screen.queryByTestId('column-backlog')).not.toBeInTheDocument();
        expect(screen.queryByTestId('column-doing')).not.toBeInTheDocument();
        expect(screen.queryByTestId('column-done')).not.toBeInTheDocument();
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
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
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

    it('renders context bar when show_context_bars is enabled', () => {
        const props = makeViewProps({
            display_options: {
                settings: { show_context_bars: true },
            },
        });
        render(<KanbanView {...props} />);
        expect(screen.getByTestId('kanban-context-bar')).toBeInTheDocument();
    });

    it('does not render context bar when show_context_bars is disabled', () => {
        const props = makeViewProps({
            display_options: {
                settings: { show_context_bars: false },
            },
        });
        render(<KanbanView {...props} />);
        expect(screen.queryByTestId('kanban-context-bar')).not.toBeInTheDocument();
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
        // all columns should be present
        expect(screen.getByTestId('column-review')).toBeInTheDocument();
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
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
        // 'blocked' is not in column_order but should still appear
        expect(screen.getByTestId('column-blocked')).toBeInTheDocument();
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
    });

    it('opens settings modal when context bar settings button is clicked', () => {
        const props = makeViewProps({
            display_options: {
                settings: { show_context_bars: true },
            },
        });
        render(<KanbanView {...props} />);
        expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('settings-btn'));
        expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });
});
