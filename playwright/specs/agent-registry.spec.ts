import { test, expect, type Locator, type Page } from '@playwright/test';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';
import { injectActivity } from '../helpers/inject-activity';

const WORKSPACE_ROOT = '/mnt/workspace/in_development';
const NOTETHINK_TODO = 'notethink/docstech/users/alex.stanhope/todo.md';
const NOTEGIT_TODO = 'notegit/docstech/users/alex.stanhope/todo.md';

/*
 * Agents known from the thinkersync registry, driven in the browser against the real bundle and a
 * synthetic snapshot shaped as the analyser posts it. Jest proves the entry parsing, the join to
 * vendor sessions and the board cross-check; what only a browser shows is a registry-only agent of a
 * vendor NoteThink cannot read drawing as a flat row among the cards, a coordinator placed on its
 * story's card with no transcript yet, a stale entry reading Stale, and a stopped one drawing nothing.
 */

async function harness(page: Page): Promise<void> {
    await page.goto('/playwright/harness/index.html');
    await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
}

async function registryBoard(page: Page, sessions: string[]): Promise<void> {
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
    await injectActivity(page, { sessions });
}

function virtualCard(page: Page, text: string): Locator {
    return page.locator('[data-card-type="agent"][data-virtual-note="true"]').filter({ hasText: text });
}

test.describe('Agents known from the registry', () => {

    test.beforeEach(async ({ page }) => {
        await harness(page);
    });

    test('draws a registry-only agent of an unread vendor as its own card with a name, monogram, state and story', async ({ page }) => {
        await registryBoard(page, ['registry-agy']);
        const card = virtualCard(page, 'AG agy-helper');
        await expect(card).toHaveCount(1);
        const row = card.getByTestId('agent-row');
        await expect(row).toHaveCount(1);
        await expect(row).toHaveAttribute('data-registry-only', 'true');
        await expect(row.getByTestId('agent-monogram')).toHaveText('AG');
        await expect(row.getByTestId('agent-name')).toHaveText('agy-helper');
        await expect(row.getByTestId('agent-state')).toHaveText('Idle');
        await expect(row.getByTestId('agent-live')).toHaveText('Registered, on kanban-card-ratio-height');
        await expect(row.getByTestId('agent-row-button')).toBeDisabled();
        await expect(row.getByTestId('agent-children')).toHaveCount(0);
    });

    test('places a working coordinator on its story\'s card before it has written anything', async ({ page }) => {
        await registryBoard(page, ['registry-coordinator']);
        const card = page.locator('[data-card-type="agent"]').filter({ hasText: 'Agent activity card' }).first();
        const row = card.getByTestId('agent-row');
        await expect(row).toHaveCount(1);
        await expect(row.getByTestId('agent-name')).toHaveText('coord-demo');
        await expect(row.getByTestId('agent-monogram')).toHaveText('CC');
        await expect(row.getByTestId('agent-state')).toHaveCount(0);
        await expect(row.getByTestId('agent-state-quiet')).toHaveText('Working');
        await expect(row).toHaveAttribute('data-state', 'working');
        // it is bound to the story, so no card of its own is minted for it
        await expect(page.locator('[data-card-type="agent"][data-virtual-note="true"]')).toHaveCount(0);
    });

    test('reads a stale working entry as Stale, and draws no card for a stopped agent', async ({ page }) => {
        await registryBoard(page, ['registry-stale', 'registry-stopped']);
        const stale = virtualCard(page, 'agy-stale');
        await expect(stale).toHaveCount(1);
        await expect(stale.getByTestId('agent-state')).toHaveText('Stale');
        await expect(stale.getByTestId('agent-row')).toHaveAttribute('data-stale', 'true');
        await expect(virtualCard(page, 'agy-stopped')).toHaveCount(0);
        await expect(page.locator('[data-card-type="agent"][data-virtual-note="true"]')).toHaveCount(1);
    });

    test('keeps a registry-only row on one line at the narrow and the wide layout', async ({ page }) => {
        await registryBoard(page, ['registry-agy']);
        const row = virtualCard(page, 'agy-helper').getByTestId('agent-row-button');
        async function expectOneLine(): Promise<void> {
            for (const testid of ['agent-monogram', 'agent-name', 'agent-state', 'agent-live']) {
                const metrics = await row.getByTestId(testid).evaluate(el => ({ height: el.getBoundingClientRect().height, font_size: parseFloat(getComputedStyle(el).fontSize) }));
                expect(metrics.height, `${testid} wrapped`).toBeLessThanOrEqual(metrics.font_size * 1.6);
            }
        }
        await expectOneLine();
        await page.setViewportSize({ width: 600, height: 900 });
        await expectOneLine();
    });
});
