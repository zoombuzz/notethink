import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged, simulateSelectionCleared } from '../helpers/simulate-selection';
import { clearCapturedMessages, findRevealMessage } from '../helpers/capture-messages';

/**
 * Single-caret ownership parity: the same click cycle on a single-file board must land the identical
 * highlighted then selected story whether or not an editor is the live caret owner.
 * - editor-closed: the board is a virtual editor; a click on the board note scopes it via the virtual
 *   caret, and the story click cycle highlights then selects with no selectionChanged ever fed.
 * - editor-open: an editor caret scopes the board, and the board click echoes a selectionChanged that
 *   moves the editor caret onto the story; the editor-derived match must resolve to the same story.
 */

interface CardParityState {
    highlighted_seq: string | null;
    selected_seq: string | null;
}

const KANBAN_FIXTURE: string = 'kanban.md';
const BOARD_HEADING: string = 'Project Board';

// caret offset inside the "# Project Board" H1 (offset 2 is within the heading) used to scope the board via an editor caret
const BOARD_HEAD_OFFSET: number = 2;

function backlogTaskACard(page: Page): Locator {
    return page.locator('[role="region"][aria-label="backlog"] [role="row"]').filter({ hasText: 'Task A' }).first();
}

// exactly one story may carry the highlight / select ring at a time; return its stable seq for cross-case comparison
async function onlyMarkedSeq(page: Page, attribute: string): Promise<string | null> {
    const marked = page.locator(`[role="row"][${attribute}="true"]`);
    await expect(marked).toHaveCount(1, { timeout: 3000 });
    return marked.getAttribute('data-seq');
}

// editor-closed: click the board note so the virtual caret scopes the file to its kanban board, no editor caret involved
async function establishBoardViaVirtualCaret(page: Page): Promise<void> {
    const { path: doc_path } = await injectDocsFromFixture(page, KANBAN_FIXTURE);
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await page.getByRole('rowheader', { name: BOARD_HEADING, exact: true }).click({ force: true });
    await expect(page.locator('[data-auto-selected-viewtype="kanban"]')).toBeVisible({ timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    // reproduce the real no-editor signal: the extension used to pin a phantom (0,0) editor caret when no editor was open, which defeated the virtual caret; the fix sends a clear instead. feed the phantom then the clear so the click cycle below actually exercises the null-clear path - the old (0,0)-pinned behaviour would resolve the editor match to offset 0 and fail the highlight
    await simulateSelectionChanged(page, doc_path, 0);
    await simulateSelectionCleared(page, doc_path);
}

// editor-open: an editor caret inside the board note scopes the file to its kanban board
async function establishBoardViaEditorCaret(page: Page): Promise<void> {
    const { path: doc_path } = await injectDocsFromFixture(page, KANBAN_FIXTURE);
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, BOARD_HEAD_OFFSET);
    await expect(page.locator('[data-auto-selected-viewtype="kanban"]')).toBeVisible({ timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

// echo the click's captured revealRange back as the editor's selectionChanged, moving the editor caret onto the clicked story
async function echoEditorCaretFromReveal(page: Page): Promise<void> {
    await expect.poll(async () => (await findRevealMessage(page)) !== undefined, { timeout: 3000 }).toBe(true);
    const reveal = await findRevealMessage(page);
    await simulateSelectionChanged(page, reveal!.docPath!, reveal!.from!);
}

// run the shared two-click cycle on the Task A card and return which story ended up highlighted then selected
async function runTaskAClickCycle(page: Page, feed_editor_selection: boolean): Promise<CardParityState> {
    const card = backlogTaskACard(page);
    const headline = card.locator('[role="rowheader"]').first();
    await expect(headline).toBeVisible({ timeout: 5000 });

    // first click highlights the clicked story; the editor-open case then echoes the caret it revealed
    await clearCapturedMessages(page);
    await headline.click({ force: true });
    if (feed_editor_selection) {
        await echoEditorCaretFromReveal(page);
    }
    await expect(card).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
    const highlighted_seq = await onlyMarkedSeq(page, 'aria-current');

    // second click at the same offset promotes the story to selected; the persisted editor caret keeps the open case authoritative
    await headline.click({ force: true });
    await expect(card).toHaveAttribute('aria-selected', 'true', { timeout: 3000 });
    const selected_seq = await onlyMarkedSeq(page, 'aria-selected');

    return { highlighted_seq, selected_seq };
}

test.describe('Kanban click parity: editor-closed vs editor-open (single-caret ownership)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('editor-closed: first click highlights the story, second click selects it (virtual caret)', async ({ page }) => {
        await establishBoardViaVirtualCaret(page);
        const state = await runTaskAClickCycle(page, false);
        expect(state.highlighted_seq).not.toBeNull();
        // the same single story is highlighted then selected
        expect(state.selected_seq).toBe(state.highlighted_seq);
    });

    test('editor-open: an echoed selectionChanged reaches the same highlight then select', async ({ page }) => {
        await establishBoardViaEditorCaret(page);
        const state = await runTaskAClickCycle(page, true);
        expect(state.highlighted_seq).not.toBeNull();
        expect(state.selected_seq).toBe(state.highlighted_seq);
    });

    test('parity: editor-closed and editor-open highlight and select the identical story', async ({ page, browser }) => {
        // editor-closed run on the beforeEach board, with no caret ever fed
        await establishBoardViaVirtualCaret(page);
        const closed = await runTaskAClickCycle(page, false);

        // editor-open run on a fully independent board so neither run pollutes the other
        const context = await browser.newContext();
        const open_page = await context.newPage();
        await open_page.goto('/playwright/harness/index.html');
        await open_page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await establishBoardViaEditorCaret(open_page);
        const open = await runTaskAClickCycle(open_page, true);
        await context.close();

        // identical highlighted story and identical selected story across the two caret owners
        expect(closed.highlighted_seq).toBe(open.highlighted_seq);
        expect(closed.selected_seq).toBe(open.selected_seq);
        expect(closed.highlighted_seq).toBe(closed.selected_seq);
    });
});
