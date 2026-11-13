import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { clearCapturedMessages, findSelectRangeMessage } from '../helpers/capture-messages';
import { fixtureOffsetOf, fixtureText } from '../helpers/fixtures';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
// the ring's reach from the card box: its 6px offset (8px for a nested note) plus its 2px width
const RING_REACH_PX = 10;

/*
 * The card action tray, driven in the browser against the real bundle. Jest proves when the tray shows and
 * what each icon posts; what only a browser shows is that the tray really sits below the card's bottom-right
 * corner, clear of the dashed ring, on a full card and on a sticky whose paper is tilted, and that the pencil
 * posts the caret position the editor needs.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function singleFileKanban(page: Page): Promise<string> {
    const { path: doc_path } = await injectDocsFromFixture(page, 'kanban.md');
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    return doc_path;
}

async function stickyFolderBoard(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'card-sticky-kanban-a.md', doc_path: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, relative_path: 'alpha/docstech/board.md' },
        { fixture: 'card-sticky-kanban-b.md', doc_path: `${WORKSPACE_ROOT}/beta/docstech/board.md`, relative_path: 'beta/docstech/board.md' },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await expect(page.locator('[data-card-type="sticky"]').first()).toBeVisible();
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const found = await locator.boundingBox();
    if (!found) { throw new Error('no bounding box'); }
    return found;
}

/** the tray's box against the card's: below its bottom edge by more than the ring, flush with its right edge */
async function expectTrayBeyondRing(card: Locator, tray: Locator): Promise<void> {
    const card_box = await box(card);
    const tray_box = await box(tray);
    expect(tray_box.y).toBeGreaterThanOrEqual(card_box.y + card_box.height + RING_REACH_PX);
    expect(tray_box.x + tray_box.width).toBeLessThanOrEqual(card_box.x + card_box.width + 1);
    expect(tray_box.x + tray_box.width).toBeGreaterThan(card_box.x + card_box.width - 80);
}

test.describe('The card action tray', () => {

    test('hangs below a highlighted card\'s corner, outside the ring, and posts the caret at the end of the title', async ({ page }) => {
        await harness(page);
        const doc_path = await singleFileKanban(page);
        await expect(page.getByTestId('note-action-tray')).toHaveCount(0);
        // a single file takes its highlight from the editor's caret, which the harness plays back
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf('kanban.md', '## Task B') + 4);
        const tray = page.getByTestId('note-action-tray');
        await expect(tray).toHaveCount(1);
        const card = page.locator('[role="row"][aria-current="true"]', { has: tray });
        await expectTrayBeyondRing(card, tray);
        // the icons take the ring's colour
        await expect(page.getByTestId('note-edit-button')).toHaveCSS('color', await card.evaluate(el => getComputedStyle(el).outlineColor));
        await expect(page.getByTestId('note-edit-button')).toHaveAttribute('title', 'Edit the title in the text editor');
        await clearCapturedMessages(page);
        await page.getByTestId('note-edit-button').click();
        const text = fixtureText('kanban.md');
        const expected = text.indexOf('## Task B') + '## Task B'.length;
        const message = await findSelectRangeMessage(page);
        expect(message).toMatchObject({ type: 'selectRange', from: expected, to: expected, docPath: doc_path, forceOpen: true });
    });

    test('hangs below a highlighted sticky whose paper is tilted, with the tray itself square', async ({ page }) => {
        await harness(page);
        await stickyFolderBoard(page);
        await page.locator('[data-card-type="sticky"] [role="rowheader"]').first().click();
        const tray = page.getByTestId('note-action-tray');
        await expect(tray).toHaveCount(1);
        const sticky = page.locator('[data-card-type="sticky"]', { has: tray });
        await expectTrayBeyondRing(sticky, tray);
        expect(await tray.evaluate(el => getComputedStyle(el).transform)).toBe('none');
        expect(await sticky.evaluate(el => getComputedStyle(el).transform)).toBe('none');
        await clearCapturedMessages(page);
        await page.getByTestId('note-edit-button').click();
        const text = fixtureText('card-sticky-kanban-a.md');
        const expected = text.indexOf('### Alpha one') + '### Alpha one'.length;
        const message = await findSelectRangeMessage(page);
        expect(message).toMatchObject({ type: 'selectRange', from: expected, to: expected, docPath: `${WORKSPACE_ROOT}/alpha/docstech/board.md`, forceOpen: true });
    });

    test('moves with the highlight: one tray, on the card now highlighted', async ({ page }) => {
        await harness(page);
        const doc_path = await singleFileKanban(page);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf('kanban.md', '## Task B') + 4);
        await expect(page.getByTestId('note-action-tray')).toHaveCount(1);
        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf('kanban.md', '## Task C') + 4);
        await expect(page.getByTestId('note-action-tray')).toHaveCount(1);
        const card = page.locator('[role="row"][aria-current="true"]', { has: page.getByTestId('note-action-tray') });
        await expect(card).toContainText('Task C');
    });
});
