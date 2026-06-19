import { test, expect, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

// emit a pendingChange message into the webview as if the extension had sent it
async function emitPendingChange(page: Page, key: string, on: boolean): Promise<void> {
    await page.evaluate(({ k, o }) => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'pendingChange', key: k, on: o } }));
    }, { k: key, o: on });
}

async function selectCurrentFileMode(page: Page): Promise<void> {
    const selector = page.locator('[data-testid="view-integration-selector"]').first();
    await selector.selectOption('current_file');
}

test.describe('Pending-work spinner', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a fast settings toggle (resolves under 150 ms) shows no visible spinner', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        // a toggleSetting command is purely a webview-side state change - no markPending is involved
        await sendCommand(page, 'toggleSetting', { setting: 'lineNumbers' });
        // give the show-delay a chance to flip something on if anything were marked
        await page.waitForTimeout(250);
        // no spinner anywhere (toolbar or drawers)
        await expect(page.locator('[data-testid="pending-work-spinner"]')).toHaveCount(0);
    });

    test('a slow folder-discovery (pendingChange on) shows the toolbar spinner; clearing it hides the spinner after min-visibility', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        await emitPendingChange(page, 'folderDiscovery', true);
        // spinner appears in the toolbar after the show-delay (scoped to the toolbar to avoid clashing with the drawer spinner that also responds to the same context)
        const toolbar_spinner = page.getByTestId('view-toolbar').getByTestId('pending-work-spinner');
        await expect(toolbar_spinner).toBeVisible({ timeout: 2000 });
        await emitPendingChange(page, 'folderDiscovery', false);
        // remains visible briefly to satisfy min-visibility, then disappears
        await expect(toolbar_spinner).toHaveCount(0, { timeout: 2000 });
    });

    test('integration-mode flip (folder ↔ current_file) does not flash the spinner', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await selectCurrentFileMode(page);
        await page.waitForTimeout(250);
        await expect(page.locator('[data-testid="pending-work-spinner"]')).toHaveCount(0);
    });

    test('with the Files drawer open during an apply, only the breadcrumb spinner shows (no redundant in-drawer spinner)', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        // open the Files drawer
        await page.getByTestId('breadcrumb-file-count').click();
        await expect(page.locator('[data-testid="files-drawer-grid"]')).toHaveAttribute('data-open', 'true');

        await emitPendingChange(page, 'integrationFilters', true);
        // the breadcrumb (toolbar) spinner is the single pending indicator; the redundant in-drawer copy was removed
        await expect(page.getByTestId('view-toolbar').getByTestId('pending-work-spinner')).toBeVisible({ timeout: 2000 });
        await expect(page.getByTestId('files-drawer-spinner')).toHaveCount(0);
        await emitPendingChange(page, 'integrationFilters', false);
        await expect(page.getByTestId('view-toolbar').getByTestId('pending-work-spinner')).toHaveCount(0, { timeout: 2000 });
    });

    test('prefers-reduced-motion: spinner SVG is in the DOM but the rotation keyframe is not animating', async ({ browser }) => {
        const context = await browser.newContext({ reducedMotion: 'reduce' });
        const page = await context.newPage();
        try {
            await page.goto('/playwright/harness/index.html');
            await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
            await injectMultipleDocsFromFixtures(page, [
                { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            ], { workspace_root: WORKSPACE_ROOT });

            await emitPendingChange(page, 'folderDiscovery', true);
            // scope to the toolbar spinner; the drawer can render a second copy
            const spinner = page.getByTestId('view-toolbar').getByTestId('pending-work-spinner');
            await expect(spinner).toBeVisible({ timeout: 2000 });

            const animation_name = await spinner.locator('svg').evaluate((el) => window.getComputedStyle(el).animationName);
            // prefers-reduced-motion CSS sets animation: none, which computed style reports as 'none'
            expect(animation_name).toBe('none');
        } finally {
            await context.close();
        }
    });
});
