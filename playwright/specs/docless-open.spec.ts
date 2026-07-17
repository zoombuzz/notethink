import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

/*
 * Open Viewer with no .md file active opens the board in folder mode at the workspace root. The host
 * side of that (a docless PanelSession entering folder mode) is covered by jest; what has to hold
 * here is the webview half: the host cannot make the board render a folder just by discovering one,
 * because the webview resolves folder-vs-file from its own __folder__ view state and an unseeded
 * state resolves current_file. So the host posts a setIntegrationScope command and the webview
 * scopes itself to it. Without the seed the board would render an arbitrary file out of the
 * aggregate instead of the folder.
 */
test.describe('Docless open (no .md file active)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a host-seeded folder scope renders the folder board rooted at the workspace root', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[data-testid="NoteRenderer"]');

        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });

        const renderer = page.locator('[data-testid="NoteRenderer"]');
        await expect(renderer).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await expect(page.locator('[data-testid="view-toolbar"]')).toHaveCount(1);
    });

    test('the seeded board scopes to the workspace root, so every project merges in', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[data-testid="NoteRenderer"]');

        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true');

        // both files' stories merge onto one board, which is what rooting at the workspace root buys
        await expect(page.locator('[data-testid="breadcrumb-file-count"]')).toBeVisible();
    });

    test('a malformed seed is ignored rather than half-applying a scope', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[data-testid="NoteRenderer"]');

        // no path, and a mode the wire never carries: both must leave the board in single-file mode
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder' });
        await sendCommand(page, 'setIntegrationScope', { mode: 'auto', path: WORKSPACE_ROOT });

        // only the folder branch stamps data-folder-mode, so single-file mode is its absence rather than a "false"
        await expect(page.locator('[data-testid="NoteRenderer"]').first()).not.toHaveAttribute('data-folder-mode', 'true');
        await expect(page.locator('[data-testid="breadcrumb-file-count"]')).toHaveCount(0);
    });
});
