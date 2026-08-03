import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { pointerDrag } from '../helpers/pointer-drag';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * Regression guard for a manually expanded card collapsing on the next content edit. MarkdownNote held the
 * "Show more" flag in local state and reset it whenever body_raw changed; ticking a checkbox rewrites the
 * body ([ ] -> [X]), so the authoritative echo from the extension re-applied the clip and the card snapped
 * shut a beat after the click - reading as if the click had scrolled the note. "Show less" is the only
 * in-place collapse; a different note arriving in the slot still starts collapsed because views key cards
 * by note identity and React mounts a fresh instance.
 *
 * Expansion is view-managed state (the note's stable_id in the view's view_expanded_ids), not component
 * state, so it also survives the card being dropped into another kanban column - a move that unmounts the
 * card from one Droppable and mounts a fresh instance under another, which is exactly what a local
 * useState could not survive.
 *
 * The edit is delivered the way the extension delivers it - a full doc update carrying the ticked source -
 * rather than by clicking the checkbox, because the harness has no extension host to apply the editText and
 * echo it back. Clicking the box is covered by checkbox-toggle.spec.ts; what matters here is what the view
 * does when the rewritten body lands.
 */

test.describe('Manual expand survives content edits', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    // expand the tall card and return the doc path it was injected under
    async function setupExpandedCard(page: Page): Promise<string> {
        const { path: doc_path } = await injectDocsFromFixture(page, 'manual-expand.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        const show_more = page.getByRole('button', { name: /show more/i }).first();
        await expect(show_more).toBeVisible();
        await show_more.click();
        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
        return doc_path;
    }

    test('a ticked checkbox does not collapse the expanded card', async ({ page }) => {
        await setupExpandedCard(page);

        await injectDocsFromFixture(page, 'manual-expand-ticked.md', '/workspace/manual-expand.md');
        await expect(page.locator('[role="rowheader"]', { hasText: 'first task on the expanded card' }).locator('input[type="checkbox"]')).toBeChecked();

        // the card must still be expanded: Show less present, no Show more bar, no clip on the body
        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /show more/i })).toHaveCount(0);
    });

    test('dragging the expanded card to another column lands it still expanded', async ({ page }) => {
        await setupExpandedCard(page);

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(doing_column.getByRole('heading', { name: 'Long Story' })).toBeVisible();

        const long_story_handle = doing_column.locator('[data-rfd-drag-handle-draggable-id]').first();
        // press near the card's top edge: an expanded card is taller than the viewport, so its centre is off-screen
        await pointerDrag(page, long_story_handle, backlog_column, { max_press_offset: 24 });

        // the drag completed: the card sits in the destination column and has left the source one
        await expect(backlog_column.getByRole('heading', { name: 'Long Story' })).toBeVisible({ timeout: 3000 });
        await expect(doing_column.getByRole('heading', { name: 'Long Story' })).toHaveCount(0);

        // the fresh instance mounted under the destination column is still expanded
        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /show more/i })).toHaveCount(0);
    });

    /*
     * refresh-resilience test: the reload IS the behaviour under test, not a workaround. Expansion is
     * keyed by stable_id and stable_id is re-derived from the same file content, so the id the reloaded
     * view looks up is the id the persisted list already holds. The caret has to be replayed afterwards
     * because AutoView resolves kanban from a selectionChanged and the harness has no editor to re-send
     * one; a real host still has the document open and does. Docs themselves come back from the
     * persisted state, so only the selection needs replaying.
     */
    test('an expanded card is still expanded after a reload', async ({ page }) => {
        const doc_path = await setupExpandedCard(page);

        // wait until the expansion has reached the (sessionStorage-backed) webview state before the reload
        await expect.poll(() => page.evaluate(() => {
            try {
                const s = JSON.parse(sessionStorage.getItem('__vsCodeState') || '{}');
                const states: Array<{ display_options?: { view_expanded_ids?: string[] } }> = Object.values(s.viewStates || {});
                return states.flatMap((v) => v.display_options?.view_expanded_ids ?? []).length;
            } catch { return 0; }
        }), { timeout: 5000 }).toBeGreaterThan(0);

        await page.reload();
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        await expect(page.getByRole('button', { name: /show less/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /show more/i })).toHaveCount(0);
    });

    test('"Show less" collapses the card', async ({ page }) => {
        await setupExpandedCard(page);

        await page.getByRole('button', { name: /show less/i }).click();
        await expect(page.getByRole('button', { name: /show less/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /show more/i }).first()).toBeVisible();
    });
});
