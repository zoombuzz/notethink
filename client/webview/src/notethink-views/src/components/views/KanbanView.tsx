import Debug from 'debug';
import React, { type ReactElement, Profiler } from "react";
import type {
    DragStart,
    DropResult,
    ResponderProvided,
} from '@hello-pangea/dnd';
import { withinNoteHeadlineOrBodyUpTo } from "../../lib/noteops";
import { useScrollToCaret, useCaretIndicator } from "../../lib/viewhooks";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import type { ViewProps } from "../../types/ViewProps";
import type { NoteProps, NoteDisplayOptions } from "../../types/NoteProps";
import GenericNote from "../notes/GenericNote";
import { useKanbanColumns } from "./kanban/useKanbanColumns";
import { buildKanbanDragEndPayload } from "./kanban/kanbanDragEndPayload";
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
        }}
    />;
};

export default function KanbanView(props: ViewProps): ReactElement {

    const display_options: NoteDisplayOptions = {
        ...props.display_options,
        settings: {
            scroll_note_into_view: true,
            show_linetags_in_headlines: false,
            ...props.display_options?.settings,
        },
    };

    const columns = useKanbanColumns(props.notes_within_parent_context, display_options.settings?.column_order);

    /**
     * post revealRange directly rather than going through props.handlers.click so the
     * dragged note's origin file is targeted, not the active editor's doc — keeps the caret
     * on the source-of-truth across files in folder mode.
     */
    const dragStartHandler = (start: DragStart, provided: ResponderProvided): void => {
        const dragged_note_seq = Number(start.draggableId);
        const dragged_note = (props.notes || []).at(dragged_note_seq);
        if (!dragged_note) { return; }
        if (props.handlers?.postMessage) {
            props.handlers.postMessage({
                type: 'revealRange',
                from: dragged_note.position.start.offset,
                docId: dragged_note.origin?.doc_id,
                docPath: dragged_note.origin?.doc_path,
            });
        }
    };

    /**
     * thin React adapter around `buildKanbanDragEndPayload`: pulls the dragged note and
     * destination column out of the drop result, applies the lock + no-destination guards,
     * then delegates payload assembly (status-tag rewrite + ordering cascade + single-doc
     * vs multi-doc routing) to the pure helper and posts whatever it returns.
     */
    const dragEndHandler = (result: DropResult, provided: ResponderProvided): void => {
        if (!result.destination?.droppableId) { return; }
        const destination_column_seq = Number(result.destination?.droppableId);
        const destination_column = columns[destination_column_seq];
        if (!destination_column) { return; }
        if (!result.draggableId) { return; }
        const dragged_note_seq = Number(result.draggableId);
        const dragged_note = (props.notes || []).at(dragged_note_seq);
        if (!dragged_note) { return; }
        if (dragged_note.locked) { return; }
        if (!props.handlers?.postMessage) { return; }
        const payload = buildKanbanDragEndPayload({
            dragged_note,
            destination_column_value: destination_column.value,
            destination_column_children: destination_column.child_notes || [],
            destination_column_position: result.destination?.index || 0,
        });
        if (payload === null) { return; }
        props.handlers.postMessage(payload);
    };

    // scroll focused note (and body item) into view when caret moves
    useScrollToCaret(display_options, props.id, props.selection);

    // virtual caret indicator: pulse-highlight the body item containing the editor caret
    useCaretIndicator(display_options, props.id, props.selection, view_specific_styles.caretTarget);

    // only render columns that contain stories (a stale column_order can list statuses no note currently uses)
    // fall back to all columns when nothing has stories so an empty board is never blank
    const populated_columns = columns.filter(col => (col.child_notes?.length ?? 0) > 0);
    const visible_columns = populated_columns.length > 0 ? populated_columns : columns;

    const container_styles: Array<string> = [view_specific_styles.viewKanban, master_view_styles.content];

    const content = (
        <div className={container_styles.join(' ')} id={`v${props.id}-inner`}
             onClick={(display_options.focused_notes?.length ? props.handlers?.getClearHandler?.(display_options.focused_notes) : undefined)}
             data-level={display_options.level} data-parent-content-seq={display_options.parent_context_seq}>
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
