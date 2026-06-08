import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { findRevealMessage, clearCapturedMessages } from '../helpers/capture-messages';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

test.describe('Duplicate stable_id collision detection', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('no alert when every headline resolves to a unique stable_id', async ({ page }) => {
        // collision-b has all-unique story headlines, so nothing collides
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'collision-b.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await page.waitForSelector('[data-testid="NoteRenderer"]');
        await expect(page.getByTestId('breadcrumb-collision-alert')).toHaveCount(0);
    });

    test('within-file duplicate headlines raise the alert; the drawer lists the group', async ({ page }) => {
        // collision-a has two '### Plan release' stories in one file
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'collision-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        const alert = page.getByTestId('breadcrumb-collision-alert');
        await expect(alert).toBeVisible({ timeout: 5000 });

        const drawer = page.getByTestId('collisions-drawer-grid');
        await expect(drawer).toHaveAttribute('data-open', 'false');
        await alert.click();
        await expect(drawer).toHaveAttribute('data-open', 'true');

        const list = page.getByTestId('collisions-drawer-list');
        await expect(list).toContainText('plan-release');
        await expect(list).toContainText('Plan release');
    });

    test('cross-file collisions in folder mode list both origins in the drawer', async ({ page }) => {
        // 'Shared milestone' appears in both files; 'Plan release' is duplicated within collision-a
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'collision-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'collision-b.md', doc_path: `${WORKSPACE_ROOT}/notegit/docstech/todo.md`, relative_path: 'notegit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        const alert = page.getByTestId('breadcrumb-collision-alert');
        await expect(alert).toBeVisible({ timeout: 5000 });
        await alert.click();

        const list = page.getByTestId('collisions-drawer-list');
        await expect(list).toContainText('shared-milestone');
        await expect(list).toContainText('oma/docstech/todo.md');
        await expect(list).toContainText('notegit/docstech/todo.md');
    });

    test('clicking a colliding title posts a revealRange so the editor jumps to that story', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'collision-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'collision-b.md', doc_path: `${WORKSPACE_ROOT}/notegit/docstech/todo.md`, relative_path: 'notegit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        await page.getByTestId('breadcrumb-collision-alert').click();
        await clearCapturedMessages(page);

        await page.getByTestId('collisions-drawer-note').first().click();

        const reveal = await findRevealMessage(page);
        expect(reveal).toBeTruthy();
        expect(typeof reveal?.from).toBe('number');
        expect(reveal?.docPath).toContain('docstech/todo.md');
    });
});
