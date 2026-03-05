import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';

test.describe('Document View', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        // Wait for React to mount
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('renders document container after injecting basic.md', async ({ page }) => {
        const { id } = await injectDocsFromFixture(page, 'basic.md');
        // The default view is 'auto' which resolves to 'document' for plain markdown
        const container = page.locator(`[data-testid="document-${id}-inner"]`);
        await expect(container).toBeVisible({ timeout: 5000 });
    });

    test('renders note headlines with correct text', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        // Wait for notes to render
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // Check that headlines render with the correct text
        const headlines = page.locator('[role="rowheader"]');
        const headline_texts = await headlines.allTextContents();
        expect(headline_texts.some(t => t.includes('Hello World'))).toBe(true);
        expect(headline_texts.some(t => t.includes('Section One'))).toBe(true);
        expect(headline_texts.some(t => t.includes('Section Two'))).toBe(true);
    });

    test('renders notes with data-seq attributes', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        const notes = page.locator('[data-seq]');
        const count = await notes.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('renders body paragraphs', async ({ page }) => {
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // Body content should be visible
        await expect(page.getByText('This is a basic paragraph.')).toBeVisible();
        await expect(page.getByText('Content of section one.')).toBeVisible();
        await expect(page.getByText('Content of section two.')).toBeVisible();
    });
});
