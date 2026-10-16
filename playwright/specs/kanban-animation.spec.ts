import { test, expect, type Page, type Locator } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';
import { pointerDrag } from '../helpers/pointer-drag';

/**
 * One scheduled animation as the FLIP hook planned it. The hook pushes every scheduled animation
 * onto the global mirror array when __NOTETHINK_ANIM_PROBE__ is set, read via page.evaluate.
 */
interface AnimationProbeEvent {
    kind: 'move' | 'enter' | 'exit' | 'column-move' | 'column-enter' | 'column-exit' | 'cap' | 'skip';
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

/** the group values the board is currently drawing, in board order */
async function groupValues(page: Page): Promise<string[]> {
    return page.locator('[data-flip-column-id]').evaluateAll(els => els.map(el => el.getAttribute('data-flip-column-id') ?? ''));
}

/** a card's FLIP registry id (its `data-flip-id`), found via the ancestor carrying its heading text */
async function cardFlipId(page: Page, headline: string): Promise<string | null> {
    const card = page.getByRole('heading', { name: headline }).locator('xpath=ancestor::*[@data-flip-id]').first();
    return card.getAttribute('data-flip-id');
}

/** put a value in one view node's own `views` bag entry at the workspace scope and re-publish the cascade, the way the drawer's own settings do */
async function seedWorkspaceViewSetting(page: Page, node_id: string, key: string, value: unknown): Promise<void> {
    await page.evaluate(([node, setting_key, setting_value]) => {
        const harness = window as unknown as { __nt_settings: { workspace: { views: Record<string, Record<string, unknown>> } }; __nt_publishSettings?: () => void };
        const views = harness.__nt_settings.workspace.views;
        views[node as string] = { ...views[node as string], [setting_key as string]: setting_value };
        harness.__nt_publishSettings?.();
    }, [node_id, key, value] as [string, string, unknown]);
}

test.describe('Kanban Passive Transition Animations', () => {

    test.beforeEach(async ({ page }) => {
        // arm the probe BEFORE the bundle runs so the FLIP hook mirrors its schedule from the first render
        await page.addInitScript(() => { window.__NOTETHINK_ANIM_PROBE__ = true; });
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
    });

    /**
     * Injects a kanban fixture and simulates a cursor inside the board heading so AutoView
     * renders it. The first render is the FLIP baseline, so callers clear the probe after this
     * returns before triggering the passive update.
     */
    async function setupKanbanView(page: Page, fixture = 'kanban.md'): Promise<{ id: string; path: string }> {
        const { id, path: doc_path } = await injectDocsFromFixture(page, fixture);
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForTimeout(500);
        return { id, path: doc_path };
    }

    /**
     * Drags via @hello-pangea/dnd's keyboard interface: focus the draggable, Space to lift,
     * arrow keys to move between droppables, Space to drop.
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

        // the gate suppressed FLIP - no move/enter were scheduled for the projection-commit re-render
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

        // fires 5 passive updates in quick succession, alternating fixtures so Task A flips backlog<->doing
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

        // a finished animation with fill:'both' legitimately lingers in getAnimations; only a still-playing one is stuck
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

    test('animateTransitions=false disables the FLIP layer', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page);

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const backlog_column = page.locator('[role="region"][aria-label="backlog"]');
        await expect(backlog_column.getByRole('heading', { name: 'Task A' })).toBeVisible({ timeout: 3000 });

        // goes through the harness store, not a hand-built payload, which would replace the cascade and drop other keys
        await seedWorkspaceViewSetting(page, 'kanban', 'animateTransitions', false);
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

    /*
     * groupOrder substitutes for 'newestFirst'/'newestLast' here: those read a card's agent-activity or
     * file-mtime timestamp, which a spec cannot pin precisely, while cardCount recomputes the same group
     * order from the injected fixture's own content - the identical code path (`orderGroupValues` -> the
     * board's group order -> this FLIP layer), fully deterministic.
     */
    test('a passive cardCount group reorder animates the groups and rides the cards that did not themselves move', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page, 'kanban-groupcount-a.md');

        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        await seedWorkspaceViewSetting(page, 'grouped', 'groupOrder', 'cardCount');
        await page.waitForTimeout(500);

        // baseline: done (3 cards) leads; backlog and doing (1 card each) tie behind it, alphabetically
        await expect.poll(() => groupValues(page)).toEqual(['done', 'backlog', 'doing']);

        const task_b_id = await cardFlipId(page, 'Task B');
        const task_c_id = await cardFlipId(page, 'Task C');
        expect(task_b_id).not.toBeNull();
        expect(task_c_id).not.toBeNull();

        await clearAnimationEvents(page);

        // passive update: Task D and Task E move from done into doing, so doing now leads and done drops to the tail
        await injectDocsFromFixture(page, 'kanban-groupcount-b.md', doc_path);
        await page.waitForTimeout(500);

        await expect.poll(() => groupValues(page)).toEqual(['doing', 'backlog', 'done']);

        const events = await getAnimationEvents(page);
        const column_moves = events.filter(e => e.kind === 'column-move');
        expect(column_moves.some(e => e.id === 'doing')).toBe(true);
        expect(column_moves.some(e => e.id === 'done')).toBe(true);
        // backlog sits in the middle both times - no group move for it
        expect(column_moves.some(e => e.id === 'backlog')).toBe(false);

        // Task B and Task C each stayed exactly where they were in their own group - no card-level move for either
        const move_ids = events.filter(e => e.kind === 'move').map(e => e.id);
        expect(move_ids).not.toContain(task_b_id);
        expect(move_ids).not.toContain(task_c_id);

        // Task D and Task E crossed from 'done' into 'doing' - a cross-group move still animates
        const task_d_id = await cardFlipId(page, 'Task D');
        const task_e_id = await cardFlipId(page, 'Task E');
        expect(move_ids).toContain(task_d_id);
        expect(move_ids).toContain(task_e_id);
    });

