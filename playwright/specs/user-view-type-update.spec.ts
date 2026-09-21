import { test, expect, type Page } from '@playwright/test';
import { injectDocsFromFixture } from '../helpers/inject-docs';
import { injectMultipleDocsFromFixtures, selectFolderMode } from '../helpers/inject-multi-docs';

/*
 * Keeping a change in a custom view type, driven in the browser against the real bundle.
 *
 * A custom type is the one node in the tree whose values are the user's own, and these two cases are the
 * halves of what that has to mean. A setting the type already holds is editable from the drawer and the
 * board follows it, rather than being written to the workspace where the type's own value paints over it;
 * a setting the type does not hold can be moved into it, which is what leaves nothing behind at the
 * workspace scope for a revert to take away.
 */

interface HarnessSettingsStore {
    user: Record<string, unknown>;
    workspace: Record<string, unknown>;
}

interface HarnessUserViewType {
    id: string;
    label: string;
    parent: string;
    overrides: Record<string, unknown>;
}

// a saved type in the shape the drawer writes one: a kanban whose lanes are an axis of its own
const BY_ASSIGNEE: HarnessUserViewType = {
    id: 'user-by-assignee',
    label: 'By Assignee',
    parent: 'kanban',
    overrides: { kanbanGroupBy: 'assignee' },
};

async function readHarnessSettings(page: Page): Promise<HarnessSettingsStore> {
    return page.evaluate(() => (window as unknown as { __nt_settings: HarnessSettingsStore }).__nt_settings);
}

/** the saved view types as the harness holds them, which is where a change kept in a type has to land */
async function readSavedTypes(page: Page): Promise<HarnessUserViewType[]> {
    const settings = await readHarnessSettings(page);
    return (settings.workspace.viewUserTypes ?? settings.user.viewUserTypes ?? []) as HarnessUserViewType[];
}

/** the lane values the board is currently drawing, in board order */
async function laneValues(page: Page): Promise<string[]> {
    return page.locator('[data-flip-column-id]').evaluateAll(els => els.map(el => el.getAttribute('data-flip-column-id') ?? ''));
}

/** put values at the workspace scope and re-publish the cascade, as a window reopened on a saved type arrives */
async function seedWorkspaceSettings(page: Page, values: Record<string, unknown>): Promise<void> {
    await page.evaluate((seeded) => {
        const harness = window as unknown as { __nt_settings: { workspace: Record<string, unknown> }; __nt_publishSettings?: () => void };
        Object.assign(harness.__nt_settings.workspace, seeded);
        harness.__nt_publishSettings?.();
    }, values);
}

/** re-publish the cascade unchanged, which is the arrival a reopened window sees */
async function republishSettings(page: Page): Promise<void> {
    await seedWorkspaceSettings(page, {});
}

async function openSettingsDrawer(page: Page): Promise<void> {
    const tab = page.getByTestId('view-settings-button');
    if (await tab.getAttribute('aria-expanded') !== 'true') {
        await tab.click();
    }
    await expect(page.getByTestId('settings-drawer-grid')).toHaveAttribute('data-open', 'true');
}

/*
 * A folder board of two files rendering as the saved type, with the drawer open on that type.
 *
 * Folder mode with two boards, because the group-by candidates are enumerated from the notes and a
 * categorical attribute has to be present for the axis to be changeable at all. The type is seeded into
 * the settings rather than minted through the drawer, so each case starts from the state the operator's
 * own window opens in: a type already on disk, already pinned.
 */
async function showBoardOnSavedType(page: Page): Promise<void> {
    await injectMultipleDocsFromFixtures(page, [
        { fixture: 'settings-drawer-board.md', doc_path: '/workspace/alpha/todo.md', relative_path: 'alpha/todo.md' },
        { fixture: 'settings-board-b.md', doc_path: '/workspace/beta/todo.md', relative_path: 'beta/todo.md' },
    ], { workspace_root: '/workspace' });
    await selectFolderMode(page);
    await page.waitForSelector('[data-folder-mode="true"]');
    await seedWorkspaceSettings(page, { viewUserTypes: [BY_ASSIGNEE], viewType: BY_ASSIGNEE.id });
    await expect(page.getByTestId('view-settings-button')).toHaveText(/By Assignee/);
    await openSettingsDrawer(page);
    await expect(page.getByTestId(`view-node-${BY_ASSIGNEE.id}`)).toBeVisible();
}

test.describe('Custom view type update', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/playwright/harness/index.html');
        await page.waitForSelector('[data-testid="NoteRenderer"]', { state: 'attached' });
        await injectDocsFromFixture(page, 'settings-drawer-board.md');
        await page.waitForSelector('[data-seq]', { timeout: 5000 });
    });

    /*
     * The fault this case stands over: the write went to the workspace, the type's override won at render,
     * and the lanes never moved while the control snapped back on the next echo.
     */
    test('changing Group by on a type that holds it moves the lanes and writes into the type', async ({ page }) => {
        await showBoardOnSavedType(page);
        // the board is drawn on the type's own axis, which is what makes it a type rather than a preference
        expect(await laneValues(page)).toEqual(['alex', 'sam']);
        await expect(page.getByTestId('setting-pill-kanbanGroupBy')).toHaveText('By Assignee');
        await expect(page.getByTestId('new-view-type-offer')).toHaveCount(0);

        await page.getByTestId('group-by-selector').selectOption('status');

        await expect.poll(async () => laneValues(page)).toEqual(['doing', 'done']);
        await expect.poll(async () => (await readSavedTypes(page))[0].overrides.kanbanGroupBy).toBe('status');
        // nothing at the workspace scope, so nothing for the type's own value to paint over
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.kanbanGroupBy).toBeUndefined();
        await expect(page.getByTestId('group-by-selector')).toHaveValue('status');
        await expect(page.getByTestId('new-view-type-offer')).toHaveCount(0);
    });

    /*
     * The other half: a row the type does not hold lands at the workspace scope, where it belongs to this
     * workspace rather than to the type. Updating moves it into the type and clears the workspace key, so
     * a cascade arriving with that scope empty still renders the change.
     */
    test('updating the type keeps the change once the workspace scope is cleared', async ({ page }) => {
        await showBoardOnSavedType(page);

        await page.getByTestId('setting-control-kanbanCardRatio').selectOption('2');

        // the ratio is kanban's rather than the type's, so it lands at the workspace scope and is offered
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.kanbanCardRatio).toBe(2);
        await expect(page.getByTestId('new-view-type-offer')).toBeVisible();
        await expect(page.getByTestId('new-view-type-reason')).toContainText('Update By Assignee');

        await page.getByTestId('user-view-type-update').click();

        await expect.poll(async () => (await readSavedTypes(page))[0].overrides.kanbanCardRatio).toBe(2);
        await expect.poll(async () => (await readHarnessSettings(page)).workspace.kanbanCardRatio).toBeUndefined();
        await expect(page.getByTestId('setting-row-kanbanCardRatio')).toHaveAttribute('data-diverged', 'false');
        await expect(page.getByTestId('setting-pill-kanbanCardRatio')).toHaveText('By Assignee');
        await expect(page.getByTestId('new-view-type-offer')).toHaveCount(0);
        // the type keeps what it was updated with, so the axis it was saved with is still its own
        await expect.poll(async () => (await readSavedTypes(page))[0].overrides.kanbanGroupBy).toBe('assignee');

        await republishSettings(page);

        await expect(page.getByTestId('setting-control-kanbanCardRatio')).toHaveValue('2');
        await expect.poll(async () => laneValues(page)).toEqual(['alex', 'sam']);
    });
});
