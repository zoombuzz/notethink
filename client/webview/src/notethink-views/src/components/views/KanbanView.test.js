import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { render, screen, within } from '@testing-library/react';
import KanbanView from './KanbanView';
// mock drag-and-drop library
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }) => _jsx("div", { "data-testid": "drag-drop-context", children: children }),
    Droppable: ({ children, droppableId }) => _jsx("div", { "data-testid": `droppable-${droppableId}`, children: children({
            droppableProps: {},
            innerRef: () => { },
            placeholder: null,
        }) }),
    Draggable: ({ children, draggableId }) => _jsx("div", { "data-testid": `draggable-${draggableId}`, children: children({
            draggableProps: {},
            dragHandleProps: {},
            innerRef: () => { },
        }) }),
}));
// mock KanbanColumn to expose children
jest.mock('./KanbanColumn', () => ({
    __esModule: true,
    default: (props) => (_jsxs("div", { "data-testid": `column-${props.value}`, role: "region", "aria-label": props.value, children: [_jsx("h3", { children: props.value }), _jsx("div", { "data-testid": `column-${props.value}-notes`, children: props.children })] })),
}));
// mock KanbanContextBar
jest.mock('./KanbanContextBar', () => ({
    __esModule: true,
    default: () => _jsx("div", { "data-testid": "kanban-context-bar", children: "ContextBar" }),
}));
// mock GenericNote
jest.mock('../notes/GenericNote', () => ({
    __esModule: true,
    default: (props) => (_jsx("div", { "data-testid": `note-${props.seq}`, role: "row", "data-seq": props.seq, children: props.headline_raw })),
}));
function makeNote(overrides = {}) {
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
function makeViewProps(overrides = {}) {
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
        render(_jsx(KanbanView, { ...makeViewProps() }));
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
        render(_jsx(KanbanView, { ...props }));
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
        render(_jsx(KanbanView, { ...props }));
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
        render(_jsx(KanbanView, { ...props }));
        const untagged_column = screen.getByTestId('column-untagged-notes');
        expect(within(untagged_column).getByTestId('note-1')).toBeInTheDocument();
    });
    it('renders drag-drop context', () => {
        render(_jsx(KanbanView, { ...makeViewProps() }));
        expect(screen.getByTestId('drag-drop-context')).toBeInTheDocument();
    });
    it('renders context bar when show_context_bars is enabled', () => {
        const props = makeViewProps({
            display_options: {
                settings: { show_context_bars: true },
            },
        });
        render(_jsx(KanbanView, { ...props }));
        expect(screen.getByTestId('kanban-context-bar')).toBeInTheDocument();
    });
    it('does not render context bar when show_context_bars is disabled', () => {
        const props = makeViewProps({
            display_options: {
                settings: { show_context_bars: false },
            },
        });
        render(_jsx(KanbanView, { ...props }));
        expect(screen.queryByTestId('kanban-context-bar')).not.toBeInTheDocument();
    });
    it('renders parent context note when provided', () => {
        const parent = makeNote({ seq: 0, headline_raw: '# Board', level: 1 });
        const props = makeViewProps({
            nested: { parent_context: parent },
        });
        render(_jsx(KanbanView, { ...props }));
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
        render(_jsx(KanbanView, { ...props }));
        const backlog_column = screen.getByTestId('column-backlog-notes');
        expect(within(backlog_column).getByTestId('note-1')).toBeInTheDocument();
        expect(within(backlog_column).getByTestId('note-2')).toBeInTheDocument();
    });
});
