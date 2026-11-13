import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { sendCommand } from '../helpers/send-command';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
// matches PERSIST_DEBOUNCE_MS in usePersistedViewStates.ts, so the debounce settles before reading state back
const PERSIST_SETTLE_MS = 600;

const FOLDER_DOCS = [
    { fixture: 'kanban-folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
    { fixture: 'kanban-folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
];

interface PersistedState { viewStates?: Record<string, { type?: string; display_options?: { split_ratio?: number } }> }

async function persistedViewStates(page: Page): Promise<PersistedState['viewStates']> {
    await page.waitForTimeout(PERSIST_SETTLE_MS);
    const raw = await page.evaluate(() => sessionStorage.getItem('__vsCodeState'));
    return (JSON.parse(raw ?? '{}') as PersistedState).viewStates;
}

async function widthOf(page: Page, test_id: string): Promise<number> {
    return (await page.getByTestId(test_id).boundingBox())!.width;
}

/*
 * The second pane is an ordinary GenericView reading its own view-state entry. page.reload() is the point
 * of the reload specs, not a workaround: the harness backs vscode.getState/setState with sessionStorage,
 * which survives a reload as a real webview's persisted state does, and re-injecting the docs stands in
 * for the extension's post-reload re-send.
 */
test.describe('Split view', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a single file opens a second pane, resizes, survives a reload, and closes leaving no entry', async ({ page }) => {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        await expect(page.getByTestId('split-handle')).toHaveCount(0);
        await expect(page.getByTestId('view-toolbar')).toHaveCount(1);

        await page.getByTestId('split-open-button').click();
        // each pane carries its own toolbar and its own scroll container
        await expect(page.getByTestId('view-toolbar')).toHaveCount(2);
        await expect(page.getByTestId('split-handle')).toBeVisible();
        await expect(page.getByTestId('split-pane-primary').locator('[role="columnheader"]').first()).toBeVisible();
        // the board opened beside a document: the second pane draws the document, not a second board
        await expect(page.getByTestId('split-pane-secondary').locator('[role="columnheader"]')).toHaveCount(0);
        await expect(page.getByTestId('split-pane-secondary').locator('[data-seq]').first()).toBeVisible();
        const overflow_y = await page.getByTestId('split-pane-secondary').evaluate(el => getComputedStyle(el).overflowY);
        expect(overflow_y).toBe('auto');
        await expect(page.getByTestId('split-close-button')).toHaveCount(1);
        // the second pane's own drawer opens from its own toolbar and leaves the first pane's closed
        await page.getByTestId('split-pane-secondary').getByTestId('view-settings-button').click();
        await expect(page.getByTestId('split-pane-secondary').getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
        await expect(page.getByTestId('split-pane-primary').getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'false');
        await page.getByTestId('split-pane-secondary').getByTestId('view-settings-button').click();

        // resize by the keyboard, then by a drag
        const before = await widthOf(page, 'split-pane-primary');
        await page.getByTestId('split-handle').focus();
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => widthOf(page, 'split-pane-primary')).toBeLessThan(before - 20);
        const handle_box = (await page.getByTestId('split-handle').boundingBox())!;
        const host_box = (await page.getByTestId('split-host').boundingBox())!;
        await page.mouse.move(handle_box.x + 3, handle_box.y + 100);
        await page.mouse.down();
        await page.mouse.move(host_box.x + host_box.width * 0.3, handle_box.y + 100, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => (await widthOf(page, 'split-pane-primary')) / host_box.width).toBeCloseTo(0.3, 1);
        const persisted = await persistedViewStates(page);
        expect(persisted?.__pane2__?.display_options?.split_ratio).toBeCloseTo(0.3, 1);
        expect(persisted?.__pane2__?.type).toBe('document');
        await page.screenshot({ path: 'test-results/split-view-open.png' });

        await page.reload();
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'kanban.md', doc_path);
        await expect(page.getByTestId('split-handle')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('view-toolbar')).toHaveCount(2);
        await expect.poll(async () => (await widthOf(page, 'split-pane-primary')) / (await widthOf(page, 'split-host'))).toBeCloseTo(0.3, 1);

        await page.getByTestId('split-close-button').click();
        await expect(page.getByTestId('split-handle')).toHaveCount(0);
        await expect(page.getByTestId('view-toolbar')).toHaveCount(1);
        await expect(page.getByTestId('split-open-button')).toBeVisible();
        const after_close = await persistedViewStates(page);
        expect(after_close).not.toHaveProperty('__pane2__');
    });

    test('folder mode shares one merged tree between a board and a document pane', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, FOLDER_DOCS, { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });

        await page.getByTestId('split-open-button').click();
        await expect(page.getByTestId('view-toolbar')).toHaveCount(2);
        // both files' stories are drawn in each pane
        const primary = page.getByTestId('split-pane-primary');
        const secondary = page.getByTestId('split-pane-secondary');
        await expect(primary.getByRole('heading', { name: 'Alpha Task Two' })).toBeVisible();
        await expect(primary.getByRole('heading', { name: 'Beta Task Two' })).toBeVisible();
        await expect(secondary.getByRole('heading', { name: 'Alpha Task Two' })).toBeVisible();
        await expect(secondary.getByRole('heading', { name: 'Beta Task Two' })).toBeVisible();

        // a window-wide view-type command retypes the first pane and leaves the second its own type
        await sendCommand(page, 'setViewType', { viewType: 'line' });
        await expect.poll(async () => (await persistedViewStates(page))?.__pane2__?.type).toBe('document');
        expect((await persistedViewStates(page))?.__folder__?.type).toBe('line');

        // focusing a card in the second pane does not move the first pane's focus
        await secondary.getByRole('heading', { name: 'Beta Task Two' }).click();
        await expect.poll(async () => (await persistedViewStates(page))?.__pane2__ !== undefined).toBe(true);
        await page.getByTestId('split-close-button').click();
        await expect(page.getByTestId('split-handle')).toHaveCount(0);
        expect(await persistedViewStates(page)).not.toHaveProperty('__pane2__');
        await expect(primary.getByRole('heading', { name: 'Alpha Task Two' })).toBeVisible();
    });
});
