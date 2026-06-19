import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

/*
 * Real POINTER (mouse) drag-and-drop coverage for the kanban board. The existing kanban-drag.spec.ts
 * drives @hello-pangea/dnd via its KEYBOARD sensor (Space + arrows), which is a different code path
 * from a mouse drag (no position:fixed clone, no transform-follows-cursor, no drop tween). This spec
 * exercises the pointer sensor so a regression in the live mouse-drag path is caught - the FLIP
 * passive-transition layer must never interfere with a user's own drag.
 */
test.describe('Kanban Pointer Drag and Drop', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupKanbanView(page: Page): Promise<{ id: string; path: string }> {
        const { id, path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        return { id, path: doc_path };
    }

    /**
     * Drive @hello-pangea/dnd's pointer sensor with a real mouse gesture: press on the card, nudge past
     * the drag threshold, move over the destination column in steps, settle, then release. The settle
     * waits give dnd's rAF-driven lift/drop phases time to run.
     */
    async function pointerDrag(page: Page, handle: Locator, destination: Locator): Promise<void> {
        const start = await handle.boundingBox();
        const end = await destination.boundingBox();
        if (!start || !end) { throw new Error('pointerDrag: missing bounding box'); }

        const from_x = start.x + start.width / 2;
        const from_y = start.y + start.height / 2;
        const to_x = end.x + end.width / 2;
        const to_y = end.y + 60;

        await page.mouse.move(from_x, from_y);
        await page.mouse.down();
        // nudge past dnd's start threshold, then let the lift settle
        await page.mouse.move(from_x, from_y + 8, { steps: 5 });
        await page.waitForTimeout(150);
        // travel to the destination column in steps so dnd tracks the move
        await page.mouse.move(to_x, to_y, { steps: 25 });
        await page.waitForTimeout(150);
        await page.mouse.move(to_x, to_y, { steps: 5 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(400);
    }

    test('pointer-dragging a card to another column sends editText and lands the card', async ({ page }) => {
        await setupKanbanView(page);

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        const done_column = page.locator('[role="region"][aria-label="done"]');
        await expect(doing_column.getByRole('heading', { name: 'Task B' })).toBeVisible({ timeout: 3000 });

        const task_b_handle = doing_column.locator('[data-rfd-drag-handle-draggable-id]').first();

        await clearCapturedMessages(page);
        await pointerDrag(page, task_b_handle, done_column);

        // the drag must have completed: an editText with a status change was posted to the extension
        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m) => m.type === 'editText');
        expect(edit_msg, 'pointer drag did not produce an editText (drag did not complete)').toBeDefined();
        const changes = edit_msg!.changes as Array<{ from: number; to?: number; insert: string }>;
        expect(changes.length).toBeGreaterThanOrEqual(1);
        expect(changes.some(c => c.to !== undefined && c.insert !== 'doing')).toBe(true);

        // the card visibly lands in the destination column (projection holds it there with no snap-back)
        await expect(done_column.getByRole('heading', { name: 'Task B' })).toBeVisible({ timeout: 3000 });
        expect(await doing_column.getByRole('heading', { name: 'Task B' }).count()).toBe(0);
    });

    test('pointer drag leaves no card stuck under a transform and the board stays interactive', async ({ page }) => {
        await setupKanbanView(page);

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        const done_column = page.locator('[role="region"][aria-label="done"]');
        const task_b_handle = doing_column.locator('[data-rfd-drag-handle-draggable-id]').first();

        await pointerDrag(page, task_b_handle, done_column);
        // let any settle/projection-reconcile finish
        await page.waitForTimeout(700);

        /*
         * no card may be left with a residual inline transform (a FLIP invert that never cleared, or a
         * dnd drop tween that got clobbered) - that is the visible "broken drag" symptom
         */
        const stuck = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-flip-id]'));
            return cards
                .filter(el => {
                    const inline = el.style.transform;
                    const computed = getComputedStyle(el).transform;
                    const has_inline = inline !== '' && inline !== 'none';
                    const has_computed = computed !== '' && computed !== 'none';
                    return has_inline || has_computed;
                })
                .map(el => ({ id: el.getAttribute('data-flip-id'), inline: el.style.transform, computed: getComputedStyle(el).transform }));
        });
        expect(stuck, `cards left under a residual transform: ${JSON.stringify(stuck)}`).toEqual([]);

        // the board is still rendered and interactive (not blanked or frozen)
        const headers = page.locator('[role="columnheader"]');
        expect(await headers.count()).toBeGreaterThanOrEqual(3);
    });
});
