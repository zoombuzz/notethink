import type { Locator, Page } from '@playwright/test';

export interface PointerDragOptions {
    max_press_offset?: number;
    destination_inset_y?: number;
    pre_release_settle_ms?: number;
    post_release_settle_ms?: number;
}

/*
 * Gesture defaults. The settle waits give dnd's rAF-driven lift and drop phases time to run; a drag
 * driven without them races the sensor and drops on the source. Only the two either side of the
 * release, and the drop point's vertical inset, are overridable; nothing else has needed to move.
 */
const PRE_RELEASE_SETTLE_MS = 100;
const POST_RELEASE_SETTLE_MS = 400;
const DESTINATION_INSET_Y = 60;
const THRESHOLD_NUDGE_PX = 8;
const LIFT_SETTLE_MS = 150;
const TRAVEL_SETTLE_MS = 150;
// how long a locator's box may keep moving before pointerDrag gives up waiting for it to settle
const BOX_SETTLE_TIMEOUT_MS = 2000;
const BOX_SETTLE_POLL_MS = 30;

/**
 * A point inside the visible part of a box, since a kanban group or a card standing at the target
 * card ratio can run off both edges of the window. The wanted offset is honoured whenever it lands
 * on screen, so a box that fits is unaffected; otherwise the point falls back to the middle of the
 * visible band. A box with no visible band at all throws, because a coordinate outside the viewport
 * dispatches no pointer event and would fail later as a drag that silently never started.
 */
function visiblePointY(box: { y: number; height: number }, offset: number, viewport_height: number): number {
    const top = Math.max(box.y, 0);
    const bottom = Math.min(box.y + box.height, viewport_height);
    if (bottom <= top) {
        throw new Error(`pointerDrag: box lies entirely outside the viewport (y ${box.y}, height ${box.height}, viewport height ${viewport_height})`);
    }
    const wanted = box.y + offset;
    return wanted > top && wanted < bottom ? wanted : (top + bottom) / 2;
}

type Box = { x: number; y: number; width: number; height: number };

function sameBox(a: Box, b: Box): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The locator's bounding box once two consecutive reads agree, so a drag computed right after a
 * settings round trip (or any other async layout settling, such as a drawer marker appearing or a
 * scroll-into-view still animating) doesn't press or drop at a coordinate the page has already
 * moved on from by the time the mouse event actually fires. Polling on a short bounded interval is
 * an observable-condition wait, not a guessed fixed delay: it returns as soon as the box stops
 * moving, and throws if it never does within the timeout, which is itself a real finding (an
 * animation that never settles) rather than something to paper over.
 */
async function stableBoundingBox(page: Page, locator: Locator): Promise<Box> {
    const deadline = Date.now() + BOX_SETTLE_TIMEOUT_MS;
    let previous = await locator.boundingBox();
    if (!previous) { throw new Error('pointerDrag: missing bounding box'); }
    for (;;) {
        await page.waitForTimeout(BOX_SETTLE_POLL_MS);
        const next = await locator.boundingBox();
        if (!next) { throw new Error('pointerDrag: missing bounding box'); }
        if (sameBox(previous, next)) { return next; }
        if (Date.now() > deadline) {
            throw new Error(`pointerDrag: bounding box never settled within ${BOX_SETTLE_TIMEOUT_MS}ms (still moving: ${JSON.stringify(previous)} -> ${JSON.stringify(next)})`);
        }
        previous = next;
    }
}

/**
 * Drives @hello-pangea/dnd's pointer sensor with a real mouse gesture: press on the card, nudge past
 * the drag threshold, travel over the destination in steps so dnd tracks the move, settle, release.
 * This is a different code path from the keyboard sensor - it has a position:fixed clone, a
 * transform that follows the cursor, and a drop tween - so specs that care about drop behaviour
 * drive it rather than pressing Space.
 *
 * `max_press_offset` caps how far below the handle's top edge the press lands, for a card taller
 * than the viewport whose centre would be off-screen. `post_release_settle_ms` of 0 skips the wait
 * entirely, for a spec that measures the echo itself and must not have the drop settled for it.
 * `destination_inset_y` overrides the drop point's offset below the destination's top edge; the default
 * aims well inside a tall kanban group, which overshoots a target only a line high.
 *
 * The handle's and destination's boxes are read only once they've stopped moving (`stableBoundingBox`):
 * reading them immediately after a preceding action (a settings write, a scroll) can catch the page
 * mid-reflow, and the coordinates computed from that stale box are what the mouse actually presses or
 * drops on - a race that shows up as the drop landing on the wrong chip or registering as a no-op.
 */
export async function pointerDrag(page: Page, handle: Locator, destination: Locator, options: PointerDragOptions = {}): Promise<void> {
    const start = await stableBoundingBox(page, handle);
    const end = await stableBoundingBox(page, destination);
    const viewport = page.viewportSize();
    if (!viewport) { throw new Error('pointerDrag: page has no viewport size'); }
    const pre_release_settle_ms = options.pre_release_settle_ms ?? PRE_RELEASE_SETTLE_MS;
    const post_release_settle_ms = options.post_release_settle_ms ?? POST_RELEASE_SETTLE_MS;
    const press_offset = options.max_press_offset === undefined
        ? start.height / 2
        : Math.min(start.height / 2, options.max_press_offset);
    const destination_inset_y = options.destination_inset_y ?? DESTINATION_INSET_Y;

    const from_x = start.x + start.width / 2;
    const from_y = visiblePointY(start, press_offset, viewport.height);
    const to_x = end.x + end.width / 2;
    const to_y = visiblePointY(end, destination_inset_y, viewport.height);

    await page.mouse.move(from_x, from_y);
    await page.mouse.down();
    // nudge past dnd's start threshold, then let the lift settle
    await page.mouse.move(from_x, from_y + THRESHOLD_NUDGE_PX, { steps: 5 });
    await page.waitForTimeout(LIFT_SETTLE_MS);
    // travel to the destination column in steps so dnd tracks the move
    await page.mouse.move(to_x, to_y, { steps: 25 });
    await page.waitForTimeout(TRAVEL_SETTLE_MS);
    await page.mouse.move(to_x, to_y, { steps: 5 });
    await page.waitForTimeout(pre_release_settle_ms);
    await page.mouse.up();
    if (post_release_settle_ms > 0) {
        await page.waitForTimeout(post_release_settle_ms);
    }
}
