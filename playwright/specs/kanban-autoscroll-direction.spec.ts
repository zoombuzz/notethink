import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * Regression guard for @hello-pangea/dnd's fluid auto-scroller under the drag-clone portal fix. The kanban board
 * root ([data-flip-root], overflow-x:auto) is the horizontal scroll container. With enough fixed-min-width columns
 * to overflow the viewport, holding a drag near the far edge must auto-scroll the board TOWARD that edge so the user
 * can reach off-screen columns, and releasing the drop must NOT snap the scroll position backward toward the start.
 * This drags a card from the leftmost column, holds the pointer at the board's right edge, polls scrollLeft to prove
 * it advances, then drops and proves the scroll offset holds.
 */
const AUTOSCROLL_MIN_PX = 24;

// releasing the drop must not reset the scroll toward the origin; allow a hair of settle jitter, catch a real snap-back
const BACKWARD_TOLERANCE_PX = 24;

test.describe('Kanban drag auto-scroll follows the drag direction', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupKanbanView(page: Page): Promise<string> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban-wide.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        return doc_path;
    }

    // current horizontal scroll offset of the board scroll container
    async function getScrollLeft(page: Page): Promise<number> {
        return page.evaluate(() => {
            const el = document.querySelector<HTMLElement>('[data-flip-root]');
            return el ? el.scrollLeft : 0;
        });
    }

    test('holding a drag near the far edge auto-scrolls the board toward the drag, and the drop does not scroll it back', async ({ page }) => {
        // the wide fixture's fixed-min-width columns overflow the default viewport, creating a horizontal scroll axis
        await setupKanbanView(page);

        // guard: the board genuinely overflows, so there is a horizontal axis to auto-scroll
        await page.waitForFunction(() => {
            const el = document.querySelector<HTMLElement>('[data-flip-root]');
            return !!el && el.scrollWidth > el.clientWidth + 20;
        }, { timeout: 5000 });

        const board_box = await page.locator('[data-flip-root]').boundingBox();
        if (!board_box) { throw new Error('missing bounding box for the board scroll container'); }

        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        const handle = backlog_column.locator('[data-rfd-drag-handle-draggable-id]').first();
        await expect(handle).toBeVisible({ timeout: 5000 });
        const start = await handle.boundingBox();
        if (!start) { throw new Error('missing bounding box for the drag handle'); }

        const initial_scroll = await getScrollLeft(page);

        // lift the leftmost card past dnd's start threshold, deliberately not releasing
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down();
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 8, { steps: 5 });

        // wait-for dnd to lift the grabbed card (it gains the 'dragging' class) before driving the auto-scroll
        const clone = page.locator('[data-rfd-draggable-id].dragging');
        await expect(clone).toBeVisible({ timeout: 3000 });

        // hold the pointer at the board's far-right inner edge, where dnd's fluid scroller engages toward that edge
        const edge_x = board_box.x + board_box.width - 6;
        const edge_y = board_box.y + board_box.height / 2;
        await page.mouse.move(edge_x, edge_y, { steps: 10 });

        /*
         * poll scrollLeft while re-asserting the pointer inside the edge zone each round (a 1px toggle) so the fluid
         * scroller keeps ticking. the offset must climb ABOVE the start, proving the board scrolled toward the drag.
         */
        let toggle = 0;
        await expect
            .poll(async (): Promise<number> => {
                toggle = toggle === 0 ? 1 : 0;
                await page.mouse.move(edge_x, edge_y + toggle);
                return getScrollLeft(page);
            }, { timeout: 6000, message: 'the board did not auto-scroll toward the held drag edge' })
            .toBeGreaterThan(initial_scroll + AUTOSCROLL_MIN_PX);

        const scrolled_during_drag = await getScrollLeft(page);
        // the scroll moved TOWARD the far edge the drag is held against, not away from it
        expect(scrolled_during_drag).toBeGreaterThan(initial_scroll);

        // drop where the pointer is holding
        await page.mouse.up();
        // wait-for the drop to settle: the clone leaves the portal host
        await expect(clone).toHaveCount(0, { timeout: 3000 });

        // the drop must not scroll the board backward toward its origin - the auto-scrolled offset holds
        const scroll_after_drop = await getScrollLeft(page);
        expect(scroll_after_drop, 'the drop scrolled the board backward toward the start').toBeGreaterThanOrEqual(scrolled_during_drag - BACKWARD_TOLERANCE_PX);
    });
});
