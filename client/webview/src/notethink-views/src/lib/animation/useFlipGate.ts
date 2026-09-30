import { useEffect, useRef } from 'react';
import { createPassiveUpdateGate, type PassiveUpdateGate } from './passiveUpdateGate';

/**
 * Owns the FLIP passive-update gate's lifecycle for a kanban view, telling the FLIP layer when a layout
 * change is the user's own move (drag + optimistic projection + reconciling echo) so it is never
 * re-animated. Holds the gate open for the whole `is_projecting` lifetime, since that round-trip is
 * unbounded and a fixed timer can't cover it; `release()` then starts a short tail covering the
 * reconcile-commit render, which the FLIP layout effect still observes held (layout effects run before
 * this passive one). The caller drives `hold()`/`release()` at the drag edges; the gate cancels on unmount.
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
