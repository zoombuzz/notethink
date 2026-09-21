import Debug from "debug";
import { useSyncExternalStore } from "react";
import { parseActivityMessage, parseActivityUnavailableMessage, type ActivitySnapshot, type ActivityUnavailable } from "./agentactivityops";

const debug = Debug("nodejs:notethink-views:activityhooks");

/**
 * The webview's store of the latest agent activity snapshot, and the hooks components read it through.
 *
 * Agent activity is workspace-wide rather than per-view, and it is neither a document nor a note, so
 * it does not travel down the composer's doc pipeline with either. It arrives on its own `activity`
 * message and is held here, in one module-level store that every card and every view reads from
 * through useSyncExternalStore. That keeps the payload off NoteProps and off ViewProps, which is what
 * the contract asks for: the join to a card is made at render, from a story's own path and id.
 *
 * The snapshot starts undefined rather than empty, because the two say different things: undefined is
 * a board that has not heard from the host yet, while a snapshot with empty arrays is the host saying
 * no producer is writing anywhere it can see. A card that drew the second answer while the first was
 * true would state something it had not been told.
 *
 * The window listener is attached on the first subscription rather than at import, so the module has
 * no side effect until something renders against it, and is detached when the last subscriber leaves.
 * Each held value is replaced only when its message lands, so identities are stable between messages
 * and useSyncExternalStore does not re-render on every check.
 */

let snapshot: ActivitySnapshot | undefined = undefined;
let unavailable: ActivityUnavailable | undefined = undefined;
const listeners = new Set<() => void>();
let attached = false;

function publish(): void {
    for (const listener of listeners) { listener(); }
}

function onWindowMessage(event: MessageEvent): void {
    const next = parseActivityMessage(event.data);
    if (next) {
        debug('activity snapshot: %d producer(s), %d session(s), %d tree(s)', next.producers.length, next.sessions.length, next.trees.length);
        snapshot = next;
        publish();
        return;
    }
    const refused = parseActivityUnavailableMessage(event.data);
    if (refused) {
        debug('activity %s unavailable: %s', refused.request, refused.reason);
        unavailable = refused;
        publish();
    }
}

function attach(): void {
    if (attached || typeof window === 'undefined') { return; }
    window.addEventListener('message', onWindowMessage);
    attached = true;
}

function detach(): void {
    if (!attached || typeof window === 'undefined') { return; }
    window.removeEventListener('message', onWindowMessage);
    attached = false;
}

/** the snapshot as it stands, undefined until the host has spoken, with an identity that changes only when a new one lands */
export function readActivitySnapshot(): ActivitySnapshot | undefined {
    return snapshot;
}

/** the host's last answer that a row's request could not be carried out, undefined when it has refused nothing */
export function readActivityUnavailable(): ActivityUnavailable | undefined {
    return unavailable;
}

/** subscribe to store changes; the returned function unsubscribes, detaching the listener with the last subscriber */
export function subscribeToActivity(listener: () => void): () => void {
    listeners.add(listener);
    attach();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { detach(); }
    };
}

/** replace the held snapshot and tell every subscriber; the seam a test drives without a window message */
export function setActivitySnapshot(next: ActivitySnapshot | undefined): void {
    snapshot = next;
    publish();
}

/** return the store to its pre-message state, for a test that must not inherit the previous one's values */
export function resetActivitySnapshot(): void {
    snapshot = undefined;
    unavailable = undefined;
    publish();
}

/** the latest activity snapshot, re-rendering the caller when a new one arrives */
export function useAgentActivity(): ActivitySnapshot | undefined {
    return useSyncExternalStore(subscribeToActivity, readActivitySnapshot, readActivitySnapshot);
}

/** the host's latest refusal of a row's request, re-rendering the caller when one arrives */
export function useActivityUnavailable(): ActivityUnavailable | undefined {
    return useSyncExternalStore(subscribeToActivity, readActivityUnavailable, readActivityUnavailable);
}
