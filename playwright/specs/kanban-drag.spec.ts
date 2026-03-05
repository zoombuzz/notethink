import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

test.describe('Kanban Drag and Drop', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupKanbanView(page: Page) {
        const { id, path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForTimeout(500);
        return { id, path: doc_path };
    }

    /**
     * Perform keyboard-based drag with @hello-pangea/dnd.
     * The library supports keyboard drag: focus the draggable, press Space to
     * lift, arrow keys to move between droppables, Space to drop.
     */
    async function keyboardDrag(page: Page, draggable_locator: import('@playwright/test').Locator, direction: 'right' | 'left', moves: number) {
        // focus the drag handle element
        await draggable_locator.focus();
        await page.waitForTimeout(100);

        // space lifts the item
        await page.keyboard.press('Space');
        await page.waitForTimeout(200);

        // arrow key moves between columns
        const key = direction === 'right' ? 'ArrowRight' : 'ArrowLeft';
        for (let i = 0; i < moves; i++) {
            await page.keyboard.press(key);
            await page.waitForTimeout(150);
        }

        // space drops the item
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
    }

    test('dragging a card between columns sends editText with status change', async ({ page }) => {
        await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // Task A is in backlog column
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        // find the drag handle for Task A (the draggable element with data-rbd-drag-handle attributes)
        const task_a_draggable = backlog_column.locator('[data-rfd-drag-handle-draggable-id]').first();

        await clearCapturedMessages(page);

        // keyboard drag: backlog → doing (one column to the right)
        await keyboardDrag(page, task_a_draggable, 'right', 1);

        // verify editText message was sent
        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m: any) => m.type === 'editText');
        expect(edit_msg).toBeDefined();
        expect(edit_msg!.changes).toBeDefined();

        // the changes should include a status linetag value replacement
        const changes = edit_msg!.changes as Array<{ from: number; to?: number; insert: string }>;
        expect(changes.length).toBeGreaterThanOrEqual(1);

        // the change replaces the old value with the new column value
        // (e.g. replaces "backlog" with "doing" at the linetag value offset)
        const has_value_change = changes.some(c => c.to !== undefined && c.insert !== 'backlog');
        expect(has_value_change).toBe(true);
    });

    test('dragging a card to untagged column sends editText that removes status tag', async ({ page }) => {
        await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // Task A is in backlog column
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        const task_a_draggable = backlog_column.locator('[data-rfd-drag-handle-draggable-id]').first();

        await clearCapturedMessages(page);

        // keyboard drag: backlog → untagged (one column to the left)
        await keyboardDrag(page, task_a_draggable, 'left', 1);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m: any) => m.type === 'editText');
        expect(edit_msg).toBeDefined();

        // should remove the status tag, not set it to "untagged"
        const changes = edit_msg!.changes as Array<{ from: number; to?: number; insert: string }>;
        const has_literal_untagged = changes.some(c => c.insert.includes('status=untagged'));
        expect(has_literal_untagged).toBe(false);
    });

    test('view does not blank after drag completes', async ({ page }) => {
        await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        const task_a_draggable = backlog_column.locator('[data-rfd-drag-handle-draggable-id]').first();
        const has_draggable = await task_a_draggable.count() > 0;

        if (has_draggable) {
            await keyboardDrag(page, task_a_draggable, 'right', 1);
        }

        await page.waitForTimeout(300);

        // view should still be rendered (not blank)
        const column_headers = page.locator('[role="columnheader"]');
        const header_count = await column_headers.count();
        expect(header_count).toBeGreaterThanOrEqual(3);

        // data-seq notes should still be present
        const notes = page.locator('[data-seq]');
        const note_count = await notes.count();
        expect(note_count).toBeGreaterThanOrEqual(3);
    });

    test('card appears in destination column after extension sends updated doc', async ({ page }) => {
        const { id, path: doc_path } = await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // verify initial placement: Task A in backlog
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        // simulate extension responding with updated doc (Task A moved to doing)
        // re-inject the doc with modified fixture using the same path/id
        await injectDocsFromFixture(page, 'kanban-moved.md', doc_path);

        await page.waitForTimeout(300);

        // re-simulate selection to keep kanban view active
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForTimeout(500);

        // Task A should now appear in doing column
        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 5000 });

        // Task A should no longer be in backlog column
        const task_a_in_backlog = await backlog_column.getByRole('heading', { name: 'Task A' }).count();
        expect(task_a_in_backlog).toBe(0);
    });
});
