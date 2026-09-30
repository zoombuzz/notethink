import Debug from 'debug';
import { useRef, type RefObject } from "react";
import type { DragStart, DropResult, ResponderProvided } from '@hello-pangea/dnd';
import { kanbanDraggableId, notesInKanbanColumn } from "../../lib/noteops";
import type { Axis } from "../../lib/axisops";
import { useFlipGate } from "../../lib/animation/useFlipGate";
import { useFlipTransition } from "../../lib/animation/useFlipTransition";
import { settleFlipAnimations } from "../../lib/animation/settleFlipAnimations";
import type { ViewProps } from "../../types/ViewProps";
import { buildKanbanDragEndPayload } from "./kanban/kanbanDragEndPayload";
import type { KanbanColumnDescriptor } from "./kanban/useKanbanColumns";
import type { KanbanMove } from "./kanban/kanbanProjection";
import view_specific_styles from "../ViewRenderer.module.scss";

const debug = Debug("nodejs:notethink-views:useLineViewDrag");

/*
 * Stable reference for the FLIP hook's class_names option. The SCSS-module class strings are
 * import-constant, so hoisting this out of the render keeps the useFlipTransition effect's dep array
 * stable - without it a fresh object literal every render would re-fire the layout effect (and its
 * getBoundingClientRect reflow) on every LineView re-render, not only on real layout changes.
 */
const FLIP_CLASS_NAMES = {
    flipping: view_specific_styles.flipping,
    columnEntering: view_specific_styles.columnEntering,
    columnExiting: view_specific_styles.columnExiting,
};

/**
 * Inputs LineView threads into the drag lifecycle.
 * - is_projecting: whether an optimistic post-drop projection is active (holds the FLIP gate open for it)
 * - columns / visible_columns: the full lane list (indexed by droppable id) and the populated subset the board renders (the FLIP registry)
 * - apply_optimistic_move: seeds the client-side projection so the dropped card does not snap back
 * - axis / group_field / drag_disabled: the group axis, its field to write, and whether the axis is read-only (no drops)
 * - animate_enabled: the kanban animate-transitions setting
 * - view: the owning ViewProps (notes, in-scope notes, post-message handler)
 */
export interface UseLineViewDragParams {
    is_projecting: boolean;
    columns: Array<KanbanColumnDescriptor>;
    visible_columns: Array<KanbanColumnDescriptor>;
    apply_optimistic_move: (move: KanbanMove) => void;
    axis: Axis;
    group_field: string;
    drag_disabled: boolean;
    animate_enabled: boolean;
    view: ViewProps;
}

/**
 * The drag surface LineView renders against.
 * - content_ref: the lane content node useFlipTransition measures within (scope for the [data-flip-id] queries)
 * - drag_active: true from drag-start until just after drag-end; gates the container clear handler against the post-drop click
 * - handle_drag_start / handle_drag_end: the DragDropContext responders
 */
export interface LineViewDragApi {
    content_ref: RefObject<HTMLDivElement | null>;
    drag_active: RefObject<boolean>;
    handle_drag_start: (start: DragStart, provided: ResponderProvided) => void;
    handle_drag_end: (result: DropResult, provided: ResponderProvided) => void;
}

/**
 * The single-axis card-lane drag lifecycle: the FLIP gate + passive-transition layer, and the drag-start
 * / drag-end responders that post the group-key rewrite through the inverse projection and seed the
 * optimistic hold. Extracted from LineView so the component body stays a short sequence of named steps.
 * - flip_gate: marks a layout change as the user's own move (drag -> optimistic projection ->
 *   authoritative echo) rather than a passive external edit, held open for the whole unbounded
 *   round-trip so the dropped card is never re-animated on its own echo.
 * - handle_drag_start: settles any in-flight FLIP move to its true box before the gate holds, so a
 *   card grabbed mid-animation is at rest when dnd lifts it into its fixed drag clone, and holds the
 *   gate for the drag's full duration (including the race before dnd's async drag-end fires).
 * - handle_drag_end's post-drop click guard: the browser's post-mouseup `click` defeats dnd's own
 *   click-suppression and would otherwise bubble to the container's clear handler and jump the caret
 *   onto the next story's header; the guard only sets a flag and must never move the caret itself.
 * - handle_drag_end: a thin React adapter around `buildKanbanDragEndPayload` that pulls the dragged
 *   note and destination lane out of the drop result, applies the lock and no-destination guards,
 *   then delegates payload assembly to the pure helper and posts whatever it returns. Reorders from
 *   the authoritative notes rather than the projection, whose child_notes carry synthetic inherited
 *   weights and a possibly-stale order that would diverge the written doc from what was projected.
 * - the FLIP passive-transition layer animates the board on an external/AI edit; it is called
 *   unconditionally to hold the rule of hooks, and the gate suppresses it on the post-drag
 *   projection-commit render.
 */
