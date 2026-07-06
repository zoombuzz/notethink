import React from 'react';
import { render } from '@testing-library/react';
import KanbanView from './KanbanView';
import type { ViewProps } from '../../types/ViewProps';
import type { NoteProps } from '../../types/NoteProps';

// captured DragDropContext callbacks so tests can drive drag start directly
const captured_dnd: { onDragStart?: (start: unknown, provided: unknown) => void; onDragEnd?: (result: unknown, provided: unknown) => void } = {};

// mock drag-and-drop library (mirrors KanbanView.test.tsx): capture the responders and render children inline
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

// mock KanbanColumn to expose children only (its internals are irrelevant to the settle path)
jest.mock('./kanban/KanbanColumn', () => ({
    __esModule: true,
    default: (props: { value: string; children?: React.ReactNode }) => (
        <div data-testid={`column-${props.value}`}>{props.children}</div>
    ),
}));

// mock GenericNote so the board renders a lightweight node instead of the full note tree
jest.mock('../notes/GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => <div data-testid={`note-${props.seq}`}>{props.headline_raw}</div>,
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

// seed a FLIP card mid-animation directly into the measured content node the drag-start handler settles within
function seedFlipCardInContent(content: HTMLElement, flip_id: string): { card: HTMLElement; finish: jest.Mock } {
    const card = document.createElement('div');
    card.setAttribute('data-flip-id', flip_id);
    card.classList.add('flipping');
    card.style.transform = 'translate(12px, 34px)';
    const finish = jest.fn();
    card.getAnimations = (() => [{ finish }]) as unknown as HTMLElement['getAnimations'];
    content.appendChild(card);
    return { card, finish };
}

describe('KanbanView drag-start settles in-flight FLIP animations', () => {

    beforeEach(() => {
        captured_dnd.onDragStart = undefined;
        captured_dnd.onDragEnd = undefined;
    });

    it('onDragStart finishes a running animation and clears the transform/flip class on a mid-flight card', () => {
        const doing_note = makeNote({
            seq: 1,
            stable_id: 'doc:task-a',
            headline_raw: '## Task A',
            linetags: {
                'status': { key: 'status', value: 'doing', note_seq: 1, key_offset: 0, value_offset: 0, linktext_offset: 0 },
            },
        });
        render(<KanbanView {...makeViewProps({ notes_within_parent_context: [doing_note] })} />);

        // the content node useFlipTransition (and settleFlipAnimations) measure within carries the view id
        const content = document.getElementById('vtest-kanban-inner');
        expect(content).not.toBeNull();
        const seeded = seedFlipCardInContent(content as HTMLElement, 'doc:task-a');

        expect(captured_dnd.onDragStart).toBeDefined();
        captured_dnd.onDragStart!({ draggableId: '1' }, {});

        expect(seeded.finish).toHaveBeenCalledTimes(1);
        expect(seeded.card.style.transform).toBe('');
        expect(seeded.card.classList.contains('flipping')).toBe(false);
    });

    it('onDragStart does not throw when no FLIP cards are present in the content node', () => {
        render(<KanbanView {...makeViewProps()} />);
        expect(captured_dnd.onDragStart).toBeDefined();
        expect(() => captured_dnd.onDragStart!({ draggableId: '1' }, {})).not.toThrow();
    });
});
