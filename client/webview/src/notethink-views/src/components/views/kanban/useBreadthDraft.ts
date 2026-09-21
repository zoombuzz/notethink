import { useSyncExternalStore } from "react";

/*
 * The breadth a drag is holding but has not yet written, keyed by view id.
 *
 * The board and the settings drawer are siblings under the view, and both have to show the same number while
 * a lane boundary is being dragged: the lanes follow it and the drawer's text box reads it. A module-level
 * store gives them one value without threading a callback through every layer between them, and because the
 * setting is only written on release, nothing else needs to know a drag is in flight.
 */
const drafts = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** hold `breadth` for a view, or drop the draft when it is undefined, and tell every reader */
export function setBreadthDraft(view_id: string, breadth: number | undefined): void {
    if (breadth === undefined) {
        if (!drafts.delete(view_id)) { return; }
    } else {
        if (drafts.get(view_id) === breadth) { return; }
        drafts.set(view_id, breadth);
    }
    listeners.forEach(listener => listener());
}

/** the breadth a view's drag is holding, or undefined when nothing is being dragged */
export function useBreadthDraft(view_id: string): number | undefined {
    return useSyncExternalStore(subscribe, () => drafts.get(view_id), () => undefined);
}
