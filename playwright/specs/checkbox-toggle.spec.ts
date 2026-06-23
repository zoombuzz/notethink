import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

/*
 * regression guard: clicking a rendered task checkbox in the viewer must post an
 * editText that flips the source state char. This silently broke because (a) the
 * edit-computation regex only matched '-' bullets while these fixtures (and the repo
 * todo files) use '+' bullets, and (b) single-file mode posted an undefined docPath
 * the extension refuses. The list-bullets fixture is a flat file (no nested stories),
 * so the note carries no origin and the docPath must fall back to the view's own doc.
 */

test.describe('Checkbox toggle', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('clicking a + bullet task checkbox posts editText with a docPath', async ({ page }) => {
        const injected = await injectDocsFromFixture(page, 'list-bullets.md');
        await page.waitForSelector('input[type="checkbox"]', { timeout: 5000 });

        // the rendered checkbox must be interactive, not a disabled GFM render
        const second = page.locator('[role="rowheader"]', { hasText: 'second checkbox child' }).locator('input[type="checkbox"]');
        await expect(second).toBeEnabled();
        await expect(second).not.toBeChecked();

        await clearCapturedMessages(page);
        await second.click();
        await page.waitForTimeout(200);

        const messages = await getCapturedMessages(page);
        const edits = messages.filter((m) => m.type === 'editText');
        expect(edits.length).toBeGreaterThanOrEqual(1);
        const edit = edits[0] as { docPath?: string; changes?: Array<{ from: number; to: number; insert: string }> };
        // single-file flat doc has no note origin: docPath falls back to the view's own doc
        expect(edit.docPath).toBe(injected.path);
        expect(edit.changes?.[0].insert).toBe('X');
        expect(edit.changes?.[0].to).toBe(edit.changes![0].from + 1);
    });

    test('clicking an already-checked task posts editText that clears the state char', async ({ page }) => {
        await injectDocsFromFixture(page, 'list-bullets.md');
        await page.waitForSelector('input[type="checkbox"]', { timeout: 5000 });

        const first = page.locator('[role="rowheader"]', { hasText: 'first checkbox child' }).locator('input[type="checkbox"]');
        await expect(first).toBeChecked();

        await clearCapturedMessages(page);
        await first.click();
        await page.waitForTimeout(200);

        const messages = await getCapturedMessages(page);
        const edits = messages.filter((m) => m.type === 'editText');
        expect(edits.length).toBeGreaterThanOrEqual(1);
        const edit = edits[0] as { changes?: Array<{ insert: string }> };
        expect(edit.changes?.[0].insert).toBe(' ');
    });
});
