import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/*
 * The column width, driven in the browser against the real bundle.
 *
 * The width is derived from the cards rather than declared, so none of these assert a number. Each one
 * asserts the DIRECTION the setting names: a squarer target card means a wider lane, a wider board past
 * the point the lanes fit means more of them rather than fatter ones, and stacking the lanes turns the
 * ratio on its side, so it sizes the card's height and each card's width is solved from its own text.
 * Only a real browser can answer any of it - the whole mechanism is a measurement of reflowed text,
 * which jsdom does not do.
 */

async function setupKanbanBoard(page: Page, fixture = 'kanban-wide.md'): Promise<void> {
    const { path: doc_path } = await injectDocsFromFixture(page, fixture);
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
    await expect(page.getByTestId('setting-row-kanbanCardRatio')).toBeVisible();
}

/** put an orientation at the workspace scope before the board first renders, so the first probe runs under it */
async function seedOrientation(page: Page, orientation: string): Promise<void> {
    await page.evaluate((value) => {
        const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings?: () => void };
        harness.__nt_settings.workspace.orientation = value;
        harness.__nt_publishSettings?.();
    }, orientation);
}

/** the rendered width of the first card, which is what the ratio sizes on a stacked board */
async function cardWidth(page: Page): Promise<number> {
    return page.locator('[data-column-card-id]').first().evaluate(el => el.getBoundingClientRect().width);
}

/** the rendered width of the first lane, which is the number every setting here moves */
async function laneWidth(page: Page): Promise<number> {
    return page.locator('[data-flip-column-id]').first().evaluate(el => el.getBoundingClientRect().width);
}

/** how many whole lanes the board shows without scrolling */
async function lanesInView(page: Page): Promise<number> {
    return page.locator('[data-flip-root]').evaluate((board) => {
        const visible = board.getBoundingClientRect().right;
        return Array.from(board.querySelectorAll('[data-flip-column-id]'))
            .filter(lane => lane.getBoundingClientRect().right <= visible + 1).length;
    });
}

