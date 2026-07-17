import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

test.describe('Aggregate (Folder) view', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('folder mode shows a single NoteRenderer with folder flag and single toolbar', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        // initially: two stacked NoteTreeComposers (single-file mode renders one per doc)
        await page.waitForSelector('[data-testid="NoteRenderer"]');

        // switch to folder mode
        await selectFolderMode(page);

        // NoteRenderer flips to folder variant
        const renderer = page.locator('[data-testid="NoteRenderer"]');
        await expect(renderer).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });

        // exactly one toolbar visible (single merged view, not stacked)
        await expect(page.locator('[data-testid="view-toolbar"]')).toHaveCount(1);
    });

    test('origin pills appear on each merged story showing the project first letter', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        const pills = page.locator('[data-testid="origin-project-pill"]');
        await expect(pills).toHaveCount(4, { timeout: 5000 }); // 2 stories per file × 2 files

        // project labels: 'OM' for oma, 'NO' for notebook (no prefix collisions in this fixture set)
        const project_attrs = await pills.evaluateAll((nodes) =>
            nodes.map((n) => n.getAttribute('data-project'))
        );
        expect(project_attrs).toEqual(expect.arrayContaining(['oma', 'oma', 'notebook', 'notebook']));
    });

    test('click on an origin pill descends the folder root to the project subfolder AND opens the clicked story in the editor', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        // clear any messages from the mode-switch handshake
        await page.evaluate(() => { (window as unknown as { __captured_messages: unknown[] }).__captured_messages = []; });

        // click the first oma origin pill - pill click is ADDITIVE: descend the folder root to `${WORKSPACE_ROOT}/oma` via setIntegration AND open the clicked story in the editor via revealRange (the underlying headline click fires alongside the descend because the pill no longer stopPropagates)
        const pill = page.locator('[data-testid="origin-project-pill"][data-project="oma"]').first();
        await expect(pill).toBeVisible({ timeout: 5000 });
        await pill.click({ force: true });

        await expect.poll(async () =>
            await page.evaluate(() => {
                const msgs = (window as unknown as { __captured_messages: Array<{ type?: string; mode?: string; path?: string }> }).__captured_messages;
                const descend = msgs.find((m) => m.type === 'setIntegration' && m.mode === 'folder');
                return descend ? descend.path : undefined;
            }),
            { timeout: 5000 }
        ).toBe(`${WORKSPACE_ROOT}/oma`);

        // pill click ALSO posts a revealRange routed to the clicked story's source doc - the headline click fires after the pill click via event bubbling
        await expect.poll(async () =>
            await page.evaluate(() => {
                const msgs = (window as unknown as { __captured_messages: Array<{ type?: string; docPath?: string }> }).__captured_messages;
                return msgs.find((m) => m.type === 'revealRange')?.docPath;
            }),
            { timeout: 5000 }
        ).toBe(`${WORKSPACE_ROOT}/oma/docstech/todo.md`);
    });

    test('breadcrumb segment click in folder mode sends setIntegration', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        /*
         * start aggregation at workspace root via a direct setViewManagedState route through GenericView
         * we trigger folder mode and let the selector fire setIntegration on its default dir
         */
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        // clear messages
        await page.evaluate(() => { (window as unknown as { __captured_messages: unknown[] }).__captured_messages = []; });

        // click a segment of the breadcrumb - choose the first available segment button
        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible();
        const segment = nav.locator('button').first();
        await segment.click();

        const last_set_integration = await page.evaluate(() => {
            const msgs = (window as unknown as { __captured_messages: Array<{ type?: string; mode?: string; path?: string }> }).__captured_messages;
            return msgs.filter((m) => m.type === 'setIntegration').pop();
        });
        expect(last_set_integration).toBeDefined();
        expect(last_set_integration!.mode).toBe('folder');
        expect(typeof last_set_integration!.path).toBe('string');
    });

    test('breadcrumb shows the merged "(X in Y files)" count only in folder mode', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        // single-file (stacked) mode: the count is meaningless and must not appear
        await expect(page.getByTestId('breadcrumb-file-count')).toHaveCount(0);

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        // folder mode: "(X in 2 files)" - X is the merged top-level story count. the count is the Files tab's own title, so read the label element rather than the tab, which also carries a chevron
        const count = page.getByTestId('breadcrumb-file-count');
        await expect(count).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('breadcrumb-file-count-label')).toHaveText(/^\(\d+ in 2 files\)$/);
    });

    test('clicking the breadcrumb count opens the Files drawer; editing the include glob re-filters the list', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        const drawer = page.locator('[data-testid="files-drawer-grid"]');
        await expect(drawer).toHaveAttribute('data-open', 'false');

        await page.getByTestId('breadcrumb-file-count').click();
        await expect(drawer).toHaveAttribute('data-open', 'true');

        // both source files are listed under the default filters
        const list = page.getByTestId('files-drawer-list');
        await expect(list).toContainText('oma/docstech/todo.md');
        await expect(list).toContainText('notebook/docstech/todo.md');

        // narrowing the include glob re-filters the list client-side after the debounce
        await page.getByTestId('files-drawer-include').fill('**/oma/**');
        await expect(list).toContainText('oma/docstech/todo.md');
        await expect(list).not.toContainText('notebook/docstech/todo.md');

        // Escape closes the drawer
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveAttribute('data-open', 'false');
    });

    test('clicking a file in the Files drawer switches to current_file mode for that file and closes the drawer', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        const drawer = page.locator('[data-testid="files-drawer-grid"]');
        await page.getByTestId('breadcrumb-file-count').click();
        await expect(drawer).toHaveAttribute('data-open', 'true');

        await clearCapturedMessages(page);
        await page.getByTestId('files-drawer-file').first().click();

        // posts a setIntegration that switches to current_file mode targeting the clicked file (absolutized path)
        const messages = await getCapturedMessages(page);
        const set_integration = messages.find(m => m.type === 'setIntegration' && m.mode === 'current_file');
        expect(set_integration).toBeTruthy();
        expect(set_integration?.path as string).toContain('docstech/todo.md');
        // switching out of folder mode unmounts the folder-only Files drawer entirely, so it is dismissed
        await expect(drawer).toHaveCount(0);
    });

    test('outside-click dismisses the toolbar drawer; clicks inside or on the trigger do not double-toggle', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        const files_drawer = page.locator('[data-testid="files-drawer-grid"]');
        const settings_drawer = page.locator('[data-testid="settings-drawer-grid"]');

        // open Files, click inside the drawer body - stays open
        await page.getByTestId('breadcrumb-file-count').click();
        await expect(files_drawer).toHaveAttribute('data-open', 'true');
        await page.getByTestId('files-drawer-include').click();
        await expect(files_drawer).toHaveAttribute('data-open', 'true');

        // click a merged note in the view body - drawer closes
        await page.locator('[data-seq]').first().click();
        await expect(files_drawer).toHaveAttribute('data-open', 'false');

        // open Settings, click the gear again - drawer toggles closed (not re-opened by the outside-click handler racing the trigger)
        await page.getByTestId('view-settings-button').click();
        await expect(settings_drawer).toHaveAttribute('data-open', 'true');
        await page.getByTestId('view-settings-button').click();
        await expect(settings_drawer).toHaveAttribute('data-open', 'false');
    });

    test('switching folder mode to Kanban shows stories grouped by status linetag with origin pills', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');

        await sendCommand(page, 'setViewType', { viewType: 'kanban' });

        // origin pills still rendered inside the kanban cards
        await expect(page.locator('[data-testid="origin-project-pill"]').first()).toBeVisible({ timeout: 5000 });

        // kanban columns present (untagged + at least one status column)
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        const column_count = await page.locator('[role="columnheader"]').count();
        expect(column_count).toBeGreaterThanOrEqual(2);
    });
});
