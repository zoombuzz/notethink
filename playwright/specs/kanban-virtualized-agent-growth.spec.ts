import { test, expect, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { simulateSelectionChanged } from '../helpers/simulate-selection';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const TODO_RELATIVE_PATH = 'notethink/docstech/users/alex.stanhope/todo.md';
const TODO_DOC_PATH = `${WORKSPACE_ROOT}/${TODO_RELATIVE_PATH}`;

const USAGE = { input_tokens: 4200, output_tokens: 980, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.34, is_estimate: true };

/**
 * A minimal activity snapshot binding one working session to `growing-story`, posted after the board
 * has already rendered: an agent card mounts quiet and only grows once activity lands.
 */
function growingStoryActivity(): Record<string, unknown> {
    const story = { doc_path: TODO_RELATIVE_PATH, id: 'growing-story' };
    return {
        analyser: { state: 'live', refusals: [] },
        sessions: [{
            root_path: `${WORKSPACE_ROOT}/notethink`,
            session: {
                session_id: 'claude-growing', vendor: 'claude-code', project: 'notethink',
                started_at: '2026-09-28T08:51:30Z', updated_at: '2026-09-28T09:14:01Z', state: 'working',
                story_binding: 'bound', stories: [story], story_usage: [{ story, usage: USAGE }],
                capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
                current: { at: '2026-09-28T09:14:01Z', kind: 'tool_call', tool: 'Edit', arg: 'client/extension/src/types/AgentActivity.ts' },
                model: 'claude-sonnet-5',
                usage: USAGE,
            },
        }],
        trees: [],
    };
}

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function pinAgentCard(page: Page): Promise<void> {
    await page.evaluate(() => {
        const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings: () => void };
        harness.__nt_settings.workspace.cardType = 'agent';
        harness.__nt_publishSettings();
    });
}

async function openViewSettings(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') { await tab.click(); }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

/** The long virtualized "doing" lane, agent card pinned, kanban view selected, before any activity arrives. */
async function setupGrowingLaneBoard(page: Page): Promise<void> {
    await pinAgentCard(page);
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'kanban-agent-long-lane.md', doc_path: TODO_DOC_PATH, relative_path: TODO_RELATIVE_PATH },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await openViewSettings(page);
    await page.getByTestId('view-radio-kanban').click();
    await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="region"][aria-label="doing"]')).toBeVisible({ timeout: 5000 });
}

test.describe('Kanban virtualized lane: a card growing after mount', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    /*
     * The bug: a card in a windowed lane grows after its row has been sized and positioned, and the
     * rows below it keep their stale offsets, drawing the next card's text over its content.
     */
    test('a card that grows after its row is measured pushes the following row down, with no overlap', async ({ page }) => {
        await setupGrowingLaneBoard(page);
        const lane = page.locator('[role="region"][aria-label="doing"]');
        const growing_card = lane.locator('[role="row"]').filter({ hasText: 'Growing Story' });
        const next_card = lane.locator('[role="row"]').filter({ hasText: 'Task After Growing' });
        await expect(growing_card).toBeVisible({ timeout: 5000 });
        await expect(next_card).toBeVisible({ timeout: 5000 });
        await expect(growing_card).toHaveAttribute('data-session-count', '0');

        const before_next_box = await next_card.boundingBox();
        expect(before_next_box).not.toBeNull();

        await page.evaluate((activity) => {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity } }));
        }, growingStoryActivity());

        // the session row (and the rest of the agent bands) actually landed on the card, growing it
        await expect(growing_card).toHaveAttribute('data-session-count', '1', { timeout: 5000 });
        await expect(growing_card.getByTestId('agent-row')).toHaveCount(1);

        // the row below must have been pushed down to make room, never left at its stale pre-growth offset
        await expect(async () => {
            const grown_box = await growing_card.boundingBox();
            const after_next_box = await next_card.boundingBox();
            expect(grown_box).not.toBeNull();
            expect(after_next_box).not.toBeNull();
            // no overlap: the grown card's own bottom edge sits at or above the next card's top edge
            expect(grown_box!.y + grown_box!.height).toBeLessThanOrEqual(after_next_box!.y + 0.5);
            // the next card actually moved down, rather than the grown card overflowing its old slot
            expect(after_next_box!.y).toBeGreaterThan(before_next_box!.y + 0.5);
        }).toPass({ timeout: 3000, intervals: [100] });
    });
});

const MANY_GROWING_IDS = ['grow-03', 'grow-06', 'grow-09', 'grow-12', 'grow-15', 'grow-18'];

/** Several sessions bound to several notes, posted in one snapshot: many mounted cards growing in the same commit. */
function manyGrowingActivity(): Record<string, unknown> {
    const sessions = MANY_GROWING_IDS.map((slug, i) => {
        const story = { doc_path: TODO_RELATIVE_PATH, id: slug };
        return {
            root_path: `${WORKSPACE_ROOT}/notethink`,
            session: {
                session_id: `claude-${slug}`, vendor: 'claude-code', project: 'notethink',
                started_at: '2026-09-28T08:51:30Z', updated_at: '2026-09-28T09:14:01Z', state: i % 2 === 0 ? 'working' : 'idle',
                story_binding: 'bound', stories: [story], story_usage: [{ story, usage: USAGE }],
                capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
                current: i % 2 === 0 ? { at: '2026-09-28T09:14:01Z', kind: 'tool_call', tool: 'Edit', arg: `client/some/very/long/nested/path/for/task-${slug}.ts` } : undefined,
                model: 'claude-sonnet-5',
                usage: USAGE,
            },
        };
    });
    return { analyser: { state: 'live', refusals: [] }, sessions, trees: [] };
}

