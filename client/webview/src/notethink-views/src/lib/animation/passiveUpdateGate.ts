import Debug from 'debug';
import { KANBAN_ANIMATION_DRAG_GATE_MS } from './flipMath';

const debug = Debug("nodejs:notethink-views:passiveUpdateGate");

/**
 * PassiveUpdateGate: a tiny stateful gate shared between KanbanView (which drives it from the drag
 * and projection lifecycle) and the FLIP hook (which reads it). while hot, the FLIP layer knows the
 * next layout change is the user's own move being shown/reconciled - not a passive external edit -
 * and suppresses its animation so a drag is never re-animated on top of @hello-pangea/dnd's drop.
 *
 * two ways to be hot:
 * - `hold()` / `release()`: held open for an indefinite span (the whole optimistic-projection
 *   lifetime, which can outlast any fixed timer because the document round-trip is unbounded).
 *   `release()` then starts a short tail so the projection→authoritative reconcile render - which
 *   commits in the same tick the projection clears - is still covered.
 * - `arm()`: a fixed `window_ms` timer, used for the brief drag-start window before the projection
 *   exists (and to bridge the gap until @hello-pangea/dnd's async drag-end fires).
 */
export interface PassiveUpdateGate {
    arm(): void;
    hold(): void;
    release(): void;
    isHot(): boolean;
    cancel(): void;
}

/**
 * create a passive-update gate. `isHot()` reports `held || (timer still open)`. `arm()` (re)starts the
 * `window_ms` timer; `hold()` pins it hot until `release()`, which clears the hold and starts a final
 * `window_ms` tail; `cancel()` clears everything (so a post-unmount read can never report hot). Uses a
 * timer flag rather than Date.now() so jest fake timers drive it deterministically.
 * default window_ms = KANBAN_ANIMATION_DRAG_GATE_MS.
 */
export function createPassiveUpdateGate(window_ms: number = KANBAN_ANIMATION_DRAG_GATE_MS): PassiveUpdateGate {
    let timer_hot = false;
    let held = false;
    let timeout_ref: ReturnType<typeof setTimeout> | null = null;
    const cancelTimeout = (): void => {
        if (timeout_ref !== null) {
            clearTimeout(timeout_ref);
            timeout_ref = null;
        }
    };
    const startTail = (): void => {
        cancelTimeout();
        timer_hot = true;
        timeout_ref = setTimeout(() => {
            timer_hot = false;
            timeout_ref = null;
        }, window_ms);
    };
    return {
        arm(): void {
            startTail();
        },
        hold(): void {
            cancelTimeout();
            timer_hot = false;
            held = true;
        },
        release(): void {
            held = false;
            startTail();
        },
        isHot(): boolean {
            return held || timer_hot;
        },
        cancel(): void {
            cancelTimeout();
            held = false;
            timer_hot = false;
        },
    };
}
