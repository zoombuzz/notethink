import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';

/*
 * "NoteThink: Open Viewer" on a folder with no stories must still show the default kanban columns
 * (LineView's populated-columns fallback), plus a note explaining why the board is empty and a link
 * into the Files drawer, whose own instructions say how to point the Include/Exclude filters at the
 * files that hold stories. Covers GenericView's empty-stories gate (folder mode, discovery settled,
 * zero notes) and the FilesDrawer instructions block (noteCount 0).
 */
test.describe('Empty-stories note (folder mode, zero stories)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('shows the default status columns plus the empty-stories note when the aggregate has no stories', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'no-stories.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/notes.md`, relative_path: 'orbit/docstech/notes.md' },
        ], { workspace_root: WORKSPACE_ROOT, aggregate_total_discovered: 1 });
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true');

        // the default column order still renders, empty, rather than a blank board
        for (const value of ['untagged', 'doing', 'code-review', 'testing', 'done']) {
            await expect(page.locator(`[role="region"][aria-label="${value}"]`)).toBeVisible();
        }

        const note = page.getByTestId('empty-stories-overlay');
        await expect(note).toBeVisible();
        await expect(note).toContainText('No stories found');
        await expect(note).toContainText('NoteThink could not find any markdown files containing story or task definitions.');

        // the note sits over the board, not in place of it: the toolbar stays reachable
        await expect(page.getByTestId('view-toolbar')).toBeVisible();
    });

    test('the note\'s link opens the Files drawer, which shows the point-at-your-stories instructions', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'no-stories.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/notes.md`, relative_path: 'orbit/docstech/notes.md' },
        ], { workspace_root: WORKSPACE_ROOT, aggregate_total_discovered: 1 });
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true');

        const files_drawer = page.getByTestId('files-drawer-grid');
        await expect(files_drawer).toHaveAttribute('data-open', 'false');
        await page.getByTestId('empty-stories-open-files').click();
        await expect(files_drawer).toHaveAttribute('data-open', 'true');

        const instructions = page.getByTestId('files-drawer-instructions');
        await expect(instructions).toBeVisible();
        await expect(instructions).toContainText('Point NoteThink at your stories');
        await expect(instructions).toContainText('**/todo.md');
        await expect(instructions).toContainText('###');
    });

    test('the note waits for the first aggregate, then shows when no file matches the filters at all', async ({ page }) => {
        // the host seeds folder scope before its file search runs, so for a moment the board is in folder mode with nothing loaded
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true');
        await expect(page.getByTestId('empty-stories-overlay')).toHaveCount(0);

        await injectMultipleDocsFromFixtures(page, [], { workspace_root: WORKSPACE_ROOT, aggregate_total_discovered: 0 });
        await expect(page.getByTestId('empty-stories-overlay')).toBeVisible();
        for (const value of ['untagged', 'doing', 'code-review', 'testing', 'done']) {
            await expect(page.locator(`[role="region"][aria-label="${value}"]`)).toBeVisible();
        }
    });

    test('the note does not appear once the folder has stories, nor do the drawer instructions', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT, aggregate_total_discovered: 1 });
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true');
        await expect(page.getByTestId('breadcrumb-file-count')).toBeVisible();

        await expect(page.getByTestId('empty-stories-overlay')).toHaveCount(0);

        await page.getByTestId('breadcrumb-file-count').click();
        await expect(page.getByTestId('files-drawer-grid')).toHaveAttribute('data-open', 'true');
        await expect(page.getByTestId('files-drawer-instructions')).toHaveCount(0);
    });
});
