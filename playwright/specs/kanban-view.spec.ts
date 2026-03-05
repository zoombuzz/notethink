import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

test.describe('Kanban View', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    /**
     * Helper: inject the kanban fixture and simulate a selection inside the
     * board note so that AutoView picks up the ng_view=kanban linetag.
     */
    async function setupKanbanView(page: import('@playwright/test').Page) {
        const { id, path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // Simulate a cursor position inside the "# Project Board" heading.
        // The heading starts at offset 0; placing cursor at offset 2 is within it.
        await simulateSelectionChanged(page, doc_path, 2);

        // Wait for AutoView to detect ng_view=kanban and re-render
        await page.waitForTimeout(500);
        return { id, path: doc_path };
    }

    test('renders kanban columns via auto view detecting ng_view linetag', async ({ page }) => {
        await setupKanbanView(page);

        // AutoView should detect ng_view=kanban and render kanban columns
        const auto_wrapper = page.locator('[data-auto-selected-viewtype="kanban"]');
        await expect(auto_wrapper).toBeVisible({ timeout: 5000 });

        // Check that expected column headers appear (use h3 to avoid count badge text)
        const column_headers = page.locator('[role="columnheader"] h3');
        const header_texts = await column_headers.allTextContents();
        expect(header_texts).toContain('untagged');
        expect(header_texts).toContain('backlog');
        expect(header_texts).toContain('doing');
        expect(header_texts).toContain('done');
    });

    test('places tasks in correct columns', async ({ page }) => {
        await setupKanbanView(page);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // Task A should be in the backlog column
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 5000 });

        // Task B should be in the doing column
        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing_column.getByRole('heading', { name: 'Task B' })).toBeVisible();

        // Task C should be in the done column
        const done_column = page.locator('[role="region"][aria-label="done"]');
        await expect(done_column.getByRole('heading', { name: 'Task C' })).toBeVisible();
    });

    test('places untagged tasks in untagged column', async ({ page }) => {
        await setupKanbanView(page);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // Task D has no status linetag, should appear in untagged column
        const untagged_column = page.locator('[role="region"][aria-label="untagged"]');
        await expect(untagged_column.getByText('Task D')).toBeVisible({ timeout: 5000 });
    });
});
