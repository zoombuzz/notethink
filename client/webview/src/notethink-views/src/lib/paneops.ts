import { PANE_VIEW_STATE_ID } from "./viewstateops";
import { chainOf, registryWithUserTypes } from "./viewregistryops";
import type { UserViewType } from "../types/Messages";

/**
 * The split's share bounds: the first pane's fraction of the width, so neither pane can be dragged
 * shut and both always keep a usable toolbar.
 */
export const SPLIT_RATIO_DEFAULT = 0.5;
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;

/** Keyboard resize step, as a fraction of the split's width. */
export const SPLIT_RATIO_KEY_STEP = 0.05;

/**
 * Clamps a split ratio into its bounds; anything that is not a finite number, such as a value a hand-edited
 * persisted state carries, falls back to the default so the split always renders.
 */
export function clampSplitRatio(ratio: unknown): number {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio)) { return SPLIT_RATIO_DEFAULT; }
    return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

/**
 * Whether the split is open: the second pane has an entry in the persisted view states. The entry is
 * the only record of the split, so a reload restores it with no second source of truth.
 */
export function isSplitOpen(view_state_ids: readonly string[] | undefined): boolean {
    return view_state_ids?.includes(PANE_VIEW_STATE_ID) ?? false;
}

/**
 * The view type a new second pane opens with: a document beside a board, or a board beside anything
 * else, since two panes drawing the same type show nothing the first does not. A board is any type whose
 * chain passes through kanban, so a minted kanban type counts.
 */
export function newPaneViewType(primary_type: string, user_types: UserViewType[] = []): string {
    const is_board = chainOf(primary_type, registryWithUserTypes(user_types)).includes('kanban');
    return is_board ? 'document' : 'kanban';
}

/**
 * The view-state update that opens the second pane, for setViewManagedState. The pane starts at the
 * default ratio with its own view type and nothing else, so it inherits every other setting from the
 * cascade like any view and carries no copy of the first pane's focus.
 */
export function buildOpenPaneUpdate(primary_type: string, user_types: UserViewType[] = []): Record<string, unknown> {
    return {
        id: PANE_VIEW_STATE_ID,
        type: newPaneViewType(primary_type, user_types),
        display_options: { split_ratio: SPLIT_RATIO_DEFAULT },
    };
}
