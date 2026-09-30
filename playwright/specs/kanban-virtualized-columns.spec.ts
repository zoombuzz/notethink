import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { fixtureOffsetOf } from '../helpers/fixtures';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { pointerDrag } from '../helpers/pointer-drag';
import { getCapturedMessages, clearCapturedMessages } from '../helpers/capture-messages';

// outline-offset (6px) + outline width (2px) of ViewRenderer.module.scss's .focused ring, outside getBoundingClientRect
const FOCUS_RING_MARGIN_PX = 8;

/**
 * Waits until `locator`'s bounding box is stable, so a caller grabbing it for a gesture doesn't read a
 * position the windowed lane is still correcting as a row's flat estimate is replaced by its real
 * measured height. Fails after 6s rather than silently racing ahead on a stale box.
 */
async function stabilizeBoundingBox(locator: Locator): Promise<void> {
    let stable_reads = 0;
    let previous_y: number | undefined;
    await expect(async () => {
        const current = await locator.boundingBox();
        const current_y = current?.y;
        stable_reads = current_y !== undefined && current_y === previous_y ? stable_reads + 1 : 0;
        previous_y = current_y;
        // three matches, not one: the throttled scroll-offset listener can coincidentally match mid-settle on just a pair
        expect(stable_reads).toBeGreaterThanOrEqual(3);
    }).toPass({ timeout: 6000, intervals: [200] });
}

