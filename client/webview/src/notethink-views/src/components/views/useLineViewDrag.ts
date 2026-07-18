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
 * stable reference for the FLIP hook's class_names option. The SCSS-module class strings are
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
 * inputs LineView threads into the drag lifecycle.
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
 * the drag surface LineView renders against.
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
 * the single-axis card-lane drag lifecycle: the FLIP gate + passive-transition layer, and the drag-start
 * / drag-end responders that post the group-key rewrite through the inverse projection and seed the
 * optimistic hold. Extracted from LineView so the component body stays a short sequence of named steps.
 */
export function useLineViewDrag(params: UseLineViewDragParams): LineViewDragApi {
    const { is_projecting, columns, visible_columns, apply_optimistic_move, axis, group_field, drag_disabled, animate_enabled, view } = params;

    const drag_active = useRef(false);
    const content_ref = useRef<HTMLDivElement>(null);

    /*
     * the FLIP gate marks when a layout change is the user's own move (drag → optimistic projection →
     * authoritative echo) rather than a passive external edit. useFlipGate holds it open for the whole
     * projection lifetime - the round-trip is unbounded and outlasts any fixed timer - so the dropped
     * card is never re-animated on its own echo. The handlers below drive the drag edges.
     */
    const flip_gate = useFlipGate(is_projecting);

    /**
     * arm the post-drop click guard. The browser fires a `click` after the drop's mouseup; with the
     * projection re-rendering the board, dnd's own click-suppression is defeated and that click bubbles
     * to the container's clear handler, which reveals the focused note's end+1 (the next story's header)
     * and jumps the editor caret onto it. The guarded container onClick swallows it. This handler must
     * only set the flag - it must NOT move the caret (a drag-start reveal was the original jump bug).
     */
    const handle_drag_start = (_start: DragStart, _provided: ResponderProvided): void => {
        drag_active.current = true;
        // snap any in-flight FLIP move to its true box BEFORE the gate holds, so a card grabbed mid-animation is at rest when dnd lifts it into a fixed drag clone (a leftover transform would jump the clone)
        if (content_ref.current) { settleFlipAnimations(content_ref.current); }
        // hold the FLIP gate for the whole drag (any duration) so an update arriving mid-drag - or in the race before @hello-pangea/dnd's async drag-end fires - is never animated; drag-end releases it (projection hold then takes over)
        flip_gate.hold();
    };

    /**
     * thin React adapter around `buildKanbanDragEndPayload`: pulls the dragged note and
     * destination lane out of the drop result, applies the lock + no-destination guards,
     * then delegates payload assembly (group-field rewrite + ordering cascade + single-doc
     * vs multi-doc routing) to the pure helper and posts whatever it returns.
     */
    const handle_drag_end = (result: DropResult, _provided: ResponderProvided): void => {
        // release the drag-start hold and start the tail; if apply_optimistic_move fires below, the projection hold re-takes the gate, so the whole user-move lifecycle stays un-animated
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
        /*
         * compute the reorder from AUTHORITATIVE notes on the SAME basis the projection uses (notesInKanbanColumn over the real notes), keeping the edit and the projection in lockstep so projectionSatisfied reconciles
         * the projected child_notes carry synthetic inherited weights (which defeat weight removal) and a possibly-stale order, so using them would diverge the written doc order from what was projected and leave the card stuck
         */
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

    /*
     * FLIP passive-transition layer: animate the board when an external/AI edit re-lays the cards.
     * flip_ids is every card's stable_id (the data-flip-id registry key) in render order; column_ids
     * is the visible lane values. The hook is called UNCONDITIONALLY so the rule-of-hooks holds; the
     * gate suppresses animation on the post-drag projection-commit render.
     */
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