export function useLineViewDrag(params: UseLineViewDragParams): LineViewDragApi {
    const { is_projecting, columns, visible_columns, apply_optimistic_move, axis, group_field, drag_disabled, animate_enabled, view } = params;
    const drag_active = useRef(false);
    const content_ref = useRef<HTMLDivElement>(null);
    // marks a layout change as the user's own drag rather than a passive external edit
    const flip_gate = useFlipGate(is_projecting);
    // arms the post-drop click guard; must only set the flag, never move the caret itself
    const handle_drag_start = (_start: DragStart, _provided: ResponderProvided): void => {
        drag_active.current = true;
        // settles any in-flight FLIP move to its true box first, so dnd's drag clone does not inherit a leftover transform
        if (content_ref.current) { settleFlipAnimations(content_ref.current); }
        flip_gate.hold();
    };
    // a thin React adapter around buildKanbanDragEndPayload's pure result, posted through postMessage
    const handle_drag_end = (result: DropResult, _provided: ResponderProvided): void => {
        // releases the drag-start hold; apply_optimistic_move below re-takes it via the projection hold if it fires
        flip_gate.release();
        // release the drag guard on the next macrotask, after the post-drop click has fired and been swallowed
        setTimeout(() => { drag_active.current = false; }, 0);
        // a read-only group axis takes no drops (the cards are non-draggable too); ignore any drop that slips through
        if (drag_disabled) { return; }
        if (!result.destination?.droppableId) { return; }
        const destination_column_seq = Number(result.destination?.droppableId);
        const destination_column = columns[destination_column_seq];
        if (!destination_column) { return; }
        if (!result.draggableId) { return; }
        const dragged_note = (view.notes || []).find(note => note !== undefined && kanbanDraggableId(note) === result.draggableId);
        if (!dragged_note) { return; }
        if (dragged_note.locked) { return; }
        if (!view.handlers?.postMessage) { return; }
        // reorders from the authoritative notes, on the same basis the projection uses, so the two stay in lockstep
        const real_destination_children = notesInKanbanColumn(view.notes_within_parent_context || [], destination_column.value, axis);
        const payload = buildKanbanDragEndPayload({
            dragged_note,
            destination_column_value: destination_column.value,
            destination_column_children: real_destination_children,
            destination_column_position: result.destination?.index || 0,
            group_field,
        });
        if (payload === null) { return; }
        view.handlers.postMessage(payload);
        if (dragged_note.stable_id) {
            apply_optimistic_move({
                dragged_stable_id: dragged_note.stable_id,
                destination_column_value: destination_column.value,
                destination_index: result.destination?.index ?? 0,
                group_field,
            });
        }
    };
    // the FLIP passive-transition layer's inputs: flip_ids is the data-flip-id registry in render order
    const flip_ids = visible_columns.flatMap(c => (c.child_notes || []).map(n => kanbanDraggableId(n)));
    const column_ids = visible_columns.map(c => c.value);
    useFlipTransition({
        container_ref: content_ref,
        flip_ids,
        column_ids,
        enabled: animate_enabled,
        gate: flip_gate,
        class_names: FLIP_CLASS_NAMES,
    });
    debug('drag lifecycle wired: %d visible lanes, disabled=%s', visible_columns.length, drag_disabled);
    return { content_ref, drag_active, handle_drag_start, handle_drag_end };
}
