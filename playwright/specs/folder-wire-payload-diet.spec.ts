import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { sendCommand } from '../helpers/send-command';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

/*
 * Proves text-only folder docs work in a real browser: PanelSession ships a folder-mode doc with
 * `text` but no `content`, so the webview has to parse it itself (useWorkerParsedDocs.ts) before it
 * can render, drag or reveal anything. Unit tests cover the parse/cache logic in jsdom, where no
 * Worker exists; this spec runs the same `omit_content` docs through a real browser end to end, the
 * only place the fallback path can be proven to produce a working board rather than an empty one.
 */

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const PATH_A = `${WORKSPACE_ROOT}/alpha/docstech/board.md`;
const PATH_B = `${WORKSPACE_ROOT}/beta/docstech/board.md`;

async function keyboardDrag(page: Page, draggable_locator: Locator, direction: 'right' | 'left' | 'up' | 'down', moves: number): Promise<void> {
    await draggable_locator.scrollIntoViewIfNeeded();
    await draggable_locator.focus();
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const key = direction === 'right' ? 'ArrowRight' : direction === 'left' ? 'ArrowLeft' : direction === 'down' ? 'ArrowDown' : 'ArrowUp';
    for (let i = 0; i < moves; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(200);
    }
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
}

test.describe('Folder wire-payload diet: text-only docs still work end to end', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a text-only folder doc still renders its stories with origin pills', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT, omit_content: true });

        await selectFolderMode(page);
        const renderer = page.locator('[data-testid="NoteRenderer"]');
        await expect(renderer).toHaveAttribute('data-folder-mode', 'true', { timeout: 5000 });

        // both files' stories must appear, 2 per fixture, proving the fallback parse produced a real, complete merged tree
        const pills = page.locator('[data-testid="origin-project-pill"]');
        await expect(pills).toHaveCount(4, { timeout: 5000 });
        const project_attrs = await pills.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-project')));
        expect(project_attrs).toEqual(expect.arrayContaining(['orbit', 'orbit', 'notebook', 'notebook']));
    });

    test('a text-only folder doc still reveals to the editor on an origin-pill click', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'folder-a.md', doc_path: `${WORKSPACE_ROOT}/orbit/docstech/todo.md`, relative_path: 'orbit/docstech/todo.md' },
            { fixture: 'folder-b.md', doc_path: `${WORKSPACE_ROOT}/notebook/docstech/todo.md`, relative_path: 'notebook/docstech/todo.md' },
        ], { workspace_root: WORKSPACE_ROOT, omit_content: true });

        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await clearCapturedMessages(page);

        const pill = page.locator('[data-testid="origin-project-pill"][data-project="orbit"]').first();
        await expect(pill).toBeVisible({ timeout: 5000 });
        await pill.click({ force: true });

        await expect.poll(async () => {
            const messages = await getCapturedMessages(page);
            return (messages.find((m: { type?: string }) => m.type === 'revealRange') as { docPath?: string } | undefined)?.docPath;
        }, { timeout: 5000 }).toBe(`${WORKSPACE_ROOT}/orbit/docstech/todo.md`);
    });

    test('a text-only folder doc still supports kanban drag write-back, targeting only the source file', async ({ page }) => {
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-folder-a.md', doc_path: PATH_A, relative_path: 'alpha/docstech/board.md' },
            { fixture: 'kanban-folder-b.md', doc_path: PATH_B, relative_path: 'beta/docstech/board.md' },
        ], { workspace_root: WORKSPACE_ROOT, omit_content: true });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await sendCommand(page, 'setViewType', { viewType: 'kanban' });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const doing = page.locator('[role="region"][aria-label="doing"]');
        const alpha_handle = doing.locator('[data-rfd-drag-handle-draggable-id]').filter({
            has: page.locator('[data-testid="origin-project-pill"][data-project="alpha"]'),
        }).first();
        await expect(alpha_handle).toBeVisible({ timeout: 5000 });

        await clearCapturedMessages(page);
        await keyboardDrag(page, alpha_handle, 'right', 1);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m: { type?: string }) => m.type === 'editText') as
            | { changes_by_doc?: Record<string, Array<{ from: number; to?: number; insert: string }>>; docPath?: string; changes?: Array<{ from: number; to?: number; insert: string }> }
            | undefined;
        expect(edit_msg).toBeDefined();

        const changes_by_doc = edit_msg!.changes_by_doc;
        let observed_changes: Array<{ from: number; to?: number; insert: string }>;
        if (changes_by_doc) {
            expect(Object.keys(changes_by_doc)).toContain(PATH_A);
            expect(Object.keys(changes_by_doc)).not.toContain(PATH_B);
            observed_changes = changes_by_doc[PATH_A] || [];
        } else {
            expect(edit_msg!.docPath).toBe(PATH_A);
            observed_changes = edit_msg!.changes || [];
        }
        expect(observed_changes.some((c) => c.insert === 'done')).toBe(true);
    });
});
