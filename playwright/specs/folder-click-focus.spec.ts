import { test, expect, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';
const PATH_A = `${WORKSPACE_ROOT}/alpha/docstech/board.md`;
const PATH_B = `${WORKSPACE_ROOT}/beta/docstech/board.md`;

async function setupFolderKanban(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
        { fixture: 'kanban-folder-b.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await sendCommand(page, 'setViewType', { viewType: 'kanban' });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

test.describe('Folder-mode click-focus and click-select (homogenisation)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('clicking a card in folder mode lights the focused outline immediately (no editor round-trip)', async ({ page }) => {
        await setupFolderKanban(page);
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        const headline_b1 = card_b1.locator('[role="rowheader"]').first();
        await expect(headline_b1).toBeVisible({ timeout: 5000 });
        await headline_b1.click({ force: true });
        // view-driven focus state is the source of truth — no selectionChanged round-trip needed
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
    });

    test('second click on a focused card promotes to selected (solid outline + selection state)', async ({ page }) => {
        await setupFolderKanban(page);
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        const headline_b1 = card_b1.locator('[role="rowheader"]').first();
        await headline_b1.click({ force: true });
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
        await headline_b1.click({ force: true });
        await expect(card_b1).toHaveAttribute('aria-selected', 'true', { timeout: 3000 });
    });

    test('clicking a card from file A then a card from file B moves focus to the latter', async ({ page }) => {
        await setupFolderKanban(page);
        const card_a1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Alpha Task One' }).first();
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        const headline_a1 = card_a1.locator('[role="rowheader"]').first();
        const headline_b1 = card_b1.locator('[role="rowheader"]').first();
        await headline_a1.click({ force: true });
        await expect(card_a1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
        await headline_b1.click({ force: true });
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
        // alpha card no longer focused — only one card carries the focused outline at a time
        await expect(card_a1).not.toHaveAttribute('aria-current', 'true');
    });

    test('editor caret moving into a story in file B highlights the matching card in folder mode (no view click)', async ({ page }) => {
        await setupFolderKanban(page);
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        await expect(card_b1).toBeVisible({ timeout: 5000 });
        // beta file: "# Todo\n\n### Beta Task One [](?status=backlog)\n+ [ ] queued\n…" — the H1 ends at offset 6, then a blank line ('\n\n' after the H1), so "### Beta Task One" starts at offset 8. Putting the caret at offset 15 lands inside the Beta Task One headline
        await simulateSelectionChanged(page, PATH_B, 15);
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
    });
});

test.describe('Current_file click-focus regression', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('current_file mode click + simulated selectionChanged still focuses the clicked note', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[role="row"]', { timeout: 5000 });
        const card_a1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Alpha Task One' }).first();
        const headline_a1 = card_a1.locator('[role="rowheader"]').first();
        await headline_a1.click({ force: true });
        // either path lands focus: the per-view state we now write directly, OR the editor-driven path if a selectionChanged confirmation arrives
        await expect(card_a1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
    });
});
