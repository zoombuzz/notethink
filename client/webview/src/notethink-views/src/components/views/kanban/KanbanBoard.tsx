import Debug from 'debug';
import React, { useMemo, useRef, type ReactElement } from "react";
import {
    DragDropContext,
    Droppable,
    type DragStart,
    type DropResult,
    type ResponderProvided,
} from '@hello-pangea/dnd';
import type { ViewProps } from "../../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions } from "../../../types/NoteProps";
import KanbanColumn from "./KanbanColumn";
import VirtualizedKanbanColumn from "./VirtualizedKanbanColumn";
import { renderBoardCard } from "./renderKanbanCard";
import type { KanbanColumnDescriptor } from "./useKanbanColumns";
import { cardSignature } from "./columnwidthops";
import { useLaneBreadth } from "./useLaneBreadth";
import { useBoardColumnStyle } from "./useColumnWidth";
import { useLaneListHeight } from "./useLaneListHeight";
import { laneNeedsVirtualization } from "./virtualCardSizingOps";
import LaneSeparator from "./LaneSeparator";
import view_specific_styles from "../../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:KanbanBoard");

/**
 * Props for the kanban board subtree.
 * - visible_columns: filtered + ordered lanes to render
 * - display_options: cascaded into each rendered note
 * - view: owning view's ViewProps, source of per-note handlers
 * - orientation: 'columns' lays lanes side by side (the default); 'rows' stacks them
 * - dragDisabled: true for a read-only group axis - lanes render, but accept no drops
 * - onDragStart / onDragEnd: drag responders owned by the parent LineView
 *
 * A 'columns' lane windows through VirtualizedKanbanColumn only once its content exceeds the
 * board's height ceiling; 'rows' always uses the plain Droppable + KanbanColumn path, since a
 * stacked lane scrolls with the board rather than in a scrollport of its own.
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
 * Renders the kanban board: a `<DragDropContext>` wrapping one lane per visible column - a
 * `VirtualizedKanbanColumn` side by side, a plain `Droppable` + `KanbanColumn` stacked.
 */
// eslint-disable-next-line max-lines-per-function -- tracked: function-decomposition-wave2
export default function KanbanBoard(boardProps: KanbanBoardProps): ReactElement {
    const { visible_columns, display_options, view, orientation, dragDisabled, onDragStart, onDragEnd } = boardProps;
    const board_ref = useRef<HTMLDivElement | null>(null);
    const lanes_side_by_side = (orientation ?? 'columns') === 'columns';
    const layout = `${orientation ?? 'columns'}/${display_options.settings?.cardType ?? 'auto'}`;
    const signature = useMemo(() => cardSignature(visible_columns, layout), [visible_columns, layout]);
    const ratio = display_options.settings?.kanbanCardRatio;
    const { breadth, commitBreadth } = useLaneBreadth(view, display_options);
    const board = useBoardColumnStyle(board_ref, lanes_side_by_side, ratio, breadth, visible_columns.length, signature);
    // one stable handlers object per board, so memoised GenericNote cards don't see a changed prop
    const handlers = useMemo(() => ({
        click: view.handlers?.click,
        setCaretPosition: view.handlers?.setCaretPosition,
        postMessage: view.handlers?.postMessage,
        descendToFolder: view.handlers?.descendToFolder,
        setNoteExpanded: view.handlers?.setNoteExpanded,
    }), [view.handlers?.click, view.handlers?.setCaretPosition, view.handlers?.postMessage, view.handlers?.descendToFolder, view.handlers?.setNoteExpanded]);
    // floored height to render; unfloored `available` drives the virtualize decision; undefined pre-measurement
    const { list_height, available: available_list_height } = useLaneListHeight(board_ref);
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
                    <React.Fragment key={column.value}>
                    {i > 0 && (
                        <LaneSeparator
                            viewId={view.id}
                            boardRef={board_ref}
                            orientation={orientation ?? 'columns'}
                            lanesBefore={i}
                            breadth={breadth}
                            onCommit={commitBreadth}
                        />
                    )}
                    {/* keyed by the column's stable status value: an index key would remap surviving columns onto each other's DOM subtrees when one empties, corrupting the FLIP layer's measurement */}
                    {lanes_side_by_side && laneNeedsVirtualization(column.child_notes?.length ?? 0, available_list_height) ? (
                        <VirtualizedKanbanColumn
                            view_id={view.id}
                            column={column}
                            display_options={display_options}
                            view={view}
                            handlers={handlers}
                            dragDisabled={dragDisabled}
                            card_height={board.cardHeight}
                            card_widths={board.cardWidths}
                            list_height={list_height}
                        />
                    ) : (
                        <Droppable droppableId={`${column.seq}`}>
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
                                    {(column.child_notes || []).map((note: NoteProps, index: number) => renderBoardCard({
                                        note,
                                        index,
                                        display_options,
                                        view,
                                        handlers,
                                        dragDisabled,
                                        card_height: board.cardHeight,
                                        card_widths: board.cardWidths,
                                    }))}
                                    {provided_drop.placeholder}
                                </KanbanColumn>
                            )}
                        </Droppable>
                    )}
                    </React.Fragment>
                ))}
            </DragDropContext>
        </div>
    );
}
