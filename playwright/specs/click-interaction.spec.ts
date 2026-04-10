import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { getCapturedMessages, clearCapturedMessages, getRevealOrSelectMessages, findRevealMessage, findSelectRangeMessage } from '../helpers/capture-messages';
import { simulateSelectionChanged, simulateRangeSelectionChanged } from '../helpers/simulate-selection';

test.describe('Click Interaction', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('clicking a note headline sends revealRange message', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
        await clearCapturedMessages(page);

        // Click a headline
        const headline = page.locator('[role="rowheader"]').first();
        await headline.click();

        // Wait for React to process the click
        await page.waitForTimeout(200);

        const reveal_or_select = await getRevealOrSelectMessages(page);
        expect(reveal_or_select.length).toBeGreaterThanOrEqual(1);
    });

    test('clicking a note sets aria-current (focused) attribute', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[role="row"]', { timeout: 5000 });

        // Click a headline to trigger focus
        const headline = page.locator('[role="rowheader"]').first();
        await headline.click();
        await page.waitForTimeout(200);

        // The click sends a revealRange to the extension, which would normally
        // send back a selectionChanged event. In the harness, we simulate that:
        const reveal_msg = await findRevealMessage(page);

        if (reveal_msg) {
            // Simulate the extension responding with a selectionChanged
            await simulateSelectionChanged(page, reveal_msg.docPath!, reveal_msg.from!);
            await page.waitForTimeout(300);

            // Check that a note now has aria-current="true"
            const focused_note = page.locator('[role="row"][aria-current="true"]');
            await expect(focused_note).toBeVisible({ timeout: 3000 });
        }
    });

    test('second click on focused note selects it without blanking the view', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
        await clearCapturedMessages(page);

        // Step 1: Click a headline to trigger revealRange
        const headline = page.locator('[role="rowheader"]').first();
        await headline.click();
        await page.waitForTimeout(200);

        const reveal_msg = await findRevealMessage(page);
        expect(reveal_msg).toBeDefined();

        // Step 2: Simulate extension responding with collapsed selection (head === anchor) → note becomes focused
        await simulateSelectionChanged(page, reveal_msg!.docPath!, reveal_msg!.from!);
        await page.waitForTimeout(300);

        const focused_note = page.locator('[role="row"][aria-current="true"]');
        await expect(focused_note).toBeVisible({ timeout: 3000 });

        // Step 3: Clear messages and click the same headline again → should send selectRange
        await clearCapturedMessages(page);
        await headline.click();
        await page.waitForTimeout(200);

        const select_msg = await findSelectRangeMessage(page);
        expect(select_msg).toBeDefined();
        expect(select_msg!.from).toBeDefined();
        expect(select_msg!.to).toBeDefined();

        // Step 4: Simulate extension responding with range selection (head ≠ anchor)
        await simulateRangeSelectionChanged(page, reveal_msg!.docPath!, select_msg!.from!, select_msg!.to!);
        await page.waitForTimeout(300);

        // Step 5: Assert view did NOT blank - notes are still visible
        const visible_notes = page.locator('[data-seq]');
        await expect(visible_notes.first()).toBeVisible({ timeout: 3000 });

        // Step 6: Assert at least one note became selected
        const selected_notes = page.locator('[role="row"][aria-selected="true"]');
        await expect(selected_notes.first()).toBeVisible({ timeout: 3000 });
    });

    test('captured messages include docId and docPath', async ({ page }) => {
        const { id, path: doc_path } = await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[role="rowheader"]', { timeout: 5000 });
        await clearCapturedMessages(page);

        const headline = page.locator('[role="rowheader"]').first();
        await headline.click();
        await page.waitForTimeout(200);

        const messages = await getCapturedMessages(page);
        const msg = messages[0];
        expect(msg).toBeDefined();
        expect(msg.docId).toBe(id);
        expect(msg.docPath).toBe(doc_path);
    });
});
