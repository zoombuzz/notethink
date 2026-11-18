import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/**
 * A card's tag rows keep every key in the left-hand column and every value on the same line to its
 * right; a value wider than the card is clipped at the card's right edge rather than wrapping under its key.
 */
test.describe('Card tag rows', () => {

    test.beforeEach(async ({ page }) => {
        // a viewer pane beside the editor, narrow enough that the fixture's long values are wider than their card
        await page.setViewportSize({ width: 640, height: 800 });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function openBoard(page: Page): Promise<void> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'linetag-row-overflow.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    }

    async function rowGeometry(row: Locator): Promise<{ key: DOMRect; value: DOMRect; row: DOMRect; card: DOMRect; value_clipped: boolean; key_line: number }> {
        return row.evaluate((element) => {
            const key = element.children[0] as HTMLElement;
            const value = element.children[1] as HTMLElement;
            const card = element.closest('[data-seq]') as HTMLElement;
            return {
                key: key.getBoundingClientRect(),
                value: value.getBoundingClientRect(),
                row: element.getBoundingClientRect(),
                card: card.getBoundingClientRect(),
                value_clipped: value.scrollWidth > value.clientWidth,
                key_line: parseFloat(getComputedStyle(key).lineHeight) || key.getBoundingClientRect().height,
            };
        });
    }

    for (const key of ['sent', 'summary']) {
        test(`a ${key} value wider than the card stays on its key's line and is clipped at the card's edge`, async ({ page }) => {
            await openBoard(page);
            const row = page.locator('[role="listitem"][aria-label="' + key + '"]');
            await expect(row).toBeVisible({ timeout: 5000 });
            const geometry = await rowGeometry(row);
            const measured = JSON.stringify(geometry);
            expect(geometry.value.left, measured).toBeGreaterThanOrEqual(geometry.key.right - 1);
            expect(Math.abs(geometry.value.top - geometry.key.top), measured).toBeLessThan(2);
            expect(geometry.row.height, measured).toBeLessThan(geometry.key_line * 1.5);
            expect(geometry.value_clipped, measured).toBe(true);
            expect(geometry.value.right, measured).toBeLessThanOrEqual(geometry.card.right + 1);
        });
    }

    test('every key on a card starts at the same left edge, and a short value is not clipped', async ({ page }) => {
        await openBoard(page);
        const card = page.locator('[role="listitem"][aria-label="sent"]').locator('xpath=ancestor::ul[1]');
        const lefts = await card.locator('[role="listitem"]').evaluateAll(rows => rows.map(row => (row.children[0] as HTMLElement).getBoundingClientRect().left));
        expect(lefts.length).toBeGreaterThan(1);
        expect(new Set(lefts.map(Math.round)).size).toBe(1);
        const short = await rowGeometry(page.locator('[role="listitem"][aria-label="owner"]'));
        expect(short.value_clipped).toBe(false);
    });
});
