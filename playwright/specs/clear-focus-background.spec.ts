import { test, expect, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { clearCapturedMessages, findRevealMessage, getCapturedMessages } from '../helpers/capture-messages';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const PATH_A = `${WORKSPACE_ROOT}/alpha/docstech/board.md`;
const PATH_B = `${WORKSPACE_ROOT}/beta/docstech/board.md`;
// matches PERSIST_DEBOUNCE_MS in usePersistedViewStates.ts, so the debounce settles before the reload
const PERSIST_SETTLE_MS = 600;

const DOCS = [
    { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
    { fixture: 'kanban-folder-b.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
];

async function setupFolderKanban(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, DOCS, { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await sendCommand(page, 'setViewType', { viewType: 'kanban' });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

/*
 * The harness has no editor, so the extension sends no selection, which is the usual state of a
 * folder board. Focus must then come from the view alone and a background click must remove it for
 * good. page.reload() is the point of the last test: the harness backs vscode.getState/setState with
 * sessionStorage, which survives a reload as a real webview's persisted state does.
 */
test.describe('Clicking the board background clears focus', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a background click leaves no focused card when no editor holds a caret, and it stays cleared after a reload', async ({ page }) => {
        await setupFolderKanban(page);
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        await card_b1.locator('[role="rowheader"]').first().click({ force: true });
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });

        await page.locator('#v__folder__-inner').click({ position: { x: 2, y: 2 } });
        await expect(page.locator('[role="row"][aria-current="true"]')).toHaveCount(0);

        await page.waitForTimeout(PERSIST_SETTLE_MS);
        await page.reload();
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectMultipleDocsFromFixtures(page, DOCS, { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        await expect(page.locator('[role="row"][data-seq]:not([data-seq="0"])').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[role="row"][aria-current="true"]')).toHaveCount(0);
    });

    test('a restored panel drops the persisted virtual caret, so no card is focused from an offset alone', async ({ page }) => {
        await setupFolderKanban(page);
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        await card_b1.locator('[role="rowheader"]').first().click({ force: true });
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
        await page.waitForTimeout(PERSIST_SETTLE_MS);

        const persisted_caret = await page.evaluate(() => {
            const state = JSON.parse(sessionStorage.getItem('__vsCodeState') || '{}') as { viewStates?: Record<string, { display_options?: Record<string, unknown> }> };
            return Object.values(state.viewStates || {}).map((view) => view.display_options?.view_caret);
        });
        // the click did persist a virtual caret, so the restore below is the thing that must drop it
        expect(persisted_caret.some((caret) => typeof caret === 'number')).toBe(true);

        await page.reload();
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectMultipleDocsFromFixtures(page, DOCS, { workspace_root: WORKSPACE_ROOT });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        await expect(page.locator('[role="row"][data-seq]:not([data-seq="0"])').first()).toBeVisible({ timeout: 5000 });
        const restored_caret = await page.evaluate(() => {
            const state = JSON.parse(sessionStorage.getItem('__vsCodeState') || '{}') as { viewStates?: Record<string, { display_options?: Record<string, unknown> }> };
            return Object.values(state.viewStates || {}).map((view) => view.display_options?.view_caret);
        });
        expect(restored_caret.some((caret) => typeof caret === 'number')).toBe(false);
    });

    test('a click on empty toolbar space clears focus, and a click on a toolbar control does not', async ({ page }) => {
        await setupFolderKanban(page);
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        await card_b1.locator('[role="rowheader"]').first().click({ force: true });
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });

        await page.locator('[data-testid="view-settings-button"]').first().click();
        await expect(card_b1).toHaveAttribute('aria-current', 'true');

        await page.locator('[data-testid="view-toolbar"]').first().click({ position: { x: 1, y: 1 } });
        await expect(page.locator('[role="row"][aria-current="true"]')).toHaveCount(0);
    });

    test('with an editor caret inside a story, a background click leaves no focused card until the caret moves', async ({ page }) => {
        await setupFolderKanban(page);
        const card_b1 = page.locator('[role="row"][data-seq]:not([data-seq="0"])').filter({ hasText: 'Beta Task One' }).first();
        await clearCapturedMessages(page);
        await card_b1.locator('[role="rowheader"]').first().click({ force: true });
        const reveal = await findRevealMessage(page);
        expect(reveal?.docPath).toBeTruthy();
        // the extension answers the reveal with the editor caret in the story
        await simulateSelectionChanged(page, reveal!.docPath!, reveal!.from!);
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });

        await clearCapturedMessages(page);
        await page.locator('#v__folder__-inner').click({ position: { x: 2, y: 2 } });
        await expect(page.locator('[role="row"][aria-current="true"]')).toHaveCount(0);
        // the editor caret is left where it is, so the clear posts no reveal
        expect((await getCapturedMessages(page)).filter((message) => message.type === 'revealRange')).toHaveLength(0);

        // the extension resends the same selection on many events; the hold survives it
        await simulateSelectionChanged(page, reveal!.docPath!, reveal!.from!);
        await page.waitForTimeout(300);
        await expect(page.locator('[role="row"][aria-current="true"]')).toHaveCount(0);

        // a caret move inside the story releases the hold and focus follows the editor again
        await simulateSelectionChanged(page, reveal!.docPath!, reveal!.from! + 1);
        await expect(card_b1).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
    });
});
