import { test, expect } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectDirectoryMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

test.describe('Aggregate (Directory) view', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('directory mode shows a single NoteRenderer with aggregate flag and single toolbar', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'aggregate-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'aggregate-b.md', doc_path: `${WORKSPACE_ROOT}/notegit/docstech/todo.md`, relative_path: 'notegit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        // initially: two stacked NoteTreeComposers (single-file mode renders one per doc)
        await page.waitForSelector('[data-testid="NoteRenderer"]');

        // switch to directory mode
        await selectDirectoryMode(page);

        // NoteRenderer flips to aggregate variant
        const renderer = page.locator('[data-testid="NoteRenderer"]');
        await expect(renderer).toHaveAttribute('data-aggregate-mode', 'true', { timeout: 5000 });

        // exactly one toolbar visible (single merged view, not stacked)
        await expect(page.locator('[data-testid="view-toolbar"]')).toHaveCount(1);
    });

    test('origin pills appear on each aggregated story showing the project first letter', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'aggregate-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'aggregate-b.md', doc_path: `${WORKSPACE_ROOT}/notegit/docstech/todo.md`, relative_path: 'notegit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectDirectoryMode(page);
        await page.waitForSelector('[data-aggregate-mode="true"]');

        const pills = page.locator('[data-testid="origin-project-pill"]');
        await expect(pills).toHaveCount(4, { timeout: 5000 }); // 2 stories per file × 2 files

        // project letters: 'O' for oma, 'N' for notegit
        const project_attrs = await pills.evaluateAll((nodes) =>
            nodes.map((n) => n.getAttribute('data-project'))
        );
        expect(project_attrs).toEqual(expect.arrayContaining(['oma', 'oma', 'notegit', 'notegit']));
    });

    test('click on an origin pill sends revealRange with the origin doc path', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'aggregate-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'aggregate-b.md', doc_path: `${WORKSPACE_ROOT}/notegit/docstech/todo.md`, relative_path: 'notegit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectDirectoryMode(page);
        await page.waitForSelector('[data-aggregate-mode="true"]');

        // clear any messages from the mode-switch handshake
        await page.evaluate(() => { (window as unknown as { __captured_messages: unknown[] }).__captured_messages = []; });

        // click the first oma origin pill — should route to oma's todo.md
        const pill = page.locator('[data-testid="origin-project-pill"][data-project="oma"]').first();
        await expect(pill).toBeVisible({ timeout: 5000 });
        await pill.click({ force: true });

        await expect.poll(async () =>
            await page.evaluate(() => {
                const msgs = (window as unknown as { __captured_messages: Array<{ type?: string; docPath?: string }> }).__captured_messages;
                const reveal = msgs.find((m) => m.type === 'revealRange');
                return reveal ? reveal.docPath : undefined;
            }),
            { timeout: 5000 }
        ).toBe(`${WORKSPACE_ROOT}/oma/docstech/todo.md`);
    });

    test('breadcrumb segment click in aggregate mode sends setIntegration', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'aggregate-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'aggregate-b.md', doc_path: `${WORKSPACE_ROOT}/notegit/docstech/todo.md`, relative_path: 'notegit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        // start aggregation at workspace root via a direct setViewManagedState route through GenericView
        // we trigger directory mode and let the selector fire setIntegration on its default dir
        await selectDirectoryMode(page);
        await page.waitForSelector('[data-aggregate-mode="true"]');

        // clear messages
        await page.evaluate(() => { (window as unknown as { __captured_messages: unknown[] }).__captured_messages = []; });

        // click a segment of the breadcrumb — choose the first available segment button
        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible();
        const segment = nav.locator('button').first();
        await segment.click();

        const last_set_integration = await page.evaluate(() => {
            const msgs = (window as unknown as { __captured_messages: Array<{ type?: string; mode?: string; path?: string }> }).__captured_messages;
            return msgs.filter((m) => m.type === 'setIntegration').pop();
        });
        expect(last_set_integration).toBeDefined();
        expect(last_set_integration!.mode).toBe('directory');
        expect(typeof last_set_integration!.path).toBe('string');
    });

    test('switching aggregate to Kanban shows stories grouped by status linetag with origin pills', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'aggregate-a.md', doc_path: `${WORKSPACE_ROOT}/oma/docstech/todo.md`, relative_path: 'oma/docstech/todo.md' },
            { fixture: 'aggregate-b.md', doc_path: `${WORKSPACE_ROOT}/notegit/docstech/todo.md`, relative_path: 'notegit/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT });

        await selectDirectoryMode(page);
        await page.waitForSelector('[data-aggregate-mode="true"]');

        await sendCommand(page, 'setViewType', { viewType: 'kanban' });

        // origin pills still rendered inside the kanban cards
        await expect(page.locator('[data-testid="origin-project-pill"]').first()).toBeVisible({ timeout: 5000 });

        // kanban columns present (untagged + at least one status column)
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        const column_count = await page.locator('[role="columnheader"]').count();
        expect(column_count).toBeGreaterThanOrEqual(2);
    });
});
