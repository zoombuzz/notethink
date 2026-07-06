import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * Geometry + appearance regression guard for kanban drag. @hello-pangea/dnd lifts the dragged card into a
 * position:fixed clone that stays in place under .board / .column (no portal), so it keeps its column-scoped
 * card styling and looks identical to the resting card. Two invariants are asserted mid-gesture:
 * - GEOMETRY: no ancestor between the fixed clone and <body> carries a transform. A transformed ancestor
 *   would become the fixed clone's containing block and pull it off the cursor. The FLIP gate suppresses
 *   every card/column transform for the whole drag, so the offenders list must stay empty.
 * - APPEARANCE: the dragging card still resolves its card box (a solid border), proving the column-scoped
 *   `.note` styling still applies. A past regression portaled the clone to <body>, dropping that styling so
 *   the preview rendered as bare, oversized text - this asserts the card look survives the drag.
 */
interface DragCloneResult {
    found: boolean;
    is_fixed: boolean;
    border_top_width: string;
    border_top_style: string;
    offenders: Array<{ tag: string; transform: string }>;
}

test.describe('Kanban drag clone isolation - card look survives, no transformed ancestor', () => {

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

    /*
     * find the live drag clone: the [data-rfd-draggable-id] element dnd has lifted to position:fixed (in place,
     * under its column). Walk from it up to <body> collecting any ancestor whose computed transform is not
     * 'none'; that offenders list must be empty. The clone itself is skipped - dnd translates it to follow the
     * cursor, so it legitimately carries a transform. Also read the clone's own border so the caller can assert
     * the card box styling is still applied. The ascent terminates by construction (parentElement shrinks depth,
     * break at document.body).
     */
    async function inspectDragClone(page: Page): Promise<DragCloneResult> {
        return page.evaluate((): DragCloneResult => {
            const draggables = Array.from(document.querySelectorAll<HTMLElement>('[data-rfd-draggable-id]'));
            const clone = draggables.find((el) => getComputedStyle(el).position === 'fixed') ?? null;
            if (!clone) { return { found: false, is_fixed: false, border_top_width: '', border_top_style: '', offenders: [] }; }
            const clone_style = getComputedStyle(clone);
            const offenders: Array<{ tag: string; transform: string }> = [];
            let node: HTMLElement | null = clone.parentElement;
            while (node) {
                const transform = getComputedStyle(node).transform;
                if (transform !== 'none') { offenders.push({ tag: node.tagName.toLowerCase(), transform }); }
                if (node === document.body) { break; }
                node = node.parentElement;
            }
            return {
                found: true,
                is_fixed: clone_style.position === 'fixed',
                border_top_width: clone_style.borderTopWidth,
                border_top_style: clone_style.borderTopStyle,
                offenders,
            };
        });
    }

    test('a paused pointer-drag clone keeps its card border and has no transformed ancestor', async ({ page }) => {
        await setupKanbanView(page);

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        const done_column = page.locator('[role="region"][aria-label="done"]');
        await expect(doing_column.getByRole('heading', { name: 'Task B' })).toBeVisible({ timeout: 3000 });

        const handle = doing_column.locator('[data-rfd-drag-handle-draggable-id]').first();
        const start = await handle.boundingBox();
        const end = await done_column.boundingBox();
        if (!start || !end) { throw new Error('missing bounding box for drag endpoints'); }

        const from_x = start.x + start.width / 2;
        const from_y = start.y + start.height / 2;
        const to_x = end.x + end.width / 2;
        const to_y = end.y + 60;

        // press and nudge past dnd's start threshold to lift the card, deliberately not releasing
        await page.mouse.move(from_x, from_y);
        await page.mouse.down();
        await page.mouse.move(from_x, from_y + 8, { steps: 5 });

        // wait-for the card to be lifted to position:fixed (dnd's own drag signal) rather than a fixed sleep
        await expect.poll(async () => page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>('[data-rfd-draggable-id]'))
                .some((el) => getComputedStyle(el).position === 'fixed')
        ), { timeout: 3000 }).toBe(true);

        // travel partway toward the destination so the gesture is genuinely mid-flight, still no mouse.up
        await page.mouse.move((from_x + to_x) / 2, (from_y + to_y) / 2, { steps: 15 });

        const result = await inspectDragClone(page);
        expect(result.found, 'no live position:fixed drag clone found').toBe(true);
        expect(result.is_fixed, 'the live drag clone is not position:fixed').toBe(true);
        expect(result.offenders, `an ancestor of the fixed clone carries a transform: ${JSON.stringify(result.offenders)}`).toEqual([]);
        // card look survives the drag: the column-scoped `.note` solid border still resolves
        expect(parseFloat(result.border_top_width), 'the dragging card lost its card border (styling stripped)').toBeGreaterThan(0);
        expect(result.border_top_style).toBe('solid');

        // release only after the mid-gesture assertions so the paused-drag state is what was measured
        await page.mouse.up();
    });
});
