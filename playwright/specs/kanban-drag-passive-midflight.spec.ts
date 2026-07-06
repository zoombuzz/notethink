import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

/*
 * Regression guard for an authoritative document update that lands WHILE a user drag is in flight. In real VS Code an
 * external/AI edit (or the debounced watcher) can post an `update` at any moment, including while the user holds a
 * card. The fix must keep that update from disturbing the live gesture: settleFlipAnimations + flip_gate.hold suppress
 * the FLIP layer for the whole drag, and the body portal (useDragPortalNode + createPortal) keeps the fixed clone
 * anchored to the viewport so a board relayout underneath it cannot re-anchor and fling it. The pre-fix symptom was a
 * mid-drag edit either aborting the drag (clone snaps back / vanishes) or flinging the clone across the board.
 *
 * This pauses a real pointer drag of a doing-column card, injects a passive content edit to a NON-dragged backlog
 * card (its body text is reworded; no card changes index, stable_id, size, or column, so the live drag's
 * Draggable/Droppable structure is untouched - the one shape @hello-pangea/dnd tolerates being re-rendered under an
 * active drag), asserts the drag is not aborted and the viewport-anchored clone does not fling, then continues the
 * gesture and releases. Continuing to move the pointer after the mid-flight re-render is what a real user does and
 * is what lets dnd refresh its drop target, so the drop still lands.
 */
interface CloneBox {
    found: boolean;
    position: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

// a fling would move the viewport-fixed clone by hundreds of px; a stationary pointer plus a board relayout must not
const FLING_TOLERANCE_PX = 24;

test.describe('Kanban drag survives a passive mid-flight update - no abort, no fling', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupKanbanView(page: Page): Promise<string> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban-midflight.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        return doc_path;
    }

    // read the live in-place drag clone (the [data-rfd-draggable-id] element dnd lifted to position:fixed): its presence proves the drag is not aborted, its box proves it did not fling
    async function readCloneBox(page: Page): Promise<CloneBox> {
        return page.evaluate((): CloneBox => {
            const clone = Array.from(document.querySelectorAll<HTMLElement>('[data-rfd-draggable-id]')).find((el) => getComputedStyle(el).position === 'fixed') ?? null;
            if (!clone) { return { found: false, position: '', x: 0, y: 0, width: 0, height: 0 }; }
            const rect = clone.getBoundingClientRect();
            return {
                found: true,
                position: getComputedStyle(clone).position,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            };
        });
    }

    test('a passive board update mid-drag neither aborts the drag nor flings the clone, and the drop still lands', async ({ page }) => {
        const doc_path = await setupKanbanView(page);

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        const done_column = page.locator('[role="region"][aria-label="done"]');
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(doing_column.getByRole('heading', { name: 'Task B' })).toBeVisible({ timeout: 3000 });

        const handle = doing_column.locator('[data-rfd-drag-handle-draggable-id]').first();
        const start = await handle.boundingBox();
        const end = await done_column.boundingBox();
        if (!start || !end) { throw new Error('missing bounding box for drag endpoints'); }

        const from_x = start.x + start.width / 2;
        const from_y = start.y + start.height / 2;
        const to_x = end.x + end.width / 2;
        const to_y = end.y + 60;

        // lift Task B past dnd's start threshold, deliberately not releasing
        await page.mouse.move(from_x, from_y);
        await page.mouse.down();
        await page.mouse.move(from_x, from_y + 8, { steps: 5 });

        // wait-for dnd to lift the grabbed card (it gains the 'dragging' class) - the drag signal, not a fixed sleep
        const clone = page.locator('[data-rfd-draggable-id].dragging');
        await expect(clone).toBeVisible({ timeout: 3000 });

        // travel over the destination column and hold there (no mouse.up), so the passive update arrives during a genuinely live drag
        await page.mouse.move(to_x, to_y, { steps: 25 });
        await expect(clone).toBeVisible();

        const before = await readCloneBox(page);
        expect(before.found, 'no live drag clone before the passive update').toBe(true);
        expect(before.position).toBe('fixed');

        // inject the authoritative passive update WHILE the drag is live: reword a non-dragged backlog card's body; no card changes index, stable_id, size, or column
        await injectDocsFromFixture(page, 'kanban-midflight-edited.md', doc_path);

        // wait-for the authoritative update to land in the board mid-drag: the reworded Task A body renders
        await expect(backlog_column.getByText('task A edited midflight')).toBeVisible({ timeout: 3000 });

        // no abort: the clone is still live under the portal and still position:fixed
        const after = await readCloneBox(page);
        expect(after.found, 'the passive mid-drag update aborted the drag - the clone left the portal').toBe(true);
        expect(after.position, 'the drag clone lost its fixed positioning after the passive update').toBe('fixed');

        // no fling: the pointer never moved during the update, so the viewport-anchored clone must not have jumped despite the board relayout
        expect(Math.abs(after.x - before.x), 'the drag clone flung horizontally on the passive update').toBeLessThanOrEqual(FLING_TOLERANCE_PX);
        expect(Math.abs(after.y - before.y), 'the drag clone flung vertically on the passive update').toBeLessThanOrEqual(FLING_TOLERANCE_PX);

        // capture only the drop's own outbound message
        await clearCapturedMessages(page);

        /*
         * continue the gesture and release: the extra moves after the mid-flight re-render let dnd refresh its drop
         * target, and the short settle gives its rAF a frame to register the new target before mouse.up resolves the
         * drop onto the destination.
         */
        await page.mouse.move(to_x - 30, to_y, { steps: 5 });
        await page.mouse.move(to_x, to_y + 10, { steps: 5 });
        await page.waitForTimeout(150);
        await page.mouse.up();

        // the drop lands: Task B settles into done (optimistic projection) and is gone from doing
        await expect(done_column.getByRole('heading', { name: 'Task B' })).toBeVisible({ timeout: 3000 });
        expect(await doing_column.getByRole('heading', { name: 'Task B' }).count()).toBe(0);

        // and an editText that rewrites the status to the destination column value was posted
        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m) => m.type === 'editText');
        expect(edit_msg, 'the completed drag produced no editText - the drop did not land').toBeDefined();
        const changes = edit_msg!.changes as Array<{ from: number; to?: number; insert: string }>;
        expect(changes.some((c) => c.insert === 'done'), 'the drop did not rewrite the status to the destination column').toBe(true);

        // no card is stranded under a residual transform once the drop settles
        const stuck = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-flip-id]'));
            return cards
                .filter((el) => {
                    const inline = el.style.transform;
                    const computed = getComputedStyle(el).transform;
                    return (inline !== '' && inline !== 'none') || (computed !== '' && computed !== 'none');
                })
                .map((el) => el.getAttribute('data-flip-id'));
        });
        expect(stuck, `cards left under a residual transform after the drop: ${JSON.stringify(stuck)}`).toEqual([]);
    });
});
