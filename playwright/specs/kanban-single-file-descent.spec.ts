import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/**
 * End-to-end coverage for the "single-file kanban descends to ### stories under ## epics" story.
 *
 * A nested single file (# H1 nt_view=kanban -> ## epics -> ### stories) must render its ### stories
 * as cards partitioned by status, each tagged with its ## epic (epic chip, no project pill) - NOT the
 * ## epics as cards in one untagged column (the bug). A flat file (## stories directly under #) keeps
 * rendering ## as cards unchanged.
 */
test.describe('Single-file kanban story descent', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function openNestedKanban(page: Page): Promise<void> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban-nested.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        // caret inside the "# Web Store" H1 (offset 2) so AutoView resolves nt_view=kanban and scopes to the H1
        await simulateSelectionChanged(page, doc_path, 2);
        await expect(page.locator('[data-auto-selected-viewtype="kanban"]')).toBeVisible({ timeout: 5000 });
    }

    test('### stories render as cards in their status columns, not the ## epics', async ({ page }) => {
        await openNestedKanban(page);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // the ### stories are cards, each in its status column
        await expect(page.locator('[role="region"][aria-label="doing"]').getByRole('heading', { name: 'Build cart' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[role="region"][aria-label="done"]').getByRole('heading', { name: 'Checkout flow' })).toBeVisible();
        await expect(page.locator('[role="region"][aria-label="todo"]').getByRole('heading', { name: 'Tokens' })).toBeVisible();

        // the ## epics are NOT cards
        await expect(page.getByRole('heading', { name: 'Storefront' })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Design system' })).toHaveCount(0);
    });

    test('each story card shows its epic chip and no project pill', async ({ page }) => {
        await openNestedKanban(page);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // one epic chip per story card (single-file notes carry no project, so no project pill)
        const epic_pills = page.locator('[data-testid="origin-epic-pill"]');
        await expect(epic_pills).toHaveCount(3, { timeout: 5000 });
        const epic_texts = await epic_pills.allTextContents();
        expect(epic_texts.sort()).toEqual(['Design system', 'Storefront', 'Storefront']);
        await expect(page.locator('[data-testid="origin-project-pill"]')).toHaveCount(0);
    });

    test('a nested file with NO nt_view renders as a document and keeps its ## epic headings (descent is kanban-only)', async ({ page }) => {
        // nested.md is `# Top Level -> ## Parent Note -> ### Child One/Two` with no nt_view: it must render as a document with its ## section intact, NOT a flattened board
        const { path: doc_path } = await injectDocsFromFixture(page, 'nested.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        // it is a document, not a kanban board
        await expect(page.locator('[data-auto-selected-viewtype="kanban"]')).toHaveCount(0);
        // the ## section heading survives (the unconditional-flatten regression would drop it)
        await expect(page.getByText('Parent Note')).toBeVisible({ timeout: 5000 });
    });
});
