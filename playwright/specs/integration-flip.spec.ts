import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode, selectIntegrationMode } from '../helpers/inject-multi-docs';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

async function selectCurrentFileMode(page: Parameters<typeof selectFolderMode>[0]): Promise<void> {
    await selectIntegrationMode(page, 'current_file');
}

test.describe('Integration flip (folder ↔ current-file)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('folder → current_file flips the selector value and drops the folder breadcrumb file-count in one render', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await expect(page.locator('[data-testid="view-integration-selector"]').first()).toHaveValue('folder');
        await expect(page.getByTestId('breadcrumb-file-count')).toBeVisible({ timeout: 5000 });

        await selectCurrentFileMode(page);
        await expect(page.locator('[data-testid="NoteRenderer"]')).not.toHaveAttribute('data-folder-mode', 'true');
        await expect(page.locator('[data-testid="view-integration-selector"]').first()).toHaveValue('current_file');
        await expect(page.getByTestId('breadcrumb-file-count')).toHaveCount(0);
    });

    test('round-trip folder → current_file → folder → current_file leaves no stale toolbar state', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        const selector = page.locator('[data-testid="view-integration-selector"]').first();
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await expect(selector).toHaveValue('folder');

        await selectCurrentFileMode(page);
        await expect(selector).toHaveValue('current_file');
        await expect(page.locator('[data-testid="NoteRenderer"]')).not.toHaveAttribute('data-folder-mode', 'true');

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await expect(selector).toHaveValue('folder');

        await selectCurrentFileMode(page);
        await expect(selector).toHaveValue('current_file');
        await expect(page.locator('[data-testid="NoteRenderer"]')).not.toHaveAttribute('data-folder-mode', 'true');
        await expect(page.getByTestId('breadcrumb-file-count')).toHaveCount(0);
    });

});
