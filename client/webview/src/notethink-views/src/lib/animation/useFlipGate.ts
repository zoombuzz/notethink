import Debug from 'debug';
import { useEffect, useRef } from 'react';
import { createPassiveUpdateGate, type PassiveUpdateGate } from './passiveUpdateGate';

const debug = Debug("nodejs:notethink-views:useFlipGate");

/**
 * own the FLIP passive-update gate's lifecycle for a kanban view. The gate exists to tell the FLIP
 * layer when a layout change is the user's OWN move (drag + optimistic projection + the authoritative
 * echo reconciling it) rather than a passive external edit, so the move is never re-animated.
 *
 * This hook creates the gate once and HOLDS it open for the entire optimistic-projection lifetime
 * (`is_projecting`), releasing only when the projection clears — `release()` starts a short tail that
 * also covers the reconcile-commit render (which clears the projection in the same tick). The
 * projection round-trip is unbounded, so a fixed timer cannot cover it; the hold can. The caller drives
 * the drag edges itself via the returned gate (`hold()` on drag-start, `release()` on drag-end); the
 * gate is cancelled on unmount.
 *
 * The hold/release here is a passive effect, so on the reconcile render the FLIP layout effect still
 * observes the gate held (layout effects run before passive effects); the release then starts the tail.
 */
export function useFlipGate(is_projecting: boolean): PassiveUpdateGate {
    const gate_ref = useRef<PassiveUpdateGate | null>(null);
    if (gate_ref.current === null) { gate_ref.current = createPassiveUpdateGate(); }
    const was_projecting = useRef(false);

    useEffect(() => {
        const gate = gate_ref.current;
        if (is_projecting) {
            gate?.hold();
            was_projecting.current = true;
        } else if (was_projecting.current) {
            gate?.release();
            was_projecting.current = false;
        }
    }, [is_projecting]);

    useEffect(() => () => gate_ref.current?.cancel(), []);

    return gate_ref.current;
}