test.describe('Kanban virtualized lane: many cards growing in one commit', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    test('several cards growing at once from one activity snapshot never overlap the rows below them', async ({ page }) => {
        await pinAgentCard(page);
        await injectMultipleDocsFromFixtures(page, [
            { fixture: 'kanban-agent-many-growing.md', doc_path: TODO_DOC_PATH, relative_path: TODO_RELATIVE_PATH },
        ], { workspace_root: WORKSPACE_ROOT });
        await selectFolderMode(page);
        await page.waitForSelector('[data-folder-mode="true"]');
        await openViewSettings(page);
        await page.getByTestId('view-radio-kanban').click();
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        const lane = page.locator('[role="region"][aria-label="doing"]');
        await expect(lane).toBeVisible({ timeout: 5000 });
        await expect(lane.locator('[role="row"]').first()).toBeVisible({ timeout: 5000 });

        await page.evaluate((activity) => {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'activity', activity } }));
        }, manyGrowingActivity());
        await expect(lane.locator('[data-testid="agent-row"]').first()).toBeVisible({ timeout: 5000 });
        // let every growing card's resize observer settle
        await page.waitForTimeout(300);

        await expect(async () => {
            const boxes = await lane.locator('[role="row"]').evaluateAll((rows) =>
                rows.map((row) => {
                    const rect = row.getBoundingClientRect();
                    return { text: (row.textContent || '').slice(0, 40), top: rect.top, bottom: rect.bottom };
                }),
            );
            for (let i = 1; i < boxes.length; i += 1) {
                const previous = boxes[i - 1];
                const current = boxes[i];
                expect(current.top, `row "${current.text}" overlaps the row above it ("${previous.text}")`).toBeGreaterThanOrEqual(previous.bottom - 0.5);
            }
        }).toPass({ timeout: 3000, intervals: [100] });
    });
});

/*
 * A different trigger for the same bug: no card's content changes, but the notes array shifts, moving
 * a card already measured and cached by stable_id to a different index. Row heights are looked up by
 * stable_id, never by index, so the moved card must keep reserving its own real measured height.
 */
test.describe('Kanban virtualized lane: a note reordered onto an already-cached index', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    async function setupBoard(page: Page, fixture: string): Promise<{ path: string }> {
        const { path: doc_path } = await injectDocsFromFixture(page, fixture);
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
        await simulateSelectionChanged(page, doc_path, 2);
        await page.waitForSelector('[data-auto-selected-viewtype="kanban"]', { timeout: 5000 });
        await page.waitForSelector('[role="columnheader"]', { timeout: 5000 });
        return { path: doc_path };
    }

    /*
     * v1 orders [Short A, Tall C, Task 03, ...]; v2 swaps the first two. One reorder exercises both
     * symptoms: an overlap (the tall card lands on the short card's smaller index) and a stale gap
     * (the short card lands on the tall card's larger index).
     */
    test('a swap that moves a tall card onto a short cached slot and a short card onto a tall one produces neither an overlap nor a stale gap', async ({ page }) => {
        const { path: doc_path } = await setupBoard(page, 'kanban-reorder-lane-v1.md');
        const backlog = page.locator('[role="region"][aria-label="backlog"]');
        const short_card = backlog.locator('[role="row"]').filter({ hasText: 'Short A' });
        const tall_card = backlog.locator('[role="row"]').filter({ hasText: 'Tall C' });
        const next_card = backlog.locator('[role="row"]').filter({ hasText: 'Task 03' });
        await expect(short_card).toBeVisible({ timeout: 5000 });
        await expect(tall_card).toBeVisible({ timeout: 5000 });
        await expect(next_card).toBeVisible({ timeout: 5000 });

        // let both rows settle at their own real measured heights before the swap
        async function stableHeight(locator: typeof tall_card): Promise<number> {
            let previous: number | undefined;
            await expect(async () => {
                const box = await locator.boundingBox();
                const settled = box !== undefined && box.height === previous;
                previous = box?.height;
                expect(settled).toBe(true);
            }).toPass({ timeout: 3000, intervals: [100] });
            return previous!;
        }
        const short_height_before = await stableHeight(short_card);
        const tall_height_before = await stableHeight(tall_card);
        expect(tall_height_before).toBeGreaterThan(300);
        expect(short_height_before).toBeLessThan(150);

        // re-parse the same doc with Short A and Tall C swapped
        await injectDocsFromFixture(page, 'kanban-reorder-lane-v2.md', doc_path);
        await expect(tall_card).toBeVisible({ timeout: 5000 });
        await expect(short_card).toBeVisible({ timeout: 5000 });

        await expect(async () => {
            const tall_box = await tall_card.boundingBox();
            const short_box = await short_card.boundingBox();
            const next_box = await next_card.boundingBox();
            expect(tall_box).not.toBeNull();
            expect(short_box).not.toBeNull();
            expect(next_box).not.toBeNull();
            // both cards render their own real height, never a stale one carried over from a different card at that index
            expect(tall_box!.height).toBeGreaterThanOrEqual(tall_height_before - 1);
            expect(short_box!.height).toBeLessThanOrEqual(short_height_before + 1);
            // no overlap: Tall C (now first) does not overrun Short A (now second)
            expect(tall_box!.y + tall_box!.height).toBeLessThanOrEqual(short_box!.y + 0.5);
            // no stale gap: Short A (now second, short) does not leave Tall C's old reserved space empty before Task 03
            expect(next_box!.y - (short_box!.y + short_box!.height)).toBeLessThan(30);
        }).toPass({ timeout: 3000, intervals: [100] });
    });
});
