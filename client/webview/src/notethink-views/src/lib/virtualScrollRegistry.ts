import Debug from "debug";

const debug = Debug("nodejs:notethink-views:virtualScrollRegistry");

/**
 * What one virtualized lane hands the registry, so a caret move elsewhere can ask it to scroll a
 * card into the mounted window before `useScrollToCaret`'s DOM-based framing runs.
 * - stable_ids: the lane's cards in render order (index is position in this array)
 * - scrollToIndex: asks the lane's list instance to bring that row into its scrollport
 */
export interface RegisteredVirtualLane {
    stable_ids: ReadonlyArray<string>;
    scrollToIndex: (index: number) => void;
}

/*
 * view_id -> lane key -> the lane currently mounted for it. Module-scope rather than context: the
 * writer (a lane under a view's board) and the reader (`useScrollToCaret`, a view-level hook) share
 * no ancestor that could hold a context value between them. Lives in lib/, not kanban/, since the
 * reader is view-agnostic even though kanban is its one writer today.
 *
 * Keyed by note identity, never seq, since a registration written on one render is read from an
 * effect on another - the cross-update-boundary case that requires resolving through an identity.
 */
const registry = new Map<string, Map<string, RegisteredVirtualLane>>();

/** Register (or replace) the lane a view's column currently renders. Call again whenever its card order changes. */
export function registerVirtualLane(view_id: string, lane_key: string, lane: RegisteredVirtualLane): void {
    let by_lane = registry.get(view_id);
    if (!by_lane) {
        by_lane = new Map();
        registry.set(view_id, by_lane);
    }
    by_lane.set(lane_key, lane);
}

/** Drop a lane's registration, on unmount or when its view stops virtualizing (orientation flip). */
export function unregisterVirtualLane(view_id: string, lane_key: string): void {
    const by_lane = registry.get(view_id);
    if (!by_lane) { return; }
    by_lane.delete(lane_key);
    if (by_lane.size === 0) { registry.delete(view_id); }
}

/**
 * Ask whichever registered lane holds `note_id` to scroll it into the mounted window. Returns true
 * when a lane handled it (the caller waits a frame for the row to mount before framing it), false
 * when no virtualized lane has this note, the caller's signal to frame immediately as before.
 */
export function scrollVirtualLaneToNoteId(view_id: string, note_id: string): boolean {
    const by_lane = registry.get(view_id);
    if (!by_lane) { return false; }
    for (const lane of by_lane.values()) {
        const index = lane.stable_ids.indexOf(note_id);
        if (index >= 0) {
            debug('scrolling virtual lane to note_id=%s at index=%d', note_id, index);
            lane.scrollToIndex(index);
            return true;
        }
    }
    return false;
}

/** test-only: drop every registration, so one test's lanes cannot leak into the next */
export function resetVirtualScrollRegistryForTests(): void {
    registry.clear();
}
