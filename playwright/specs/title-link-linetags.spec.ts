import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

const FIXTURE = 'title-link-linetags.md';

/*
 * A markdown link in a heading is part of the card title, not the start of the linetags: the card shows
 * the link text and the words after it, the link stays clickable, and a linetag after it still applies.
 */

async function openBoard(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    const { path: doc_path } = await injectDocsFromFixture(page, FIXTURE);
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

test.describe('Links in a card title', () => {
    test('a heading link and the text after it stay in the card title beside its linetag', async ({ page }) => {
        await openBoard(page);
        const card = page.locator('[data-seq]', { has: page.locator('a', { hasText: 'the guide' }) }).first();
        await expect(card.locator('a', { hasText: 'the guide' }).first()).toBeVisible();
        await expect(card.getByText('first', { exact: false }).first()).toBeVisible();
        // the linetag after the link still places the card in its column
        await expect(page.locator('[role="columnheader"]', { hasText: 'doing' }).first()).toBeVisible();
    });

    test('a heading link with no linetags shows the link text and the rest of the title', async ({ page }) => {
        await openBoard(page);
        const card = page.locator('[data-seq]', { has: page.locator('a', { hasText: 'site' }) }).first();
        await expect(card.locator('a', { hasText: 'site' }).first()).toBeVisible();
        await expect(card.getByText('heading', { exact: false }).first()).toBeVisible();
    });
});
