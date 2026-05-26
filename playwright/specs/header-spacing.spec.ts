import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';

test.describe('Header bar breathing room and root label suppression', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('does not render a literal "Root" headline for the synthetic root container', async ({ page }) => {
        const { id } = await injectDocsFromFixture(page, 'basic.md');
        const container = page.locator(`[data-testid="document-${id}-inner"]`);
        await expect(container).toBeVisible({ timeout: 5000 });

        // the synthetic root container (note.type === 'root') previously rendered <span>Root</span>;
        // assert no rowheader contains exactly "Root"
        const headlines = page.locator('[role="rowheader"]');
        const headline_texts = await headlines.allTextContents();
        expect(headline_texts.some(t => t.trim() === 'Root')).toBe(false);
    });

    test('top note rect does not overlap the sticky toolbar beyond the outline-offset clearance', async ({ page }) => {
        const { id } = await injectDocsFromFixture(page, 'basic.md');
        const container = page.locator(`[data-testid="document-${id}-inner"]`);
        await expect(container).toBeVisible({ timeout: 5000 });

        const toolbar = page.locator('[data-testid="view-toolbar"]');
        await expect(toolbar).toBeVisible({ timeout: 5000 });

        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        const toolbar_box = await toolbar.boundingBox();
        const first_note = page.locator('[role="row"]').first();
        const note_box = await first_note.boundingBox();

        // the top note must sit far enough below the toolbar that its outline-offset (6px) + outline (2px) ring is not clipped
        const required_clearance_px = 8;
        expect(toolbar_box).not.toBeNull();
        expect(note_box).not.toBeNull();
        const gap_px = note_box!.y - (toolbar_box!.y + toolbar_box!.height);
        expect(gap_px).toBeGreaterThanOrEqual(required_clearance_px);
    });
});
