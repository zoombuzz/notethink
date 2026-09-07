import { test, expect, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';

/*
 * Bring up a folder board of two files in distinct project folders, each carrying whatever nt_card the
 * caller wants voted. Folder mode is where the card axis auto-resolves: the synthetic root has no single
 * linetag to read, so the type comes from a majority vote over the originating files.
 */
async function setupCardFolder(page: Page, fixture_a: string, fixture_b: string): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: fixture_a, doc_path: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, relative_path: 'alpha/docstech/board.md' },
        { fixture: fixture_b, doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
}

test.describe('Card type axis', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('an H1 nt_card=sticky on every file resolves the card type to sticky and draws compact cards', async ({ page }) => {
        await setupCardFolder(page, 'card-sticky-a.md', 'card-sticky-b.md');
        await expect(page.locator('[data-auto-selected-cardtype="sticky"]')).toHaveCount(1, { timeout: 5000 });
        // the resolved type reaches the notes themselves, not just the wrapper that published it
        await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible();
        // a compact card is headline-only: the task list that the full card renders in its body is absent
        await expect(page.getByText('task a1')).toHaveCount(0);
    });

    /*
     * The two axes are independent, and this is where that was untrue. The nt_card vote lived inside
     * AutoView, which renders for `auto` alone - so pinning any view type unmounted the only thing that
     * ran it, `settings.cardType` was never stamped, and every sticky expanded into the view's default
     * full card. Pinning the VIEW must not disturb the CARD.
     */
    test('pinning the view type leaves the voted card type alone', async ({ page }) => {
        await setupCardFolder(page, 'card-sticky-a.md', 'card-sticky-b.md');
        await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible({ timeout: 5000 });

        await page.getByTestId('view-settings-button').click();
        await page.getByTestId('view-radio-kanban').click();
        await expect(page.locator('[data-flip-column-id]').first()).toBeVisible({ timeout: 5000 });
        // the board is a kanban now, and every card on it is still the sticky the files voted for
        await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible();
        await expect(page.locator('[data-card-type="card"]')).toHaveCount(0);
    });

    test('the compact card keeps the headline it replaces the body of', async ({ page }) => {
        await setupCardFolder(page, 'card-sticky-a.md', 'card-sticky-b.md');
        const sticky_cards = page.locator('[data-card-type="sticky"]');
        await expect(sticky_cards.first()).toBeVisible({ timeout: 5000 });
        // the title shares the headline row with the origin pill, so match on the card's text
        await expect(sticky_cards.filter({ hasText: 'Alpha one' })).toHaveCount(1);
        await expect(sticky_cards.filter({ hasText: 'Beta one' })).toHaveCount(1);
        await expect(sticky_cards.first().locator('[role="rowheader"]')).toBeVisible();
    });

    test('the card axis resolves independently of the view axis', async ({ page }) => {
        await setupCardFolder(page, 'card-sticky-kanban-a.md', 'card-sticky-kanban-b.md');
        // both axes are voted from the same two files: kanban lanes drawn with sticky cards
        await expect(page.locator('[data-auto-selected-viewtype="kanban"]')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('[data-auto-selected-cardtype="sticky"]')).toHaveCount(1);
        await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible();
    });

    test('a tie in the nt_card vote falls back to the full card', async ({ page }) => {
        await setupCardFolder(page, 'card-sticky-a.md', 'card-plain-b.md');
        await expect(page.locator('[data-auto-selected-cardtype="card"]')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('[data-card-type="sticky"]')).toHaveCount(0);
        await expect(page.getByText('task a1')).toBeVisible();
    });

    test('files that declare no nt_card render the full card, unchanged', async ({ page }) => {
        await setupCardFolder(page, 'folder-a.md', 'folder-b.md');
        await expect(page.locator('[data-auto-selected-cardtype="card"]')).toHaveCount(1, { timeout: 5000 });
        await expect(page.locator('[data-card-type="sticky"]')).toHaveCount(0);
        await expect(page.getByText('write changelog')).toBeVisible();
    });
});
