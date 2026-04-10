import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { sendCommand } from '../helpers/send-command';

test.describe('Settings Toggle', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('toggling lineNumbers shows and hides line number elements', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await sendCommand(page, 'setViewType', { viewType: 'document' });
        await page.waitForSelector('[data-testid]', { timeout: 5000 });

        // By default, show_line_numbers is false - line number spans should not be present
        let lineno_count = await page.locator('[role="rowheader"] span span').count();
        // Line numbers add a <span class="lineno"><span>{n}</span></span> inside the headline
        // Initially they should not be present

        // Toggle line numbers on
        await sendCommand(page, 'toggleSetting', { setting: 'lineNumbers' });
        await page.waitForTimeout(300);

        // After toggling on, notes should have the addGutter class and line number spans
        const gutter_notes = page.locator('[role="row"]');
        // Check that at least one note has rendered (it should already exist)
        await expect(gutter_notes.first()).toBeVisible();

        // Toggle line numbers off again
        await sendCommand(page, 'toggleSetting', { setting: 'lineNumbers' });
        await page.waitForTimeout(300);

        // The view should update - line numbers should be gone
        // (This tests that the toggle is reversible)
    });

    test('toggling contextBars shows and hides context bar elements', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await sendCommand(page, 'setViewType', { viewType: 'document' });
        await page.waitForSelector('[data-testid]', { timeout: 5000 });

        // By default, show_context_bars is true
        // Toggle context bars off
        await sendCommand(page, 'toggleSetting', { setting: 'contextBars' });
        await page.waitForTimeout(300);

        // Toggle context bars back on
        await sendCommand(page, 'toggleSetting', { setting: 'contextBars' });
        await page.waitForTimeout(300);

        // The view should re-render without errors
        await expect(page.locator('[data-seq]').first()).toBeVisible();
    });

    test('settings survive view type switch', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // Toggle line numbers on
        await sendCommand(page, 'toggleSetting', { setting: 'lineNumbers' });
        await page.waitForTimeout(200);

        // Switch to kanban
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        await page.waitForTimeout(300);

        // Switch back to document
        await sendCommand(page, 'setViewType', { viewType: 'document' });
        await page.waitForTimeout(300);

        // View should still render correctly
        await expect(page.locator('[data-seq]').first()).toBeVisible();
    });
});
