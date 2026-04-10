import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { sendCommand } from '../helpers/send-command';

test.describe('View Switching', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('defaults to auto view which resolves to document for plain markdown', async ({ page }) => {
        const { id } = await injectDocsFromFixture(page, 'basic.md');
        // AutoView wraps content in a div with data-auto-selected-viewtype
        const auto_wrapper = page.locator('[data-auto-selected-viewtype="document"]');
        await expect(auto_wrapper).toBeVisible({ timeout: 5000 });

        // Document inner container should exist
        await expect(page.locator(`[data-testid="document-${id}-inner"]`)).toBeVisible();
    });

    test('switches to kanban view and back to document', async ({ page }) => {
        const { id } = await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // Switch to kanban
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        const kanban_container = page.locator(`#v${id}-inner`);
        await expect(kanban_container).toBeVisible({ timeout: 5000 });

        // The document-specific container should no longer be visible
        await expect(page.locator(`[data-testid="document-${id}-inner"]`)).not.toBeVisible();

        // Switch back to document
        await sendCommand(page, 'setViewType', { viewType: 'document' });
        await expect(page.locator(`[data-testid="document-${id}-inner"]`)).toBeVisible({ timeout: 5000 });
    });

    test('switches to auto view', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // Switch to kanban first
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // Switch to auto - should resolve back to document for plain markdown
        await sendCommand(page, 'setViewType', { viewType: 'auto' });
        const auto_wrapper = page.locator('[data-auto-selected-viewtype="document"]');
        await expect(auto_wrapper).toBeVisible({ timeout: 5000 });
    });
});
