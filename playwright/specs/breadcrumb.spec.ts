import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

test.describe('Breadcrumb workspace root stripping', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('shows full path when no workspace_root is provided', async ({ page }) => {
        const doc_path = '/mnt/secure/home/alex/git/github.com/active_development/notethink/docstech/testdata/example.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path);

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        // Without workspace_root or relative_path, all path segments should be visible
        await expect(nav.locator('button', { hasText: 'mnt' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'secure' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'active_development' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'notethink' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'example.md' })).toBeVisible();
    });

    test('keeps the opened workspace folder as the first breadcrumb segment', async ({ page }) => {
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/notethink/docstech/testdata/example.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, workspace_root);

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        // absolute prefix above the opened folder stays hidden
        await expect(nav.locator('button', { hasText: 'mnt' })).not.toBeVisible();
        // the opened folder itself is now the first segment
        await expect(nav.locator('button', { hasText: 'active_development' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'notethink' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'example.md' })).toBeVisible();
    });

    test('uses relative_path for breadcrumb (symlink-safe), keeping the opened folder as root', async ({ page }) => {
        /*
         * simulate symlink mismatch: workspace opened via /home/alex/github.com/active_development
         * but doc path resolves via /mnt/secure/home/alex/git/github.com/active_development
         * workspace_root won't match doc_path, but relative_path from asRelativePath handles it
         */
        const doc_path = '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, {
            workspace_root: '/home/alex/github.com/active_development',
            relative_path: 'countingsheet/docs/todo.md',
        });

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        // absolute prefix above the opened folder stays hidden
        await expect(nav.locator('button', { hasText: 'mnt' })).not.toBeVisible();
        await expect(nav.locator('button', { hasText: 'secure' })).not.toBeVisible();
        await expect(nav.locator('button', { hasText: 'home' })).not.toBeVisible();

        // the opened folder is the first segment, derived from doc_path minus the relative suffix
        const first_button = nav.locator('button[data-path]').first();
        await expect(first_button).toHaveText('active_development');
        await expect(nav.locator('button', { hasText: 'countingsheet' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'docs' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'todo.md' })).toBeVisible();
    });

    test('relative_path data-path attributes use full absolute paths for folder loading', async ({ page }) => {
        const doc_path = '/mnt/secure/home/alex/git/github.com/active_development/countingsheet/docs/todo.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, {
            relative_path: 'countingsheet/docs/todo.md',
        });

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        const first_segment = nav.locator('button[data-path]').first();
        // first segment is the opened folder itself
        await expect(first_segment).toHaveAttribute(
            'data-path',
            '/mnt/secure/home/alex/git/github.com/active_development'
        );
    });

    test('breadcrumb with workspace root shows the opened folder as the first segment', async ({ page }) => {
        const workspace_root = '/mnt/secure/home/alex/git/github.com/active_development';
        const doc_path = workspace_root + '/countingsheet/nodejs/ledger/docs/todo.md';
        await injectDocsFromFixture(page, 'basic.md', doc_path, workspace_root);

        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible({ timeout: 5000 });

        const first_button = nav.locator('button[data-path]').first();
        await expect(first_button).toHaveText('active_development');
        await expect(nav.locator('button', { hasText: 'countingsheet' })).toBeVisible();

        await expect(nav.locator('button', { hasText: 'nodejs' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'ledger' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'docs' })).toBeVisible();
        await expect(nav.locator('button', { hasText: 'todo.md' })).toBeVisible();
    });
});

/*
 * The trail hosts three of the four drawer tabs, so it is the trail that decides how tall the toolbar
 * row is - and a board rooted at the workspace root has no ancestor segments to decide it with. These
 * measure the row rather than assert a pixel count: what has to hold is that the two cases agree with
 * each other, that a tab still reaches the row's bottom edge (the seam an open tab merges through),
 * and that the drawers stick at exactly the row's height.
 */
test.describe('Toolbar row geometry', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    async function toolbarHeight(page: import('@playwright/test').Page): Promise<number> {
        const box = await page.locator('[data-testid="view-toolbar"]').first().boundingBox();
        return box!.height;
    }

    test('the row keeps its height when the breadcrumb has no ancestors above the leaf', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[data-testid="NoteRenderer"]');

        // single-file mode on a deep path: active_development > oma > docstech > [todo.md], so ancestor text is there to set the height
        await expect(page.getByTestId('breadcrumb-leaf').first()).toBeVisible({ timeout: 5000 });
        const with_ancestors = await toolbarHeight(page);

        // rooted at the workspace root the trail is the leaf tab alone, with no ancestor segment behind it
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });
        await expect(page.locator('[data-testid="view-toolbar"]')).toHaveCount(1);
        await expect(page.getByTestId('breadcrumb-leaf')).toHaveText(/active_development/);
        const without_ancestors = await toolbarHeight(page);

        expect(without_ancestors).toBeCloseTo(with_ancestors, 1);
    });

    test('a tab reaches the toolbar bottom edge, and the drawers stick at exactly that height', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[data-testid="NoteRenderer"]');
        await sendCommand(page, 'setIntegrationScope', { mode: 'folder', path: WORKSPACE_ROOT });
        await expect(page.locator('[data-testid="NoteRenderer"]')).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });

        const toolbar_box = (await page.locator('[data-testid="view-toolbar"]').first().boundingBox())!;
        const tab_box = (await page.getByTestId('view-settings-button').boundingBox())!;
        // the tab's background has to meet the drawer body pushed down beneath it, with no strip of toolbar left between them
        expect(tab_box.y + tab_box.height).toBeCloseTo(toolbar_box.y + toolbar_box.height, 1);

        // the drawer hangs off the sticky toolbar, so its offset and the row's height are one number in the SCSS
        const drawer_top = await page.getByTestId('settings-drawer-grid').evaluate((el) => getComputedStyle(el).top);
        expect(drawer_top).toBe(`${toolbar_box.height}px`);
    });
});
