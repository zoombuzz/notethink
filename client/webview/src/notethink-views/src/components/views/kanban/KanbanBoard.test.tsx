import React from 'react';
import { render } from '@testing-library/react';
import KanbanBoard from './KanbanBoard';
import type { NoteProps } from '../../../types/NoteProps';
import type { ViewProps } from '../../../types/ViewProps';
import type { KanbanColumnDescriptor } from './useKanbanColumns';

/*
 * Regression guard: a lane that fits the board's height ceiling must render the plain path, not
 * VirtualizedKanbanColumn, which is mocked directly so the test can tell which path rendered.
 */
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }: { children: React.ReactNode }) => <div data-testid="drag-drop-context">{children}</div>,
    Droppable: ({ children, droppableId }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode; droppableId: string }) => (
        <div data-testid={`droppable-${droppableId}`}>
            {(children as (provided: unknown, snapshot: unknown) => React.ReactNode)(
                { droppableProps: {}, innerRef: () => {}, placeholder: null },
                { isUsingPlaceholder: false },
            )}
        </div>
    ),
    Draggable: ({ children, draggableId }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode; draggableId: string }) => (
        <div data-testid={`draggable-${draggableId}`}>
            {(children as (provided: unknown, snapshot: unknown) => React.ReactNode)(
                { draggableProps: {}, dragHandleProps: {}, innerRef: () => {} },
                { isDragging: false },
            )}
        </div>
    ),
}));

jest.mock('./VirtualizedKanbanColumn', () => ({
    __esModule: true,
    default: (props: { column: { value: string } }) => <div data-testid={`virtualized-${props.column.value}`} />,
}));

jest.mock('../../notes/GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid={`note-${props.seq}`}>{props.headline_raw}</div>,
}));

function makeNotes(status: string, count: number, seq_start: number): Array<NoteProps> {
    return Array.from({ length: count }, (_, i) => ({
        seq: seq_start + i,
        level: 3,
        stable_id: `${status}-${i}`,
        children_body: [],
        headline_raw: `${status} ${i}`,
        body_raw: '',
        position: { start: { offset: 0, line: 0 }, end: { offset: 10, line: 0 } },
        children: [],
    }));
}

function makeColumn(value: string, notes: Array<NoteProps>, seq: number): KanbanColumnDescriptor {
    return { seq, value, child_notes: notes };
}

function makeView(): ViewProps {
    return { id: 'view-1', type: 'kanban', display_options: {} };
}

describe('KanbanBoard: virtualization is per-lane, not per-board', () => {
    it('renders a short lane through the plain path, not VirtualizedKanbanColumn', () => {
        const short_column = makeColumn('doing', makeNotes('doing', 2, 0), 0);
        const { queryByTestId, getByTestId } = render(
            <KanbanBoard
                visible_columns={[short_column]}
                display_options={{}}
                view={makeView()}
                orientation="columns"
                onDragStart={jest.fn()}
                onDragEnd={jest.fn()}
            />,
        );
        expect(queryByTestId('virtualized-doing')).toBeNull();
        expect(getByTestId('note-0')).toBeInTheDocument();
        expect(getByTestId('note-1')).toBeInTheDocument();
    });

    it('renders a lane whose content exceeds the ceiling through VirtualizedKanbanColumn', () => {
        const long_column = makeColumn('backlog', makeNotes('backlog', 400, 0), 0);
        const { getByTestId, queryByTestId } = render(
            <KanbanBoard
                visible_columns={[long_column]}
                display_options={{}}
                view={makeView()}
                orientation="columns"
                onDragStart={jest.fn()}
                onDragEnd={jest.fn()}
            />,
        );
        expect(getByTestId('virtualized-backlog')).toBeInTheDocument();
        expect(queryByTestId('note-0')).toBeNull();
    });

    it('mixes both paths in the same board when one lane is long and another is short', () => {
        const short_column = makeColumn('doing', makeNotes('doing', 1, 0), 0);
        const long_column = makeColumn('backlog', makeNotes('backlog', 400, 1), 1);
        const { getByTestId, queryByTestId } = render(
            <KanbanBoard
                visible_columns={[short_column, long_column]}
                display_options={{}}
                view={makeView()}
                orientation="columns"
                onDragStart={jest.fn()}
                onDragEnd={jest.fn()}
            />,
        );
        expect(queryByTestId('virtualized-doing')).toBeNull();
        expect(getByTestId('note-0')).toBeInTheDocument();
        expect(getByTestId('virtualized-backlog')).toBeInTheDocument();
    });

    it('always uses the plain path in rows orientation, however long the lane', () => {
        const long_column = makeColumn('backlog', makeNotes('backlog', 400, 0), 0);
        const { queryByTestId } = render(
            <KanbanBoard
                visible_columns={[long_column]}
                display_options={{}}
                view={makeView()}
                orientation="rows"
                onDragStart={jest.fn()}
                onDragEnd={jest.fn()}
            />,
        );
        expect(queryByTestId('virtualized-backlog')).toBeNull();
    });
});