// in columns orientation every lane always mounts; only a lane's own length is windowed
test.describe('Kanban virtualized columns', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    /** Pins the view's card type before any doc is injected. */
    async function setCardType(page: Page, card_type: string): Promise<void> {
        await page.evaluate((type) => {
            const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings: () => void };
            harness.__nt_settings.workspace.cardType = type;
            harness.__nt_publishSettings();
        }, card_type);
    }

    /** The card-surface properties CODING_STANDARDS' "every card type works in every view" promises, read off the card's own root element (not a child, since sticky paints its surface on an inner element). */
    async function cardSurface(card: Locator): Promise<Record<string, string>> {
        return card.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                background: style.backgroundColor,
                border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
                borderRadius: style.borderRadius,
                boxShadow: style.boxShadow,
                padding: style.padding,
            };
        });
    }

    async function setupKanbanView(page: Page, fixture: string): Promise<{ id: string; path: string }> {
        const { id, path: doc_path } = await injectDocsFromFixture(page, fixture);
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        return { id, path: doc_path };
    }

    /**
     * Scrolls the page's own scroller to its bottom, repeatedly rather than once: a row starts at a
     * flat estimate and is replaced by its real measured height asynchronously, so the first
     * `scrollHeight` read undershoots. Re-reading and re-setting converges once every row has measured.
     */
    async function scrollPageToBottom(page: Page): Promise<void> {
        let previous_scroll_top = -1;
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const current_scroll_top = await page.evaluate(() => {
                const board = document.querySelector<HTMLElement>('[data-flip-root]');
                if (!board) { throw new Error('no board'); }
                let node: HTMLElement | null = board.parentElement;
                while (node) {
                    const style = getComputedStyle(node);
                    const scrollable = node.scrollHeight > node.clientHeight;
                    if (/(auto|scroll)/.test(style.overflowY) && scrollable) {
                        node.scrollTop = node.scrollHeight;
                        return node.scrollTop;
                    }
                    node = node.parentElement;
                }
                // no ancestor sets overflow-y explicitly, so fall back to the document's own scrolling element
                const page_scroller = (document.scrollingElement as HTMLElement | null) ?? document.body;
                page_scroller.scrollTop = page_scroller.scrollHeight;
                return page_scroller.scrollTop;
            });
            if (current_scroll_top === previous_scroll_top) { return; }
            previous_scroll_top = current_scroll_top;
            await page.waitForTimeout(100);
        }
    }

    test('every lane stays mounted while the board scrolls horizontally', async ({ page }) => {
        await setupKanbanView(page, 'kanban-many-columns.md');
        const lanes = page.locator('[data-flip-column-id]');
        const lane_count_before = await lanes.count();
        expect(lane_count_before).toBe(14);

        await page.evaluate(() => {
            const board = document.querySelector<HTMLElement>('[data-flip-root]');
            if (!board) { throw new Error('no board'); }
            board.scrollLeft = board.scrollWidth;
        });
        await page.waitForTimeout(100);

        // a horizontal scroll mounts no new lanes and drops none - every lane was already in the DOM
        expect(await lanes.count()).toBe(lane_count_before);
        await expect(page.getByRole('heading', { name: 'Task 14' })).toBeVisible();
    });

    test('a long lane windows its cards: far fewer are mounted than the corpus it holds', async ({ page }) => {
        await setupKanbanView(page, 'kanban-long-lane.md');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog.getByRole('heading', { name: 'Backlog Task 01' })).toBeVisible();

        const mounted = await backlog.locator('[data-column-card-id]').count();
        expect(mounted).toBeGreaterThan(0);
        // 40 backlog cards exist; a viewport-sized window plus overscan is nowhere near all of them
        expect(mounted).toBeLessThan(30);
    });

    test('scrolling the page streams a previously-unmounted card in', async ({ page }) => {
        await setupKanbanView(page, 'kanban-long-lane.md');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog.getByRole('heading', { name: 'Backlog Task 40' })).not.toBeAttached();

        await scrollPageToBottom(page);
        await expect(backlog.getByRole('heading', { name: 'Backlog Task 40' })).toBeVisible({ timeout: 3000 });
    });

    test('no lane grows its own vertical scrollbar - the page is the only vertical scroller', async ({ page }) => {
        await setupKanbanView(page, 'kanban-long-lane.md');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog.getByRole('heading', { name: 'Backlog Task 01' })).toBeVisible();

        const result = await page.evaluate(() => {
            const board = document.querySelector<HTMLElement>('[data-flip-root]');
            if (!board) { throw new Error('no board'); }
            // no element inside the board may be its own vertical scrollport
            const lane_scrollers = Array.from(board.querySelectorAll<HTMLElement>('*')).filter((el) => {
                const style = getComputedStyle(el);
                return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
            }).map((el) => el.className || el.tagName);
            // the page's own scroller: an explicit overflowing ancestor if one exists, else the document's scrolling element
            let page_scroller: HTMLElement | null = board.parentElement;
            let found_explicit_scroller = false;
            while (page_scroller) {
                const style = getComputedStyle(page_scroller);
                if (/(auto|scroll)/.test(style.overflowY) && page_scroller.scrollHeight > page_scroller.clientHeight) { found_explicit_scroller = true; break; }
                page_scroller = page_scroller.parentElement;
            }
            const scrolling_element = (document.scrollingElement as HTMLElement | null) ?? document.body;
            const page_scroll_height = found_explicit_scroller ? (page_scroller as HTMLElement).scrollHeight : scrolling_element.scrollHeight;
            const page_client_height = found_explicit_scroller ? (page_scroller as HTMLElement).clientHeight : scrolling_element.clientHeight;
            return { lane_scrollers, page_actually_overflows: page_scroll_height > page_client_height };
        });
        expect(result.lane_scrollers, `element(s) inside the board are their own vertical scrollport: ${result.lane_scrollers.join(', ')}`).toEqual([]);
        expect(result.page_actually_overflows, 'the page itself must still be tall enough to scroll - the 40-card lane\'s content has to end up somewhere').toBe(true);
    });

    test('pointer-dragging a card that starts off-screen (scrolled into view) to another column completes the drop', async ({ page }) => {
        await setupKanbanView(page, 'kanban-long-lane.md');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        const done_column = page.locator('[role="region"][aria-label="done"]');

        // the card "Backlog Task 40" starts outside the lane's initially mounted window
        await expect(backlog.getByRole('heading', { name: 'Backlog Task 40' })).not.toBeAttached();
        await scrollPageToBottom(page);
        await expect(backlog.getByRole('heading', { name: 'Backlog Task 40' })).toBeVisible({ timeout: 3000 });

        const handle = backlog.locator('[data-rfd-drag-handle-draggable-id]').filter({ hasText: 'Backlog Task 40' });
        // let the row's real measured height settle: a box captured mid-settle is stale by the time the gesture reaches it
        await stabilizeBoundingBox(handle);
        await clearCapturedMessages(page);
        await pointerDrag(page, handle, done_column);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m) => m.type === 'editText');
        expect(edit_msg, 'pointer drag of an off-screen-origin card did not produce an editText').toBeDefined();

        await expect(done_column.getByRole('heading', { name: 'Backlog Task 40' })).toBeVisible({ timeout: 3000 });
        expect(await backlog.getByRole('heading', { name: 'Backlog Task 40' }).count()).toBe(0);
    });

    /*
     * Keyboard drag with @hello-pangea/dnd: Space lifts, an arrow key moves to the next droppable,
     * Space drops. Column order renders as [doing, done, backlog], so backlog is rightmost and
     * ArrowLeft is the direction with a droppable to move into. `backlog` genuinely virtualizes (40
     * cards), unlike the short fixtures the other kanban drag specs use.
     */
    test('keyboard-dragging a card OUT of a genuinely virtualized lane completes the drop', async ({ page }) => {
        await setupKanbanView(page, 'kanban-long-lane.md');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        const handle = backlog.locator('[data-rfd-drag-handle-draggable-id]').filter({ hasText: 'Backlog Task 01' });
        await expect(handle).toBeVisible({ timeout: 3000 });

        await clearCapturedMessages(page);
        await handle.focus();
        await page.waitForTimeout(200);
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(300);
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m) => m.type === 'editText') as { changes?: Array<{ insert: string }> } | undefined;
        expect(edit_msg, 'keyboard drag out of a virtualized lane did not produce an editText').toBeDefined();
        // the destination status must be a real column, not backlog's own value written back onto itself
        const inserts = (edit_msg?.changes ?? []).map((c) => c.insert);
        expect(inserts, 'keyboard drag out of a virtualized lane must not write its own source status back onto itself').not.toContain('backlog');
    });

    // the mirror direction: a short plain-path lane as source, moving into the virtualized destination
    test('keyboard-dragging a card INTO a genuinely virtualized lane completes the drop', async ({ page }) => {
        await setupKanbanView(page, 'kanban-long-lane.md');
        const done_column = page.locator('[role="region"][aria-label="done"]');
        const handle = done_column.locator('[data-rfd-drag-handle-draggable-id]').filter({ hasText: 'Done Task' });
        await expect(handle).toBeVisible({ timeout: 3000 });

        await clearCapturedMessages(page);
        await handle.focus();
        await page.waitForTimeout(200);
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m) => m.type === 'editText') as { changes?: Array<{ insert: string }> } | undefined;
        expect(edit_msg, 'keyboard drag into a virtualized lane did not produce an editText').toBeDefined();
        const inserts = (edit_msg?.changes ?? []).map((c) => c.insert);
        expect(inserts, 'keyboard drag into a virtualized lane must not write its own source status back onto itself').not.toContain('done');
        expect(inserts).toContain('backlog');
    });

    /*
     * The pointer-sensor mirror of the keyboard INTO test, same pair dragged by mouse: @hello-pangea/dnd's
     * pointer sensor resolves the drop from live hit-testing, a genuinely different code path than the
     * keyboard sensor's candidate search.
     */
    test('pointer-dragging a card into a genuinely virtualized lane completes the drop', async ({ page }) => {
        await setupKanbanView(page, 'kanban-long-lane.md');
        const done_column = page.locator('[role="region"][aria-label="done"]');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        const handle = done_column.locator('[data-rfd-drag-handle-draggable-id]').filter({ hasText: 'Done Task' });
        await expect(handle).toBeVisible({ timeout: 3000 });

        await clearCapturedMessages(page);
        await pointerDrag(page, handle, backlog);

        const messages = await getCapturedMessages(page);
        const edit_msg = messages.find((m) => m.type === 'editText') as { changes?: Array<{ insert: string }> } | undefined;
        expect(edit_msg, 'pointer drag into a virtualized lane did not produce an editText').toBeDefined();
        const inserts = (edit_msg?.changes ?? []).map((c) => c.insert);
        expect(inserts, 'pointer drag into a virtualized lane must not write its own source status back onto itself').not.toContain('done');
        expect(inserts).toContain('backlog');
    });

    /*
     * CODING_STANDARDS.md > Focused-note scroll framing: a virtualized lane's note can start genuinely
     * unmounted, not merely scrolled out of view, so framing it needs the scrollVirtualLaneToNoteId
     * registry hop to mount it before the usual box-measuring framing logic can run.
     */
    test('keyboard-focusing a note outside a virtualized lane\'s window mounts it and frames its ring fully visible', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page, 'kanban-long-lane.md');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog.getByRole('heading', { name: 'Backlog Task 40' })).not.toBeAttached();

        await simulateSelectionChanged(page, doc_path, fixtureOffsetOf('kanban-long-lane.md', 'Backlog Task 40'));

        const card = backlog.locator('[role="row"]').filter({ hasText: 'Backlog Task 40' });
        await expect(card).toBeVisible({ timeout: 3000 });
        await expect(card).toHaveAttribute('aria-current', 'true', { timeout: 3000 });

        // the ring must sit inside every clipping ancestor between the card and the page scroller, on every edge
        await expect(async () => {
            const result = await page.evaluate((margin) => {
                const region = document.querySelector<HTMLElement>('[role="region"][aria-label="backlog"]');
                const heading = Array.from(region!.querySelectorAll<HTMLElement>('[role="row"]')).find((el) => (el.textContent || '').includes('Backlog Task 40'));
                if (!heading) { return null; }
                const card_rect = heading.getBoundingClientRect();
                const failures: Array<string> = [];
                let node: HTMLElement | null = heading.parentElement;
                while (node) {
                    const style = getComputedStyle(node);
                    const rect = node.getBoundingClientRect();
                    const label = node.className || node.tagName;
                    if (/(hidden|auto|scroll|clip)/.test(style.overflowY)) {
                        if (card_rect.top - margin < rect.top - 0.5) { failures.push(`${label} clips the ring's top edge`); }
                        if (card_rect.bottom + margin > rect.bottom + 0.5) { failures.push(`${label} clips the ring's bottom edge`); }
                    }
                    if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) {
                        if (card_rect.left - margin < rect.left - 0.5) { failures.push(`${label} clips the ring's left edge`); }
                        if (card_rect.right + margin > rect.right + 0.5) { failures.push(`${label} clips the ring's right edge`); }
                    }
                    node = node.parentElement;
                }
                return { failures };
            }, FOCUS_RING_MARGIN_PX);
            expect(result, 'focused card not found').not.toBeNull();
            expect(result!.failures).toEqual([]);
        }).toPass({ timeout: 3000, intervals: [100] });
    });

    // regression guard: a windowed lane's deeper row wrapper broke the card-surface selector; loops over all card types
    for (const card_type of ['card', 'sticky', 'agent']) {
        test(`a windowed lane's "${card_type}" card looks identical to a non-windowed lane's`, async ({ page }) => {
            await setCardType(page, card_type);
            await setupKanbanView(page, 'kanban-long-lane.md');
            const windowed_card = page.locator('[role="region"][aria-label="backlog"]').locator('[role="row"]').first();
            const plain_card = page.locator('[role="region"][aria-label="doing"]').locator('[role="row"]').first();
            await expect(windowed_card).toBeVisible({ timeout: 3000 });
            await expect(plain_card).toBeVisible({ timeout: 3000 });
            const [windowed_surface, plain_surface] = await Promise.all([cardSurface(windowed_card), cardSurface(plain_card)]);
            expect(windowed_surface).toEqual(plain_surface);
        });
    }
});
