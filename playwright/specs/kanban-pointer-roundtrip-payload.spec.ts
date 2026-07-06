import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

/*
 * Full round-trip guard for one real pointer drag: the drop's posted editText must rewrite the status linetag to the
 * destination column and carry the source docPath; the just-dropped card must hold in place (no snap-back); and when
 * the extension echoes the applied edit back as an authoritative update, the card must NOT re-animate (the "cards slid
 * across the board after a drop" regression). The no-fling assertion is a pixel/position check on the card box - the
 * primary guard - with the FLIP probe as a secondary cross-check, never relied on alone.
 *
 * The harness never echoes edits, so we stand in for the extension by re-injecting the moved fixture at the same
 * doc_path (Task A -> doing, exactly what the extension would deliver after applying this drop's editText).
 */
const ECHO_FLING_TOLERANCE_PX = 24;

interface AnimationProbeEvent {
    kind: string;
    id?: string;
}

test.describe('Kanban pointer drag round-trip - payload, hold, and no fling on echo', () => {

    test.beforeEach(async ({ page }) => {
        // arm the FLIP probe before the bundle runs so the secondary cross-check sees the echo render from the first frame
        await page.addInitScript(() => { (window as unknown as { __NOTETHINK_ANIM_PROBE__: boolean }).__NOTETHINK_ANIM_PROBE__ = true; });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupKanbanView(page: Page): Promise<string> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        return doc_path;
    }

    // drive dnd's pointer sensor with a real mouse gesture; the settle waits give dnd's rAF lift/drop phases time to run
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
        await page.mouse.move(from_x, from_y + 8, { steps: 5 });
        await page.waitForTimeout(150);
        await page.mouse.move(to_x, to_y, { steps: 25 });
        await page.waitForTimeout(150);
        await page.mouse.move(to_x, to_y, { steps: 5 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(400);
    }

    async function probeMoves(page: Page): Promise<Array<AnimationProbeEvent>> {
        const events = await page.evaluate(() => (window as unknown as { __notethinkAnimationEvents?: Array<AnimationProbeEvent> }).__notethinkAnimationEvents ?? []);
        return events.filter((e) => e.kind === 'move' || e.kind === 'enter');
    }
    async function clearProbe(page: Page): Promise<void> {
        await page.evaluate(() => { (window as unknown as { __notethinkAnimationEvents: unknown[] }).__notethinkAnimationEvents = []; });
    }

    test('a pointer drop posts a status+docPath editText, holds the card, and does not fling it on its own echo', async ({ page }) => {
        const doc_path = await setupKanbanView(page);

        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        const handle = backlog_column.locator('[data-rfd-drag-handle-draggable-id]').first();

        await clearCapturedMessages(page);
        // Task A backlog -> doing; the moved fixture (kanban-moved.md) is exactly this applied edit, so it doubles as the echo
        await pointerDrag(page, handle, doing_column);

        // payload: an editText was posted that rewrites the status value and carries the source doc path
        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m) => m.type === 'editText');
        expect(edit_msg, 'the pointer drag posted no editText').toBeDefined();
        expect(edit_msg!.docPath, 'the editText did not carry the source docPath').toBe(doc_path);
        const changes = edit_msg!.changes as Array<{ from: number; to?: number; insert: string }>;
        expect(changes.length).toBeGreaterThanOrEqual(1);
        // the status linetag is rewritten to the destination column value
        expect(changes.some((c) => c.insert === 'doing'), 'the editText did not set the destination status value').toBe(true);
        // and it replaces text in place (a ranged change), proving a status swap rather than a stray append
        expect(changes.some((c) => c.to !== undefined), 'the status change was a pure insert, not an in-place rewrite').toBe(true);

        // hold: the card lands in doing and does not snap back to backlog
        const dropped_heading = doing_column.getByRole('heading', { name: 'Task A' });
        await expect(dropped_heading).toBeVisible({ timeout: 3000 });
        expect(await backlog_column.getByRole('heading', { name: 'Task A' }).count()).toBe(0);
        const box_after_drop = await dropped_heading.boundingBox();
        expect(box_after_drop).not.toBeNull();

        // measure the echo render from a clean probe slate
        await clearProbe(page);

        // echo: the extension applies the edit and echoes the authoritative doc (Task A now status=doing)
        await injectDocsFromFixture(page, 'kanban-moved.md', doc_path);
        // settle window for the echo to reconcile against the projection; there is no distinct DOM transition to await here
        await page.waitForTimeout(500);

        // no fling (primary pixel check): the just-dropped card's box is unchanged - it did not slide on its own echo
        const box_after_echo = await dropped_heading.boundingBox();
        expect(box_after_echo).not.toBeNull();
        expect(Math.abs(box_after_echo!.x - box_after_drop!.x), 'the dropped card flung horizontally on its own echo').toBeLessThanOrEqual(ECHO_FLING_TOLERANCE_PX);
        expect(Math.abs(box_after_echo!.y - box_after_drop!.y), 'the dropped card flung vertically on its own echo').toBeLessThanOrEqual(ECHO_FLING_TOLERANCE_PX);

        // no card is left under a residual FLIP transform once the echo settles
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
        expect(stuck, `cards left under a residual transform after the echo: ${JSON.stringify(stuck)}`).toEqual([]);

        // secondary cross-check: the FLIP layer scheduled no move/enter for the card's own echo (the pixel check above is the primary guard)
        const moves = await probeMoves(page);
        expect(moves, `the dropped card's own echo was animated: ${JSON.stringify(moves)}`).toEqual([]);
    });
});
