import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { clearCapturedMessages } from '../helpers/capture-messages';

/*
 * Regression guard for the FLIP layer vs. a USER drag's own round-trip. In real VS Code, dropping a
 * card posts editText; the extension writes the file, the watcher refires (debounced), the doc is
 * re-parsed and an authoritative `update` echoes back. That echo is the user's OWN move arriving as a
 * passive document update — the FLIP layer must NOT re-animate the just-dropped card on it (the
 * regression: cards slid across the board after a drop). Suppression is tied to the optimistic-projection
 * lifecycle, which is unbounded, NOT a fixed drag-end timer that the round-trip can outlast.
 *
 * The harness never echoes edits automatically, so these tests stand in for the extension by re-injecting
 * the moved fixture at the same doc_path, at both realistic and adversarial timings.
 */
test.describe('Kanban drag round-trip — own echo never re-animates the dropped card', () => {

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => { (window as unknown as { __NOTETHINK_ANIM_PROBE__: boolean }).__NOTETHINK_ANIM_PROBE__ = true; });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupKanbanView(page: Page): Promise<string> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        return doc_path;
    }

    async function pointerDrag(page: Page, handle: Locator, destination: Locator): Promise<void> {
        const start = await handle.boundingBox();
        const end = await destination.boundingBox();
        if (!start || !end) { throw new Error('pointerDrag: missing bounding box'); }
        const fx = start.x + start.width / 2;
        const fy = start.y + start.height / 2;
        const tx = end.x + end.width / 2;
        const ty = end.y + 60;
        await page.mouse.move(fx, fy);
        await page.mouse.down();
        await page.mouse.move(fx, fy + 8, { steps: 5 });
        await page.waitForTimeout(150);
        await page.mouse.move(tx, ty, { steps: 25 });
        await page.waitForTimeout(150);
        await page.mouse.move(tx, ty, { steps: 5 });
        await page.waitForTimeout(100);
        await page.mouse.up();
    }

    async function probeMoves(page: Page): Promise<Array<{ kind: string; id?: string }>> {
        const events = await page.evaluate(() => (window as unknown as { __notethinkAnimationEvents?: Array<{ kind: string; id?: string }> }).__notethinkAnimationEvents ?? []);
        return events.filter(e => e.kind === 'move' || e.kind === 'enter');
    }
    async function clearProbe(page: Page): Promise<void> {
        await page.evaluate(() => { (window as unknown as { __notethinkAnimationEvents: unknown[] }).__notethinkAnimationEvents = []; });
    }

    async function dragAThenEcho(page: Page, doc_path: string, gate_delay_ms: number): Promise<Array<{ kind: string; id?: string }>> {
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        const doing = page.locator('[role="region"][aria-label="doing"]');
        await expect(backlog.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        const task_a_handle = backlog.locator('[data-rfd-drag-handle-draggable-id]').first();
        await clearCapturedMessages(page);
        await pointerDrag(page, task_a_handle, doing);
        await expect(doing.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        if (gate_delay_ms > 0) { await page.waitForTimeout(gate_delay_ms); }
        await clearProbe(page);
        // simulate the extension echoing the applied edit (Task A is now status=doing)
        await injectDocsFromFixture(page, 'kanban-moved.md', doc_path);
        await page.waitForTimeout(300);
        return probeMoves(page);
    }

    test('echo arriving AFTER the drag tail (realistic round-trip) does not re-animate', async ({ page }) => {
        const doc_path = await setupKanbanView(page);
        const moves = await dragAThenEcho(page, doc_path, 350);
        expect(moves, `the dropped card's own echo was animated: ${JSON.stringify(moves)}`).toEqual([]);
        // and the board is correct: Task A settled in doing
        await expect(page.locator('[role="region"][aria-label="doing"]').getByRole('heading', { name: 'Task A' })).toBeVisible();
    });

    test('echo arriving immediately (adversarial race) does not re-animate', async ({ page }) => {
        const doc_path = await setupKanbanView(page);
        const moves = await dragAThenEcho(page, doc_path, 0);
        expect(moves, `the dropped card's own echo was animated: ${JSON.stringify(moves)}`).toEqual([]);
        await expect(page.locator('[role="region"][aria-label="doing"]').getByRole('heading', { name: 'Task A' })).toBeVisible();
    });

    test('positive control: a genuine passive update (no preceding drag) still animates', async ({ page }) => {
        const doc_path = await setupKanbanView(page);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        await clearProbe(page);
        // no drag happened — this is a real external/AI edit, so FLIP must fire
        await injectDocsFromFixture(page, 'kanban-moved.md', doc_path);
        await page.waitForTimeout(300);
        const moves = await probeMoves(page);
        expect(moves.length, 'FLIP did not animate a genuine passive update — suppression is too broad').toBeGreaterThanOrEqual(1);
    });
});
