import { test, expect } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';

test.describe('List bullets', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('non-checkbox parent listItem keeps its bullet even when nested children are checkboxes', async ({ page }) => {
        await injectDocsFromFixture(page, 'list-bullets.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });

        // collect { text, listStyleType } for each listItem by walking from the headline up
        // to its nearest <li>, so the pairing is unambiguous (hasText on <li> filters by the
        // entire subtree's text content, which matches ancestors of the intended node)
        const rows = await page.evaluate(() => {
            const headlines = Array.from(document.querySelectorAll('[role="rowheader"]')) as HTMLElement[];
            const out: Array<{ text: string; listStyleType: string }> = [];
            for (const h of headlines) {
                const li = h.closest('li[data-mdast-type="listItem"]') as HTMLElement | null;
                if (!li) { continue; }
                out.push({
                    text: (h.textContent || '').trim(),
                    listStyleType: getComputedStyle(li).listStyleType,
                });
            }
            return out;
        });

        const find = (needle: string) => rows.find((r) => r.text.startsWith(needle));

        expect(find('plain parent item with no children')?.listStyleType).toBe('disc');
        // the bug: this parent's bullet used to disappear because a descendant had a checkbox
        expect(find('parent item with nested checkbox children')?.listStyleType).toBe('disc');
        expect(find('another plain parent with non-checkbox nested children')?.listStyleType).toBe('disc');
        expect(find('first checkbox child')?.listStyleType).toBe('none');
        expect(find('second checkbox child')?.listStyleType).toBe('none');
        expect(find('nested plain child')?.listStyleType).toBe('disc');

        // capture a visual snapshot for manual inspection after CSS changes
        await page.locator('[data-testid="NoteRenderer"]').screenshot({
            path: 'test-results/list-bullets/rendered.png',
        });
    });
});
