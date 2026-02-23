import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo } from "react";
import { DragDropContext, Draggable, Droppable, } from '@hello-pangea/dnd';
import { noteIsVisible, withinNoteHeadlineOrBodyUpTo, kanbanNoteOrder, } from "../../lib/noteops";
import { calculateTextChangesForNewLinetagValue, calculateTextChangesForOrdering } from "../../lib/linetagops";
import { buildChildNoteDisplayOptions } from "../../lib/noteui";
import KanbanColumn from "./KanbanColumn";
import KanbanContextBar from "./KanbanContextBar";
import GenericNote from "../notes/GenericNote";
import master_view_styles from "../ViewRenderer.module.scss";
import view_specific_styles from "../ViewRenderer.module.scss";
const renderTopLevelNoteWithoutChildren = (note, view, display_options) => {
    const filtered_children_body = note.children_body.filter((child) => !('seq' in child && child.seq !== undefined));
    return _jsx(GenericNote, { ...note, display_options: {
            ...buildChildNoteDisplayOptions(display_options, note, view),
            additional_classes: [view_specific_styles.parentContext].concat(note.display_options?.additional_classes || []),
        }, child_notes: [], children_body: filtered_children_body, focused: (filtered_children_body.length > 0) && withinNoteHeadlineOrBodyUpTo(view.selection?.main.head, note, filtered_children_body[filtered_children_body.length - 1].position.end.offset), selection: view.selection, handlers: {
            click: view.handlers?.click,
            setCaretPosition: view.handlers?.setCaretPosition,
        } });
};
export default function KanbanView(props) {
    const display_options = {
        ...props.display_options,
        settings: {
            scroll_note_into_view: true,
            show_linetags_in_headlines: true,
            ...props.display_options?.settings,
        },
    };
    const columns = useMemo(() => {
        const status_values = new Set();
        for (const note of (props.notes_within_parent_context || [])) {
            if (note.linetags?.status?.value) {
                status_values.add(note.linetags.status.value);
            }
        }
        const result = [{ seq: 0, value: "untagged", type: "pseudo" }];
        Array.from(status_values).sort().forEach((value, index) => {
            result.push({ seq: index + 1, value });
        });
        return result;
    }, [props.notes_within_parent_context]);
    const dragStartHandler = (start, provided) => {
        const dragged_note_seq = Number(start.draggableId);
        const dragged_note = (props.notes || []).at(dragged_note_seq);
        if (dragged_note) {
            props.handlers?.click?.({ detail: 1 }, dragged_note, {
                from: dragged_note.position.start.offset,
                to: dragged_note.position.end.offset,
                selection_from: undefined,
                selection_to: undefined,
                type: 'note_drag',
            });
        }
    };
    const dragEndHandler = (result, provided) => {
        const destination_column_position = result.destination?.index || 0;
        if (!result.destination?.droppableId) {
            return;
        }
        const destination_column_seq = Number(result.destination?.droppableId);
        const destination_column = columns[destination_column_seq];
        if (!destination_column) {
            return;
        }
        if (!result.draggableId) {
            return;
        }
        const dragged_note_seq = Number(result.draggableId);
        const dragged_note = (props.notes || []).at(dragged_note_seq);
        if (!dragged_note) {
            return;
        }
        if (dragged_note.locked) {
            return;
        }
        const changes = [];
        changes.push(...calculateTextChangesForNewLinetagValue(dragged_note, 'status', destination_column.value, 'untagged'));
        const destination_column_children = (destination_column.child_notes || [])
            .filter((note) => (dragged_note.seq !== note.seq));
        destination_column_children.splice(destination_column_position, 0, dragged_note);
        changes.push(...calculateTextChangesForOrdering(destination_column_children, destination_column_position, 'kanban_ordering_weight'));
        if (props.handlers?.postMessage && changes.length > 0) {
            props.handlers.postMessage({
                type: 'editText',
                changes: changes,
            });
        }
    };
    // scroll focused note into view
    useEffect(() => {
        if (display_options.settings?.scroll_note_into_view && display_options.focused_seqs?.length) {
            const view_element = window?.document?.getElementById(`v${props.id}-inner`);
            const note_element_id = `v${props.id}-n${display_options.focused_seqs[display_options.focused_seqs.length - 1]}`;
            const note_element = window?.document?.getElementById(note_element_id);
            if (note_element && view_element) {
                if (!noteIsVisible(note_element, view_element)) {
                    note_element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                }
            }
        }
    }, [
        display_options.settings?.scroll_note_into_view,
        display_options.focused_seqs?.length && display_options.focused_seqs[display_options.focused_seqs.length - 1],
        props.id,
    ]);
    // assign notes to columns
    columns.map((column) => {
        column.child_notes = (props.notes_within_parent_context || [])
            .filter((note) => ((note?.linetags?.status && note?.linetags?.status.value === column.value)
            || (!note?.linetags?.status && column.value === 'untagged')))
            .sort(kanbanNoteOrder);
    });
    const rendered_board = _jsx("div", { className: view_specific_styles.board, "data-total-columns": columns.length, children: _jsx(DragDropContext, { onDragEnd: dragEndHandler, onDragStart: dragStartHandler, children: columns.map((column, i, column_array) => (_jsx(Droppable, { droppableId: `${column.seq}`, children: (provided_drop) => (_jsxs(KanbanColumn, { seq: column.seq || i, value: column.value, type: column.type, display_options: {
                        ...column?.display_options,
                        total_columns: column_array.length,
                        provided: {
                            droppableProps: { ...provided_drop.droppableProps },
                            innerRef: provided_drop.innerRef,
                        },
                    }, children: [(column.child_notes || [])
                            .map((note, index) => (_jsx(Draggable, { draggableId: `${note.seq}`, index: index, children: (provided_drag) => (_jsx(GenericNote, { ...note, display_options: {
                                    ...buildChildNoteDisplayOptions(display_options, note, props),
                                    provided: {
                                        draggableProps: { ...provided_drag.draggableProps },
                                        dragHandleProps: provided_drag.dragHandleProps ? { ...provided_drag.dragHandleProps } : undefined,
                                        innerRef: provided_drag.innerRef,
                                    },
                                }, handlers: {
                                    click: props.handlers?.click,
                                    setCaretPosition: props.handlers?.setCaretPosition,
                                } })) }, note.seq))), provided_drop.placeholder] })) }, i))) }) });
    const container_styles = [view_specific_styles.viewKanban, master_view_styles.content];
    return (_jsx(_Fragment, { children: _jsxs("div", { className: container_styles.join(' '), id: `v${props.id}-inner`, onClick: (display_options.focused_notes?.length ? props.handlers?.getClearHandler?.(display_options.focused_notes) : undefined), "data-level": display_options.level, "data-parent-content-seq": display_options.parent_context_seq, children: [display_options.settings?.show_context_bars && _jsx(KanbanContextBar, { ...props }), props.nested?.parent_context && renderTopLevelNoteWithoutChildren(props.nested?.parent_context, props, display_options), rendered_board] }) }));
}
