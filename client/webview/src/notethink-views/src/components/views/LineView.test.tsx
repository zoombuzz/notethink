import React from 'react';
import { render, screen, within } from '@testing-library/react';
import LineView from './LineView';
import type { ViewProps } from '../../types/ViewProps';
import type { NoteProps, NoteOrigin, LineTag } from '../../types/NoteProps';

// mock drag-and-drop library so the board renders in jsdom without the real dnd
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
    Draggable: ({ children, draggableId, isDragDisabled }: { children: (provided: unknown, snapshot: unknown) => React.ReactNode; draggableId: string; isDragDisabled?: boolean }) =>
        <div data-testid={`draggable-${draggableId}`} data-drag-disabled={String(!!isDragDisabled)}>{
            (children as (provided: { draggableProps: Record<string, unknown>; dragHandleProps: Record<string, unknown>; innerRef: () => void }, snapshot: { isDragging: boolean }) => React.ReactNode)({
                draggableProps: {},
                dragHandleProps: {},
                innerRef: () => {},
            }, { isDragging: false })
        }</div>,
}));

// mock KanbanColumn to expose each lane's value + its notes
jest.mock('./kanban/KanbanColumn', () => ({
    __esModule: true,
    default: (props: { seq: number; value: string; type?: string; count?: number; children?: React.ReactNode }) => (
        <div data-testid={`column-${props.value}`} role="region" aria-label={props.value}>
            <div data-testid={`column-${props.value}-notes`}>{props.children}</div>
        </div>
    ),
}));

// mock GenericNote to expose each note by seq
jest.mock('../notes/GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid={`note-${props.seq}`} data-seq={props.seq}>{props.headline_raw}</div>,
}));

function tag(key: string, value: string, note_seq: number): LineTag {
    return { key, value, note_seq, key_offset: 0, value_offset: 0, linktext_offset: 0 };
}

function makeNote(seq: number, offset: number, linetags?: Record<string, LineTag>, origin?: NoteOrigin): NoteProps {
    return {
        seq,
        level: 2,
        children_body: [],
        children: [],
        position: { start: { offset, line: 1 }, end: { offset: offset + 10, line: 1 }, end_body: { offset: offset + 40, line: 5 } },
        headline_raw: `## Note ${seq}`,
        body_raw: '',
        linetags,
        origin,
    };
}

function makeViewProps(notes: NoteProps[], overrides: Partial<ViewProps> = {}): ViewProps {
    return {
        id: 'test-line',
        type: 'line',
        display_options: {},
        notes,
        notes_within_parent_context: notes,
        handlers: {
            setViewManagedState: jest.fn(),
            deleteViewFromManagedState: jest.fn(),
            revertAllViewsToDefaultState: jest.fn(),
            postMessage: jest.fn(),
        },
        ...overrides,
    };
}

describe('LineView lane derivation under an axis', () => {
    it('groups notes into the same lane shape as kanban when the axis is status', () => {
        const doing = makeNote(1, 0, { status: tag('status', 'doing', 1) });
        const untagged = makeNote(2, 60);
        render(<LineView {...makeViewProps([doing, untagged])} axis="status" />);
        expect(screen.getByTestId('column-doing')).toBeInTheDocument();
        expect(screen.getByTestId('column-untagged')).toBeInTheDocument();
        expect(within(screen.getByTestId('column-doing-notes')).getByTestId('note-1')).toBeInTheDocument();
    });

    it('groups notes into lanes on an arbitrary categorical attribute axis', () => {
        const high = makeNote(1, 0, { priority: tag('priority', 'high', 1) });
        const low = makeNote(2, 60, { priority: tag('priority', 'low', 2) });
        render(<LineView {...makeViewProps([high, low])} axis="priority" />);
        expect(screen.getByTestId('column-high')).toBeInTheDocument();
        expect(screen.getByTestId('column-low')).toBeInTheDocument();
        expect(within(screen.getByTestId('column-high-notes')).getByTestId('note-1')).toBeInTheDocument();
        expect(within(screen.getByTestId('column-low-notes')).getByTestId('note-2')).toBeInTheDocument();
    });

    it('collects notes lacking the axis field into the absent-value bucket for a non-status axis', () => {
        const high = makeNote(1, 0, { priority: tag('priority', 'high', 1) });
        const no_priority = makeNote(2, 60, { status: tag('status', 'doing', 2) });
        render(<LineView {...makeViewProps([high, no_priority])} axis="priority" />);
        expect(within(screen.getByTestId('column-untagged-notes')).getByTestId('note-2')).toBeInTheDocument();
        expect(within(screen.getByTestId('column-high-notes')).getByTestId('note-1')).toBeInTheDocument();
    });
});

