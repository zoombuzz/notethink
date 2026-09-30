import React from 'react';
import { render, act } from '@testing-library/react';
import VirtualizedKanbanColumn from './VirtualizedKanbanColumn';
import { scrollVirtualLaneToNoteId } from '../../../lib/virtualScrollRegistry';
import type { NoteProps } from '../../../types/NoteProps';
import type { ViewProps } from '../../../types/ViewProps';
import type { KanbanColumnDescriptor } from './useKanbanColumns';

/*
 * The real component resolves card types through React.lazy, which suspends with no <Suspense>
 * ancestor here. This mock also spreads `provided.draggableProps` so `data-column-card-id` shows up
 * as the real cards emit it.
 */
jest.mock('../../notes/GenericNote', () => ({
    __esModule: true,
    default: (props: NoteProps) => (
        <div {...props.display_options?.provided?.draggableProps} ref={props.display_options?.provided?.innerRef as never}>
            {props.headline_raw}
        </div>
    ),
}));

// mocks @hello-pangea/dnd rather than driving it for real; also supports renderClone so a test can request a clone
jest.mock('@hello-pangea/dnd', () => ({
    Droppable: ({ children, renderClone }: {
        children: (provided: unknown, snapshot: unknown) => React.ReactNode;
        renderClone?: (provided: unknown, snapshot: unknown, rubric: unknown) => React.ReactNode;
    }) => (
        <div data-testid="droppable">
            {/* always rendered here (unlike the real library, which only clones mid-drag) so it doesn't inflate the mounted-lane-content count */}
            <div data-testid="lane-content">
                {(children as (provided: unknown, snapshot: unknown) => React.ReactNode)(
                    { droppableProps: {}, innerRef: () => {} },
                    { isUsingPlaceholder: false },
                )}
            </div>
            {renderClone ? <div data-testid="clone">{renderClone({ draggableProps: {}, dragHandleProps: {}, innerRef: () => {} }, { isDragging: true }, { source: { index: 0 } })}</div> : null}
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

function makeNotes(count: number): Array<NoteProps> {
    return Array.from({ length: count }, (_, i) => ({
        seq: i + 1,
        level: 3,
        stable_id: `story-${i}`,
        children_body: [],
        headline_raw: `Task ${i}`,
        body_raw: '',
        position: { start: { offset: 0, line: 0 }, end: { offset: 10, line: 0 } },
        children: [],
    }));
}

function makeColumn(notes: Array<NoteProps>): KanbanColumnDescriptor {
    return { seq: 0, value: 'doing', child_notes: notes };
}

function makeView(): ViewProps {
    return { id: 'view-1', type: 'kanban', display_options: {} };
}

describe('VirtualizedKanbanColumn', () => {
    it('mounts far fewer cards than the total when the lane is long (windowed, not the whole corpus)', () => {
        const notes = makeNotes(200);
        const { container } = render(
            <VirtualizedKanbanColumn
                view_id="view-1"
                column={makeColumn(notes)}
                display_options={{}}
                view={makeView()}
                handlers={{}}
                card_height={undefined}
                card_widths={{}}
                list_height={300}
            />,
        );
        const mounted_cards = container.querySelectorAll('[data-testid="lane-content"] [data-column-card-id]');
        expect(mounted_cards.length).toBeGreaterThan(0);
        // generous bound: a 300px viewport at ~180px/row plus LANE_OVERSCAN_COUNT (8) either side is nowhere near 200
        expect(mounted_cards.length).toBeLessThan(40);
    });

    it('mounts every card when the lane is short enough to fit', () => {
        const notes = makeNotes(3);
        const { container } = render(
            <VirtualizedKanbanColumn
                view_id="view-1"
                column={makeColumn(notes)}
                display_options={{}}
                view={makeView()}
                handlers={{}}
                card_height={undefined}
                card_widths={{}}
                list_height={2000}
            />,
        );
        expect(container.querySelectorAll('[data-testid="lane-content"] [data-column-card-id]').length).toBe(3);
    });

    it('registers a virtual lane the scroll registry can look a card up in, and unregisters it on unmount', () => {
        const notes = makeNotes(200);
        const { unmount } = render(
            <VirtualizedKanbanColumn
                view_id="view-1"
                column={makeColumn(notes)}
                display_options={{}}
                view={makeView()}
                handlers={{}}
                card_height={undefined}
                card_widths={{}}
                list_height={300}
            />,
        );
        // a card well outside the initial mounted window is still known to the registry by position
        let handled = false;
        act(() => { handled = scrollVirtualLaneToNoteId('view-1', 'story-150'); });
        expect(handled).toBe(true);
        unmount();
        expect(scrollVirtualLaneToNoteId('view-1', 'story-150')).toBe(false);
    });

    it('scrolling to an off-screen card mounts it (the virtualizer actually moved, not just answered true)', () => {
        const notes = makeNotes(200);
        const { container } = render(
            <VirtualizedKanbanColumn
                view_id="view-1"
                column={makeColumn(notes)}
                display_options={{}}
                view={makeView()}
                handlers={{}}
                card_height={undefined}
                card_widths={{}}
                list_height={300}
            />,
        );
        expect(container.querySelector('[data-testid="lane-content"] [data-column-card-id="story-150"]')).toBeNull();
        act(() => { scrollVirtualLaneToNoteId('view-1', 'story-150'); });
        expect(container.querySelector('[data-testid="lane-content"] [data-column-card-id="story-150"]')).not.toBeNull();
    });

    it('renders a drag clone through renderClone rather than requiring the source row to stay mounted', () => {
        const notes = makeNotes(200);
        const { container } = render(
            <VirtualizedKanbanColumn
                view_id="view-1"
                column={makeColumn(notes)}
                display_options={{}}
                view={makeView()}
                handlers={{}}
                card_height={undefined}
                card_widths={{}}
                list_height={300}
            />,
        );
        // the mock's renderClone always asks for source index 0 - the clone renders regardless of the mounted window
        expect(container.querySelector('[data-testid="clone"] [data-column-card-id]')).not.toBeNull();
    });
});
