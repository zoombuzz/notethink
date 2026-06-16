import Debug from 'debug';
import React, { type ReactElement, Profiler, useRef } from "react";
import type {
    DragStart,
    DropResult,
    ResponderProvided,
} from '@hello-pangea/dnd';
import { withinNoteHeadlineOrBodyUpTo, kanbanDraggableId, notesInKanbanColumn } from "../../lib/noteops";
import { useScrollToCaret, useCaretIndicator } from "../../lib/viewhooks";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import type { ViewProps } from "../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions } from "../../types/NoteProps";
import GenericNote from "../notes/GenericNote";
import { useKanbanColumns } from "./kanban/useKanbanColumns";
import { buildKanbanDragEndPayload } from "./kanban/kanbanDragEndPayload";
import { useProjectedNotes } from "./kanban/useProjectedNotes";
import KanbanBoard from "./kanban/KanbanBoard";
import master_view_styles from "../ViewRenderer.module.scss";
import view_specific_styles from "../ViewRenderer.module.scss";

declare const NOTETHINK_DEV: boolean | undefined;
const debug = Debug("nodejs:notethink-views:KanbanView");

const onProfilerRender = (typeof NOTETHINK_DEV !== 'undefined' && NOTETHINK_DEV)
    ? (id: string, phase: string, actualDuration: number) => {
        debug('Profiler %s %s %dms', id, phase, actualDuration.toFixed(1));
    }
    : undefined;

const renderTopLevelNoteWithoutChildren = (note: NoteProps, view: ViewProps, display_options: NoteDisplayOptions): ReactElement => {
    const filtered_children_body = note.children_body.filter((child) => !('seq' in child && child.seq !== undefined));
    return <GenericNote
        {...note}
        display_options={{
            ...buildChildNoteDisplayOptions(display_options, note, view),
            additional_classes: [view_specific_styles.parentContext].concat(note.display_options?.additional_classes || []),
        }}
        child_notes={[]}
        children_body={filtered_children_body}
        focused={(filtered_children_body.length > 0) && withinNoteHeadlineOrBodyUpTo(view.selection?.main.head, note, filtered_children_body[filtered_children_body.length - 1].position.end.offset)}
        selection={view.selection}
        handlers={{
            click: view.handlers?.click,
            setCaretPosition: view.handlers?.setCaretPosition,
            postMessage: view.handlers?.postMessage,
            descendToFolder: view.handlers?.descendToFolder,
        }}
    />;
};

