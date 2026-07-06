import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * Geometry regression guard: a live pointer-drag clone must track the cursor. @hello-pangea/dnd positions
 * the fixed clone by translating the card so the grabbed point stays under the pointer; the card stays in place
 * under its column (no portal) and the FLIP gate suppresses ancestor transforms for the whole drag, so that
 * translation lands where dnd intends. draggableProps and dragHandleProps spread onto the same card-root
 * element, so grabbing the handle centre grabs the card centre - the clone centre and pointer coincide. This
 * spec steps the pointer across the board and asserts the clone's bounding-box centre stays within a few
 * pixels of the pointer at every step. The pre-fix bug (a transformed ancestor re-anchoring the fixed clone)
 * showed up exactly here: the card drifted away from the cursor as it moved.
 */
const TRACKING_TOLERANCE_PX = 8;
const TRACKING_STEP_COUNT = 8;

test.describe('Kanban drag cursor tracking - the clone follows the pointer', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupKanbanView(page: Page): Promise<void> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    }

    test('the drag clone centre stays under the pointer across a stepped move', async ({ page }) => {
        await setupKanbanView(page);

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        const done_column = page.locator('[role="region"][aria-label="done"]');
        await expect(doing_column.getByRole('heading', { name: 'Task B' })).toBeVisible({ timeout: 3000 });

        const handle = doing_column.locator('[data-rfd-drag-handle-draggable-id]').first();
        const start = await handle.boundingBox();
        const end = await done_column.boundingBox();
        if (!start || !end) { throw new Error('missing bounding box for drag endpoints'); }

        // grab at the card centre so the clone centre and the pointer coincide throughout the drag
        const from_x = start.x + start.width / 2;
        const from_y = start.y + start.height / 2;
        const to_x = end.x + end.width / 2;
        const to_y = end.y + 60;

        await page.mouse.move(from_x, from_y);
        await page.mouse.down();
        await page.mouse.move(from_x, from_y + 6, { steps: 4 });

        // wait-for dnd to lift the grabbed card (it gains the 'dragging' class) before measuring, rather than a fixed sleep
        const clone = page.locator('[data-rfd-draggable-id].dragging');
        await expect(clone).toBeVisible({ timeout: 3000 });

        for (let step = 1; step <= TRACKING_STEP_COUNT; step++) {
            const ratio = step / TRACKING_STEP_COUNT;
            const pointer_x = from_x + (to_x - from_x) * ratio;
            const pointer_y = from_y + (to_y - from_y) * ratio;
            await page.mouse.move(pointer_x, pointer_y, { steps: 3 });
            /*
             * poll the clone centre until it settles under the pointer: dnd repositions the clone on the next
             * animation frame, so expect.poll is the wait-for that absorbs that one-frame lag without a sleep.
             * the metric is the larger of the two axis offsets, so a drift on either axis fails the step.
             */
            await expect
                .poll(async (): Promise<number> => {
                    const box = await clone.boundingBox();
                    if (!box) { return Number.POSITIVE_INFINITY; }
                    const centre_x = box.x + box.width / 2;
                    const centre_y = box.y + box.height / 2;
                    return Math.max(Math.abs(centre_x - pointer_x), Math.abs(centre_y - pointer_y));
                }, { timeout: 1000, message: `clone centre drifted from the pointer at step ${step}` })
                .toBeLessThanOrEqual(TRACKING_TOLERANCE_PX);
        }

        await page.mouse.up();
    });
});
