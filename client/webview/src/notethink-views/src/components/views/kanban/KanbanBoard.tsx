import Debug from 'debug';
import React, { useMemo, useRef, type ReactElement } from "react";
import {
    DragDropContext,
    Draggable,
    Droppable,
    type DragStart,
    type DraggableProvidedDraggableProps,
    type DraggableStateSnapshot,
    type DropResult,
    type ResponderProvided,
} from '@hello-pangea/dnd';
import { buildChildNoteDisplayOptions } from "../../../lib/noteui";
import { kanbanDraggableId } from "../../../lib/noteops";
import type { ViewProps } from "../../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import KanbanColumn from "./KanbanColumn";
import GenericNote from "../../notes/GenericNote";
import type { KanbanColumnDescriptor } from "./useKanbanColumns";
import { cardSignature } from "./columnwidthops";
import { useBoardColumnStyle } from "./useColumnWidth";
import view_specific_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:KanbanBoard");

/**
 * collapse @hello-pangea/dnd's drop tween to ~instant during the drop phase. The optimistic
 * projection has already placed the card in its landing slot, so dnd's slide-from-home tween would
 * visibly fight that (the "drops correct then slides in from the top" glitch). We shorten the
 * transition DURATION rather than removing the transition: dnd detects drop completion via the
 * `transitionend` event, so `transition: 'none'` suppressed that event and left the card stuck with
 * a leftover transform (the overlap bug). A tiny non-zero duration still fires transitionend, so the
 * drop completes and the transform clears - just without a visible slide. The live drag is untouched.
 */
function draggableStyleWithoutDropAnimation(
    style: DraggableProvidedDraggableProps['style'],
    snapshot: DraggableStateSnapshot,
): DraggableProvidedDraggableProps['style'] {
    if (!snapshot.isDropAnimating || !style) { return style; }
    // dnd types the drop-phase transition as the literal 'none'; we set a tiny real duration so the transitionend dnd waits on still fires (cast escapes the literal type)
    return { ...style, transition: 'transform 0.001s' } as DraggableProvidedDraggableProps['style'];
}

/**
 * The drag style plus this card's own width, when the stacked layout has solved one for it. The width
 * rides in as a custom property rather than as `width`, because the stylesheet sets the card's flex basis
 * from that property and a basis always beats a width; publishing it this way lets the card override the
 * board's shared value while the one CSS rule stays in charge of how it is applied.
 */
function cardStyle(
    style: DraggableProvidedDraggableProps['style'],
    snapshot: DraggableStateSnapshot,
    card_width: number | undefined,
): DraggableProvidedDraggableProps['style'] {
    const dragged = draggableStyleWithoutDropAnimation(style, snapshot);
    if (card_width === undefined) { return dragged; }
    // dnd's style union names only its own properties, so the custom one goes in untyped
    const merged: Record<string, unknown> = { ...dragged, '--nt-card-width': `${card_width.toFixed(1)}px` };
    return merged as DraggableProvidedDraggableProps['style'];
}

/**
 * props for the kanban board subtree.
 *
 * - visible_columns: filtered + ordered list of lanes to render (caller picks populated vs all)
 * - display_options: cascaded view-level display options, propagated into each rendered note via buildChildNoteDisplayOptions
 * - view: the owning view's ViewProps; passed to buildChildNoteDisplayOptions and used to extract per-note handlers (click, setCaretPosition, postMessage)
 * - orientation: lays the lanes out as columns (side by side, the kanban default) or rows (stacked); one flex-direction flip, not a forked renderer
 * - dragDisabled: when true (a read-only group axis, e.g. the first level folder) the cards are not draggable, so the board renders lanes but takes no drops
 * - onDragStart / onDragEnd: drag responders owned by the parent LineView so post-message routing stays at the view level
 *
 * Three things the board hands down on each note's display options, none of which the note asks for:
 * `card_target_height`, the height every card in a stacked lane aims at and clips its own body to reach;
 * `data-column-card-id`, the measurement's handle on a card, so a per-card width comes back to the card it
 * was solved from; and `data-flip-id`, the FLIP registry key, omitted entirely when the note carries no
 * stable id so the attribute is never emitted as the string "undefined".
 *
 * The board owns only DOM/JSX assembly; the lane derivation, note partitioning, and drag policy
 * decisions all live in the parent (and the pure helpers it delegates to).
 */
