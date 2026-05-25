import Debug from 'debug';
import React, { type ReactElement } from "react";
import {
    DragDropContext,
    Draggable,
    Droppable,
    type DragStart,
    type DropResult,
    type ResponderProvided,
} from '@hello-pangea/dnd';
import { buildChildNoteDisplayOptions } from "../../../lib/noteui";
import type { ViewProps } from "../../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import KanbanColumn from "../KanbanColumn";
import GenericNote from "../../notes/GenericNote";
import type { KanbanColumnDescriptor } from "./useKanbanColumns";
import view_specific_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:KanbanBoard");

/**
 * props for the kanban board subtree.
 *
 * - visible_columns: filtered + ordered list of columns to render (caller picks populated vs all)
 * - display_options: cascaded view-level display options, propagated into each rendered note via buildChildNoteDisplayOptions
 * - view: the owning view's ViewProps; passed to buildChildNoteDisplayOptions and used to extract per-note handlers (click, setCaretPosition, postMessage)
 * - onDragStart / onDragEnd: drag responders owned by the parent KanbanView so post-message routing stays at the view level
 *
 * The board owns only DOM/JSX assembly; the column derivation, note partitioning, and drag policy
 * decisions all live in the parent (and the pure helpers it delegates to).
 */
export interface KanbanBoardProps {
    visible_columns: Array<KanbanColumnDescriptor>;
    display_options: NoteDisplayOptions;
    view: ViewProps;
    onDragStart: (start: DragStart, provided: ResponderProvided) => void;
    onDragEnd: (result: DropResult, provided: ResponderProvided) => void;
}

/**
 * render the kanban board: a `<DragDropContext>` wrapping one `<Droppable>` per visible
 * column, each column rendering its `child_notes` as `<Draggable>`-wrapped `<GenericNote>`.
 * Sequenced as the eventual `ColumnBasedView` substitution target — keep the prop shape
 * focused on what `ColumnBasedView` would also need: visible_columns plus the drag wiring.
 */
export default function KanbanBoard(boardProps: KanbanBoardProps): ReactElement {
    const { visible_columns, display_options, view, onDragStart, onDragEnd } = boardProps;
    debug('rendering %d columns', visible_columns.length);
    return (
        <div className={view_specific_styles.board} data-total-columns={visible_columns.length}>
            <DragDropContext onDragEnd={onDragEnd} onDragStart={onDragStart}>
                {visible_columns.map((column: KanbanColumnDescriptor, i: number, column_array: Array<KanbanColumnDescriptor>) => (
                    <Droppable key={i} droppableId={`${column.seq}`}>
                        {(provided_drop) => (
                            <KanbanColumn
                                seq={column.seq || i}
                                value={column.value}
                                type={column.type}
                                count={column.child_notes?.length ?? 0}
                                display_options={{
                                    ...column?.display_options,
                                    total_columns: column_array.length,
                                    provided: {
                                        droppableProps: { ...provided_drop.droppableProps },
                                        innerRef: provided_drop.innerRef,
                                    },
                                }}
                            >
                                {(column.child_notes || [])
                                    .map((note: NoteProps, index: number) => (
                                        <Draggable key={note.seq} draggableId={`${note.seq}`} index={index}>
                                            {(provided_drag, snapshot_drag) => (
                                                <GenericNote
                                                    {...note}
                                                    display_options={{
                                                        ...buildChildNoteDisplayOptions(display_options, note, view),
                                                        additional_classes: snapshot_drag.isDragging ? ['dragging'] : undefined,
                                                        provided: {
                                                            draggableProps: { ...provided_drag.draggableProps },
                                                            dragHandleProps: provided_drag.dragHandleProps ? { ...provided_drag.dragHandleProps } : undefined,
                                                            innerRef: provided_drag.innerRef,
                                                        },
                                                    }}
                                                    handlers={{
                                                        click: view.handlers?.click,
                                                        setCaretPosition: view.handlers?.setCaretPosition,
                                                        postMessage: view.handlers?.postMessage,
                                                    }}
                                                />
                                            )}
                                        </Draggable>
                                    ))
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
