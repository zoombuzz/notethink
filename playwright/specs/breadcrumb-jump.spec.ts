import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

// the harness has no real extension, so echo a jumpTargets response back to the webview for the exact path the leaf-click requested — that path-match is what the drawer waits for before rendering
async function injectJumpTargets(
    page: Page,
    mode: string,
    request_path: string,
    entries: Array<{ label: string; path: string; kind: 'folder' | 'file' }>,
): Promise<void> {
    await page.evaluate(({ mode, request_path, entries }) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'jumpTargets', mode, path: request_path, entries },
        }));
    }, { mode, request_path, entries });
}

async function findCaptured(page: Page, type: string): Promise<Record<string, unknown> | undefined> {
    const messages = await getCapturedMessages(page);
    return messages.find(m => m.type === type);
}

test.describe('Terminal breadcrumb leaf jump drawer', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('folder mode: leaf click opens the drawer and lists child subfolders; clicking one descends', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'collision-b.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        const grid = page.getByTestId('jump-drawer-grid');
        await expect(grid).toHaveAttribute('data-open', 'false');

        await clearCapturedMessages(page);
        await page.getByTestId('breadcrumb-leaf').first().click();
        await expect(grid).toHaveAttribute('data-open', 'true');

        // the leaf click posts a requestJumpTargets for the current folder
        const request = await findCaptured(page, 'requestJumpTargets');
        expect(request).toBeTruthy();
        expect(request?.mode).toBe('folder');
        const leaf_path = request?.path as string;
        expect(typeof leaf_path).toBe('string');

        const child_path = `${leaf_path}/specs`;
        await injectJumpTargets(page, 'folder', leaf_path, [
            { label: 'specs', path: child_path, kind: 'folder' },
        ]);

        const drawer = page.getByTestId('jump-drawer');
        await expect(drawer).toContainText('specs');

        // the tree root header carries the basename of the clicked breadcrumb folder, so the subtree reads as belonging to it
        const root_label = leaf_path.split('/').filter(Boolean).pop() as string;
        await expect(page.getByTestId('jump-drawer-root')).toContainText(root_label);

        // clicking a folder entry descends the folder view via setIntegration
        await clearCapturedMessages(page);
        await page.getByTestId('jump-drawer-entry').first().click();
        const set_integration = await findCaptured(page, 'setIntegration');
        expect(set_integration).toBeTruthy();
        expect(set_integration?.path).toBe(child_path);
        // descending into the subfolder dismisses the jump drawer
        await expect(grid).toHaveAttribute('data-open', 'false');
    });

    test('current-file mode: leaf click lists sibling files; clicking one posts openFile', async ({ page }) => {
        const doc_path = `${WORKSPACE_ROOT}/oma/docstech/todo.md`;
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'collision-b.md', doc_path, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[data-testid="NoteRenderer"]');

        const grid = page.getByTestId('jump-drawer-grid');
        await clearCapturedMessages(page);
        await page.getByTestId('breadcrumb-leaf').first().click();
        await expect(grid).toHaveAttribute('data-open', 'true');

        const request = await findCaptured(page, 'requestJumpTargets');
        expect(request).toBeTruthy();
        expect(request?.mode).toBe('current_file');
        const leaf_path = request?.path as string;
        expect(leaf_path).toBe(doc_path);

        const sibling_path = `${WORKSPACE_ROOT}/oma/docstech/done.md`;
        await injectJumpTargets(page, 'current_file', leaf_path, [
            { label: 'done.md', path: sibling_path, kind: 'file' },
        ]);

        const drawer = page.getByTestId('jump-drawer');
        await expect(drawer).toContainText('done.md');

        await clearCapturedMessages(page);
        await page.getByTestId('jump-drawer-entry').first().click();
        const open_file = await findCaptured(page, 'openFile');
        expect(open_file).toBeTruthy();
        expect(open_file?.path).toBe(sibling_path);
        // opening the file dismisses the jump drawer
        await expect(grid).toHaveAttribute('data-open', 'false');
    });

    test('empty-state row when the folder has no jump targets', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'collision-b.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        await clearCapturedMessages(page);
        await page.getByTestId('breadcrumb-leaf').first().click();
        const request = await findCaptured(page, 'requestJumpTargets');
        const leaf_path = request?.path as string;
        await injectJumpTargets(page, 'folder', leaf_path, []);

        const drawer = page.getByTestId('jump-drawer');
        await expect(drawer).toContainText('No subfolders');
        await expect(page.getByTestId('jump-drawer-entry')).toHaveCount(0);
    });
});
