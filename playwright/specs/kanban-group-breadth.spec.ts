import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * The group breadth, driven in the browser against the real bundle.
 *
 * The breadth is a pixel setting: the width of a group side by side, the height of a row stacked. These
 * specs cover its three ways in - the default, a drag on the gap between two groups, and the drawer's text
 * box - and what each does to the groups. The gesture needs real layout and a real pointer, which jsdom has
 * neither of; the drag arithmetic and the fill rule are asked of the pure functions in columnwidthops.test.ts.
 */

// the fixture holds seven groups, which is more than fit a narrow board and exactly what fits a wide one
const GROUP_COUNT = 7;

// the default breadth in px, which is what groups hold while the board is too narrow for all of them
const DEFAULT_BREADTH = 220;

async function setupKanbanBoard(page: Page): Promise<void> {
    const { path: doc_path } = await injectDocsFromFixture(page, 'kanban-wide.md');
    await page.waitForSelector('[data-seq]', { timeout: 5000 });
    await simulateSelectionChanged(page, doc_path, 2);
    await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
    await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
}

async function openKanbanSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('setting-control-lineBreadth')).toBeVisible();
}

/** size the viewport so the BOARD is `width` wide, whatever margins the harness page puts round it */
async function sizeBoardTo(page: Page, width: number): Promise<void> {
    await page.setViewportSize({ width: 1000, height: 800 });
    const board_width = await page.locator('[data-flip-root]').evaluate(el => el.clientWidth);
    await page.setViewportSize({ width: width + (1000 - board_width), height: 800 });
    await expect.poll(() => page.locator('[data-flip-root]').evaluate(el => el.clientWidth)).toBe(width);
}

/** every group's drawn width, rounded, which is the number the breadth sets */
async function groupWidths(page: Page): Promise<number[]> {
    return page.locator('[data-flip-column-id]').evaluateAll(groups => groups.map(group => Math.round(group.getBoundingClientRect().width)));
}

/** how many whole groups the board shows without scrolling */
async function groupsInView(page: Page): Promise<number> {
    return page.locator('[data-flip-root]').evaluate((board) => {
        const visible = board.getBoundingClientRect().right;
        return Array.from(board.querySelectorAll('[data-flip-column-id]'))
            .filter(group => group.getBoundingClientRect().right <= visible + 1).length;
    });
}

/**
 * The breadth values the view has posted so far. lineBreadth is per-view (homed at Line), so a drag on
 * a kanban board - not Line itself - writes kanban's own cell in the `views` bag
 * (`{setting: 'views', value: {sets: [{node_id: 'kanban', key: 'lineBreadth', value}]}}`) rather than
 * Line's own; both land as a `views` bag delta and are read here as one list of posted breadth numbers.
 */
async function breadthWrites(page: Page): Promise<unknown[]> {
    return page.evaluate(() => {
        const captured = (window as unknown as { __captured_messages: Array<{ type: string; setting?: string; value?: { sets?: Array<{ key?: string; value?: unknown }> } }> }).__captured_messages;
        return captured
            .filter(msg => msg.type === 'updateSetting' && msg.setting === 'views')
            .flatMap(msg => (msg.value?.sets ?? []).filter(op => op.key === 'lineBreadth').map(op => op.value))
            .filter(value => value !== undefined);
    });
}

test.describe('Kanban group breadth', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    test('at the default breadth a board shows 3 whole groups at 760px and all 7 at 1590px', async ({ page }) => {
        await setupKanbanBoard(page);
        await sizeBoardTo(page, 760);
        await expect.poll(() => groupsInView(page)).toBe(3);
        expect((await groupWidths(page))[0]).toBe(DEFAULT_BREADTH);

        await sizeBoardTo(page, 1590);
        await expect.poll(() => groupsInView(page)).toBe(GROUP_COUNT);
    });

    /*
     * Reduced motion stops the groups FLIP-animating after a resize: mid-transition, boundingBox() can read the
     * separator hundreds of px away, so the pointerdown misses it and the drag never starts. A longer wait
     * makes that worse, not better.
     */
    test('dragging one boundary resizes every group, and the drawer\'s text box shows the width during the drag', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await setupKanbanBoard(page);
        await sizeBoardTo(page, 760);
        await openKanbanSettings(page);
        const separator = page.getByTestId('group-separator').first();
        const box = (await separator.boundingBox())!;
        // the open drawer lies over the top of the board, so the drag starts on the separator just below it
        const drawer_bottom = await page.locator('[id$="-settings-drawer"] > *').first().evaluate(element => element.getBoundingClientRect().bottom);
        const start = { x: box.x + box.width / 2, y: Math.max(box.y + box.height / 2, drawer_bottom + 12) };
        expect(start.y).toBeLessThan(box.y + box.height);

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 40, start.y, { steps: 4 });
        await page.mouse.move(start.x + 80, start.y, { steps: 4 });
        // mid-drag, before the release: the groups and the text box both already read the dragged breadth
        await expect(page.getByTestId('setting-control-lineBreadth')).toHaveValue(`${DEFAULT_BREADTH + 80}`);
        await expect.poll(async () => (await groupWidths(page)).every(width => width === DEFAULT_BREADTH + 80)).toBe(true);
        expect(await breadthWrites(page)).toEqual([]);
        await page.mouse.up();

        await expect.poll(async () => (await groupWidths(page)).every(width => width === DEFAULT_BREADTH + 80)).toBe(true);
    });

    test('releasing a drag posts one updateSetting for lineBreadth', async ({ page }) => {
        await setupKanbanBoard(page);
        await sizeBoardTo(page, 760);
        const box = (await page.getByTestId('group-separator').first().boundingBox())!;
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 30, start.y, { steps: 6 });
        await page.mouse.move(start.x + 60, start.y, { steps: 6 });
        await page.mouse.up();

        await expect.poll(() => breadthWrites(page)).toEqual([DEFAULT_BREADTH + 60]);
    });

    test('typing a width into the drawer resizes the groups, and stacked the same box reads Row height', async ({ page }) => {
        await setupKanbanBoard(page);
        await sizeBoardTo(page, 760);
        await openKanbanSettings(page);
        const field = page.getByTestId('setting-control-lineBreadth');
        await expect(field).toHaveAttribute('aria-label', 'Column width');

        await field.fill('300');
        await field.press('Enter');
        await expect.poll(async () => (await groupWidths(page)).every(width => width === 300)).toBe(true);

        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');
        await expect(field).toHaveAttribute('aria-label', 'Row height');
        await expect(page.getByTestId('setting-row-lineBreadth')).toContainText('Row height');
    });
});
