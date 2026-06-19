import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

/**
 * one scheduled animation as the FLIP hook planned it (mirrors AnimationProbeEvent from
 * the production probe). the hook pushes every scheduled animation onto the global mirror
 * array when __NOTETHINK_ANIM_PROBE__ is set; we read it via page.evaluate.
 */
interface AnimationProbeEvent {
    kind: 'move' | 'enter' | 'exit' | 'column-enter' | 'column-exit' | 'cap' | 'skip';
    id?: string;
    dx?: number;
    dy?: number;
    duration?: number;
    reason?: string;
}

declare global {
    interface Window {
        __NOTETHINK_ANIM_PROBE__?: boolean;
        __notethinkAnimationEvents?: AnimationProbeEvent[];
    }
}

// snapshot the probe mirror array (returns [] when nothing scheduled yet)
async function getAnimationEvents(page: Page): Promise<AnimationProbeEvent[]> {
    return page.evaluate(() => window.__notethinkAnimationEvents ?? []);
}

// drop every buffered probe event so the next passive update starts from a clean slate
async function clearAnimationEvents(page: Page): Promise<void> {
    await page.evaluate(() => { window.__notethinkAnimationEvents = []; });
}

test.describe('Kanban Passive Transition Animations', () => {

    test.beforeEach(async ({ page }) => {
        // arm the probe BEFORE the bundle runs so the FLIP hook mirrors its schedule from the first render
        await page.addInitScript(() => { window.__NOTETHINK_ANIM_PROBE__ = true; });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    /**
     * inject a kanban fixture and simulate a cursor inside the board heading so AutoView
     * picks up nt_view=kanban and renders the board. The FIRST render is the FLIP baseline,
     * so callers CLEAR the probe after this returns before triggering the passive update.
     */
    async function setupKanbanView(page: Page, fixture = 'kanban.md'): Promise<{ id: string; path: string }> {
        const { id, path: doc_path } = await injectDocsFromFixture(page, fixture);
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForTimeout(500);
        return { id, path: doc_path };
    }

    /**
     * keyboard-based drag with @hello-pangea/dnd (replicated from kanban-drag.spec.ts —
     * the helper there is local, not exported). focus the draggable, Space to lift, arrows
     * to move between droppables, Space to drop.
     */
    async function keyboardDrag(page: Page, draggable_locator: Locator, direction: 'right' | 'left', moves: number): Promise<void> {
        await draggable_locator.focus();
        await page.waitForTimeout(100);

        await page.keyboard.press('Space');
        await page.waitForTimeout(200);

        const key = direction === 'right' ? 'ArrowRight' : 'ArrowLeft';
        for (let i = 0; i < moves; i++) {
            await page.keyboard.press(key);
            await page.waitForTimeout(150);
        }

        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
    }

    test('cross-column passive move animates and lands correctly', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // baseline placement: Task A in backlog
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        // clear the probe so we only observe the upcoming passive update
        await clearAnimationEvents(page);

        // passive update: re-inject the same doc with Task A moved to doing
        await injectDocsFromFixture(page, 'kanban-moved.md', doc_path);
        await page.waitForTimeout(500);

        // the FLIP layer scheduled at least one card move
        const events = await getAnimationEvents(page);
        const move_events = events.filter(e => e.kind === 'move');
        expect(move_events.length).toBeGreaterThanOrEqual(1);

        // final DOM: Task A now in doing, no longer in backlog
        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 5000 });
        const task_a_in_backlog = await backlog_column.getByRole('heading', { name: 'Task A' }).count();
        expect(task_a_in_backlog).toBe(0);
    });

    test('in-column passive reorder animates and swaps card order', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page, 'kanban-reorder.md');

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        const task_a = doing_column.getByRole('heading', { name: 'Task A' });
        const task_b = doing_column.getByRole('heading', { name: 'Task B' });
        await expect(task_a).toBeVisible({ timeout: 3000 });
        await expect(task_b).toBeVisible({ timeout: 3000 });

        // initial vertical order: Task A above Task B (weights 1, 2)
        const a_box_before = await task_a.boundingBox();
        const b_box_before = await task_b.boundingBox();
        expect(a_box_before).not.toBeNull();
        expect(b_box_before).not.toBeNull();
        expect(a_box_before!.y).toBeLessThan(b_box_before!.y);

        await clearAnimationEvents(page);

        // passive update: same two cards, weights flipped so B sorts above A
        await injectDocsFromFixture(page, 'kanban-reorder-swapped.md', doc_path);
        await page.waitForTimeout(500);

        // a reorder schedules at least one card move
        const events = await getAnimationEvents(page);
        const move_events = events.filter(e => e.kind === 'move');
        expect(move_events.length).toBeGreaterThanOrEqual(1);

        // nice-to-have (tolerant): a reorder is a vertical slide, so some move carries a non-zero dy
        const has_vertical_move = move_events.some(e => typeof e.dy === 'number' && Math.abs(e.dy) > 0);
        expect(has_vertical_move).toBe(true);

        // final vertical order is swapped: Task B now above Task A
        const a_box_after = await task_a.boundingBox();
        const b_box_after = await task_b.boundingBox();
        expect(a_box_after).not.toBeNull();
        expect(b_box_after).not.toBeNull();
        expect(b_box_after!.y).toBeLessThan(a_box_after!.y);
    });

    test('new column appears before its inbound card animates', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        // 'blocked' is neither in kanban.md nor in the cascade default order, so it has no column yet
        const blocked_before = await page.locator('[role="region"][aria-label="blocked"]').count();
        expect(blocked_before).toBe(0);

        await clearAnimationEvents(page);

        // passive update: Task A now status=blocked, forcing a brand-new column to appear
        await injectDocsFromFixture(page, 'kanban-newcolumn.md', doc_path);
        await page.waitForTimeout(500);

        const events = await getAnimationEvents(page);

        // a column-enter for 'blocked' was scheduled
        const column_enter = events.find(e => e.kind === 'column-enter' && e.id === 'blocked');
        expect(column_enter).toBeDefined();

        // the new column appears with Task A inside it
        const blocked_column = page.locator('[role="region"][aria-label="blocked"]');
        await expect(blocked_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 5000 });

        // CHOREOGRAPHY: the column-enter must be scheduled before the inbound card's move so the column lands first
        const column_enter_index = events.findIndex(e => e.kind === 'column-enter' && e.id === 'blocked');
        const move_index = events.findIndex(e => e.kind === 'move');
        expect(column_enter_index).toBeGreaterThanOrEqual(0);
        expect(move_index).toBeGreaterThanOrEqual(0);
        expect(column_enter_index).toBeLessThan(move_index);
    });

    test('user drag is not double-animated by the FLIP layer', async ({ page }) => {
        await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing_column.getByRole('heading', { name: 'Task B' })).toBeVisible({ timeout: 3000 });
        const task_b_draggable = doing_column.locator('[data-rfd-drag-handle-draggable-id]').first();

        await clearAnimationEvents(page);

        // keyboard drag: Task B from doing one column to the right (its own drop is owned by dnd, not FLIP)
        await keyboardDrag(page, task_b_draggable, 'right', 1);
        await page.waitForTimeout(400);

        // the gate suppressed FLIP — no move/enter were scheduled for the projection-commit re-render
        const events = await getAnimationEvents(page);
        expect(events.filter(e => e.kind === 'move')).toHaveLength(0);
        expect(events.filter(e => e.kind === 'enter')).toHaveLength(0);

        // board is still rendered and Task B has left doing (the drag actually completed)
        const column_headers = page.locator('[role="columnheader"]');
        expect(await column_headers.count()).toBeGreaterThanOrEqual(3);
        const task_b_still_in_doing = await doing_column.getByRole('heading', { name: 'Task B' }).count();
        expect(task_b_still_in_doing).toBe(0);
    });

    test('rapid burst of passive updates settles clean and correct', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        await clearAnimationEvents(page);

        // fire ~5 passive updates in quick succession, alternating fixtures so Task A flips backlog<->doing; end on kanban-moved.md (Task A in doing)
        const burst = ['kanban-moved.md', 'kanban.md', 'kanban-moved.md', 'kanban.md', 'kanban-moved.md'];
        for (const fixture of burst) {
            await injectDocsFromFixture(page, fixture, doc_path);
        }

        // settle past the 800ms global cap
        await page.waitForTimeout(1100);

        // final DOM matches the last-injected fixture: Task A in doing, not in backlog
        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 5000 });
        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        const task_a_in_backlog = await backlog_column.getByRole('heading', { name: 'Task A' }).count();
        expect(task_a_in_backlog).toBe(0);

        // no stuck animations: every card cleared its inline transform and no WAAPI animation is still playing (a `finished` animation with fill:'both' legitimately lingers in getAnimations — that is the settled state, not a stuck one)
        const clean = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-flip-id]'));
            return cards.every((el) => {
                if (el.style.transform !== '') { return false; }
                if (typeof el.getAnimations === 'function') {
                    const still_playing = el.getAnimations().some((a) => a.playState === 'running' || a.playState === 'paused');
                    if (still_playing) { return false; }
                }
                return true;
            });
        });
        expect(clean).toBe(true);
    });

    test('prefers-reduced-motion skips animation but lands correctly', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });

        const { path: doc_path } = await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        await clearAnimationEvents(page);

        // passive update under reduced-motion
        await injectDocsFromFixture(page, 'kanban-moved.md', doc_path);
        await page.waitForTimeout(500);

        const events = await getAnimationEvents(page);

        // no card animation scheduled; a reduced-motion skip fired instead
        expect(events.filter(e => e.kind === 'move')).toHaveLength(0);
        expect(events.filter(e => e.kind === 'enter')).toHaveLength(0);
        expect(events.some(e => e.kind === 'skip' && e.reason === 'reduced-motion')).toBe(true);

        // final DOM is instantly correct: Task A in doing
        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 5000 });
        const task_a_in_backlog = await backlog_column.getByRole('heading', { name: 'Task A' }).count();
        expect(task_a_in_backlog).toBe(0);
    });

    test('kanbanAnimateTransitions=false disables the FLIP layer', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        // turn the global setting off via a globalSettings message
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'globalSettings',
                settings: { showLineNumbers: false, watchUnopenedFilesInViewer: true, kanbanAnimateTransitions: false },
            },
        })));
        await page.waitForTimeout(500);

        await clearAnimationEvents(page);

        // passive update with the layer disabled
        await injectDocsFromFixture(page, 'kanban-moved.md', doc_path);
        await page.waitForTimeout(500);

        const events = await getAnimationEvents(page);

        // no card animation scheduled; a disabled skip fired instead
        expect(events.filter(e => e.kind === 'move')).toHaveLength(0);
        expect(events.filter(e => e.kind === 'enter')).toHaveLength(0);
        expect(events.some(e => e.kind === 'skip' && e.reason === 'disabled')).toBe(true);

        // final DOM is still correct: Task A in doing
        const doing_column = page.locator('[role="region"][aria-label="doing"]');
        await expect(doing_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 5000 });
        const task_a_in_backlog = await backlog_column.getByRole('heading', { name: 'Task A' }).count();
        expect(task_a_in_backlog).toBe(0);
    });
});