    test('dragging a group chip (custom order) in the settings drawer animates the board behind it', async ({ page }) => {
        await setupKanbanView(page);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        const before = await groupValues(page);
        expect(before.length).toBeGreaterThanOrEqual(2);

        const settings_tab = page.getByTestId('view-settings-button');
        if (await settings_tab.getAttribute('aria-expanded') !== 'true') { await settings_tab.click(); }
        await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
        await page.getByTestId('view-node-kanban').click();
        await expect(page.getByTestId('setting-row-groupDisplay')).toBeVisible();

        await clearAnimationEvents(page);

        // drags the second chip onto the first, the same gesture view-settings-drawer.spec.ts drives
        const chips = page.getByTestId(/^group-display-chip-/);
        await chips.first().scrollIntoViewIfNeeded();
        const second = chips.nth(1);
        const inset = ((await second.boundingBox())?.height ?? 2) / 2;
        await pointerDrag(page, second, chips.nth(0), { destination_inset_y: inset });

        await expect.poll(() => groupValues(page)).not.toEqual(before);

        const events = await getAnimationEvents(page);
        expect(events.filter(e => e.kind === 'column-move').length).toBeGreaterThanOrEqual(1);
    });

    test('animateTransitions=false disables group animation too, and the order still lands correctly', async ({ page }) => {
        const { path: doc_path } = await setupKanbanView(page, 'kanban-groupcount-a.md');
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        await seedWorkspaceViewSetting(page, 'grouped', 'groupOrder', 'cardCount');
        await page.waitForTimeout(500);
        await expect.poll(() => groupValues(page)).toEqual(['done', 'backlog', 'doing']);

        await seedWorkspaceViewSetting(page, 'kanban', 'animateTransitions', false);
        await page.waitForTimeout(500);
        await clearAnimationEvents(page);

        await injectDocsFromFixture(page, 'kanban-groupcount-b.md', doc_path);
        await page.waitForTimeout(500);

        const events = await getAnimationEvents(page);
        expect(events.filter(e => e.kind === 'column-move')).toHaveLength(0);
        expect(events.filter(e => e.kind === 'move')).toHaveLength(0);
        expect(events.some(e => e.kind === 'skip' && e.reason === 'disabled')).toBe(true);

        await expect.poll(() => groupValues(page)).toEqual(['doing', 'backlog', 'done']);
    });

    test('prefers-reduced-motion skips group animation too, and the order still lands correctly', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const { path: doc_path } = await setupKanbanView(page, 'kanban-groupcount-a.md');
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });

        await seedWorkspaceViewSetting(page, 'grouped', 'groupOrder', 'cardCount');
        await page.waitForTimeout(500);
        await expect.poll(() => groupValues(page)).toEqual(['done', 'backlog', 'doing']);

        await clearAnimationEvents(page);
        await injectDocsFromFixture(page, 'kanban-groupcount-b.md', doc_path);
        await page.waitForTimeout(500);

        const events = await getAnimationEvents(page);
        expect(events.filter(e => e.kind === 'column-move')).toHaveLength(0);
        expect(events.filter(e => e.kind === 'move')).toHaveLength(0);
        expect(events.some(e => e.kind === 'skip' && e.reason === 'reduced-motion')).toBe(true);

        await expect.poll(() => groupValues(page)).toEqual(['doing', 'backlog', 'done']);
    });
});
