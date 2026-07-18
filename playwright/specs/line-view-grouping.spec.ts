import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

const WORKSPACE_ROOT = '/mnt/workspace/active_development';

// keyboard-based drag (@hello-pangea/dnd: Space to lift, arrows to move lanes, Space to drop) - the same wire boundary the kanban drag specs use
async function keyboardDrag(page: Page, handle: Locator, direction: 'right' | 'left', moves: number): Promise<void> {
    await handle.scrollIntoViewIfNeeded();
    await handle.focus();
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    for (let i = 0; i < moves; i++) {
        await page.keyboard.press(direction === 'right' ? 'ArrowRight' : 'ArrowLeft');
        await page.waitForTimeout(200);
    }
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
}

// collect the edit changes from either the single-doc (`changes`) or multi-doc (`changes_by_doc`) editText shape
function collectChanges(edit: { changes?: Array<{ insert: string }>; changes_by_doc?: Record<string, Array<{ insert: string }>> }): Array<{ insert: string }> {
    if (edit.changes) { return edit.changes; }
    if (edit.changes_by_doc) { return Object.values(edit.changes_by_doc).flat(); }
    return [];
}

// bring up a folder board of two files in distinct project folders (alpha, beta), each carrying an authored `assignee` attribute, then switch to the Line view
async function setupLineFolder(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'line-view-a.md', doc_path: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, relative_path: 'alpha/docstech/board.md' },
        { fixture: 'line-view-b.md', doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await sendCommand(page, 'setViewType', { viewType: 'line' });
    // wait for the lane board itself (the first [role="region"] in the DOM is a hidden drawer, not a lane)
    await page.waitForSelector('[data-flip-root]', { timeout: 5000 });
}

test.describe('Line view grouping and drag', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('groups by first level folder by default; lanes match the project folders and cards do not drag', async ({ page }) => {
        await setupLineFolder(page);
        // the default group-by is the first level folder: the lanes are the project folders
        await expect(page.locator('[role="region"][aria-label="alpha"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[role="region"][aria-label="beta"]')).toBeVisible();
        // the folder axis is read-only, so no card carries a drag handle (the board renders lanes but takes no drops)
        await expect(page.locator('[data-rfd-drag-handle-draggable-id]')).toHaveCount(0);
    });

    test('changing the group-by re-derives the lanes (folder -> authored assignee, which is draggable)', async ({ page }) => {
        await setupLineFolder(page);
        await expect(page.locator('[role="region"][aria-label="alpha"]')).toBeVisible({ timeout: 5000 });

        // open the view settings drawer and switch the group-by to the authored `assignee` attribute
        await page.getByTestId('view-settings-button').click();
        await expect(page.locator('[data-testid="settings-drawer-grid"]')).toHaveAttribute('data-open', 'true');
        await page.getByTestId('group-by-selector').selectOption('assignee');

        // the lanes re-derive to the assignee values; the folder lanes are gone
        await expect(page.locator('[role="region"][aria-label="alex"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[role="region"][aria-label="sam"]')).toBeVisible();
        await expect(page.locator('[role="region"][aria-label="jo"]')).toBeVisible();
        await expect(page.locator('[role="region"][aria-label="alpha"]')).toHaveCount(0);
        // assignee is an authored, writable attribute, so the cards are draggable again
        await expect(page.locator('[data-rfd-drag-handle-draggable-id]').first()).toBeVisible();
    });

    test('dragging a card between attribute lanes rewrites that attribute in the file (inverse projection end-to-end)', async ({ page }) => {
        await setupLineFolder(page);
        // group by the authored assignee attribute, then close the drawer so it does not overlay the board
        await page.getByTestId('view-settings-button').click();
        await page.getByTestId('group-by-selector').selectOption('assignee');
        await expect(page.locator('[role="region"][aria-label="alex"]')).toBeVisible({ timeout: 5000 });
        await page.getByTestId('view-settings-button').click();
        await expect(page.locator('[data-testid="settings-drawer-grid"]')).toHaveAttribute('data-open', 'false');

        // drag a card out of the "alex" lane into the next assignee lane
        const alex_handle = page.locator('[role="region"][aria-label="alex"] [data-rfd-drag-handle-draggable-id]').first();
        await expect(alex_handle).toBeVisible({ timeout: 5000 });
        await clearCapturedMessages(page);
        await keyboardDrag(page, alex_handle, 'right', 1);

        // the drop posts an editText that rewrites the GROUP field (assignee), not status: 'jo'/'sam' exist only as assignee values, so an insert of one proves the inverse projection wrote the group key end-to-end
        const messages = await getCapturedMessages(page);
        const edit = messages.find((m: { type?: string }) => m.type === 'editText');
        expect(edit).toBeDefined();
        const inserts = collectChanges(edit as Parameters<typeof collectChanges>[0]).map(c => c.insert);
        expect(inserts.some(v => v === 'jo' || v === 'sam')).toBe(true);
    });
});