export interface KanbanBoardProps {
    visible_columns: Array<KanbanColumnDescriptor>;
    display_options: NoteDisplayOptions;
    view: ViewProps;
    orientation?: 'columns' | 'rows';
    dragDisabled?: boolean;
    onDragStart: (start: DragStart, provided: ResponderProvided) => void;
    onDragEnd: (result: DropResult, provided: ResponderProvided) => void;
}

/**
 * render the kanban board: a `<DragDropContext>` wrapping one `<Droppable>` per visible
 * column, each column rendering its `child_notes` as `<Draggable>`-wrapped `<GenericNote>`.
 * Sequenced as the eventual `ColumnBasedView` substitution target - keep the prop shape
 * focused on what `ColumnBasedView` would also need: visible_columns plus the drag wiring.
 */
export default function KanbanBoard(boardProps: KanbanBoardProps): ReactElement {
    const { visible_columns, display_options, view, orientation, dragDisabled, onDragStart, onDragEnd } = boardProps;
    const board_ref = useRef<HTMLDivElement | null>(null);
    const lanes_side_by_side = (orientation ?? 'columns') === 'columns';
    const layout = `${orientation ?? 'columns'}/${display_options.settings?.cardType ?? 'auto'}`;
    const signature = useMemo(() => cardSignature(visible_columns, layout), [visible_columns, layout]);
    const ratio = display_options.settings?.kanbanCardRatio;
    const board = useBoardColumnStyle(board_ref, lanes_side_by_side, ratio, visible_columns.length, signature);
    debug('rendering %d lanes as %s', visible_columns.length, orientation ?? 'columns');
    return (
        <div
            className={view_specific_styles.board}
            ref={board_ref}
            data-total-columns={visible_columns.length}
            data-orientation={orientation ?? 'columns'}
            style={board.style}
            data-flip-root
        >
            <DragDropContext onDragEnd={onDragEnd} onDragStart={onDragStart}>
                {visible_columns.map((column: KanbanColumnDescriptor, i: number) => (
                    /*
                     * key by the column's stable status value, not its array index: when a column empties and drops
                     * out of visible_columns, index keys remap the surviving columns onto each other's DOM subtrees
                     * (and the FLIP layer's data-flip-id nodes), which corrupts the before/after measurement
                     */
                    <Droppable key={column.value} droppableId={`${column.seq}`}>
                        {(provided_drop) => (
                            <KanbanColumn
                                seq={column.seq || i}
                                value={column.value}
                                type={column.type}
                                count={column.child_notes?.length ?? 0}
                                display_options={{
                                    ...column?.display_options,
                                    provided: {
                                        droppableProps: { ...provided_drop.droppableProps },
                                        innerRef: provided_drop.innerRef,
                                    },
                                }}
                            >
                                {(column.child_notes || [])
                                    .map((note: NoteProps, index: number) => {
                                        const draggable_id = kanbanDraggableId(note);
                                        return (
                                        <Draggable key={draggable_id} draggableId={draggable_id} index={index} isDragDisabled={dragDisabled}>
                                            {(provided_drag, snapshot_drag) => (
                                                <GenericNote
                                                    {...note}
                                                    display_options={{
                                                        ...buildChildNoteDisplayOptions(display_options, note, view),
                                                        additional_classes: snapshot_drag.isDragging ? ['dragging'] : undefined,
                                                        card_target_height: board.cardHeight,
                                                        provided: {
                                                            draggableProps: {
                                                                ...provided_drag.draggableProps,
                                                                style: cardStyle(provided_drag.draggableProps.style, snapshot_drag, board.cardWidths[draggable_id]),
                                                                'data-column-card-id': draggable_id,
                                                                ...(note.stable_id !== undefined ? { 'data-flip-id': note.stable_id } : {}),
                                                            },
                                                            dragHandleProps: provided_drag.dragHandleProps ? { ...provided_drag.dragHandleProps } : undefined,
                                                            innerRef: provided_drag.innerRef,
                                                        },
                                                    }}
                                                    handlers={{
                                                        click: view.handlers?.click,
                                                        setCaretPosition: view.handlers?.setCaretPosition,
                                                        postMessage: view.handlers?.postMessage,
                                                        descendToFolder: view.handlers?.descendToFolder,
                                                        setNoteExpanded: view.handlers?.setNoteExpanded,
                                                    }}
                                                />
                                            )}
                                        </Draggable>
                                        );
                                    })
                                }
                                {provided_drop.placeholder}
                            </KanbanColumn>
                        )}
                    </Droppable>
                ))}
            </DragDropContext>
        </div>
    );
}
