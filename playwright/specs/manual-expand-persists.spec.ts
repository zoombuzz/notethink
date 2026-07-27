import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * Regression guard for a manually expanded card collapsing on the next content edit. MarkdownNote held the
 * "Show more" flag in local state and reset it whenever body_raw changed; ticking a checkbox rewrites the
 * body ([ ] -> [X]), so the authoritative echo from the extension re-applied the clip and the card snapped
 * shut a beat after the click - reading as if the click had scrolled the note. "Show less" is the only
 * in-place collapse; a different note arriving in the slot still starts collapsed because views key cards
 * by note identity and React mounts a fresh instance.
 *
 * The edit is delivered the way the extension delivers it - a full doc update carrying the ticked source -
 * rather than by clicking the checkbox, because the harness has no extension host to apply the editText and
 * echo it back. Clicking the box is covered by checkbox-toggle.spec.ts; what matters here is what the view
 * does when the rewritten body lands.
 */

test.describe('Manual expand survives content edits', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function setupExpandedCard(page: Page): Promise<void> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'manual-expand.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        const show_more = page.getByRole('button', { name: /show more/i }).first();
        await expect(show_more).toBeVisible();
        await show_more.click();
        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
    }

    test('a ticked checkbox does not collapse the expanded card', async ({ page }) => {
        await setupExpandedCard(page);

        await injectDocsFromFixture(page, 'manual-expand-ticked.md', '/workspace/manual-expand.md');
        await expect(page.locator('[role="rowheader"]', { hasText: 'first task on the expanded card' }).locator('input[type="checkbox"]')).toBeChecked();

        // the card must still be expanded: Show less present, no Show more bar, no clip on the body
        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /show more/i })).toHaveCount(0);
    });

    test('"Show less" collapses the card', async ({ page }) => {
        await setupExpandedCard(page);

        await page.getByRole('button', { name: /show less/i }).click();
        await expect(page.getByRole('button', { name: /show less/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /show more/i }).first()).toBeVisible();
    });
});
