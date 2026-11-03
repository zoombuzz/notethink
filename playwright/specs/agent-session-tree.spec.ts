import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { injectActivity } from '../helpers/inject-activity';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const NOTETHINK_TODO = 'notethink/docstech/users/alex.stanhope/todo.md';
const NOTEGIT_TODO = 'notegit/docstech/users/alex.stanhope/todo.md';

/*
 * The agent tree inside the story card, driven in the browser against the real bundle and a synthetic
 * snapshot. Jest proves how children are split and drawn; what only a browser shows is the indent
 * under the session's own row, the rail colours, the dimming, and that every cell of a child row
 * holds one line at both the narrow and the wide row layout.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function treeBoard(page: Page, finished_children: number): Promise<Locator> {
    await page.evaluate(() => {
        const win = window as unknown as { __nt_settings: { workspace: { cards: Record<string, Record<string, unknown>> } }; __nt_publishSettings: () => void };
        win.__nt_settings.workspace.cards.allcards = { ...win.__nt_settings.workspace.cards.allcards, cardType: 'agent' };
        win.__nt_publishSettings();
    });
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'activity-todo-notethink.md', doc_path: `${WORKSPACE_ROOT}/${NOTETHINK_TODO}`, relative_path: NOTETHINK_TODO },
        { fixture: 'activity-todo-notegit.md', doc_path: `${WORKSPACE_ROOT}/${NOTEGIT_TODO}`, relative_path: NOTEGIT_TODO },
    ], { workspace_root: WORKSPACE_ROOT });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await injectActivity(page, { sessions: ['claude-coordinator'], finished_children });
    const card = page.locator('[data-card-type="agent"]').filter({ hasText: 'Agent activity card' }).first();
    await expect(card.getByTestId('agent-row')).toHaveCount(1);
    return card;
}

test.describe('Agent tree in the story card', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    test('names the coordinator beside its monogram and model, and draws a running and a finished subagent indented under it', async ({ page }) => {
        const card = await treeBoard(page, 1);
        const main = card.getByTestId('agent-row');
        await expect(main.getByTestId('agent-name')).toHaveText('coord-notethink');
        await expect(main.getByTestId('agent-model')).toHaveAttribute('title', 'claude-opus-5');
        await expect(main.getByTestId('agent-live')).toHaveText('Bash pnpm run test-jest');
        const children = card.getByTestId('agent-child-row');
        await expect(children).toHaveCount(2);
        const finished = children.nth(0);
        const running = children.nth(1);
        await expect(finished).toHaveAttribute('data-state', 'ended');
        await expect(finished.getByTestId('agent-child-title')).toHaveText('Finished task 1');
        await expect(finished.getByTestId('agent-child-model')).toHaveAttribute('title', 'claude-sonnet-5');
        await expect(finished.getByTestId('agent-child-clock')).toHaveText('4m');
        await expect(finished.getByTestId('agent-child-usage')).toContainText('2.7k tokens');
        await expect(finished.getByTestId('agent-child-monogram')).toHaveText('CC');
        await expect(running).toHaveAttribute('data-state', 'working');
        await expect(running.getByTestId('agent-child-title')).toHaveText('Map view code');
        await expect(running.getByTestId('agent-child-title')).toHaveAttribute('title', /Grep agentRail/);
        await expect(running.getByTestId('agent-child-model')).toHaveAttribute('title', 'claude-haiku-5');
        await expect(running.getByTestId('agent-child-state')).toHaveText('Working');
        // a running child's clock counts from its start up to now, so it reads in days for a fixture dated in the past
        await expect(running.getByTestId('agent-child-clock')).toHaveText(/^\d+[mhd]/);
        await expect(card.getByTestId('agent-children-toggle')).toHaveCount(0);
    });

    test('indents the child rail inside its parent\'s, colours it by the child\'s own state, and dims a finished child', async ({ page }) => {
        const card = await treeBoard(page, 1);
        const main_rail = await card.getByTestId('agent-row-button').locator('> span').first().boundingBox();
        const children = card.getByTestId('agent-child-row');
        const rail_of = (row: Locator): Locator => row.locator('> span').first();
        const finished_rail = await rail_of(children.nth(0)).boundingBox();
        expect(finished_rail!.x - main_rail!.x).toBeGreaterThanOrEqual(10);
        const colour_of = (row: Locator): Promise<string> => rail_of(row).evaluate(el => getComputedStyle(el).backgroundColor);
        const running_colour = await colour_of(children.nth(1));
        expect(running_colour).not.toBe('rgba(0, 0, 0, 0)');
        expect(await colour_of(children.nth(0))).not.toBe(running_colour);
        expect(Number(await children.nth(0).evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(1);
        expect(Number(await children.nth(1).evaluate(el => getComputedStyle(el).opacity))).toBe(1);
        expect(await card.getByTestId('agent-children').evaluate(ul => getComputedStyle(ul).listStyleType)).toBe('none');
    });

    test('folds finished subagents past the latest three behind a keyboard-operable count and expands them', async ({ page }) => {
        const card = await treeBoard(page, 6);
        await expect(card.getByTestId('agent-child-row')).toHaveCount(4);
        const toggle = card.getByTestId('agent-children-toggle');
        await expect(toggle).toHaveText('Show 3 earlier finished subagents');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(card.getByTestId('agent-child-row')).toHaveCount(7);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(card.getByTestId('agent-child-title').first()).toHaveText('Finished task 1');
        await page.keyboard.press('Space');
        await expect(card.getByTestId('agent-child-row')).toHaveCount(4);
    });

    test('keeps every cell of the session row and of a child row on one line at the narrow and the wide layout', async ({ page }) => {
        const card = await treeBoard(page, 1);
        const rows = card.getByTestId('agent-rows');
        const cells_of = (row: Locator, testids: string[]): Promise<Array<{ testid: string; height: number; font_size: number }>> => row.evaluate((el, ids) => ids.map(testid => {
            const cell = el.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
            return { testid, height: cell.getBoundingClientRect().height, font_size: parseFloat(getComputedStyle(cell).fontSize) };
        }), testids);
        const main_cells = ['agent-monogram', 'agent-name', 'agent-model', 'agent-state', 'agent-clock', 'agent-live', 'agent-usage'];
        const child_cells = ['agent-child-monogram', 'agent-child-model', 'agent-child-state', 'agent-child-clock', 'agent-child-title', 'agent-child-usage'];
        async function expectOneLine(): Promise<void> {
            for (const cell of await cells_of(card.getByTestId('agent-row-button'), main_cells)) {
                expect(cell.height, `${cell.testid} wrapped`).toBeLessThanOrEqual(cell.font_size * 1.6);
            }
            for (const cell of await cells_of(card.getByTestId('agent-child-row').nth(1), child_cells)) {
                expect(cell.height, `${cell.testid} wrapped`).toBeLessThanOrEqual(cell.font_size * 1.6);
            }
        }
        expect((await rows.boundingBox())!.width).toBeGreaterThanOrEqual(440);
        await expectOneLine();
        await page.getByTestId('view-settings-button').click();
        await page.getByTestId('view-radio-kanban').click();
        await expect(page.locator('[role="columnheader"]').first()).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 600, height: 900 });
        await expect.poll(async () => (await card.getByTestId('agent-rows').boundingBox())!.width).toBeLessThan(440);
        await expectOneLine();
        const child_title = await card.getByTestId('agent-child-row').nth(1).getByTestId('agent-child-title').boundingBox();
        expect(child_title!.width).toBeGreaterThan(80);
    });

    test('draws a session without subagents as a flat row, and one without a name with no name cell', async ({ page }) => {
        await treeBoard(page, 1);
        await injectActivity(page);
        const card = page.locator('[data-card-type="agent"]').filter({ hasText: 'Agent activity card' }).first();
        await expect(card.getByTestId('agent-row')).toHaveCount(1);
        await expect(card.getByTestId('agent-children')).toHaveCount(0);
        await expect(card.getByTestId('agent-name')).toHaveCount(0);
    });
});
