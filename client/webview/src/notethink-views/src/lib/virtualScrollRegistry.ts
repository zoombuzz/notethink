import Debug from "debug";

const debug = Debug("nodejs:notethink-views:virtualScrollRegistry");

/**
 * What one virtualized group hands the registry, so a caret move elsewhere can ask it to scroll a
 * card into the mounted window before `useScrollToCaret`'s DOM-based framing runs.
 * - stable_ids: the group's cards in render order (index is position in this array)
 * - scrollToIndex: asks the group's list instance to bring that row into its scrollport
 */
export interface RegisteredVirtualGroup {
    stable_ids: ReadonlyArray<string>;
    scrollToIndex: (index: number) => void;
}

/*
 * view_id -> group key -> the group currently mounted for it. Module-scope rather than context: the
 * writer (a group under a view's board) and the reader (`useScrollToCaret`, a view-level hook) share
 * no ancestor that could hold a context value between them. Lives in lib/, not kanban/, since the
 * reader is view-agnostic even though kanban is its one writer today.
 *
 * Keyed by note identity, never seq, since a registration written on one render is read from an
 * effect on another - the cross-update-boundary case that requires resolving through an identity.
 */
const registry = new Map<string, Map<string, RegisteredVirtualGroup>>();

/** Register (or replace) the group a view's column currently renders. Call again whenever its card order changes. */
export function registerVirtualGroup(view_id: string, group_key: string, group: RegisteredVirtualGroup): void {
    let by_group = registry.get(view_id);
    if (!by_group) {
        by_group = new Map();
        registry.set(view_id, by_group);
    }
    by_group.set(group_key, group);
}

/** Drop a group's registration, on unmount or when its view stops virtualizing (orientation flip). */
export function unregisterVirtualGroup(view_id: string, group_key: string): void {
    const by_group = registry.get(view_id);
    if (!by_group) { return; }
    by_group.delete(group_key);
    if (by_group.size === 0) { registry.delete(view_id); }
}

/**
 * Ask whichever registered group holds `note_id` to scroll it into the mounted window. Returns true
 * when a group handled it (the caller waits a frame for the row to mount before framing it), false
 * when no virtualized group has this note, the caller's signal to frame immediately as before.
 */
export function scrollVirtualGroupToNoteId(view_id: string, note_id: string): boolean {
    const by_group = registry.get(view_id);
    if (!by_group) { return false; }
    for (const group of by_group.values()) {
        const index = group.stable_ids.indexOf(note_id);
        if (index >= 0) {
            debug('scrolling virtual group to note_id=%s at index=%d', note_id, index);
            group.scrollToIndex(index);
            return true;
        }
    }
    return false;
}

/** test-only: drop every registration, so one test's groups cannot leak into the next */
export function resetVirtualScrollRegistryForTests(): void {
    registry.clear();
}