export default function KanbanView(props: ViewProps): ReactElement {

    const display_options: NoteDisplayOptions = {
        ...props.display_options,
        settings: {
            scrollNoteIntoView: true,
            showLinetagsInHeadlines: false,
            ...props.display_options?.settings,
        },
    };

    // optimistic projection: hold the dropped layout client-side until the document round-trip lands, so there is no drop→snap-back→re-land flash
    // safe to render the projected order during the drop animation because KanbanBoard collapses the drop tween via transitionDuration, not the old transition:'none' hack that broke dnd's transitionend and left cards stuck
    const { notes_to_render, applyOptimisticMove } = useProjectedNotes(props.notes_within_parent_context);
    const columns = useKanbanColumns(notes_to_render, display_options.settings?.columnOrder);

    // true from drag-start until just after drag-end; gates the container clear handler against the post-drop click
    const drag_active = useRef(false);
    /**
     * arm the post-drop click guard. The browser fires a `click` after the drop's mouseup; with the
     * projection re-rendering the board, dnd's own click-suppression is defeated and that click bubbles
     * to the container's clear handler, which reveals the focused note's end+1 (the next story's header)
     * and jumps the editor caret onto it. The guarded container onClick swallows it. This handler must
     * only set the flag — it must NOT move the caret (a drag-start reveal was the original jump bug).
     */
    const dragStartHandler = (_start: DragStart, _provided: ResponderProvided): void => {
        drag_active.current = true;
    };

    /**
     * thin React adapter around `buildKanbanDragEndPayload`: pulls the dragged note and
     * destination column out of the drop result, applies the lock + no-destination guards,
     * then delegates payload assembly (status-tag rewrite + ordering cascade + single-doc
     * vs multi-doc routing) to the pure helper and posts whatever it returns.
     */
    const dragEndHandler = (result: DropResult, provided: ResponderProvided): void => {
        // release the drag guard on the next macrotask, after the post-drop click has fired and been swallowed
        setTimeout(() => { drag_active.current = false; }, 0);
        if (!result.destination?.droppableId) { return; }
        const destination_column_seq = Number(result.destination?.droppableId);
        const destination_column = columns[destination_column_seq];
        if (!destination_column) { return; }
        if (!result.draggableId) { return; }
        const dragged_note = (props.notes || []).find(note => note !== undefined && kanbanDraggableId(note) === result.draggableId);
        if (!dragged_note) { return; }
        if (dragged_note.locked) { return; }
        if (!props.handlers?.postMessage) { return; }
        // compute the reorder from AUTHORITATIVE notes on the SAME basis the projection uses (notesInKanbanColumn over the real notes), keeping the edit and the projection in lockstep so projectionSatisfied reconciles
        // the projected child_notes carry synthetic inherited weights (which defeat weight removal) and a possibly-stale order, so using them would diverge the written doc order from what was projected and leave the card stuck
        const real_destination_children = notesInKanbanColumn(props.notes_within_parent_context || [], destination_column.value);
        const payload = buildKanbanDragEndPayload({
            dragged_note,
            destination_column_value: destination_column.value,
            destination_column_children: real_destination_children,
            destination_column_position: result.destination?.index || 0,
        });
        if (payload === null) { return; }
        props.handlers.postMessage(payload);
        if (dragged_note.stable_id) {
            applyOptimisticMove({
                dragged_stable_id: dragged_note.stable_id,
                destination_column_value: destination_column.value,
                destination_index: result.destination?.index ?? 0,
            });
        }
    };

    // scroll focused note (and body item) into view when caret moves
    useScrollToCaret(display_options, props.id, props.selection);

    // virtual caret indicator: pulse-highlight the body item containing the editor caret
    useCaretIndicator(display_options, props.id, props.selection, view_specific_styles.caretTarget);

    // only render columns that contain stories (a stale columnOrder can list statuses no note currently uses)
    // fall back to all columns when nothing has stories so an empty board is never blank
    const populated_columns = columns.filter(col => (col.child_notes?.length ?? 0) > 0);
    const visible_columns = populated_columns.length > 0 ? populated_columns : columns;

    const container_styles: Array<string> = [view_specific_styles.viewKanban, master_view_styles.content];

    // clear focus on a background click, but ignore the post-drop click (drag_active) that would otherwise jump the caret to the next story via the clear handler
    const clear_handler = display_options.focused_notes?.length
        ? props.handlers?.getClearHandler?.(display_options.focused_notes)
        : undefined;
    const containerClickHandler = clear_handler
        ? (event: React.MouseEvent<HTMLElement>) => { if (!drag_active.current) { clear_handler(event); } }
        : undefined;

    const content = (
        <div className={container_styles.join(' ')} id={`v${props.id}-inner`}
             onClick={containerClickHandler}
             data-level={display_options.level} data-parent-content-seq={display_options.parent_context_seq}>
            {props.nested?.document_strip}
            {props.nested?.parent_context && renderTopLevelNoteWithoutChildren(props.nested?.parent_context, props, display_options)}
            <KanbanBoard
                visible_columns={visible_columns}
                display_options={display_options}
                view={props}
                onDragStart={dragStartHandler}
                onDragEnd={dragEndHandler}
            />
        </div>
    );

    if (onProfilerRender) {
        return <Profiler id="KanbanView" onRender={onProfilerRender}>{content}</Profiler>;
    }
    return content;
}
