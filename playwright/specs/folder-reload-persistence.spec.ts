import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
// matches PERSIST_DEBOUNCE_MS in usePersistedViewStates.ts, so the debounce settles before reading vscode.setState back
const PERSIST_SETTLE_MS = 600;

const DOCS = [
    { fixture: 'kanban-folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
    { fixture: 'kanban-folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
];

/*
 * page.reload() is the point of this spec, not a workaround: the harness backs vscode.getState/setState
 * with sessionStorage, which survives a reload the same way a real webview's persisted state does. The
 * harness has no extension host, so the second injectMultipleDocsFromFixtures call below stands in for
 * the real extension's post-reload re-send.
 */
test.describe('Folder-mode board survives a reload', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('reload restores folder columns without an error, and the persisted state carries no doc bodies', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, DOCS, { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });

        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('heading', { name: 'Alpha Task Two' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('heading', { name: 'Beta Task Two' })).toBeVisible({ timeout: 5000 });

        // let the debounced persist flush before reading it back
        await page.waitForTimeout(PERSIST_SETTLE_MS);

        const persisted_raw = await page.evaluate(() => sessionStorage.getItem('__vsCodeState'));
        expect(persisted_raw).toBeTruthy();
        const persisted = JSON.parse(persisted_raw!) as { docs?: Record<string, Record<string, unknown>> };
        const persisted_docs = Object.values(persisted.docs || {});
        // the diet: persisted docs are identity + change-detection fields only, never the doc's text/mdast body
        expect(persisted_docs.length).toBe(DOCS.length);
        for (const doc of persisted_docs) {
            expect(doc).not.toHaveProperty('content');
            expect(doc).not.toHaveProperty('text');
        }
        // two small metadata records, nowhere near the multi-KB-per-file a full-doc persist would produce
        expect(persisted_raw!.length).toBeLessThan(5000);

        await page.reload();
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });

        // the board must render safely from metadata-only persisted docs alone, before any fresh doc arrives
        await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
        await expect(page.locator('[data-folder-mode="true"]')).toBeVisible({ timeout: 5000 });

        // the extension host's fast reload path re-sends the same docs (mtime-unchanged skip), and the board settles back
        await injectMultipleDocsFromFixtures(page, DOCS, { workspace_root: WORKSPACE_ROOT });
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('heading', { name: 'Alpha Task Two' })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('heading', { name: 'Beta Task Two' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[data-testid="error-boundary-fallback"]')).toHaveCount(0);
    });

});
