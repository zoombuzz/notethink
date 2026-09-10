import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { sendCommand } from '../helpers/send-command';
import { clearCapturedMessages, findRevealMessage } from '../helpers/capture-messages';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

test.describe('Keyboard Navigation', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('clicking different notes produces revealRange messages', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
        await page.waitForTimeout(500);

        // Click first headline
        await clearCapturedMessages(page);
        const headlines = page.locator('[role="rowheader"]');
        await headlines.nth(0).click();
        await page.waitForTimeout(200);
        const first_reveal = await findRevealMessage(page);
        expect(first_reveal).toBeDefined();
        expect(typeof first_reveal!.from).toBe('number');

        // Click a different headline
        await clearCapturedMessages(page);
        const headline_count = await headlines.count();
        await headlines.nth(Math.min(1, headline_count - 1)).click();
        await page.waitForTimeout(200);
        const second_reveal = await findRevealMessage(page);
        expect(second_reveal).toBeDefined();
        expect(typeof second_reveal!.from).toBe('number');
    });

    test('selection feedback updates focused note styling', async ({ page }) => {
        const { path: doc_path } = await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
        await page.waitForTimeout(500);

        // Click a headline
        await page.locator('[role="rowheader"]').first().click();
        await page.waitForTimeout(200);

        // Get the revealRange message
        const reveal = await findRevealMessage(page);
        expect(reveal).toBeDefined();

        // Simulate the extension responding with selectionChanged
        await simulateSelectionChanged(page, reveal!.docPath || doc_path, reveal!.from!);
        await page.waitForTimeout(500);

        // A note should now have aria-current="true" (focused)
        const focused = page.locator('[role="row"][aria-current="true"]');
        await expect(focused).toBeVisible({ timeout: 3000 });
    });

    test('drillIn on nested doc changes parent context', async ({ page }) => {
        const { path: doc_path } = await injectDocsFromFixture(page, 'nested.md');
        await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
        await page.waitForTimeout(500);

        // Navigate down to focus on a note with children
        await sendCommand(page, 'navigate', { direction: 'down' });
        await page.waitForTimeout(300);

        // Simulate selectionChanged so GenericView knows the caret position
        const reveal = await findRevealMessage(page);
        if (reveal?.from !== undefined) {
            await simulateSelectionChanged(page, reveal.docPath || doc_path, reveal.from);
            await page.waitForTimeout(500);
        }

        const data_parent = page.locator('[data-parent-content-seq]');
        // the view opens scoped to the document root, which is the value drill-in has to move off
        const parent_before_drill = await data_parent.first().getAttribute('data-parent-content-seq');
        expect(parent_before_drill).not.toBeNull();

        // Drill in
        await sendCommand(page, 'navigate', { direction: 'drillIn' });
        await page.waitForTimeout(500);

        const parent_after_drill = await data_parent.first().getAttribute('data-parent-content-seq');
        expect(parent_after_drill).not.toBeNull();
        expect(parent_after_drill).not.toBe(parent_before_drill);
    });

    test('drillOut returns to parent context', async ({ page }) => {
        const { path: doc_path } = await injectDocsFromFixture(page, 'nested.md');
        await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
        await page.waitForTimeout(500);

        // Navigate down and simulate selection
        await sendCommand(page, 'navigate', { direction: 'down' });
        await page.waitForTimeout(300);
        const reveal = await findRevealMessage(page);
        if (reveal?.from !== undefined) {
            await simulateSelectionChanged(page, reveal.docPath || doc_path, reveal.from);
            await page.waitForTimeout(500);
        }

        const data_parent = page.locator('[data-parent-content-seq]');
        const parent_before_drill = await data_parent.first().getAttribute('data-parent-content-seq');

        // Drill in
        await sendCommand(page, 'navigate', { direction: 'drillIn' });
        await page.waitForTimeout(500);

        /*
         * The drill-in value is the whole point of the round trip, so it is compared rather than
         * captured. Note getAttribute returns string | null: toBeDefined() holds on null and on a
         * missing attribute alike, so every check here is an equality against a value read earlier
         * in the same test.
         */
        const parent_after_drill = await data_parent.first().getAttribute('data-parent-content-seq');
        expect(parent_after_drill).not.toBeNull();
        expect(parent_after_drill).not.toBe(parent_before_drill);

        // Drill out
        await sendCommand(page, 'navigate', { direction: 'drillOut' });
        await page.waitForTimeout(500);

        // drill-out from one level in returns the scope to exactly where drill-in found it
        const parent_after_out = await data_parent.first().getAttribute('data-parent-content-seq');
        expect(parent_after_out).toBe(parent_before_drill);
    });
});