test.describe('Kanban column width', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    /*
     * The area a card's text occupies is fixed by the notes, so a shorter target card is a wider one. The
     * same board asked for a 1:1 card must therefore lay out wider lanes than the same board asked for 1:3,
     * which is the whole claim the setting makes.
     */
    test('a squarer target card asks for a wider lane, since the text area is fixed', async ({ page }) => {
        // narrow, so the target width is what the lanes actually take; give them room to all fit and the fill rule sets the width instead and the ratio moves nothing
        await page.setViewportSize({ width: 520, height: 800 });
        await setupKanbanBoard(page);
        await openKanbanSettings(page);

        await page.selectOption('[data-testid="setting-control-kanbanCardRatio"]', '3');
        await expect.poll(() => laneWidth(page)).toBeGreaterThan(0);
        const tall = await laneWidth(page);

        await page.selectOption('[data-testid="setting-control-kanbanCardRatio"]', '1');
        await expect.poll(() => laneWidth(page)).toBeGreaterThan(tall);
    });

    /*
     * A board that opens already stacked must measure the same cards as one that opens side by side. It
     * did not: the probe clone keeps the lane's class and sits inside the live board, so the stacked rules
     * reached it - laying its cards along a row and sizing each from the `--nt-card-width` the clones carry
     * inline from the last solve. The probe was measuring its own output, cached it against the signature,
     * and the ratio setting then moved nothing at all on that board for the rest of the session.
     */
    test('a board that opens stacked measures the same cards as one that opens side by side', async ({ page }) => {
        await page.setViewportSize({ width: 520, height: 800 });
        await seedOrientation(page, 'rows');
        await setupKanbanBoard(page);
        await expect.poll(() => cardWidth(page)).toBeGreaterThan(0);
        const opened_stacked = await cardWidth(page);

        await openKanbanSettings(page);
        await page.selectOption('[data-testid="setting-control-orientation"]', 'columns');
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect.poll(() => cardWidth(page)).toBeCloseTo(opened_stacked, 0);
    });

    test('a stacked board that flips to columns still answers the ratio', async ({ page }) => {
        await page.setViewportSize({ width: 520, height: 800 });
        await seedOrientation(page, 'rows');
        await setupKanbanBoard(page);
        await openKanbanSettings(page);
        await page.selectOption('[data-testid="setting-control-orientation"]', 'columns');
        await expect.poll(() => laneWidth(page)).toBeGreaterThan(0);
        const at_default = await laneWidth(page);

        await page.selectOption('[data-testid="setting-control-kanbanCardRatio"]', '3');
        await expect.poll(() => laneWidth(page)).toBeLessThan(at_default);
    });

    /*
     * The point of the feature. Below the width the lanes need, they hold their target and the board
     * scrolls, so widening the panel reveals more of them at the same width rather than fattening the ones
     * already showing.
     */
    test('a wider board reveals more lanes at the same width, rather than widening the ones on screen', async ({ page }) => {
        await page.setViewportSize({ width: 620, height: 800 });
        await setupKanbanBoard(page);
        await expect.poll(() => laneWidth(page)).toBeGreaterThan(0);
        const narrow_width = await laneWidth(page);
        const narrow_count = await lanesInView(page);

        await page.setViewportSize({ width: 900, height: 800 });
        await expect.poll(() => lanesInView(page)).toBeGreaterThan(narrow_count);
        expect(await laneWidth(page)).toBeCloseTo(narrow_width, 0);
    });

    /*
     * Stacked lanes are the other half of the orientation flip: width stops being the main axis, so the
     * computed column width must not reach them and each lane spans the board instead.
     */
    test('flipping to rows stacks the lanes at least the board width, ignoring the column width', async ({ page }) => {
        await setupKanbanBoard(page);
        await openKanbanSettings(page);
        const board_width = await page.locator('[data-flip-root]').evaluate(el => el.clientWidth);

        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');
        await expect.poll(async () => {
            const widths = await page.locator('[data-flip-column-id]').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().width)));
            // at least the board, because a lane is as wide as its own cards and is floored at the board so a short one still draws a full band
            return widths.length > 0 && widths.every(w => w >= board_width - 2);
        }).toBe(true);
    });

    /*
     * The flip has to transpose BOTH axes or it is only half done. The first cut stacked the lanes and
     * left the cards inside each one running downwards, which is a column wearing a row's shape: the board
     * gained no horizontal reach and every lane grew as tall as its own card list.
     */
    test('flipping to rows runs the cards along each lane, not down it', async ({ page }) => {
        // the one fixture here with a lane holding two cards, which is what makes the two axes distinguishable
        await setupKanbanBoard(page, 'kanban-reorder.md');
        await openKanbanSettings(page);
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');

        // a lane with more than one card is the only one that can answer this, since one card sits on every axis at once
        await expect.poll(async () => page.locator('[data-column-cards]').evaluateAll(lists => {
            const multi = lists.filter(list => list.children.length > 1);
            if (multi.length === 0) { return 'no lane holds two cards'; }
            return multi.every(list => {
                const [first, second] = Array.from(list.children).map(card => card.getBoundingClientRect());
                return second.left > first.left && Math.abs(second.top - first.top) < 2;
            }) ? 'side by side' : 'stacked';
        })).toBe('side by side');
    });

    /*
     * The lane name is turned on its side and set beside the cards rather than above them. A name reading
     * across the top costs every row a line of height it does not otherwise need, and the point of the
     * stacked layout is that a row is exactly one card tall.
     */
    test('stacked, the lane name sits beside the cards rather than above them', async ({ page }) => {
        await setupKanbanBoard(page, 'kanban-reorder.md');
        await openKanbanSettings(page);
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');

        await expect.poll(async () => page.locator('[data-flip-column-id]').first().evaluate((lane) => {
            const heading = lane.querySelector('[role="columnheader"]')?.getBoundingClientRect();
            const cards = lane.querySelector('[data-column-cards]')?.getBoundingClientRect();
            if (!heading || !cards) { return 'missing'; }
            return cards.left >= heading.right - 1 && cards.top < heading.bottom ? 'beside' : 'above';
        })).toBe('beside');
    });

    /*
     * The defect this guards was shipped and seen: capping the CARD's height from outside squeezed a box
     * that already contains its own clip, and since a card deliberately sets no overflow of its own, the
     * body spilled out over its neighbours and the focused-note scroll then scrolled inside it. A card's
     * content must stay inside the card, whatever is deciding how tall the card is.
     */
    test('stacked, no card spills its content outside its own box', async ({ page }) => {
        await setupKanbanBoard(page, 'kanban-reorder.md');
        await openKanbanSettings(page);
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');

        await expect.poll(async () => page.locator('[data-column-card-id]').evaluateAll(
            cards => cards.filter(card => card.scrollHeight > card.clientHeight + 2).length,
        )).toBe(0);
    });

    /*
     * The transpose in one assertion. Side by side, every card is the same width and a wordy one is
     * taller; stacked, every card is the same height and a wordy one is wider. Sizing a stacked board by
     * one shared width instead left the row as tall as its longest card, with every other card floating
     * in the space that card needed.
     */
    test('stacked, every card in a lane is drawn the same height and a wordy one is wider instead', async ({ page }) => {
        // the one fixture whose lane holds three cards of deliberately different lengths: a two-card lane makes the wordy one its own median, so it lands exactly on the floor and the widths cannot separate
        await setupKanbanBoard(page, 'kanban-ragged.md');
        await openKanbanSettings(page);
        await page.selectOption('[data-testid="setting-control-orientation"]', 'rows');
        await expect(page.locator('[data-flip-root]')).toHaveAttribute('data-orientation', 'rows');

        await expect.poll(async () => page.locator('[data-column-cards]').evaluateAll(lists => {
            const multi = lists.filter(list => list.children.length > 1);
            if (multi.length === 0) { return 'no lane holds two cards'; }
            return multi.every(list => {
                const heights = Array.from(list.children).map(card => card.getBoundingClientRect().height);
                return Math.max(...heights) - Math.min(...heights) < 2;
            }) ? 'one height' : 'ragged';
        })).toBe('one height');

        // the other half of the same claim, and the half the title had been asserting on trust: the extra text has to leave as width
        const spread = await page.locator('[data-column-cards]').evaluateAll(lists => {
            const multi = lists.filter(list => list.children.length > 1);
            const widths = multi.map(list => Array.from(list.children).map(card => card.getBoundingClientRect().width));
            return widths.map(w => Math.max(...w) - Math.min(...w));
        });
        expect(spread.length).toBeGreaterThan(0);
        expect(Math.max(...spread)).toBeGreaterThan(2);
    });
});
