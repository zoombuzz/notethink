/*
 * Pure sizing math for a virtualized (columns-orientation) lane's card list. `useCardHeightCache` wraps
 * the measured-height map this reads and writes; `VirtualizedKanbanColumn` is the only caller.
 */

// a card with no measurement yet (not rendered since the last board reflow) sizes its row at this guess
export const DEFAULT_ESTIMATED_CARD_HEIGHT = 160;

/** The gap `.notes { gap: 20px }` draws for a non-virtual lane, baked into each row's own size since an absolutely positioned row has no `gap` to inherit. */
export const CARD_ROW_GAP = 20;

// rows kept mounted above/below the visible window, so a fast scroll or drag auto-scroll never outruns what's rendered
export const LANE_OVERSCAN_COUNT = 8;

/** The shortest a lane's virtualized list is ever given, so an early render or short pane still shows more than a sliver of the first card. */
export const MIN_LANE_LIST_HEIGHT = 160;

// space left below the lane list and the bottom of the window, matching the page's own scroll margins
export const LANE_LIST_BOTTOM_MARGIN = 16;

/**
 * One virtual row's height, in px: measured height (falling back to the shared target, then a flat
 * estimate) plus the gap below it. The first card's focus-ring padding needs no row of its own here:
 * `VirtualizedKanbanColumn` renders inside `KanbanColumn`'s existing `.notes` padding, which shifts
 * where rows start but never enters this per-row math.
 */
export function rowSizeFor(measured_height: number | undefined, estimated_card_height: number | undefined): number {
    const card_height = measured_height ?? estimated_card_height ?? DEFAULT_ESTIMATED_CARD_HEIGHT;
    return card_height + CARD_ROW_GAP;
}

/**
 * The lane list's height, clamped to the floor. `available` is undefined until the board has been
 * measured once, which tells the caller to keep whatever fallback height it was already rendering at.
 */
export function laneListHeight(available: number | undefined): number {
    if (available === undefined || !Number.isFinite(available)) { return MIN_LANE_LIST_HEIGHT; }
    return Math.max(available - LANE_LIST_BOTTOM_MARGIN, MIN_LANE_LIST_HEIGHT);
}

/** the sum of every row's own size, in px - what a lane's list would stand were it not capped to the viewport */
export function totalContentHeight(row_sizes: ReadonlyArray<number>): number {
    return row_sizes.reduce((total, size) => total + size, 0);
}

/**
 * Each row's top-edge offset (px) within the lane's content: row `i` spans `[offsets[i], offsets[i] +
 * row_sizes[i])`. Rebuilt fresh from the current id order on every call, so a reorder needs no
 * separate invalidation step.
 */
export function rowOffsets(row_sizes: ReadonlyArray<number>): Array<number> {
    const offsets: Array<number> = [];
    let running = 0;
    for (const size of row_sizes) {
        offsets.push(running);
        running += size;
    }
    return offsets;
}

/** first and last row index (inclusive) to mount; `end < start` only for an empty list. */
export interface VisibleRowRange {
    start: number;
    end: number;
}

/**
 * Row indices intersecting `[scroll_offset, scroll_offset + viewport_size)`, padded by
 * `overscan_count` rows on each side and clamped to the list's bounds. `scroll_offset` is how far the
 * page has scrolled past the lane's top edge, not a `scrollTop` of the lane's own - it has none.
 */
export function visibleRowRange(
    row_sizes: ReadonlyArray<number>,
    scroll_offset: number,
    viewport_size: number,
    overscan_count: number,
): VisibleRowRange {
    if (row_sizes.length === 0) { return { start: 0, end: -1 }; }
    const offsets = rowOffsets(row_sizes);
    const viewport_start = scroll_offset;
    const viewport_end = scroll_offset + viewport_size;
    let first: number | undefined;
    let last: number | undefined;
    for (let index = 0; index < row_sizes.length; index += 1) {
        const row_start = offsets[index];
        const row_end = row_start + row_sizes[index];
        if (row_end > viewport_start && row_start < viewport_end) {
            first = first === undefined ? index : Math.min(first, index);
            last = last === undefined ? index : Math.max(last, index);
        }
    }
    if (first === undefined || last === undefined) {
        // viewport sits wholly before or after every row: mount whichever edge it is closer to
        const at_start = viewport_start <= 0;
        return at_start
            ? { start: 0, end: Math.min(overscan_count, row_sizes.length - 1) }
            : { start: Math.max(0, row_sizes.length - 1 - overscan_count), end: row_sizes.length - 1 };
    }
    return {
        start: Math.max(0, first - overscan_count),
        end: Math.min(row_sizes.length - 1, last + overscan_count),
    };
}

/**
 * The scroll offset that brings row `index` into view with the least movement: unchanged if already
 * fully visible, otherwise flush with whichever edge it was off past. `VirtualizedKanbanColumn` sets
 * this directly to mount the row; `useScrollToCaret` scrolls the page once its position is measured.
 */
export function scrollOffsetForIndex(
    row_sizes: ReadonlyArray<number>,
    index: number,
    current_offset: number,
    viewport_size: number,
): number {
    const offsets = rowOffsets(row_sizes);
    const row_start = offsets[index] ?? 0;
    const row_size = row_sizes[index] ?? 0;
    const row_end = row_start + row_size;
    if (row_start >= current_offset && row_end <= current_offset + viewport_size) { return current_offset; }
    if (row_start < current_offset) { return row_start; }
    return Math.max(0, row_end - viewport_size);
}

/** clamp a scroll offset to what the content has to give, so an emptied lane cannot pin one past its own end */
export function clampScrollOffset(offset: number, content_height: number, viewport_size: number): number {
    const max_offset = Math.max(0, content_height - viewport_size);
    return Math.min(Math.max(0, offset), max_offset);
}

/**
 * Whether a lane's content genuinely exceeds the board's ceiling - the only case windowing helps.
 * Estimated from the flat `DEFAULT_ESTIMATED_CARD_HEIGHT`, not the solved card-target height: the
 * target is a ceiling a card clips down to, never a floor a short card is stretched up to, so using
 * it would over-count most lanes on a small board.
 *
 * `available_height` is `useLaneListHeight`'s unfloored reading, `undefined` before the board's first
 * measurement; that case answers `false`. @hello-pangea/dnd's keyboard sensor cannot tolerate a
 * lane's Droppable switching between virtual and plain mode near a drag, so a lane that virtualizes
 * on the bootstrap render can carry a broken cross-column move even after it corrects itself - a lane
 * that fits instead renders through the plain `Droppable`, never `VirtualizedKanbanColumn`.
 */
export function laneNeedsVirtualization(card_count: number, available_height: number | undefined): boolean {
    if (card_count <= 0 || available_height === undefined) { return false; }
    return card_count * rowSizeFor(undefined, DEFAULT_ESTIMATED_CARD_HEIGHT) > available_height;
}
