import type { Locator, Page } from '@playwright/test';

export interface PointerDragOptions {
    max_press_offset?: number;
    pre_release_settle_ms?: number;
    post_release_settle_ms?: number;
}

/*
 * gesture defaults. The settle waits give dnd's rAF-driven lift and drop phases time to run; a drag
 * driven without them races the sensor and drops on the source. Only the two either side of the
 * release are overridable, because they are the only ones a caller has ever needed to move.
 */
const PRE_RELEASE_SETTLE_MS = 100;
const POST_RELEASE_SETTLE_MS = 400;
const DESTINATION_INSET_Y = 60;
const THRESHOLD_NUDGE_PX = 8;
const LIFT_SETTLE_MS = 150;
const TRAVEL_SETTLE_MS = 150;

/**
 * drive @hello-pangea/dnd's pointer sensor with a real mouse gesture: press on the card, nudge past
 * the drag threshold, travel over the destination in steps so dnd tracks the move, settle, release.
 * This is a different code path from the keyboard sensor - it has a position:fixed clone, a
 * transform that follows the cursor, and a drop tween - so specs that care about drop behaviour
 * drive it rather than pressing Space.
 *
 * `max_press_offset` caps how far below the handle's top edge the press lands, for a card taller
 * than the viewport whose centre would be off-screen. `post_release_settle_ms` of 0 skips the wait
 * entirely, for a spec that measures the echo itself and must not have the drop settled for it.
 */
export async function pointerDrag(page: Page, handle: Locator, destination: Locator, options: PointerDragOptions = {}): Promise<void> {
    const start = await handle.boundingBox();
    const end = await destination.boundingBox();
    if (!start || !end) { throw new Error('pointerDrag: missing bounding box'); }
    const pre_release_settle_ms = options.pre_release_settle_ms ?? PRE_RELEASE_SETTLE_MS;
    const post_release_settle_ms = options.post_release_settle_ms ?? POST_RELEASE_SETTLE_MS;
    const press_offset = options.max_press_offset === undefined
        ? start.height / 2
        : Math.min(start.height / 2, options.max_press_offset);

    const from_x = start.x + start.width / 2;
    const from_y = start.y + press_offset;
    const to_x = end.x + end.width / 2;
    const to_y = end.y + DESTINATION_INSET_Y;

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