describe('LineView orientation', () => {
    function laneNames(container: HTMLElement): string[] {
        return Array.from(container.querySelectorAll('[data-testid^="column-"]'))
            .map(el => el.getAttribute('data-testid') || '')
            .filter(id => !id.endsWith('-notes'))
            .map(id => id.replace('column-', ''));
    }

    it('flips the board direction to rows without changing lane membership', () => {
        const doing = makeNote(1, 0, { status: tag('status', 'doing', 1) });
        const done = makeNote(2, 60, { status: tag('status', 'done', 2) });
        const notes = [doing, done];

        const columns_view = render(<LineView {...makeViewProps(notes, { display_options: { settings: { orientation: 'columns' } } })} axis="status" />);
        const columns_board = columns_view.container.querySelector('[data-flip-root]');
        expect(columns_board?.getAttribute('data-orientation')).toBe('columns');
        const columns_lanes = laneNames(columns_view.container);
        columns_view.unmount();

        const rows_view = render(<LineView {...makeViewProps(notes, { display_options: { settings: { orientation: 'rows' } } })} axis="status" />);
        const rows_board = rows_view.container.querySelector('[data-flip-root]');
        expect(rows_board?.getAttribute('data-orientation')).toBe('rows');
        const rows_lanes = laneNames(rows_view.container);

        // membership is identical between orientations - only the flex direction differs
        expect(rows_lanes).toEqual(columns_lanes);
        expect(within(rows_view.container.querySelector('[data-testid="column-doing-notes"]') as HTMLElement).getByTestId('note-1')).toBeInTheDocument();
    });

    it('defaults to columns orientation when unset (kanban default)', () => {
        const doing = makeNote(1, 0, { status: tag('status', 'doing', 1) });
        const { container } = render(<LineView {...makeViewProps([doing])} axis="status" />);
        expect(container.querySelector('[data-flip-root]')?.getAttribute('data-orientation')).toBe('columns');
    });
});

describe('LineView group-by resolution (no axis preset)', () => {
    function fileNote(seq: number, offset: number, folder: string, doc_id: string): NoteProps {
        return makeNote(seq, offset, undefined, { doc_id, doc_path: `/${folder}/f.md`, relative_path: `${folder}/f.md` });
    }

    it('defaults to first-level-folder lanes and makes the cards non-draggable (read-only key)', () => {
        const a = fileNote(1, 0, 'projA', 'a');
        const b = fileNote(2, 60, 'projB', 'b');
        const { container } = render(<LineView {...makeViewProps([a, b], { type: 'line' })} />);
        expect(screen.getByTestId('column-projA')).toBeInTheDocument();
        expect(screen.getByTestId('column-projB')).toBeInTheDocument();
        // the first level folder is read-only, so every card is non-draggable (the board takes no drops)
        const cards = container.querySelectorAll('[data-testid^="draggable-"]');
        expect(cards.length).toBeGreaterThan(0);
        cards.forEach(card => expect(card.getAttribute('data-drag-disabled')).toBe('true'));
    });

    it('groups by an explicit group-by selection and keeps the cards draggable (authored, writable)', () => {
        const high = makeNote(1, 0, { priority: tag('priority', 'high', 1) });
        const low = makeNote(2, 60, { priority: tag('priority', 'low', 2) });
        const props = makeViewProps([high, low], { type: 'line', display_options: { settings: { groupBy: 'priority' } } });
        const { container } = render(<LineView {...props} />);
        expect(screen.getByTestId('column-high')).toBeInTheDocument();
        expect(screen.getByTestId('column-low')).toBeInTheDocument();
        const cards = container.querySelectorAll('[data-testid^="draggable-"]');
        cards.forEach(card => expect(card.getAttribute('data-drag-disabled')).toBe('false'));
    });
});
