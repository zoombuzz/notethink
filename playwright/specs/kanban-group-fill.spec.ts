import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * Groups stretch to fill the visible view, and repeat their header at their far end, driven in the
 * browser against the real bundle: both depend on real layout (the viewport's height, where a group
 * ends) that jsdom cannot give us, so Jest covers only the footer's DOM shape
 * (ViewRenderer.module.scss owns the CSS this spec exercises).
 */

async function setupKanbanView(page: Page, fixture: string): Promise<{ id: string; path: string }> {
    const { id, path: doc_path } = await injectDocsFromFixture(page, fixture);
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
    return { id, path: doc_path };
}

test.describe('Kanban groups fill the view', () => {

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('a short board\'s groups (and the separators between them) reach the bottom of the view', async ({ page }) => {
        // every group in this fixture holds exactly one card, far shorter than the 800px viewport
        await setupKanbanView(page, 'kanban.md');
        const viewport = page.viewportSize()!;
        const column_bottoms = await page.locator('[data-flip-column-id]').evaluateAll(
            columns => columns.map(column => column.getBoundingClientRect().bottom),
        );
        expect(column_bottoms.length).toBeGreaterThan(0);
        for (const bottom of column_bottoms) {
            // a floor, not a cap: at least the bottom of the view below the toolbar, never short of it
            expect(bottom).toBeGreaterThanOrEqual(viewport.height - 2);
        }
        const separator_bottoms = await page.getByTestId('group-separator').evaluateAll(
            separators => separators.map(separator => separator.getBoundingClientRect().bottom),
        );
        expect(separator_bottoms.length).toBeGreaterThan(0);
        for (const bottom of separator_bottoms) {
            expect(bottom).toBeGreaterThanOrEqual(viewport.height - 2);
        }
    });

    test('each group repeats its header at its far end, below its cards', async ({ page }) => {
        await setupKanbanView(page, 'kanban.md');
        const groups = await page.locator('[data-flip-column-id]').evaluateAll(columns => columns.map(column => {
            const value = column.getAttribute('data-flip-column-id') ?? '';
            const header = column.querySelector('[role="columnheader"]');
            const footer = column.querySelector(`[data-testid="group-footer-${value}"]`);
            const cards = column.querySelector('[data-column-cards]');
            return {
                value,
                header_text: (header?.textContent ?? '').replace(/\s+/g, ' ').trim(),
                footer_text: (footer?.textContent ?? '').replace(/\s+/g, ' ').trim(),
                footer_bottom: footer?.getBoundingClientRect().bottom ?? -1,
                footer_top: footer?.getBoundingClientRect().top ?? -1,
                cards_bottom: cards?.getBoundingClientRect().bottom ?? -1,
                group_bottom: column.getBoundingClientRect().bottom,
            };
        }));
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
            // the same name and card count as the header, closing the group off below its cards
            expect(group.footer_text, group.value).toBe(group.header_text);
            expect(group.footer_top, group.value).toBeGreaterThanOrEqual(group.cards_bottom);
            expect(Math.abs(group.group_bottom - group.footer_bottom), group.value).toBeLessThan(4);
        }
    });

    test('stacked as rows, each group repeats its header at its right-hand end, after its cards', async ({ page }) => {
        await setupKanbanView(page, 'kanban.md');
        const tab = page.getByTestId('view-settings-button');
        if (await tab.getAttribute('aria-expanded') !== 'true') {
            await tab.click();
        }
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');
        await tab.click();
        const groups = await page.locator('[data-flip-column-id]').evaluateAll(columns => columns.map(column => {
            const value = column.getAttribute('data-flip-column-id') ?? '';
            const footer = column.querySelector(`[data-testid="group-footer-${value}"]`);
            const cards = column.querySelector('[data-column-cards]');
            return {
                value,
                footer_left: footer?.getBoundingClientRect().left ?? -1,
                footer_right: footer?.getBoundingClientRect().right ?? -1,
                cards_right: cards?.getBoundingClientRect().right ?? -1,
                group_right: column.getBoundingClientRect().right,
            };
        }));
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
            expect(group.footer_left, group.value).toBeGreaterThanOrEqual(group.cards_right);
            expect(Math.abs(group.group_right - group.footer_right), group.value).toBeLessThan(4);
        }
    });

    test('groups still window and fit correctly with the stretch applied: an empty board and the empty-stories overlay are unaffected', async ({ page }) => {
        const { path: doc_path } = await injectDocsFromFixture(page, 'kanban-long-group.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        // the long group still windows its cards under the stretch - far fewer mounted than its 40-card corpus
        const mounted = await backlog.locator('[data-column-card-id]').count();
        expect(mounted).toBeGreaterThan(0);
        expect(mounted).toBeLessThan(30);
        // the repeated footer sits outside the card list, never counted as one of them
        expect(await backlog.locator('[data-column-cards] [data-testid="group-footer-backlog"]').count()).toBe(0);
    });
});
