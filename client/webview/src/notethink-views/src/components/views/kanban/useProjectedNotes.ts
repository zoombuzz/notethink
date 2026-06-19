import Debug from 'debug';
import { useState, useEffect, useCallback, useRef } from 'react';
import { applyKanbanMove, projectionSatisfied } from './kanbanProjection';
import type { NoteProps } from '../../../types/NoteProps';
import type { KanbanMove } from './kanbanProjection';

const debug = Debug("nodejs:notethink-views:useProjectedNotes");

// hard ceiling on how long a projection may mask the live document before the live state wins
const KANBAN_PROJECTION_MAX_MS = 1500;

interface ProjectionState {
    move: KanbanMove;
    projected_notes: Array<NoteProps>;
}

export interface UseProjectedNotesApi {
    notes_to_render: Array<NoteProps>;
    applyOptimisticMove: (move: KanbanMove) => void;
    is_projecting: boolean;
}

/**
 * hold a short-lived optimistic projection of kanban notes after a drag-drop, reconciling
 * against the authoritative document once the live notes catch up.
 *
 * while a projection is active, `notes_to_render` returns the projected notes so the drag
 * result is visible immediately with no snap-back. the hook auto-clears the projection by
 * two paths: (1) the reconcile effect detects that the authoritative notes satisfy the
 * projected move (document caught up - drop back to live notes seamlessly), or (2) the
 * KANBAN_PROJECTION_MAX_MS safety timeout fires (live state wins regardless).
 */
export function useProjectedNotes(authoritative_notes: Array<NoteProps> | undefined): UseProjectedNotesApi {
    const [projection, setProjection] = useState<ProjectionState | null>(null);
    const timeout_ref = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelTimeout = useCallback(() => {
        if (timeout_ref.current !== null) {
            clearTimeout(timeout_ref.current);
            timeout_ref.current = null;
        }
    }, []);

    const applyOptimisticMove = useCallback((move: KanbanMove) => {
        const projected_notes = applyKanbanMove(authoritative_notes ?? [], move);
        debug('applying optimistic move: dragged=%s dest=%s idx=%d', move.dragged_stable_id, move.destination_column_value, move.destination_index);
        cancelTimeout();
        setProjection({ move, projected_notes });
        timeout_ref.current = setTimeout(() => {
            debug('projection safety timeout fired, reverting to live notes');
            setProjection(null);
            timeout_ref.current = null;
        }, KANBAN_PROJECTION_MAX_MS);
    }, [authoritative_notes, cancelTimeout]);

    // reconcile: when the authoritative notes satisfy the projected move, drop the projection
    useEffect(() => {
        if (projection === null) { return; }
        if (projectionSatisfied(authoritative_notes ?? [], projection.move)) {
            debug('projection satisfied by authoritative notes, clearing projection');
            cancelTimeout();
            setProjection(null);
        }
    }, [authoritative_notes, projection, cancelTimeout]);

    // clear the safety timeout on unmount
    useEffect(() => {
        return () => { cancelTimeout(); };
    }, [cancelTimeout]);

    const notes_to_render = projection ? projection.projected_notes : (authoritative_notes ?? []);
    return { notes_to_render, applyOptimisticMove, is_projecting: projection !== null };
}
