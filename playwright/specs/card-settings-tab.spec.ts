import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';

/*
 * The card settings tab, driven in the browser against the real bundle.
 *
 * The card axis is orthogonal to the view axis: the same board, drawn differently. So the assertion
 * that matters is that picking a card type changes how notes render without touching which view is
 * showing, and that the three card-drawn settings live here rather than on the view tab.
 */

interface HarnessSettingsStore {
    user: Record<string, unknown>;
    workspace: Record<string, unknown>;
}

async function readHarnessSettings(page: Page): Promise<HarnessSettingsStore> {
    return page.evaluate(() => (window as unknown as { __nt_settings: HarnessSettingsStore }).__nt_settings);
}

async function openCardDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('card-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('card-settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

test.describe('Card settings tab', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'basic.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
    });

    /*
     * A folder board, not the plain document.
     *
     * Two reasons, both measured rather than assumed: a single file's `nt_view` is only majority-voted
     * in folder mode, so one kanban-declaring file still opens as a document; and a document renders its
     * hierarchy through the container note's body, where the per-note card dispatch does not apply - the
     * container itself always draws full, since drawing it compact would take the whole document with it.
     * Cards are what the card axis is about, so a board is where the choice is visible.
     */
    test('switching the card type to Sticky collapses the notes to the compact card', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
            { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
        ], { workspace_root: '/workspace' });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        // neither file declares nt_card, so the board opens on the view default and nothing is sticky
        await expect(page.locator('[data-card-type="sticky"]')).toHaveCount(0);

        await openCardDrawer(page);
        await page.getByTestId('card-radio-sticky').click();

        // round-trip order, so a failure names the broken link: write, resolution, render
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.cardType).toBe('sticky');
        await expect(page.locator('[data-auto-selected-cardtype="sticky"]')).toHaveCount(1);
        await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible();
    });

    test('the card tab owns the card-drawn settings and the view tab no longer shows them', async ({ page }) => {
        await openCardDrawer(page);
        const card_drawer = page.getByTestId('card-settings-drawer-grid');
        await expect(card_drawer.getByTestId('setting-row-showLineNumbers')).toBeVisible();
        await expect(card_drawer.getByTestId('setting-row-showLinetagsInHeadlines')).toBeVisible();
        await expect(card_drawer.getByTestId('setting-row-autoExpandFocusedNote')).toBeVisible();

        await page.getByTestId('view-settings-button').click();
        const view_drawer = page.getByTestId('settings-drawer-grid');
        await expect(view_drawer).toHaveAttribute('data-open', 'true');
        // a closed drawer stays mounted, so scope the query to the view drawer rather than the page
        await expect(view_drawer.getByTestId('setting-row-showLineNumbers')).toHaveCount(0);
        await expect(view_drawer.getByTestId('setting-row-showLinetagsInHeadlines')).toHaveCount(0);
        await expect(view_drawer.getByTestId('setting-row-autoExpandFocusedNote')).toHaveCount(0);
        // scrollNoteIntoView stayed on the view side, so it is the control that proves the split is real
        await expect(view_drawer.getByTestId('setting-row-scrollNoteIntoView')).toBeVisible();
    });

    test('a card setting diverges and the card tab counts it independently of the view tab', async ({ page }) => {
        await openCardDrawer(page);
        await expect(page.getByTestId('card-diverged-count')).toContainText('0 settings');

        const card_rows = page.getByTestId('card-settings-drawer-grid');
        await card_rows.getByTestId('setting-control-showLineNumbers').click();

        await expect.poll(async () => (await readHarnessSettings(page)).workspace.showLineNumbers).toBe(true);
        await expect(card_rows.getByTestId('setting-row-showLineNumbers')).toHaveAttribute('data-diverged', 'true');
        await expect(page.getByTestId('card-diverged-count')).toContainText('1 setting');
    });
});
